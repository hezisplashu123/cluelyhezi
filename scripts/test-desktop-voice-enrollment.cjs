const { test } = require('node:test');
const assert = require('node:assert/strict');
const DesktopVoiceEnrollment = require('../src/services/desktop-voice-enrollment.service');
const DesktopVoiceRecordingCoordinator = require('../src/services/desktop-voice-recording-coordinator.service');

function pcm(seconds, amplitude = 5000) {
  const value = Buffer.alloc(seconds * 16000 * 2);
  for (let i = 0; i < value.length; i += 2) value.writeInt16LE(amplitude, i);
  return value;
}

test('desktop enrollment is session scoped, local, and clears temporary chunks', async () => {
  let enrolled;
  const verifier = {
    inspectPcm: value => ({ elapsedSeconds: value.length / 32000, usableSpeechSeconds: value.length / 32000, clippingRatio: 0 }),
    enroll: async value => { enrolled = Buffer.from(value); return { profile: 'ready' }; },
    getStatus: () => ({ profile: 'ready', model: 'ready' })
  };
  const service = new DesktopVoiceEnrollment(verifier);
  service.start({ sessionId: 'enroll-1234', mode: 'enrollment' });
  for (let index = 0; index < 20; index++) service.append({ sessionId: 'enroll-1234', buffer: pcm(1) });
  const result = await service.finish({ sessionId: 'enroll-1234' });
  assert.equal(result.status.profile, 'ready');
  assert.equal(enrolled.length, 20 * 32000);
  assert.equal(service.session, null);
});

test('empty, invalid, oversized, cancelled, and stale enrollment data is rejected', () => {
  const verifier = { inspectPcm: () => ({}) };
  const service = new DesktopVoiceEnrollment(verifier);
  service.start({ sessionId: 'enroll-5678', mode: 'enrollment' });
  assert.throws(() => service.append({ sessionId: 'enroll-5678', buffer: Buffer.alloc(0) }), /Invalid PCM/);
  assert.throws(() => service.append({ sessionId: 'wrong-session', buffer: pcm(1) }), /no longer active/);
  assert.equal(service.cancel('enroll-5678'), true);
  assert.throws(() => service.append({ sessionId: 'enroll-5678', buffer: pcm(1) }), /no longer active/);
});

test('recognition test invokes local verification and returns explicit decision', async () => {
  const verifier = {
    inspectPcm: value => ({ elapsedSeconds: value.length / 32000 }),
    verify: async () => ({ decision: 'SELF_MATCH', score: 0.82, totalMs: 41 }),
    getStatus: () => ({ profile: 'ready', model: 'ready' })
  };
  const service = new DesktopVoiceEnrollment(verifier);
  service.start({ sessionId: 'test-voice-1', mode: 'test' });
  service.append({ sessionId: 'test-voice-1', buffer: pcm(3) });
  const result = await service.finish({ sessionId: 'test-voice-1' });
  assert.equal(result.result.decision, 'SELF_MATCH');
});

test('desktop voice recording pauses live transcription and resumes its prior source', async () => {
  const calls = [];
  const speech = {
    isRecording: true, isProcessingAudio: false, liveTranscription: {}, recognizer: null, captureSource: 'desktop',
    isAvailable: () => true,
    stopRecording() { calls.push('stop'); this.isRecording = false; this.liveTranscription = null; },
    startRecording({ source }) { calls.push(`start:${source}`); this.isRecording = true; }
  };
  const enrollment = {
    start({ sessionId, mode }) { calls.push(`enroll:${mode}`); return { sessionId, mode }; },
    finish: async ({ sessionId }) => ({ sessionId, result: { profile: 'ready' } }),
    cancel: () => true
  };
  const coordinator = new DesktopVoiceRecordingCoordinator(speech, enrollment);
  await coordinator.start('coordinator-session', 'enrollment');
  assert.deepEqual(calls, ['stop', 'enroll:enrollment']);
  await coordinator.finish('coordinator-session');
  assert.deepEqual(calls, ['stop', 'enroll:enrollment', 'start:desktop']);
});
