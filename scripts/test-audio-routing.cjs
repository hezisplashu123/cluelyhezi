const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { EventEmitter } = require('events');
const config = require('../src/core/config');
const path = require('path');
const { pathToFileURL } = require('url');
const { allowAudioCapturePermission } = require('../src/core/system-audio');
const source = fs.readFileSync(require.resolve('../src/services/speech.service'), 'utf8');
// Load the class without constructing the singleton or probing speech tools.
const SpeechService = vm.runInNewContext(
  source.slice(source.indexOf('class SpeechService'), source.indexOf('module.exports =')) + '\nSpeechService;',
  { EventEmitter, Buffer, process: { env: {} }, config, logger: { debug() {}, error() {}, info() {} } }
);
function service(provider) {
  return Object.assign(Object.create(SpeechService.prototype), {
    provider, isRecording: true, useRendererCapture: true, runtimeSettings: {},
    segmentBuffers: [], segmentBytes: 0
  });
}

test('Electron media permission is granted to the app audio page only', () => {
  const page = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  assert.equal(allowAudioCapturePermission(page, 'media'), true);
  assert.equal(allowAudioCapturePermission(page, 'display-capture'), true);
  assert.equal(allowAudioCapturePermission('https://example.com', 'media'), false);
  assert.equal(allowAudioCapturePermission(page, 'notifications'), false);
});

test('playback PCM goes to Whisper, and stopped capture ignores new chunks', () => {
  const speech = service('whisper');
  let calls = 0;
  speech._ingestWhisperAudio = () => calls++;
  speech.handleAudioChunkFromRenderer(Buffer.alloc(320));
  speech.isRecording = false;
  speech.handleAudioChunkFromRenderer(Buffer.alloc(320));
  assert.equal(calls, 1);
});

test('Azure receives only the PCM slice, without adjacent buffer contents', () => {
  const speech = service('azure');
  const writes = [];
  speech.pushStream = { write: data => writes.push(Buffer.from(data)) };
  speech.handleAudioChunkFromRenderer(Buffer.from([9, 1, 2, 9]).subarray(1, 3));
  assert.deepEqual(writes, [Buffer.from([1, 2])]);
});

test('playback VAD flushes after 700 ms of trailing silence', () => {
  const speech = service('whisper');
  speech._resetVadState();
  let flushes = 0;
  speech._endUtteranceFlush = () => flushes++;
  const voice = Buffer.alloc(16000);
  for (let i = 0; i < voice.length; i += 2) voice.writeInt16LE(5000, i);
  speech.handleAudioChunkFromRenderer(voice); // 500 ms of speech.
  speech.handleAudioChunkFromRenderer(Buffer.alloc(19200)); // 600 ms silence.
  assert.equal(flushes, 0);
  speech.handleAudioChunkFromRenderer(Buffer.alloc(3200)); // Another 100 ms.
  assert.equal(flushes, 1);
});
