const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OPENAI_API_KEY = 'test-key';
process.env.OPENAI_MODEL = 'gpt-6-luna';
const service = require('../src/services/llm.service');

test('preserves instructions, conversation roles, and screenshot data', () => {
  const request = service.buildOpenAIRequest({
    systemInstruction: { parts: [{ text: 'Use Python.' }] },
    contents: [
      { role: 'model', parts: [{ text: 'Previous answer' }] },
      { role: 'user', parts: [{ text: 'Explain this' }, { inlineData: { mimeType: 'image/png', data: 'abc' } }] }
    ],
    generationConfig: { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } }
  });
  assert.ok(request.instructions.startsWith('Use Python.'));
  assert.match(request.instructions, /clean, runnable source/);
  assert.equal(request.input[0].role, 'assistant');
  assert.equal(request.input[0].content[0].type, 'output_text');
  assert.equal(request.input[1].content[1].image_url, 'data:image/png;base64,abc');
  assert.equal(request.max_output_tokens, 1000);
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.reasoning.effort, 'low');
  assert.equal(request.store, false);
  assert.equal(request.generationConfig, undefined);
});

test('streams deltas and rejects incomplete answers', async () => {
  const originalClient = service.client;
  try {
    service.client = { responses: { create: async function* () {
      yield { type: 'response.output_text.delta', delta: 'Hello' };
      yield { type: 'response.output_text.delta', delta: ' world' };
      yield { type: 'response.completed' };
    } } };
    const deltas = [];
    assert.equal(await service.executeStreamingRequest({ contents: 'Hi' }, delta => deltas.push(delta)), 'Hello world');
    assert.deepEqual(deltas, ['Hello', ' world']);
    service.client.responses.create = async function* () {
      yield { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } };
    };
    await assert.rejects(service.executeStreamingRequest({ contents: 'Hi' }), /max_output_tokens/);
    service.client.responses.create = async () => ({ status: 'incomplete', output_text: 'Partial' });
    await assert.rejects(service.executeRequest({ contents: 'Hi' }), /incomplete/);
  } finally { service.client = originalClient; }
});

test('screenshot batches use Luna without changing concurrent text routing', async () => {
  const originalClient = service.client;
  const requests = [];
  try {
    service.client = { responses: { create: async function* (request) {
      requests.push(request);
      yield { type: 'response.output_text.delta', delta: 'Answer' };
      yield { type: 'response.completed' };
    } } };
    const images = ['first', 'second'].map(text => ({ imageBuffer: Buffer.from(text), mimeType: 'image/png' }));
    const [result] = await Promise.all([
      service.processImageWithSkillStream(images, 'image/png', 'dsa', [], 'python'),
      service.processTextWithSkillStream('Explain arrays', 'dsa')
    ]);
    const imageRequest = requests.find(request => request.input.some(message => message.content.some(part => part.type === 'input_image')));
    assert.equal(imageRequest.model, 'gpt-6-luna');
    assert.equal(imageRequest.reasoning.effort, 'low');
    assert.equal(imageRequest.input[0].content.filter(part => part.type === 'input_image').length, 2);
    assert.equal(requests.find(request => request !== imageRequest).model, 'gpt-6-luna');
    assert.equal(requests.find(request => request !== imageRequest).reasoning.effort, 'low');
    assert.equal(result.metadata.imageCount, 2);
    service.client.responses.create = async () => { throw new Error('offline'); };
    await assert.rejects(service.processImageWithSkill(images, 'image/png', 'dsa'), /offline/);
  } finally { service.client = originalClient; }
});

