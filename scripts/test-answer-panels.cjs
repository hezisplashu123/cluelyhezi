// Run with Electron (ELECTRON_RUN_AS_NODE unset). Uses fixture answers, no API.
const { app, ipcMain, BrowserWindow, clipboard, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { splitResponse } = require('../lib/response-parts');
const timeout = setTimeout(() => app.exit(1), 30000);
const fixture = '<!-- coding-answer -->\n## Solution\nAdd the inputs.\n\n```python\n# @explain: I combine the two inputs.\ndef add(a, b):\n    # @explain: I give back their sum.\n    return a + b\n```\n\nTime: O(1).';
app.whenReady().then(async () => {
  const manager = require('../src/managers/window.manager');
  manager.currentDisplay = screen.getPrimaryDisplay();
  ipcMain.handle('get-window-stats', () => manager.getWindowStats());
  ipcMain.handle('get-settings', () => ({ activeSkill: 'dsa', codingLanguage: 'cpp' }));
  ipcMain.handle('get-screenshot-queue', () => ({ count: 0 }));
  ipcMain.handle('get-speech-availability', () => false);
  ipcMain.handle('show-answer-windows', () => { manager.showAnswerWindows(); return { success: true }; });
  ipcMain.handle('close-window', event => { BrowserWindow.fromWebContents(event.sender).hide(); return { success: true }; });
  ipcMain.handle('copy-to-clipboard', async (_event, text) => { await clipboard.writeText(text); return true; });
  // Main toolbar may request a resize during initialization.
  ipcMain.handle('resize-window', () => ({ success: true }));
  for (const type of ['main', 'llmResponse', 'codeResponse']) {
    const win = await manager.createWindow(type);
    manager.windows.set(type, win);
  }
  manager.showLLMResponse('## Question\nHow should I structure an interview answer?\n\n## Answer\nStart with the main point, then support it with an example.');
  manager.showLLMResponse(fixture, { isImageAnalysis: true });
  const text = manager.getWindow('llmResponse');
  const code = manager.getWindow('codeResponse');
  const main = manager.getWindow('main');
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 300))');
  assert.ok(text.isVisible() && code.isVisible());
  const [tx, ty] = text.getPosition();
  const [mx, my] = main.getPosition();
  assert.ok(Math.abs(tx + text.getSize()[0] / 2 - mx - main.getSize()[0] / 2) <= 1, 'Answer centers under toolbar');
  assert.equal(ty, my + main.getSize()[1] + manager.windowGap);
  assert.ok(await text.webContents.executeJavaScript("document.getElementById('full-markdown').innerText.includes('Start with the main point')"));
  assert.ok(!(await text.webContents.executeJavaScript("document.getElementById('full-markdown').innerText.includes('Add the inputs.')")));
  assert.equal(await text.webContents.executeJavaScript("document.querySelectorAll('#full-markdown pre').length"), 0);
  manager.showLLMResponse('Use a specific example to support your answer.', { question: 'Can you expand on that?', messageId: 'qa-followup' });
  manager.showLLMResponse('Use a specific example to support your answer.', { question: 'Can you expand on that?', messageId: 'qa-followup' });
  manager.showLLMResponse(fixture, { isImageAnalysis: true });
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
  assert.equal(await text.webContents.executeJavaScript("document.querySelectorAll('.qa-entry').length"), 2, 'Follow-ups append without duplicated final events or coding responses');
  assert.ok(await text.webContents.executeJavaScript("document.querySelectorAll('.qa-question')[1].textContent.includes('Can you expand')"));
  assert.equal(await text.webContents.executeJavaScript("getComputedStyle(document.querySelector('.qa-answer p')).color"), 'rgb(114, 236, 157)');
  assert.equal(await text.webContents.executeJavaScript("getComputedStyle(document.querySelector('.qa-entry')).borderBottomWidth"), '1px');
  text.webContents.send('show-loading');
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 50))');
  assert.ok(await text.webContents.executeJavaScript("!document.getElementById('response-content').classList.contains('hidden')"), 'History stays readable while waiting for the next answer');
  assert.equal(await code.webContents.executeJavaScript("Array.from(document.querySelectorAll('.source-line code'), el => el.textContent).join('\\n')"), 'def add(a, b):\n    return a + b');
  assert.equal(await code.webContents.executeJavaScript("document.querySelectorAll('.line-explanation').length"), 2);
  assert.equal(await code.webContents.executeJavaScript("getComputedStyle(document.querySelector('.line-explanation')).color"), 'rgb(114, 236, 157)');
  assert.ok(await code.webContents.executeJavaScript("document.querySelector('.code-summary').innerText.includes('Add the inputs.')"));
  const screenshotCode = await code.webContents.executeJavaScript("document.getElementById('code-content').innerText");
  manager.showLLMResponse('<!-- coding-answer -->\n```python\nprint("spoken implementation")\n```', {
    isTranscriptionResponse: true, question: 'Show me a print implementation.', messageId: 'spoken-code'
  });
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
  assert.equal(await code.webContents.executeJavaScript("document.getElementById('code-content').innerText"), screenshotCode, 'Spoken code cannot replace screenshot code popup');
  assert.ok(await text.webContents.executeJavaScript("document.querySelector('.qa-entry:last-child .qa-answer code').textContent.includes('spoken implementation')"), 'Explicitly requested spoken code stays inside Q&A');
  manager.setInteractive(true);
  const originalClipboard = await clipboard.readText();
  try {
    await code.webContents.executeJavaScript("document.querySelector('.copy-btn').click(); new Promise(resolve => setTimeout(resolve, 100))");
    assert.equal(await clipboard.readText(), 'def add(a, b):\n    return a + b\n');
  } finally { await clipboard.writeText(originalClipboard); }
  assert.equal(await code.webContents.executeJavaScript("getComputedStyle(document.querySelector('.window-header')).webkitAppRegion"), 'drag');
  assert.equal(code.isResizable(), true);
  code.setBounds({ x: 120, y: 160, width: 520, height: 450 });
  const placed = code.getBounds();
  manager.showLLMResponse(fixture, { isImageAnalysis: true });
  assert.deepEqual(code.getBounds(), placed, 'Answers preserve the independently placed code window');
  manager.moveWindowsToActiveScreen();
  assert.deepEqual(code.getBounds(), placed, 'Screen tracking preserves code position');
  assert.equal(splitResponse('````js\nconst fence = "```";\n````\n').codeBlocks.length, 1);
  assert.equal(splitResponse('Example:\n~~~cpp\nint x = 1;\n~~~').codeBlocks.length, 1);
  // Export fixture renders for visual QA; no real screen data is saved.
  for (const [name, window] of [['answer', text], ['code', code], ['toolbar', main]]) {
    const image = await window.webContents.capturePage();
    const imagePath = path.join(os.tmpdir(), `opencluely-${name}-panel.png`);
    fs.writeFileSync(imagePath, image.toPNG());
    console.log('Rendered', imagePath);
  }
  await code.webContents.executeJavaScript("document.getElementById('close-window-btn').click(); new Promise(resolve => setTimeout(resolve, 100))");
  assert.equal(code.isVisible(), false);
  manager.setInteractive(false);
  manager.showAnswerWindows();
  assert.ok(code.isVisible() && text.isVisible() && !manager.isInteractive);
  manager.showLLMResponse('Plain answer without code.');
  assert.equal(code.isVisible(), true, 'Non-coding answers preserve the independently displayed code');
  manager.showLLMResponse('## Non-coding answer\n' + 'A long explanation.\n\n'.repeat(80));
  manager.showLLMResponse('## Explanation\n' + 'A long explanation.\n\n'.repeat(80) + '\n```python\n' + 'print("scroll")\n'.repeat(100) + '```', { isImageAnalysis: true });
  await code.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
  assert.ok(await code.webContents.executeJavaScript("(() => { const el = document.querySelector('.code-panel .panel-content'); return el.scrollHeight > el.clientHeight; })()"), 'Long code scrolls within the popup');
  assert.ok(await text.webContents.executeJavaScript("(() => { const el = document.querySelector('.full-content-inner'); return el.scrollHeight > el.clientHeight; })()"), 'Long answers scroll within the popup');
  await text.webContents.executeJavaScript("document.querySelector('.full-content-inner').style.scrollBehavior = 'auto'; document.querySelector('.full-content-inner').scrollTop = 250");
  text.webContents.send('panel-scroll', { x: 0, y: -200 });
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
  assert.ok(await text.webContents.executeJavaScript("document.querySelector('.full-content-inner').scrollTop < 250"), 'Native scroll messages allow scrolling back to previous Q&A entries');
  text.webContents.send('interim-transcription', { text: 'Can you explain the follow-up question?' });
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
  assert.ok(await text.webContents.executeJavaScript("document.getElementById('live-question').textContent.includes('follow-up')"), 'Speech appears before submission');
  text.webContents.send('transcription-received', { text: 'Can you explain the follow-up question?' });
  text.webContents.send('transcription-llm-response-start', { messageId: 'stream-check', question: 'Can you explain the follow-up question?' });
  text.webContents.send('transcription-llm-response-chunk', { messageId: 'stream-check', delta: 'Here is the live answer.\n\n'.repeat(30) });
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
  assert.ok(await text.webContents.executeJavaScript("document.querySelector('#pending-qa .qa-answer').innerText.includes('live answer')"), 'Answer streams into Q&A');
  assert.ok(await text.webContents.executeJavaScript("(() => { const el = document.querySelector('.full-content-inner'); return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2; })()"), 'Streaming follows the newest answer');
  manager.showLLMResponse('**Final streamed answer.**\n- Keep this plain.', { messageId: 'stream-check', question: 'Can you explain the follow-up question?' });
  await text.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
  assert.equal(await text.webContents.executeJavaScript("document.querySelectorAll('#pending-qa').length"), 0, 'Completed response replaces pending answer');
  assert.equal(await text.webContents.executeJavaScript("document.querySelectorAll('.qa-answer strong, .qa-answer ul').length"), 0, 'Answers display plain text instead of Markdown styling');
  assert.equal(await text.webContents.executeJavaScript("[...document.querySelectorAll('.qa-answer')].at(-1).innerText.includes('**')"), false, 'Raw bold markers are not shown');
  assert.ok(await text.webContents.executeJavaScript("(() => { const el = document.querySelector('.full-content-inner'); return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2; })()"), 'Completed answer scrolls to newest entry');
  assert.equal(await text.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor'), 'rgba(38, 38, 40, 0.16)');
  assert.equal(await text.webContents.executeJavaScript('getComputedStyle(document.body).borderTopWidth'), '1px');
  assert.equal(text.isFocusable(), false, 'Click-through answer does not steal VM focus');
  code.webContents.send('panel-scroll', { x: 0, y: 200 });
  await code.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
  assert.ok(await code.webContents.executeJavaScript("document.querySelector('.code-panel .panel-content').scrollTop > 0"), 'Native scroll messages scroll click-through code');
  manager.hideAllWindows();
  assert.equal(text.isVisible(), false);
  console.log('Answer panel checks passed: centering, separate code, copy, drag region, resizing, placement, close, reopen, visibility.');
  clearTimeout(timeout);
  manager.destroyAllWindows();
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
