const { test } = require('node:test');
const assert = require('node:assert/strict');
const DesktopVoiceGate = require('../src/services/desktop-voice-gate.service');

function pcm(ms, amplitude = 5000) {
  const result = Buffer.alloc(Math.round(ms * 32));
  for (let i = 0; i < result.length; i += 2) result.writeInt16LE(i % 80 < 40 ? amplitude : -amplitude, i);
  return result;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function verifier(decision, filterEnabled = true) {
  return { filterEnabled, status: 'ready', profile: { embedding: [] }, verify: async () => typeof decision === 'function' ? decision() : decision };
}

for (const provider of ['openai', 'azure', 'whisper']) {
  test(`${provider}: self and uncertain PCM never reaches provider sink`, async () => {
    for (const decision of [{ decision: 'SELF_MATCH' }, { decision: 'UNCERTAIN' }, { decision: 'MODEL_FAILURE' }]) {
      const received = [];
      const gate = new DesktopVoiceGate(verifier(decision), chunk => received.push(Buffer.from(chunk)));
      gate.startSession('microphone');
      for (let i = 0; i < 10; i++) gate.handlePcm(pcm(200));
      await settle();
      assert.equal(received.length, 0);
      gate.stopSession();
    }
  });
}

test('accepted opening PCM reaches the provider in original order', async () => {
  const received = [];
  const gate = new DesktopVoiceGate(verifier({ decision: 'OTHER_SPEAKER' }), chunk => received.push(Buffer.from(chunk)));
  gate.startSession('desktop');
  const chunks = Array.from({ length: 10 }, (_, index) => pcm(200, 3000 + index * 100));
  chunks.forEach(chunk => gate.handlePcm(chunk));
  await settle();
  assert.deepEqual(Buffer.concat(received), Buffer.concat(chunks));
});

test('rapid speaker turns reset and re-evaluate instead of locking to first speaker', async () => {
  const decisions = [{ decision: 'OTHER_SPEAKER' }, { decision: 'SELF_MATCH' }];
  const received = [];
  const gate = new DesktopVoiceGate(verifier(() => decisions.shift()), chunk => received.push(Buffer.from(chunk)));
  gate.startSession('microphone');
  for (let i = 0; i < 10; i++) gate.handlePcm(pcm(200, 4000));
  await settle();
  for (let i = 0; i < 4; i++) gate.handlePcm(pcm(200, 0));
  const afterOther = Buffer.concat(received).length;
  for (let i = 0; i < 10; i++) gate.handlePcm(pcm(200, 7000));
  await settle();
  assert.equal(Buffer.concat(received).length, afterOther);
});

test('worker failure fails closed and disabling filtering restores routing', async () => {
  const received = [];
  const broken = verifier({ decision: 'MODEL_FAILURE', reason: 'worker crashed' });
  const gate = new DesktopVoiceGate(broken, chunk => received.push(Buffer.from(chunk)));
  gate.startSession('desktop');
  for (let i = 0; i < 10; i++) gate.handlePcm(pcm(200));
  await settle();
  assert.equal(received.length, 0);
  gate.stopSession();
  broken.filterEnabled = false;
  gate.startSession('desktop');
  gate.handlePcm(pcm(200));
  assert.equal(received.length, 1);
});

test('stopping invalidates delayed verification and clears buffered PCM', async () => {
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  const received = [];
  const gate = new DesktopVoiceGate({ filterEnabled: true, status: 'ready', profile: {}, verify: () => delayed }, chunk => received.push(chunk));
  gate.startSession('desktop');
  for (let i = 0; i < 10; i++) gate.handlePcm(pcm(200));
  gate.stopSession();
  finish({ decision: 'OTHER_SPEAKER' });
  await settle();
  assert.equal(received.length, 0);
  assert.equal(gate.getDiagnostics().bufferedBytes, 0);
});
