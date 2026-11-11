const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { SpeakerVerification } = require('../src/services/speaker-verification.service');
const { MobileAudio } = require('../src/services/mobile-audio.service');

const secureStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
function pcm(seconds, amplitude = 5000) { const result = Buffer.alloc(seconds * 16000 * 2); for (let i = 0; i < result.length; i += 2) result.writeInt16LE(i % 80 < 40 ? amplitude : -amplitude, i); return result; }
function unit(first, second = 0) { const value = Array(192).fill(0); value[0] = first; value[1] = second; const n = Math.hypot(first, second); return value.map(x => x / n); }

test('enrollment persists only an encrypted aggregate profile and deletion removes it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-speaker-')); const verifier = new SpeakerVerification();
  verifier.status = 'ready'; verifier._embed = async () => ({ vector: unit(1, 0.01), inferenceMs: 5 });
  const store = require('../src/services/voice-profile-store.service'); store.initialize(root, secureStorage);
  const result = await verifier.enroll(pcm(25)); assert.equal(result.profile, 'ready');
  const stored = fs.readFileSync(path.join(root, 'voice-recognition', 'profile.enc'), 'utf8'); assert.doesNotMatch(stored, /pcm|recording|base64/); assert.equal(verifier.profile.embedding.length, 192);
  verifier.deleteProfile(); assert.equal(fs.existsSync(path.join(root, 'voice-recognition', 'profile.enc')), false); fs.rmSync(root, { recursive: true, force: true });
});

test('verification returns self, other, and uncertain without treating failures as other', async () => {
  const verifier = new SpeakerVerification(); verifier.status = 'ready'; verifier.profile = { embedding: unit(1), thresholds: { self: .8, other: .6 } };
  verifier._embed = async () => ({ vector: unit(1), inferenceMs: 1 }); assert.equal((await verifier.verify(pcm(2))).decision, 'SELF_MATCH');
  verifier._embed = async () => ({ vector: unit(0, 1), inferenceMs: 1 }); assert.equal((await verifier.verify(pcm(2))).decision, 'OTHER_SPEAKER');
  verifier._embed = async () => ({ vector: unit(.7, .714), inferenceMs: 1 }); assert.equal((await verifier.verify(pcm(2))).decision, 'UNCERTAIN');
  verifier._embed = async () => { throw new Error('crash'); }; const failed = await verifier.verify(pcm(2)); assert.equal(failed.decision, 'UNCERTAIN'); assert.equal(failed.reason, 'MODEL_FAILURE');
});

class Speech extends EventEmitter { constructor() { super(); this.isRecording = false; this.received = []; } isAvailable() { return true; } startRecording({ source }) { this.captureSource = source; this.isRecording = true; this.emit('recording-started'); } stopRecording() { this.isRecording = false; this.emit('recording-stopped'); } ingestMobilePcm(value) { this.received.push(value); } }
const start = { sessionId: 'session-gate', encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 };
async function gated(decision) { const speech = new Speech(); const events = []; const verifier = { filterEnabled: true, verify: async () => decision }; const audio = new MobileAudio(speech, () => {}, verifier, (type, payload) => events.push({ type, payload })); await audio.start('phone', start); const block = pcm(1); audio.chunk('phone', { sessionId: start.sessionId, sequence: 1, pcm: block.toString('base64') }); audio.chunk('phone', { sessionId: start.sessionId, sequence: 2, pcm: block.toString('base64') }); await new Promise(resolve => setImmediate(resolve)); return { speech, events, audio }; }

test('privacy gate never forwards self, uncertain, or failed verification audio', async () => {
  for (const result of [{ decision: 'SELF_MATCH' }, { decision: 'UNCERTAIN' }, { decision: 'UNCERTAIN', reason: 'MODEL_FAILURE' }]) { const { speech, audio } = await gated(result); assert.equal(speech.received.length, 0); assert.equal(speech.isRecording, false); audio.stop('phone'); }
});
test('privacy gate preserves accepted opening audio in order', async () => { const { speech, audio } = await gated({ decision: 'OTHER_SPEAKER' }); assert.equal(speech.isRecording, true); assert.ok(Buffer.concat(speech.received).length > 60000); audio.stop('phone'); });

test('voice enrollment replaces stale phone listening and ignores late closed-session packets', async () => {
  const speech = new Speech(); const verifier = { filterEnabled: false, inspectPcm: value => ({ elapsedSeconds: value.length / 32000, usableSpeechSeconds: value.length / 32000 }) };
  const audio = new MobileAudio(speech, () => {}, verifier);
  await audio.start('phone', start); assert.equal(speech.isRecording, true);
  const recording = { sessionId: 'enroll-session', encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 };
  audio.enrollmentStart('phone', recording); assert.equal(speech.isRecording, false); assert.ok(audio.enrollment);
  const block = pcm(1); audio.enrollmentChunk('phone', { ...recording, sequence: 1, pcm: block.toString('base64') });
  audio.enrollmentCancel('phone');
  assert.deepEqual(audio.enrollmentChunk('phone', { ...recording, sequence: 2, pcm: block.toString('base64') }), { ignored: true, reason: 'recording_already_closed' });
});
