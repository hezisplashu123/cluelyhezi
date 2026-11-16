const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const vm = require('vm'); const { EventEmitter } = require('events');
const config = require('../src/core/config');
const speechPath = require.resolve('../src/services/speech.service');
const source = fs.readFileSync(speechPath, 'utf8');
const Speech = vm.runInNewContext(source.slice(source.indexOf('class SpeechService'), source.indexOf('module.exports =')) + '\nSpeechService;', {
  EventEmitter, Buffer, process: { env: {} }, config, require: require('module').createRequire(speechPath),
  setTimeout, clearTimeout, setImmediate, logger: { debug() {}, error() {}, info() {} }
});
const pcm = (ms, value = 5000) => { const bytes = Buffer.alloc(ms * 32); for (let i=0;i<bytes.length;i+=2) bytes.writeInt16LE(value,i); return bytes; };
const speech = provider => {
  const service = new EventEmitter(); Object.setPrototypeOf(service, Speech.prototype);
  Object.assign(service, { provider, isRecording: true, useRendererCapture: true, runtimeSettings: {}, conversationId: 'conversation-a', segmentBuffers: [], segmentBytes: 0 });
  service._resetVadState(); return service;
};

test('manual capture buffers silence without VAD completion and stops PCM before finalization', async () => {
  const s = speech('whisper'); s.manualSendEnabled = true;
  let calls = 0; s._transcribeWhisperBuffer = async () => { calls++; return 'One manual question'; };
  s.handleAudioChunkFromRenderer(pcm(500)); s.handleAudioChunkFromRenderer(pcm(2000,0));
  assert.equal(calls,0); assert.equal(s.isRecording,true); assert.equal(s.segmentBytes,2500*32);
  s.pauseCapture(); const bytes = s.segmentBytes;
  s.handleAudioChunkFromRenderer(pcm(500)); assert.equal(s.segmentBytes,bytes);
  await s.finalizePendingSpeech(); assert.equal(calls,1);
});

test('Whisper Force Send flushes once, awaits transcription, preserves listening and original conversation', async () => {
  const s = speech('whisper'); const finals = []; let calls = 0; let release;
  s._transcribeWhisperBuffer = async () => { calls++; await new Promise(resolve => { release = resolve; }); return 'A complete pending question'; };
  s.on('transcription', (text, metadata) => finals.push({ text, metadata }));
  s.handleAudioChunkFromRenderer(pcm(500));
  const pending = s.finalizePendingSpeech(); const repeated = s.finalizePendingSpeech();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(finals.length, 0); assert.equal(s.isRecording, true);
  s.conversationId = 'conversation-b'; release(); await Promise.all([pending, repeated]);
  assert.equal(finals.length, 1); assert.equal(finals[0].metadata.conversationId, 'conversation-a'); assert.ok(finals[0].metadata.utteranceId);
  await s.finalizePendingSpeech(); assert.equal(calls, 1);
});

test('Whisper drains audio queued behind an earlier transcription without merging distinct segments', async () => {
  const s = speech('whisper'); let release; let calls = 0; const texts = [];
  s._transcribeWhisperBuffer = async () => { calls++; if (calls === 1) await new Promise(resolve => { release = resolve; }); return `Question ${calls}`; };
  s.on('transcription', text => texts.push(text));
  s.handleAudioChunkFromRenderer(pcm(500)); const one = s.finalizePendingSpeech();
  await new Promise(resolve => setImmediate(resolve));
  s.handleAudioChunkFromRenderer(pcm(500)); const two = s.finalizePendingSpeech();
  release(); await Promise.all([one,two]); assert.deepEqual(texts, ['Question 1','Question 2']);
});

test('VAD rejects short spikes and background hiss while preserving speech pre-roll', async () => {
  const s = speech('whisper'); let calls = 0; let bytes = 0;
  s._transcribeWhisperBuffer = async buffer => { calls++; bytes = buffer.length; return 'Speech'; };
  for (let i=0;i<20;i++) s.handleAudioChunkFromRenderer(pcm(50, 50));
  s.handleAudioChunkFromRenderer(pcm(30)); s.handleAudioChunkFromRenderer(pcm(800,0));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls,0);
  for (let i=0;i<6;i++) s.handleAudioChunkFromRenderer(pcm(50,0));
  s.handleAudioChunkFromRenderer(pcm(500)); s.handleAudioChunkFromRenderer(pcm(700,0));
  await s._flushPromise; assert.equal(calls,1); assert.ok(bytes >= 1500 * 32, 'Pre-roll and word endings remain present');
});

test('Azure Force Send uses a silence boundary, waits for final and resumes queued capture', async () => {
  const s = speech('azure'); const writes = []; s._azurePending = true;
  s.pushStream = { write: bytes => writes.push(Buffer.from(bytes)) };
  const pending = s.finalizePendingSpeech();
  s._forwardPcm(pcm(100));
  assert.equal(writes.length,1); assert.ok(writes[0].every(b => b===0));
  assert.equal(s.isRecording,true);
  s._azurePending = false; s.emit('azure-final'); await pending;
  assert.equal(writes.length,2); assert.equal(writes[1].length,3200); assert.equal(s._azureFinalizing,false);
});

test('provider errors propagate from Force Send without inventing a transcript', async () => {
  const s = speech('whisper'); s._transcribeWhisperBuffer = async () => { throw new Error('Provider offline'); };
  s.handleAudioChunkFromRenderer(pcm(500));
  await assert.rejects(s.finalizePendingSpeech(), /Provider offline/); assert.equal(s.isRecording,true);
});

test('Azure stop waits for SDK cleanup so the next recording cannot be closed by an old callback', async () => {
  const s = speech('azure'); let done; let cleaned = 0;
  s.recognizer = { stopContinuousRecognitionAsync: callback => { done = callback; } };
  s._finalizeStop = () => { cleaned++; };
  const stopped = s.stopRecording({ discardPending: true });
  assert.equal(cleaned,0); assert.equal(s.isRecording,false);
  done(); await stopped; assert.equal(cleaned,1);
  done(); assert.equal(cleaned,1);
});
