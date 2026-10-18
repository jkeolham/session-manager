const fs = require('fs');

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
        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'user',
          content: obj.content || '',
          timestamp: obj.timestamp || null
        });
      } else if (obj.type === 'PLANNER_RESPONSE') {
        const toolCalls = [];
        if (Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            toolCalls.push({
              name: tc.tool_name || tc.name || 'tool',
              args: tc.args || {},
              summary: tc.toolSummary || null
            });
          }
        }
        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'assistant',
          content: obj.content || '',
          toolCalls: toolCalls,
          thinking: obj.thinking || null,
          timestamp: obj.timestamp || null
        });
      }
    } catch (e) {
      // Ignore corrupted or partially flushed lines safely
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
  parseTranscriptString,
  parseTranscriptFile
};
