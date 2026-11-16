// Optional paid API smoke test. Uses only synthetic conversation and image data.
require('dotenv').config({ quiet: true });
const originalResumePath = process.env.RESUME_CONTEXT_PATH;
process.env.RESUME_CONTEXT_PATH = ''; // This smoke test must use synthetic data only.
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('node:assert/strict');
const sharp = require('sharp');
const store = require('../src/services/conversation-store.service');
const modes = require('../src/services/assistant-mode.service');
const llm = require('../src/services/llm.service');
async function main() {
  if (!llm.isInitialized) { console.log('LIVE_CONVERSATION_SKIPPED: no configured API key'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-live-'));
  store.initialize(root); modes.initialize(store);
  const results = [];
  const ask = async (question, captures) => {
    const turn = store.createTurn({ source: captures ? 'screenshot' : 'chat', content: question });
    if (captures) store.addAttachments(turn.user.id, captures);
    let chunks = 0;
    const result = await llm.processConversation(turn, {}, () => chunks++);
    store.completeAssistant(turn.assistant.id, result.response, result.metadata);
    assert.ok(chunks > 0); results.push({ question, answer: result.response, ...result.metadata });
    return result.response;
  };
  try {
    await ask('Our synthetic project is Cedar. Problem one is a slow disk. Problem two is stale cache entries. The exact timeout is 1777 milliseconds. Acknowledge briefly.');
    const followup = await ask('What was the second problem, and what exact timeout did I give?');
    assert.match(followup, /stale|cache/i); assert.match(followup, /1,?777/);
    modes.set('behavioral_star');
    const behavioral = await ask('Give an explicitly hypothetical behavioral interview answer about resolving a team disagreement. Show the STAR breakdown using Situation:, Task:, Action:, and Result: labels. Use placeholders for outcomes and do not claim this is my real experience.');
    for (const label of ['Situation:', 'Task:', 'Action:', 'Result:']) assert.ok(behavioral.includes(label), label);
    const technical = await ask('What is a race condition? Keep the technical explanation brief.');
    assert.doesNotMatch(technical, /Situation:|Task:|Action:|Result:/);
    modes.set('normal');
    const image = await sharp(Buffer.from('<svg width="500" height="160"><rect width="500" height="160" fill="white"/><text x="30" y="100" font-size="64" fill="black">CACHE 42</text></svg>')).png().toBuffer();
    await ask('Read the label in this image and remember it.', [{ imageBuffer: image, mimeType: 'image/png' }]);
    const visual = await ask('Look at the previous image. What exact number is shown?');
    assert.match(visual, /42/);
    console.log('LIVE_CONVERSATION_PASS', JSON.stringify(results));
  } finally { if (originalResumePath === undefined) delete process.env.RESUME_CONTEXT_PATH; else process.env.RESUME_CONTEXT_PATH = originalResumePath; require('../src/core/resume-context').resumeContext.clearCache(); store.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error('LIVE_CONVERSATION_FAILED', error.message); process.exitCode = 1; });
