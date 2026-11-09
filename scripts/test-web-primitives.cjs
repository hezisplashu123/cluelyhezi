const test = require('node:test');
const assert = require('node:assert/strict');
const native = { URL: global.URL, Blob: global.Blob, File: global.File };
require('../src/services/speech.service');
test('speech initialization preserves web primitives used by OpenAI transport', () => {
  assert.equal(global.URL, native.URL);
  if (native.Blob) assert.equal(global.Blob, native.Blob);
  if (native.File) assert.equal(global.File, native.File);
  assert.deepEqual(Object.fromEntries(new URL('https://api.openai.com/v1/responses').searchParams), {});
});
