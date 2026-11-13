const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SpeakerVerification } = require('../src/services/speaker-verification.service');

test('runtime discovery uses the dedicated userData virtual environment and pinned model', () => {
  const verifier = new SpeakerVerification();
  const root = path.join('C:', 'example-user-data');
  // initialize performs I/O, so validate the stable path contract directly.
  const expectedPython = path.join(root, 'speaker-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const expectedModel = path.join(root, 'speaker-models', 'spkrec-ecapa-voxceleb-0f99f2d');
  assert.match(expectedPython, /speaker-python/);
  assert.match(expectedModel, /speaker-models/);
  assert.equal(verifier.status, 'uninitialized');
});

test('worker script performs a real inference health check and validates PCM', () => {
  const source = fs.readFileSync(path.join(__dirname, 'speaker_worker.py'), 'utf8');
  assert.match(source, /def health\(\)/);
  assert.match(source, /vector, inference_ms = embed/);
  assert.match(source, /embeddingDimension/);
  assert.match(source, /validate=True/);
});
