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

function extractUserAttachments(rawText) {
  let text = String(rawText || '');
  const attachments = [];

  const attachBlockRegex = /(?:\n\s*)?\[(?:첨부 파일|Attached Files)\]\s*([\s\S]*)$/i;
  const match = text.match(attachBlockRegex);

  if (match) {
    const listPart = match[1];
    text = text.slice(0, match.index).trim();
    const lines = listPart.split('\n');
    for (const line of lines) {
      const trimmed = line.replace(/^[\s\-\*•]+/, '').trim();
      if (!trimmed) continue;
      const fileName = trimmed.split('/').pop() || 'attachment';
      const isUpload = trimmed.includes('/uploads/');
      const url = isUpload ? `/uploads/${fileName}` : trimmed;
      attachments.push({
        name: fileName,
        path: trimmed,
        url: url
      });
    }
  }

  return { text, attachments };
}

function parseTranscriptString(rawText, limit = 50, beforeIndex = null) {
  if (!rawText || !rawText.trim()) {
    return { turns: [], totalCount: 0, hasEarlier: false, earliestIndex: null, latestIndex: null };
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
        const { text: contentText, attachments } = extractUserAttachments(cleaned);
        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'user',
          content: contentText,
          attachments: attachments,
          timestamp: obj.timestamp || obj.created_at || null
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
          timestamp: obj.timestamp || obj.created_at || null
        });
      }
    } catch (e) {
      // Ignore corrupted lines safely
    }
  }

  const totalCount = allTurns.length;
  let candidateTurns = allTurns;

  if (beforeIndex !== null && beforeIndex !== undefined && !isNaN(beforeIndex)) {
    const beforeIdxNum = Number(beforeIndex);
    candidateTurns = allTurns.filter(t => t.index < beforeIdxNum);
  }

  let turns = candidateTurns;
  let hasEarlier = false;

  if (limit && candidateTurns.length > limit) {
    const candidateStart = candidateTurns.length - limit;
    const userIndices = [];
    for (let i = 0; i < candidateTurns.length; i++) {
      if (candidateTurns[i].role === 'user') {
        userIndices.push(i);
      }
    }

    let startIndex = candidateStart;
    if (userIndices.length > 0) {
      // Find the user turn at or immediately preceding candidateStart
      // so turns[0] always begins cleanly with a user conversational prompt
      let bestUserIdx = -1;
      for (let i = userIndices.length - 1; i >= 0; i--) {
        if (userIndices[i] <= candidateStart) {
          bestUserIdx = userIndices[i];
          break;
        }
      }

      if (bestUserIdx !== -1) {
        startIndex = bestUserIdx;
      } else {
        // All user turns are after candidateStart, start at first user turn
        startIndex = userIndices[0];
      }
    }

    if (startIndex > 0) {
      turns = candidateTurns.slice(startIndex);
      hasEarlier = true;
    } else {
      turns = candidateTurns;
      hasEarlier = false;
    }
  }

  return {
    turns,
    totalCount,
    hasEarlier,
    earliestIndex: turns.length > 0 ? turns[0].index : null,
    latestIndex: turns.length > 0 ? turns[turns.length - 1].index : null
  };
}

function parseTranscriptFile(filePath, limit = 50, beforeIndex = null) {
  if (!fs.existsSync(filePath)) {
    return { turns: [], totalCount: 0, hasEarlier: false, earliestIndex: null, latestIndex: null };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseTranscriptString(raw, limit, beforeIndex);
  } catch (err) {
    console.error(`Failed to read transcript file ${filePath}:`, err);
    return { turns: [], totalCount: 0, hasEarlier: false, earliestIndex: null, latestIndex: null };
  }
}

module.exports = {
  cleanUserMessage,
  parseTranscriptString,
  parseTranscriptFile
};
