const fs = require('fs');

function cleanUserMessage(raw) {
  if (!raw) return '';
  let text = String(raw);

  // 1. Extract <USER_REQUEST>...</USER_REQUEST> if present
  const reqMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (reqMatch) {
    text = reqMatch[1];
  }

  // 2. Strip XML system envelopes
  text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');
  text = text.replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '');
  text = text.replace(/<[^>]+>/g, '');

  return text.trim();
}

function cleanString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

function parseTranscriptString(rawText, limit = 50) {
  if (!rawText || !rawText.trim()) {
    return { turns: [], totalCount: 0, hasEarlier: false };
  }

  const lines = rawText.trim().split('\n');
  const allTurns = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        const cleaned = cleanUserMessage(obj.content);
        if (!cleaned) continue;
        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'user',
          content: cleaned,
          timestamp: obj.timestamp || null
        });
      } else if (obj.type === 'PLANNER_RESPONSE') {
        const toolCalls = [];
        if (Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            let summary = tc.toolSummary || null;
            let action = tc.toolAction || null;
            let args = tc.args || {};

            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch (e) {}
            }

            // Clean up surrounding quotes
            summary = cleanString(summary);
            action = cleanString(action);

            // Determine friendly label
            let label = summary || action;
            const toolName = tc.tool_name || tc.name || 'tool';
            if (!label) {
              if (toolName === 'run_command' && args.CommandLine) {
                label = 'Run command: ' + cleanString(args.CommandLine).slice(0, 50);
              } else if (toolName === 'view_file' && args.AbsolutePath) {
                const parts = cleanString(args.AbsolutePath).split('/');
                label = 'View ' + parts[parts.length - 1];
              } else if (toolName === 'search_web' && args.query) {
                label = 'Search web: ' + cleanString(args.query);
              } else {
                label = toolName;
              }
            }

            toolCalls.push({
              name: toolName,
              label,
              args,
              status: tc.status || obj.status || 'DONE'
            });
          }
        }

        const content = obj.content || '';
        const thinking = obj.thinking || null;

        // Skip completely empty turns
        if (!content.trim() && !thinking && toolCalls.length === 0) {
          continue;
        }

        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'assistant',
          content,
          toolCalls,
          thinking,
          timestamp: obj.timestamp || null
        });
      }
    } catch (e) {
      // Ignore corrupted lines safely
    }
  }

  const totalCount = allTurns.length;
  let turns = allTurns;
  let hasEarlier = false;

  if (limit && totalCount > limit) {
    turns = allTurns.slice(totalCount - limit);
    hasEarlier = true;
  }

  return {
    turns,
    totalCount,
    hasEarlier
  };
}

function parseTranscriptFile(filePath, limit = 50) {
  if (!fs.existsSync(filePath)) {
    return { turns: [], totalCount: 0, hasEarlier: false };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseTranscriptString(raw, limit);
  } catch (err) {
    console.error(`Failed to read transcript file ${filePath}:`, err);
    return { turns: [], totalCount: 0, hasEarlier: false };
  }
}

module.exports = {
  cleanUserMessage,
  parseTranscriptString,
  parseTranscriptFile
};