test('maps purpose descriptions by line number without allowing the model to rewrite source', async () => {
  const originalClient = service.client;
  const plain = '```python\ndef add(a, b):\n    return a + b\n```';
  const annotated = '```python\n# @explain: I combine the two inputs.\ndef add(a, b):\n# @explain: I give back their sum.\n    return a + b\n```';
  try {
    let sidecarRequest;
    service.client = { responses: { create: async request => {
      sidecarRequest = request;
      return { output_text: JSON.stringify({ descriptions: {
        b0_l2: 'I give back their sum.',
        b0_l1: 'I combine the two inputs.'
      } }) };
    } } };
    assert.equal(await service.ensureCodeAnnotations(plain, {}), annotated);
    assert.equal(sidecarRequest.text.format.type, 'json_schema');
    assert.equal(sidecarRequest.model, 'gpt-6-luna');
    assert.equal(sidecarRequest.reasoning.effort, 'low');
    const descriptionInput = JSON.parse(sidecarRequest.input[0].content[0].text);
    assert.equal(descriptionInput.requestedLines[0].focus, 'problem_goal');
    assert.equal(descriptionInput.requestedLines[1].focus, 'step_purpose');
    assert.equal(sidecarRequest.text.format.schema.properties.descriptions.additionalProperties, false);
    assert.deepEqual(sidecarRequest.text.format.schema.properties.descriptions.required, ['b0_l1', 'b0_l2']);
    service.client.responses.create = async () => ({ output_text: JSON.stringify({ descriptions: [
      { block: 1, line: 1, description: 'I show the result again.' },
      { block: 0, line: 1, description: 'I show the initial result.' }
    ] }) });
    const duplicate = '```python\nprint(1)\n```\n\n```python\nprint(1)\n```';
    const mapped = require('../lib/response-parts').splitResponse(await service.ensureCodeAnnotations(duplicate, {}));
    assert.equal(mapped.codeBlocks[0].lines[0].explanation, 'I show the initial result.');
    assert.equal(mapped.codeBlocks[1].lines[0].explanation, 'I show the result again.');
    assert.ok(mapped.codeBlocks.every(block => block.cleanCode === 'print(1)\n'));
    service.client.responses.create = async () => ({ output_text: 'unparseable description response' });
    assert.equal(await service.ensureCodeAnnotations(plain, {}), plain, 'Malformed description data cannot fail the screenshot');
    service.client.responses.create = async () => { throw new Error('description request offline'); };
    assert.equal(await service.ensureCodeAnnotations(plain, {}), plain, 'A description failure cannot discard the code answer');
    const fenced = service.enforceProgrammingLanguage(annotated + '\n', 'python');
    const parts = require('../lib/response-parts').splitResponse(fenced);
    assert.equal(parts.codeBlocks.length, 1);
    assert.equal(parts.codeBlocks[0].cleanCode, 'def add(a, b):\n    return a + b\n');
    assert.ok(parts.codeBlocks[0].lines.every(line => line.explanation));
  } finally { service.client = originalClient; }
});

test('typed and spoken follow-ups receive exactly the last three completed Q&A pairs', () => {
  const session = require('../src/managers/session.manager');
  const original = session.qaTurns;
  try {
    session.qaTurns = [];
    for (let i = 1; i <= 4; i++) session.addQATurn(`Question ${i}`, `Answer ${i}`);
    // Unanswered inputs and system events must not displace completed pairs.
    for (const request of [
      service.buildPromptRequest('Follow up', 'dsa', [], 'python'),
      service.buildIntelligentTranscriptionRequest('Follow up', 'dsa', [], 'python')
    ]) {
      assert.equal(request.contents.length, 7);
      assert.deepEqual(request.contents.slice(0, 6).map(item => [item.role, item.parts[0].text]), [
        ['user', 'Question 2'], ['model', 'Answer 2'],
        ['user', 'Question 3'], ['model', 'Answer 3'],
        ['user', 'Question 4'], ['model', 'Answer 4']
      ]);
      assert.match(request.contents[6].parts[0].text, /Follow up/);
    }
    session.clear();
    assert.deepEqual(session.getQAHistory(), []);
  } finally { session.qaTurns = original; }
});

test('spoken questions default to concepts and skip screenshot code annotations', async () => {
  const request = service.buildIntelligentTranscriptionRequest('How does binary search work?', 'dsa', [], 'python');
  assert.equal(request.responseSource, 'speech');
  assert.match(request.systemInstruction.parts[0].text, /Default to a CONCEPTUAL/);
  assert.match(request.systemInstruction.parts[0].text, /unless the speaker explicitly asks/);
  const originalClient = service.client;
  try {
    service.client = { responses: { create: () => { throw new Error('Speech must not request screenshot annotations'); } } };
    const response = '<!-- coding-answer -->\n```python\ndef add(a, b):\n    return a + b\n```';
    assert.equal(await service.ensureCodeAnnotations(response, request), '```python\ndef add(a, b):\n    return a + b\n```');
  } finally { service.client = originalClient; }
});

test('clearing a key resets the initialized client', () => {
  delete process.env.OPENAI_API_KEY;
  service.initializeClient();
  assert.equal(service.isInitialized, false);
  assert.equal(service.client, null);
});
