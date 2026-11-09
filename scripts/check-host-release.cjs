const { app } = require('electron');
const assert = require('node:assert/strict');
const input = require('../src/services/windows-input.service');
const timeout = setTimeout(() => { input.stop(); app.exit(1); }, 15000);
app.whenReady().then(async () => {
  try {
    input.start({ isInteractive: false, getWindow: () => null }, {});
    const start = Date.now();
    while (!input.ready && Date.now() - start < 8000) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(input.ready, 'Native host controls initialize');
    assert.equal(typeof input.releaseVMInput, 'undefined', 'Host capture never synthesizes Ctrl+Alt');
    const capture = await require('../src/services/capture.service').captureAndProcess();
    assert.ok(capture.imageBuffer.length > 1000, 'Host capture returns screen pixels');
    console.log('Host-only controls initialize and local screenshot capture passed; no automatic release. PNG bytes:', capture.imageBuffer.length);
    input.stop(); clearTimeout(timeout); app.quit();
  } catch (error) { console.error(error.stack); input.stop(); app.exit(1); }
});
