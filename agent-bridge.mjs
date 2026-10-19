import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

export class AgentBridgeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workers = new Map(); // cid -> { proc, lineRemainder, lastUsed, relayUrl }
    this.idleTimeoutMs = options.idleTimeoutMs || 30 * 60 * 1000; // 30 min
    this.workDir = options.workDir || path.join(process.env.HOME || '/home/ttolmany', 'gdrive/work/SecondBrain');

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

    const proc = spawn('agy', [
      `--conversation=${cid}`,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--remote-control',
      '--dangerously-skip-permissions'
    ], {
      cwd: this.workDir,
      env: { ...process.env, PAGER: 'cat' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    worker = {
      cid,
      proc,
      lineRemainder: '',
      lastUsed: Date.now(),
      relayUrl: null
    };

    proc.stdout.on('data', (chunk) => {
      worker.lineRemainder += chunk.toString('utf-8');
      const lines = worker.lineRemainder.split('\n');
      worker.lineRemainder = lines.pop(); // keep partial

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          this.emit('event', { cid, data: parsed });
          if (parsed.event === 'turn' || parsed.event === 'result') {
            this.emit('turn', { cid, data: parsed });
          }
        } catch (e) {
          // Non-JSON line or debug output
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      const match = text.match(/https:\/\/antigravity\.google\.com\/r\/[a-zA-Z0-9_-]+/);
      if (match) {
        worker.relayUrl = match[0];
        this.emit('relay-url', { cid, url: match[0] });
      }
    });

    proc.on('exit', () => {
      this.workers.delete(cid);
      this.emit('exit', { cid });
    });

    this.workers.set(cid, worker);
    return worker;
  }

  sendPrompt(cid, text, attachments = []) {
    const worker = this.getWorker(cid);
    if (!worker || !worker.proc || worker.proc.killed) {
      throw new Error(`Worker process unavailable for session ${cid}`);
    }

    let promptText = text;
    if (attachments && attachments.length > 0) {
      const attachNotes = attachments.map(a => `[첨부 파일]\n- ${a.path}`).join('\n');
      promptText = `${promptText}\n\n${attachNotes}`;
    }

    const msg = {
      event: 'prompt',
      prompt: promptText
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
