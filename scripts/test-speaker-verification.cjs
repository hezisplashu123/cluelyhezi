const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SpeakerVerification } = require('../src/services/speaker-verification.service');

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
  verifier._embed = async () => { throw new Error('crash'); }; const failed = await verifier.verify(pcm(2)); assert.equal(failed.decision, 'MODEL_FAILURE'); assert.equal(failed.reason, 'MODEL_FAILURE');
});
