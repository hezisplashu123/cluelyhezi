// Local capture diagnostic. Does not save images or send them to an API.
const { app, desktopCapturer, globalShortcut } = require('electron');
const assert = require('node:assert/strict');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  process.env.OPENAI_API_KEY = 'test-key-no-network-requests';
  const llm = require('../src/services/llm.service');
  assert.ok(llm.isInitialized, 'OpenAI client must initialize in Electron main');
  console.log('Electron main-process OpenAI initialization: OK');
  const capture = require('../src/services/capture.service');
  const result = await capture.captureAndProcess();
  assert.ok(result.imageBuffer.length > 1000, 'Screen capture must contain pixels');
  console.log('Screen capture:', JSON.stringify(result.metadata.source), 'PNG bytes:', result.imageBuffer.length);
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1280, height: 720 } });
  const vm = sources.find(source => /VMware Workstation/.test(source.name));
  assert.ok(vm, 'VMware window must be available as a capture source');
  assert.ok(!vm.thumbnail.isEmpty(), 'VMware capture must not be empty');
  console.log('VMware capture source:', vm.name, JSON.stringify(vm.thumbnail.getSize()));
  for (const key of ['\\', '`', 'Control+Shift+S', 'Control+Shift+Enter']) {
    const registered = globalShortcut.register(key, () => {});
    console.log('Shortcut', JSON.stringify(key), registered ? 'registered' : 'unavailable (possibly held by a running app)');
    assert.ok(registered, 'Shortcut registration: ' + key);
  }
  globalShortcut.unregisterAll();
  clearTimeout(timeout);
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
