// Real host toolbar + real desktop capture, with a local fake model for submission.
const { app, ipcMain, screen } = require('electron');
const assert = require('node:assert/strict');
const Queue = require('../src/services/screenshot-queue');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const manager = require('../src/managers/window.manager');
  const capture = require('../src/services/capture.service');
  const input = require('../src/services/windows-input.service');
  let analyzed = 0;
  let resolveAnalyze;
  const submitted = new Promise(resolve => { resolveAnalyze = resolve; });
  const queue = new Queue(options => capture.captureAndProcess(options), count => manager.broadcastToAllWindows('screenshot-queue-changed', { count }));
  try {
    ipcMain.handle('get-settings', () => ({ activeSkill: 'dsa', codingLanguage: 'cpp' }));
    ipcMain.handle('get-window-stats', () => ({ isInteractive: true }));
    ipcMain.handle('get-screenshot-queue', () => ({ count: queue.images.length }));
    ipcMain.handle('get-speech-availability', () => false);
    ipcMain.handle('resize-window', () => ({ success: true }));
    ipcMain.handle('take-screenshot', async () => ({ success: true, count: await queue.add({ displayId: screen.getPrimaryDisplay().id }) }));
    ipcMain.handle('submit-screenshots', () => queue.submit(async images => { analyzed = images.length; resolveAnalyze(); }));
    const toolbar = await manager.createWindow('main');
    manager.windows.set('main', toolbar);
    toolbar.show();
    manager.setInteractive(false);
    assert.equal(input.releaseVMInput, undefined, 'Automatic Ctrl+Alt injection removed');
    await toolbar.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 150))");
    // Even a late/stale click-through event may not disable camera or submit.
    toolbar.webContents.send('interaction-mode-changed', false);
    const captureDone = new Promise(resolve => {
      const interval = setInterval(() => { if (queue.images.length === 2) { clearInterval(interval); resolve(); } }, 20);
    });
    await toolbar.webContents.executeJavaScript("document.getElementById('captureScreenshot').click(); document.getElementById('captureScreenshot').click()");
    await captureDone;
    assert.ok(queue.images.every(image => image.imageBuffer.length > 1000), 'Both captures contain real host pixels');
    await toolbar.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 50))");
    assert.equal(await toolbar.webContents.executeJavaScript("document.getElementById('screenshotCount').textContent"), '\\ 2');
    await toolbar.webContents.executeJavaScript("document.getElementById('submitScreenshots').click()");
    await submitted;
    assert.equal(analyzed, 2, 'Submit forwards both captured images');
    assert.equal(queue.images.length, 0);
    console.log('PASS: camera and submit remain usable in click-through mode; two real local screenshots queue and submit without any injected keys.');
    clearTimeout(timeout); manager.destroyAllWindows(); app.quit();
  } catch (error) { console.error(error.stack); app.exit(1); }
});
