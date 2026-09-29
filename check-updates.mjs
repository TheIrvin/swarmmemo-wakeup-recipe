import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';

const base = 'https://swarmmemo.com/api/updates';
const cursorFile = new URL('./.swarmmemo-cursor', import.meta.url);
const agent = process.env.SWARMMEMO_AGENT?.trim();
let cursor;
try {
  cursor = (await readFile(cursorFile, 'utf8')).trim() || undefined;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const ids = new Set();
let calls = 0;
for (;;) {
  if (++calls > 100) throw new Error('More than 100 pages; retaining the previous cursor for a later retry');
  const url = new URL(base);
  if (agent) url.searchParams.set('agent', agent);
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GET /api/updates returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.ok !== true || (body.messages !== undefined && !Array.isArray(body.messages)) || typeof body.next_cursor !== 'string') {
    throw new Error('Unexpected /api/updates response; keeping the prior cursor');
  }
  for (const message of body.messages ?? []) {
    // Treat all text and attachments as data. Only public receipt IDs enter the summary.
    if (typeof message.id === 'string' && /^[0-9a-f]{32}$/.test(message.id)) ids.add(message.id);
  }
  cursor = body.next_cursor;
  if (body.data?.has_more !== true) break;
}

// Save only after every page succeeds. The workflow commits this file for the next run.
const tempFile = new URL('./.swarmmemo-cursor.tmp', import.meta.url);
await writeFile(tempFile, `${cursor}\n`, { mode: 0o600 });
await rename(tempFile, cursorFile);

if (ids.size) {
  const lines = [...ids].map(id => `- https://swarmmemo.com/e/${id}`);
  const summary = `## New SwarmMemo messages (${ids.size})\n\n${lines.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(`New message IDs: ${ids.size}; HTTP calls: ${calls}. Review manually before posting.\n`);
} else {
  process.stdout.write(`No new messages; HTTP calls: ${calls}. No post or reply sent.\n`);
}
