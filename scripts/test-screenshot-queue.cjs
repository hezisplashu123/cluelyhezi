const test = require('node:test');
const assert = require('node:assert/strict');
const ScreenshotQueue = require('../src/services/screenshot-queue');

test('rapid captures serialize and submission waits for them in order', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new ScreenshotQueue(async id => {
    if (id === 1) await gate;
    return { imageBuffer: Buffer.from(String(id)) };
  });
  const first = queue.add(1);
  const second = queue.add(2);
  let received;
  const submission = queue.submit(async images => { received = images.map(i => i.imageBuffer.toString()); });
  assert.deepEqual(await queue.submit(() => assert.fail()), { success: false, busy: true });
  release();
  await Promise.all([first, second, submission]);
  assert.deepEqual(received, ['1', '2']);
  assert.equal(queue.images.length, 0);
});

test('failed requests restore the batch before captures added during analysis', async () => {
  const queue = new ScreenshotQueue(async id => ({ imageBuffer: Buffer.from(id) }));
  await queue.add('old');
  await assert.rejects(queue.submit(async () => {
    await queue.add('new');
    throw new Error('network failed');
  }), /network failed/);
  assert.deepEqual(queue.images.map(i => i.imageBuffer.toString()), ['old', 'new']);
  await queue.submit(async () => {});
  await assert.rejects(queue.submit(() => assert.fail()), /No screenshots/);
});

test('failed captures do not block later captures and queue has a limit', async () => {
  const queue = new ScreenshotQueue(async id => {
    if (id === 'bad') throw new Error('capture failed');
    return { imageBuffer: Buffer.from('ok') };
  });
  await assert.rejects(queue.add('bad'), /capture failed/);
  await Promise.all(Array.from({ length: 20 }, () => queue.add('ok')));
  await assert.rejects(queue.add('ok'), /full/);
  assert.equal(queue.images.length, 20);
});

test('same-sized monitors select by display ID and capture at physical resolution', async () => {
  const fs = require('fs');
  const vm = require('vm');
  const displays = [1, 2].map(id => ({ id, size: { width: 1920, height: 1080 }, scaleFactor: 1.5 }));
  const thumbnails = displays.map(d => ({ getSize: () => ({ width: 2880, height: 1620 }), isEmpty: () => false, toPNG: () => Buffer.from(String(d.id)) }));
  let requested;
  const fakeElectron = {
    screen: { getAllDisplays: () => displays, getDisplayNearestPoint: () => displays[1], getCursorScreenPoint: () => ({ x: 2000, y: 0 }) },
    desktopCapturer: { getSources: async options => {
      requested = options;
      return thumbnails.map((thumbnail, index) => ({ display_id: String(index + 1), thumbnail }));
    } }
  };
  const sandbox = { module: { exports: {} }, require: name => name === 'electron' ? fakeElectron : { createServiceLogger: () => ({ debug() {}, logPerformance() {} }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/capture.service'), 'utf8'), sandbox);
  const image = await sandbox.module.exports.captureAndProcess();
  assert.equal(image.imageBuffer.toString(), '2');
  assert.equal(requested.thumbnailSize.width, 2880);
});
