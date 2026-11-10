const test = require('node:test');
const assert = require('node:assert/strict');
const ScreenshotQueue = require('../src/services/screenshot-queue');
const { parseArgs } = require('./check-screen-capture.cjs');

test('diagnostic crop accepts normalized coordinates and rejects unsafe arguments', () => {
  assert.deepEqual(parseArgs(['--save', 'frame.png', '--source', 'window:42:0', '--capture-crop', '0.05,0.1,0.9,0.8']).crop, { x: .05, y: .1, width: .9, height: .8 });
  for (const value of ['0,0,0,1', '0,0,1.1,1', '-0.1,0,1,1', '0,,1,1', 'NaN,0,1,1', '0,0,1', '0,0,0.5,0.5,1']) {
    assert.throws(() => parseArgs(['--save', 'frame.png', '--capture-crop', value]), /Diagnostic crop/);
  }
  assert.throws(() => parseArgs(['--capture-crop', '0,0,1,1']), /require --save/);
  assert.throws(() => parseArgs(['--save', 'frame.png', '--source']), /requires a value/);
  assert.throws(() => parseArgs(['--save', 'frame.png', '--save', 'other.png']), /Duplicate/);
  assert.deepEqual(parseArgs([], { OPENCLUELY_DIAGNOSTIC_CROP: '0,0,1,1' }).crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.throws(() => parseArgs([], { OPENCLUELY_DIAGNOSTIC_CROP: '0,0,2,1' }), /Diagnostic crop/);
  assert.throws(() => parseArgs(['--save', 'frame.png', '--capture-crop', '0,0,1,1'], { OPENCLUELY_DIAGNOSTIC_CROP: '0,0,1,1' }), /only once/);
});

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

test('clear waits for pending captures and refuses to clear an owned submission', async () => {
  let release;
  const queue = new ScreenshotQueue(() => new Promise(resolve => { release = () => resolve({ imageBuffer: Buffer.from('pending') }); }));
  const add = queue.add();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const clearing = queue.clear();
  release();
  await add;
  assert.deepEqual(await clearing, { success: true, cleared: 1, count: 0 });
  queue.images.push({ imageBuffer: Buffer.from('owned') });
  let finish;
  const submitting = queue.submit(() => new Promise(resolve => { finish = resolve; }));
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await queue.clear()).busy, true);
  finish();
  await submitting;
});

