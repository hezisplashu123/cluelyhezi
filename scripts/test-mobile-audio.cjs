const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MobileAudio, Resampler, MAX_CHUNK } = require('../src/services/mobile-audio.service');

class Speech extends EventEmitter {
  constructor() { super(); this.isRecording = false; this.received = []; }
  isAvailable() { return true; }
  startRecording({ source }) { this.captureSource = source; this.isRecording = true; this.emit('recording-started'); }
  stopRecording() { this.isRecording = false; }
  ingestMobilePcm(bytes) { this.received.push(bytes); }
}
const start = { sessionId: 'session-123', encoding: 'pcm_s16le', sampleRate: 48000, channels: 1 };
const chunk = { sessionId: start.sessionId, sequence: 1, pcm: Buffer.alloc(4800, 1).toString('base64') };

test('resamples device PCM with a continuous clock across chunk boundaries', () => {
  const input = Buffer.alloc(9600); for (let i = 0; i < input.length; i += 2) input.writeInt16LE(12000, i);
  const whole = new Resampler(48000).convert(input);
  const split = new Resampler(48000); const parts = Buffer.concat([split.convert(input.subarray(0, 4000)), split.convert(input.subarray(4000))]);
  assert.deepEqual(parts, whole); assert.ok(Math.abs(parts.length - 3200) <= 2); assert.equal(parts.readInt16LE(0), 12000);
});

test('rejects invalid metadata, duplicate chunks, excessive payloads, and competing sources', async () => {
  const speech = new Speech(); const audio = new MobileAudio(speech);
  await assert.rejects(audio.start('a', { ...start, channels: 2 }), /format/);
  speech.isRecording = true; await assert.rejects(audio.start('a', start), /desktop audio/); speech.isRecording = false;
  await audio.start('a', start); await assert.rejects(audio.start('b', start), /already active/);
  assert.throws(() => audio.chunk('b', chunk), /matching/); audio.chunk('a', chunk); assert.equal(speech.received.length, 1);
  assert.throws(() => audio.chunk('a', chunk), /sequence/);
  assert.throws(() => audio.chunk('a', { ...chunk, sequence: 2, pcm: Buffer.alloc(MAX_CHUNK + 2).toString('base64') }), /chunk/);
  audio.stop('b'); assert.equal(speech.isRecording, true); audio.stop('a'); assert.equal(speech.isRecording, false);
});
