// Run with Electron. Verifies the real main-process lifecycle starts the LAN bridge.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-electron-mobile-'));
app.setAppPath(path.resolve(__dirname, '..'));
app.setPath('userData', userData);
fs.writeFileSync(path.join(userData, '.opencluely-firstrun-completed'), 'test');
process.env.MOBILE_CONTROL_ENABLED = 'true';
process.env.MOBILE_CONTROL_PASSWORD = '9898';
process.env.MOBILE_CONTROL_PORT = String(43000 + Math.floor(Math.random() * 1000));
delete process.env.MOBILE_CONTROL_HOST;
// Exercise real controller/HTTP/queue/history with deterministic capture and model;
// Provider calls are mocked. Renderer microphone capture is exercised briefly.
const putMock = (name, value) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports: value }; };
const target = { kind: 'window', application: 'vmware', sourceId: 'window:1:0', displayName: 'Test - VMware Workstation' };
let captureSequence = 0; let failModel = false; let analyzed = []; let imageQuestion = null; let textQuestion = null; let imageSkill = null; let textSkill = null; let textHistory = null;
let holdText = null; let textStarted = null; let imageCalls = 0;
putMock('../src/services/capture.service', {
  selected: target, isProcessing: false, initialize() {}, setOverlayCaptureScope() {}, listDisplays: () => ({ success: true, displays: [] }),
  listTargets: async () => [target], selectTarget: async () => target,
  captureAndProcess: async () => ({ imageBuffer: Buffer.from(`fresh-${++captureSequence}`), mimeType: 'image/png', metadata: { source: { target } } })
});
const speech = new (require('node:events').EventEmitter)();
let finalizeCalls = 0;
speech.finalizePendingSpeech = async () => {
  finalizeCalls++; await new Promise(resolve => setTimeout(resolve, 30));
  for (let i = 0; i < 2; i++) speech.emit('transcription', 'What is a race condition?', { utteranceId: 'forced-utterance-one', committed: true, conversationId: speech.conversationId });
};
Object.assign(speech, { isRecording: false, available: false, captureSource: 'desktop', isAvailable: () => speech.available, hasPendingSpeech: () => false, getStatus: () => ({ isInitialized: speech.available, isRecording: speech.isRecording, isProcessingAudio: !!speech.isProcessingAudio, captureSource: speech.captureSource }),
  stopRecording() { this.isRecording = false; setTimeout(() => { this.liveTranscription = null; this.isProcessingAudio = false; this.emit('recording-stopped'); }, 200); },
  startRecording({ source } = {}) { this.captureSource = source || 'desktop'; this.isRecording = true; this.emit('recording-started'); }, handleAudioChunkFromRenderer() {}, ingestMobilePcm() {}, cleanup() {} });
putMock('../src/services/speech.service', speech);
putMock('../src/services/llm.service', {
  isInitialized: true, imageModel: 'mock', processConversation: async (turn, { skill }) => {
    const store = require('../src/services/conversation-store.service');
    const captures = store.loadAttachments(turn.user.id);
    if (captures.length) {
      imageCalls++; imageSkill = skill;
      analyzed = captures.map(item => fs.readFileSync(item.localPath).toString());
      imageQuestion = turn.user.content;
      if (failModel) throw new Error('simulated model failure');
      return { response: 'Mock answer', metadata: { processingTime: 1 } };
    }
    textQuestion = turn.user.content; textSkill = skill;
    textHistory = store.getMessages(turn.user.conversationId, { limit: 100 }).items;
    if (holdText) { textStarted?.(); await holdText; }
    return { response: 'Text answer', metadata: { processingTime: 1 } };
  }

});
const timeout = setTimeout(() => { console.error('MOBILE_MAIN_TEST timed out'); app.exit(1); }, 20000);
require('../main');