test('VMware selection persists and re-resolves changed IDs; explicit monitor capture is independent of cursor', async () => {
  const fs = require('fs');
  const vm = require('vm');
  const displays = [1, 2].map(id => ({ id, size: { width: 1920, height: 1080 }, scaleFactor: 1.5 }));
  const thumbnails = displays.map(d => ({ getSize: () => ({ width: 2880, height: 1620 }), isEmpty: () => false, toPNG: () => Buffer.from(String(d.id)) }));
  let requested; let sources = [];
  const fakeElectron = {
    screen: { getAllDisplays: () => displays, getDisplayNearestPoint: () => displays[1], getCursorScreenPoint: () => ({ x: 2000, y: 0 }) },
    desktopCapturer: { getSources: async options => {
      requested = options;
      return sources;
    } }
  };
  const sandbox = { module: { exports: {} }, require: name => name === 'electron' ? fakeElectron : name === './capture-window-metadata.service' ? async () => [] : { createServiceLogger: () => ({ debug() {}, logPerformance() {}, warn() {} }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/capture.service'), 'utf8'), sandbox);
  const capture = sandbox.module.exports;
  let saved = null; capture.initialize({ getMeta: () => saved, setMeta: (_key, value) => { saved = value; } });
  sources = thumbnails.map((thumbnail, index) => ({ id: `screen:${index}`, name: `Screen ${index}`, display_id: String(index + 1), thumbnail }));
  const vmSource = { id: 'window:10:0', name: 'Guest A - VMware Workstation', thumbnail: thumbnails[0] };
  sources.push(vmSource);
  const image = await capture.captureAndProcess();
  assert.equal(image.imageBuffer.toString(), '1');
  assert.equal(JSON.parse(saved).application, 'vmware');
  sources[2] = { ...vmSource, id: 'window:20:0' };
  const restored = await capture.captureAndProcess();
  assert.equal(restored.metadata.source.target.sourceId, 'window:20:0');
  const screenImage = await capture.captureAndProcess({ displayId: 2 });
  assert.equal(screenImage.imageBuffer.toString(), '2');
  sources.pop();
  capture.initialize({ getMeta: () => null, setMeta() {} });
  await assert.rejects(capture.captureAndProcess(), error => error.code === 'NO_VM_WINDOW');
  capture.initialize({ getMeta: () => JSON.stringify({ kind: 'window', application: 'vmware', displayName: vmSource.name }), setMeta() {} });
  await assert.rejects(capture.captureAndProcess(), error => error.code === 'TARGET_UNAVAILABLE');
  sources.push(vmSource, { ...vmSource, id: 'window:30:0', name: 'Guest B - VMware Player' });
  capture.initialize({ getMeta: () => null, setMeta() {} });
  await assert.rejects(capture.captureAndProcess(), error => error.code === 'TARGET_SELECTION_REQUIRED');
  await capture.selectTarget('window:10:0');
  sources[2] = { ...vmSource, thumbnail: { ...thumbnails[0], isEmpty: () => true } };
  await assert.rejects(capture.captureAndProcess(), error => error.code === 'FALLBACK_CROP_REQUIRED');
  await assert.rejects(capture.captureAndProcess({ displayId: 999 }), /unavailable/);
  assert.throws(() => capture.setCrop({ x: .9, y: 0, width: .5, height: 1 }), /fit inside/);
  assert.equal(requested.thumbnailSize.width, 2880);
});

test('visible fallback uses verified VMware ownership and the containing scaled display, otherwise refuses capture', async () => {
  const fs = require('fs'); const vm = require('vm');
  const cropCalls = [];
  const image = (width, height, empty = false) => ({ isEmpty: () => empty, getSize: () => ({ width, height }), toPNG: () => Buffer.from('frame'), crop: area => { cropCalls.push(area); return image(area.width, area.height); } });
  const displays = [{ id: 1, size: { width: 1000, height: 800 }, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }, { id: 2, size: { width: 1000, height: 800 }, scaleFactor: 1.5, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }];
  let metadata = [{ handle: '102', title: 'Guest - VMware Workstation', executable: 'vmware.exe', foreground: true, minimized: false, x: 1650, y: 150, width: 900, height: 600 }];
  let screenIds = ['1', '2'];
  const electron = { screen: { getAllDisplays: () => displays, dipToScreenRect: (_win, b) => b.x ? { x: 1500, y: 0, width: 1500, height: 1200 } : b }, desktopCapturer: { getSources: async options => options.types.length === 1 ? screenIds.map(id => ({ id: `screen:${id}`, display_id: id, thumbnail: image(id === '2' ? 1500 : 1000, id === '2' ? 1200 : 800) })) : [{ id: 'window:102:0', name: 'Guest - VMware Workstation', thumbnail: image(0, 0, true) }] } };
  const sandbox = { module: { exports: {} }, require: name => name === 'electron' ? electron : name === './capture-window-metadata.service' ? async () => metadata : { createServiceLogger: () => ({ debug() {}, warn() {} }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/capture.service'), 'utf8'), sandbox);
  const capture = sandbox.module.exports; let hidden = 0; let restored = 0;
  capture.setOverlayCaptureScope(async work => { hidden++; try { return await work(); } finally { restored++; } });
  const target = { kind: 'window', application: 'vmware', executable: 'vmware.exe', sourceId: 'window:101:0', displayName: 'Guest - VMware Workstation', crop: { x: .1, y: .1, width: .8, height: .8 } };
  capture.initialize({ getMeta: () => JSON.stringify(target), setMeta() {} });
  const result = await capture.captureAndProcess();
  assert.equal(result.metadata.source.method, 'visible-screen-fallback'); assert.equal(result.metadata.source.displayId, 2);
  assert.equal(result.metadata.source.target.sourceId, 'window:102:0');
  assert.equal(JSON.stringify(cropCalls), JSON.stringify([{ x: 150, y: 150, width: 900, height: 600 }, { x: 90, y: 60, width: 720, height: 480 }]));
  assert.equal(hidden, 1); assert.equal(restored, 1);
  screenIds = ['1']; await assert.rejects(capture.captureAndProcess(), error => error.code === 'TARGET_UNAVAILABLE');
  screenIds = ['1', '2']; metadata[0].minimized = true; await assert.rejects(capture.captureAndProcess(), error => error.code === 'TARGET_UNAVAILABLE');
  metadata[0].minimized = false; metadata.unshift({ handle: '900', executable: 'other.exe', x: 1700, y: 200, width: 20, height: 20 });
  await assert.rejects(capture.captureAndProcess(), error => error.code === 'TARGET_OCCLUDED');
  metadata.shift(); metadata[0].executable = 'browser.exe';
  await assert.rejects(capture.captureAndProcess(), error => error.code === 'TARGET_UNAVAILABLE');
  assert.equal(hidden, restored);
});
