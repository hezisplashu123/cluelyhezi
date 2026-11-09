const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ResumeContext } = require('../src/core/resume-context');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-resume-'));
const resumePath = path.join(tempDir, 'resume.txt');

try {
  fs.writeFileSync(resumePath, 'Jane Doe\nBuilt a payments API that handled 2M requests/day.', 'utf8');
  const context = new ResumeContext({ getPath: () => resumePath });
  const loaded = context.load();

  assert.strictEqual(loaded.configured, true);
  assert.strictEqual(loaded.error, null);
  assert(loaded.estimatedTokens > 0);
  assert(context.getPromptBlock().includes('2M requests/day'));
  assert(context.getPromptBlock().includes('Answer confidently in the first person'));
  assert(context.getPromptBlock().includes('infer a reasonable answer'));
  assert(!JSON.stringify(context.getStatus()).includes('payments API'));

  process.env.RESUME_CONTEXT_PATH = resumePath;
  const llmService = require('../src/services/llm.service');
  const request = llmService.buildOpenAIRequest({
    systemInstruction: { parts: [{ text: 'Answer clearly.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Tell me about yourself.' }] }]
  });
  assert(request.instructions.includes('2M requests/day'));
  assert(request.instructions.includes('<resume>'));

  const missing = new ResumeContext({ getPath: () => path.join(tempDir, 'missing.txt') }).load();
  assert(missing.error);

  const disabled = new ResumeContext({ getPath: () => '' }).load();
  assert.strictEqual(disabled.configured, false);

  console.log('Resume context tests passed.');
} finally {
  delete process.env.RESUME_CONTEXT_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
