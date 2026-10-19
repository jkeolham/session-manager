import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

const defaultAgyBin = fs.existsSync(path.join(process.env.HOME || '/home/ttolmany', '.local/bin/agy'))
  ? path.join(process.env.HOME || '/home/ttolmany', '.local/bin/agy')
  : 'agy';

export class AgentBridgeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workers = new Map(); // cid -> { proc, lineRemainder, lastUsed, relayUrl }
    this.idleTimeoutMs = options.idleTimeoutMs || 30 * 60 * 1000; // 30 min
    this.workDir = options.workDir || path.join(process.env.HOME || '/home/ttolmany', 'gdrive/work/SecondBrain');
    this.agyBin = options.agyBin || defaultAgyBin;

    // Periodic idle reaper
    this.reaperInterval = setInterval(() => {
      const now = Date.now();
      for (const [cid, worker] of this.workers.entries()) {
        if (now - worker.lastUsed > this.idleTimeoutMs) {
          this.closeWorker(cid);
        }
      }
    }, 60 * 1000);
    this.reaperInterval.unref();
  }

  getWorker(cid) {
    if (!cid) return null;
    let worker = this.workers.get(cid);
    if (worker && !worker.proc.killed) {
      worker.lastUsed = Date.now();
      return worker;
    }

    // Clean up any legacy tmux session to prevent SQLite locks
    const oldTmux = `rc_${cid.slice(0, 8)}`;
    try {
      execSync(`tmux kill-session -t "${oldTmux}" 2>/dev/null || true`);
    } catch (e) {}

    const customPath = `${path.join(process.env.HOME || '/home/ttolmany', '.local/bin')}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`;
    const proc = spawn(this.agyBin, [
      `--conversation=${cid}`,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--remote-control',
      '--dangerously-skip-permissions'
    ], {
      cwd: this.workDir,
      env: { ...process.env, PATH: customPath, PAGER: 'cat' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    console.log(`[AgentBridge] Spawning worker for cid ${cid} using ${this.agyBin}`);
    proc.on('error', (err) => {
      console.error(`[AgentBridge] Worker process error for ${cid}:`, err.message);
      this.workers.delete(cid);
      this.emit('error', { cid, error: err });
    });

    if (proc.stdin) {
      proc.stdin.on('error', (err) => {
        console.error(`[AgentBridge stdin ${cid.slice(0, 8)} error]:`, err.message);
      });
    }

    worker = {
      cid,
      proc,
      lineRemainder: '',
      lastUsed: Date.now(),
      relayUrl: null
    };

    proc.stdout.on('data', (chunk) => {
      worker.lastUsed = Date.now();
      worker.lineRemainder += chunk.toString('utf-8');
      const lines = worker.lineRemainder.split('\n');
      worker.lineRemainder = lines.pop(); // keep partial

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        console.log(`[AgentBridge stdout ${cid.slice(0, 8)}]:`, trimmed.slice(0, 160));
        try {
          const parsed = JSON.parse(trimmed);
          this.emit('event', { cid, data: parsed });
          if (parsed.event === 'turn' || parsed.event === 'result' || parsed.event === 'step_update') {
            this.emit('turn', { cid, data: parsed });
          }
        } catch (e) {
          // Non-JSON line or debug output
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      console.log(`[AgentBridge stderr ${cid.slice(0, 8)}]:`, text.trim());
      const match = text.match(/https:\/\/antigravity\.google\.com\/r\/[a-zA-Z0-9_-]+/);
      if (match) {
        worker.relayUrl = match[0];
        console.log(`[AgentBridge relay-url ${cid.slice(0, 8)}]:`, match[0]);
        this.emit('relay-url', { cid, url: match[0] });
      }
    });

    proc.on('exit', (code, signal) => {
      console.log(`[AgentBridge exit ${cid.slice(0, 8)}]: code=${code}, signal=${signal}`);
      this.workers.delete(cid);
      this.emit('exit', { cid });
    });

    this.workers.set(cid, worker);
    return worker;
  }

  sendPrompt(cid, text, attachments = []) {
    console.log(`[AgentBridge sendPrompt ${cid.slice(0, 8)}]:`, (text || '').slice(0, 60));
    const worker = this.getWorker(cid);
    if (!worker || !worker.proc || worker.proc.killed) {
      throw new Error(`Worker process unavailable for session ${cid}`);
    }

    let promptText = text;
    if (attachments && attachments.length > 0) {
      const attachNotes = attachments.map(a => {
        const p = typeof a === 'string' ? a : (a.path || a.destPath || a.url || a.name || '');
        return `- ${p}`;
      }).join('\n');
      promptText = `${promptText}\n\n[첨부 파일]\n${attachNotes}`;
    }

    const msg = {
      event: 'user',
      message: {
        content: promptText
      }
    };

    worker.proc.stdin.write(JSON.stringify(msg) + '\n');
    worker.lastUsed = Date.now();
    return true;
  }

  getRelayUrl(cid) {
    const worker = this.workers.get(cid);
    return worker ? worker.relayUrl : null;
  }

  closeWorker(cid) {
    const worker = this.workers.get(cid);
    if (worker && worker.proc && typeof worker.proc.kill === 'function' && !worker.proc.killed) {
      worker.proc.kill('SIGTERM');
    }
    this.workers.delete(cid);
  }

  closeAll() {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
    }
    for (const cid of this.workers.keys()) {
      this.closeWorker(cid);
    }
  }
}
