const assert = require('assert');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const ListeningController = require('../src/services/listening-controller.service');
const GlobalBacktickService = require('../src/services/global-backtick.service');

class MockSpeech extends EventEmitter {
  constructor({ available = true, fail = false } = {}) {
    super();
    this.available = available;
    this.fail = fail;
    this.provider = 'mock';
    this.isRecording = false;
    this.starts = 0;
    this.stops = 0;
    this.forwarded = [];
  }
  isAvailable() { return this.available; }
  startRecording() {
    this.starts++;
    if (this.fail) return queueMicrotask(() => this.emit('error', 'provider unavailable'));
    this.isRecording = true;
    queueMicrotask(() => this.emit('recording-started'));
  }
  stopRecording(options) {
    this.stops++;
    this.isRecording = false;
    this.stopOptions = options;
    this.emit('recording-stopped');
  }
  handleAudioChunkFromRenderer(chunk) { this.forwarded.push(Buffer.from(chunk)); }
}

async function turnOn(controller) {
  const requested = new Promise(resolve => controller.once('capture-requested', resolve));
  const start = controller.start();
  const capture = await requested;
  assert.equal(controller.getStatus().state, 'STARTING');
  assert.equal(controller.ingestPcm(capture.sessionId, Buffer.alloc(320)), true);
  await start;
  return capture;
}

async function testLifecycle() {
  const speech = new MockSpeech();
  const controller = new ListeningController(speech, { startTimeoutMs: 200 });
  assert.equal(controller.getStatus().state, 'OFF', 'startup must be OFF');

  const first = await turnOn(controller);
  assert.equal(controller.getStatus().state, 'LISTENING');
  assert.equal(speech.starts, 1);
  assert.equal(speech.forwarded.length, 1);

  await controller.stop();
  assert.equal(controller.getStatus().state, 'OFF');
  assert.equal(speech.stopOptions.discardPending, true);
  assert.equal(controller.ingestPcm(first.sessionId, Buffer.alloc(320)), false, 'OFF must reject PCM');

  const requested = new Promise(resolve => controller.once('capture-requested', resolve));
  const start = controller.toggle();
  const second = await requested;
  controller.ingestPcm(second.sessionId, Buffer.alloc(320));
  await start;
  await controller.toggle();
  assert.equal(controller.getStatus().state, 'OFF', 'second backtick must stop');
  assert.equal(speech.starts, 2);
}

async function testFastToggleAndStaleAudio() {
  const speech = new MockSpeech();
  const controller = new ListeningController(speech, { startTimeoutMs: 200 });
  const firstRequest = new Promise(resolve => controller.once('capture-requested', resolve));
  const p1 = controller.toggle();
  const first = await firstRequest;
  const p2 = controller.toggle();
  await Promise.all([p1, p2]);
  assert.equal(controller.getStatus().state, 'OFF');
  assert.equal(speech.starts, 1, 'rapid presses must not create duplicate capture');
  assert.equal(controller.ingestPcm(first.sessionId, Buffer.alloc(80)), false);

  const secondRequest = new Promise(resolve => controller.once('capture-requested', resolve));
  const p3 = controller.toggle();
  const second = await secondRequest;
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(controller.ingestPcm(first.sessionId, Buffer.alloc(80)), false, 'stale session must be rejected');
  controller.ingestPcm(second.sessionId, Buffer.alloc(80));
  await p3;
  await controller.stop();
}

async function testFailures() {
  const unavailable = new ListeningController(new MockSpeech({ available: false }), { startTimeoutMs: 50 });
  await assert.rejects(unavailable.start(), /unavailable/);
  assert.equal(unavailable.getStatus().state, 'ERROR');

  const speech = new MockSpeech();
  const controller = new ListeningController(speech, { startTimeoutMs: 100 });
  const request = new Promise(resolve => controller.once('capture-requested', resolve));
  const start = controller.start();
  const capture = await request;
  controller.reportCaptureError(capture.sessionId, 'track ended');
  await assert.rejects(start);
  assert.equal(controller.getStatus().state, 'ERROR');
  assert.equal(controller.allowsTranscription(), false);
}

async function testHeldKeyEdges() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', 0);
  const shortcut = {
    register: () => true,
    isRegistered: () => true,
    unregister: () => {}
  };
  let presses = 0;
  const listener = new GlobalBacktickService({ platform: 'win32', globalShortcut: shortcut, spawn: () => child });
  listener.start(() => presses++);
  child.stdout.write('DOWN\nDOWN\nDOWN\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(presses, 1, 'auto-repeat while held must be ignored');
  child.stdout.write('UP\nDOWN\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(presses, 2, 'a new key-down edge must toggle again');
  listener.stop();
  assert.equal(listener.getStatus().registered, false, 'shutdown must release listener');
}

(async () => {
  await testLifecycle();
  await testFastToggleAndStaleAudio();
  await testFailures();
  await testHeldKeyEdges();
  console.log('listening toggle lifecycle tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