app.whenReady().then(async () => {
  const bridge = require('../src/services/mobile-bridge.service');
  for (let i = 0; i < 150 && !bridge.getStatus().enabled; i++) await new Promise(resolve => setTimeout(resolve, 100));
  const status = bridge.getStatus();
  assert.equal(status.enabled, true);
  assert.match(status.address, /^http:\/\/(10\.|192\.168\.|172\.)/);
  const health = await fetch(`${status.address}/api/v1/health`).then(response => response.json());
  assert.equal(health.success, true);
  const denied = await fetch(`${status.address}/api/v1/state`);
  assert.equal(denied.status, 401);
  assert.equal(status.autoConnect, false);
  const connected = await fetch(`${status.address}/api/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '9898', deviceName: 'Electron Expo test' }) }).then(response => response.json());
  assert.ok(connected.data.token);
  const authorized = await fetch(`${status.address}/api/v1/state`, { headers: { authorization: `Bearer ${connected.data.token}` } });
  assert.equal(authorized.status, 200);
  const headers = { authorization: `Bearer ${connected.data.token}`, 'content-type': 'application/json' };
  const post = async (route, requestId) => fetch(`${status.address}/api/v1/actions/${route}`, { method: 'POST', headers, body: JSON.stringify({ requestId }) }).then(async r => ({ status: r.status, body: await r.json() }));
  speech.available = true;
  const micStarted = await fetch(`${status.address}/api/v1/actions/computer-microphone`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'computer-mic-start', enabled: true }) });
  assert.equal(micStarted.status, 202); assert.equal(speech.isRecording, true); assert.equal(speech.captureSource, 'microphone');
  const microphoneState = await fetch(`${status.address}/api/v1/state`, { headers }).then(r => r.json());
  console.log('CAPTURE_SETTINGS', JSON.stringify(microphoneState.data.listening.activeDevice));
  const modeChanged = await fetch(`${status.address}/api/v1/actions/assistant-mode`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'mode-star', mode: 'behavioral_star' }) }).then(r => r.json());
  assert.equal(modeChanged.data.reasoningEffort, 'medium');
  const toolbar = require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await toolbar.webContents.executeJavaScript("document.getElementById('assistantModeSelect').value"), 'behavioral_star');
  const layout = await toolbar.webContents.executeJavaScript(`({ width: innerWidth, controls: [...document.querySelectorAll('.command-tab > *')].map(el => ({ id: el.id, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })) })`);
  assert.ok(layout.controls.every(control => control.left >= -1 && control.right <= layout.width + 1), 'Toolbar controls remain within the visible window');
  speech.emit('transcription', 'What is a race condition?', { utteranceId: 'provider-auto-final', committed: true, conversationId: speech.conversationId });
  await new Promise(resolve => setTimeout(resolve, 1700));
  const storeBeforeSend = require('../src/services/conversation-store.service');
  assert.equal(storeBeforeSend.getMessages(storeBeforeSend.currentConversationId).items.length, 0, 'Provider finalization and silence do not submit before Send');
  const caseChanged = await fetch(`${status.address}/api/v1/actions/assistant-mode`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'mode-case', mode: 'case_interview' }) }).then(r => r.json());
  assert.equal(caseChanged.data.model, 'gpt-6.1-sol'); assert.equal(caseChanged.data.reasoningEffort, 'medium');
  assert.equal(speech.isRecording, true, 'Switching to Case must not stop listening');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await toolbar.webContents.executeJavaScript("document.getElementById('assistantModeSelect').value"), 'case_interview');
  await toolbar.webContents.executeJavaScript("(() => { const select = document.getElementById('assistantModeSelect'); select.value = 'behavioral_star'; select.dispatchEvent(new Event('change')); })()");
  for (let i=0; i<30; i++) { const next = (await fetch(`${status.address}/api/v1/state`, { headers }).then(r=>r.json())).data; if (next.assistantMode.mode === 'behavioral_star') break; await new Promise(resolve=>setTimeout(resolve,20)); }
  assert.equal((await fetch(`${status.address}/api/v1/state`, { headers }).then(r=>r.json())).data.assistantMode.mode, 'behavioral_star');
  const force = id => fetch(`${status.address}/api/v1/actions/send-speech`, { method: 'POST', headers, body: JSON.stringify({ requestId: id }) }).then(r => r.json());
  const forced = await Promise.all([force('force-one'), force('force-two')]);
  assert.ok(forced.every(result => result.success)); assert.equal(finalizeCalls, 1);
  assert.equal(speech.isRecording, false, 'Green Send stops listening');
  assert.equal(await toolbar.webContents.executeJavaScript('window.mainWindowUI.isRecording'), false, 'Renderer capture stops when Send is pressed');
  assert.equal((await fetch(`${status.address}/api/v1/state`, { headers }).then(r => r.json())).data.listening.desiredOn, false);
  const conversationStore = require('../src/services/conversation-store.service');
  for (let i = 0; i < 50 && !conversationStore.getMessages(conversationStore.currentConversationId).items.some(m => m.role === 'assistant' && m.status === 'completed'); i++) await new Promise(resolve => setTimeout(resolve, 20));
  const forcedMessages = conversationStore.getMessages(conversationStore.currentConversationId).items;
  assert.equal(forcedMessages.filter(m => m.role === 'user' && m.content === 'What is a race condition?').length, 1, 'Duplicate provider callbacks submit one question');
  await fetch(`${status.address}/api/v1/actions/assistant-mode`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'mode-normal', mode: 'normal' }) });
  const micStopped = await fetch(`${status.address}/api/v1/actions/computer-microphone`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'computer-mic-stop', enabled: false }) });
  assert.equal(micStopped.status, 202);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(speech.isRecording, false);
  const state = async () => (await fetch(`${status.address}/api/v1/state`, { headers }).then(r => r.json())).data;
  const first = await post('capture', 'capture-1'); const second = await post('capture', 'capture-2');
  assert.equal(first.status, 202); assert.equal(second.body.data.count, 2);
  const preview = await fetch(`${status.address}/api/v1/screenshots/${first.body.data.id}/preview`, { headers });
  assert.equal(preview.status, 404);
  failModel = true;
  let job = (await post('submit', 'submit-fail')).body.data;
  const waitJob = async id => { for (let i = 0; i < 100; i++) { const value = (await fetch(`${status.address}/api/v1/jobs/${id}`, { headers }).then(r => r.json())).data; if (value.status !== 'processing') return value; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Job timed out'); };
  assert.equal((await waitJob(job.id)).status, 'failed');
  assert.equal((await state()).screenshotQueueCount, 2);
  failModel = false; job = (await post('submit', 'submit-success')).body.data;
  assert.equal((await waitJob(job.id)).status, 'completed');
  assert.equal(imageSkill, 'general_qa');
  assert.deepEqual(analyzed, ['fresh-1', 'fresh-2']);
  assert.equal((await state()).screenshotQueueCount, 0);
  const historyState = await state();
  const history = await fetch(`${status.address}/api/v1/conversations/${historyState.currentConversationId}/messages`, { headers }).then(r => r.json());
  assert.ok(history.data.items.some(message => message.content === 'Mock answer'));
  const screenshotQuestion = history.data.items.find(message => message.role === 'user' && message.attachmentCount === 2);
  assert.ok(screenshotQuestion);
  const sendMessage = body => fetch(`${status.address}/api/v1/messages`, { method: 'POST', headers, body: JSON.stringify({ requestId: require('crypto').randomUUID(), ...body }) }).then(r => r.json());
  let followup = (await sendMessage({ content: 'Explain the screenshot again', attachmentMessageId: screenshotQuestion.id })).data;
  assert.equal((await waitJob(followup.id)).status, 'completed');
  assert.equal(imageQuestion, 'Explain the screenshot again');
  assert.deepEqual(analyzed, ['fresh-1', 'fresh-2']);
  followup = (await sendMessage({ content: 'Text-only follow-up' })).data;
  assert.equal((await waitJob(followup.id)).status, 'completed');
  assert.equal(textQuestion, 'Text-only follow-up');
  assert.equal(textSkill, 'general_qa');
  assert.ok(textHistory.some(item => item.content === 'Mock answer'), 'Mobile follow-up uses stored completed answers');
  // Queued screenshot work keeps the conversation selected at submission, even across New Chat.
  await post('capture', 'capture-serial');
  let releaseText; holdText = new Promise(resolve => { releaseText = resolve; });
  const started = new Promise(resolve => { textStarted = resolve; });
  const queuedText = (await sendMessage({ content: 'Question before screenshot' })).data;
  await started;
  const callsBefore = imageCalls;
  const queuedImage = (await post('submit', 'submit-serial')).body.data;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(imageCalls, callsBefore, 'Screenshot model work waits for mobile text');
  const beforeSwitch = (await state()).currentConversationId;
  assert.equal((await post('new-conversation', 'new-while-queued')).status, 202);
  const afterSwitch = (await state()).currentConversationId;
  assert.notEqual(afterSwitch, beforeSwitch);
  releaseText(); holdText = null; textStarted = null;
  assert.equal((await waitJob(queuedText.id)).status, 'completed');
  assert.equal((await waitJob(queuedImage.id)).status, 'completed');
  assert.equal(imageCalls, callsBefore + 1);
  const switchedHistory = await fetch(`${status.address}/api/v1/conversations/${afterSwitch}/messages`, { headers }).then(r => r.json());
  assert.equal(switchedHistory.data.items.length, 0, 'Old queued responses stay in their original conversation');
  assert.equal((await post('submit', 'submit-empty')).body.error.code, 'EMPTY_QUEUE');
  const manager = require('../src/managers/window.manager');
  assert.equal(manager.getWindow('chat'), undefined);
  manager.handleRecordingStarted(); manager.showAllWindows();
  assert.equal(manager.getWindow('chat'), undefined);
  console.log('MOBILE_MAIN_TEST', JSON.stringify(status));
  clearTimeout(timeout);
  await bridge.stop();
  app.exit(0);
}).catch(error => { console.error(error.stack); clearTimeout(timeout); app.exit(1); });
