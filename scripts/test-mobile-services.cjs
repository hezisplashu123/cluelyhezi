const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../src/services/conversation-store.service');
const auth = require('../src/services/mobile-auth.service');
const bridge = require('../src/services/mobile-bridge.service');
const events = require('../src/services/conversation-events.service');
const actions = require('../src/services/action-controller.service');
const WebSocket = require('ws');

test('pairing issues a token, rejects wrong codes, and supports revocation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-auth-'));
  auth.initialize(root);
  const pairing = auth.generatePairingCode(10000);
  assert.throws(() => auth.pair('999999', 'Wrong'), /Invalid pairing code/);
  const paired = auth.pair(pairing.code, 'Test phone');
  assert.equal(auth.authenticate(paired.token).name, 'Test phone');
  assert.equal(auth.revoke(paired.device.id), true);
  assert.equal(auth.authenticate(paired.token), null);
  const expired = auth.generatePairingCode(1); auth.pairing.expiresAt = Date.now() - 1;
  assert.throws(() => auth.pair(expired.code, 'Expired'), /expired/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('conversation streaming persists one turn, reloads, paginates, and preserves old conversations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-history-'));
  store.initialize(root);
  const firstConversation = store.currentConversationId;
  const turn = store.createTurn({ source: 'chat', content: 'What is O(n)?', skill: 'dsa' });
  store.appendAssistant(turn.assistant.id, 'Linear');
  store.appendAssistant(turn.assistant.id, ' time');
  store.completeAssistant(turn.assistant.id, 'Linear time');
  const page = store.getMessages(firstConversation, { limit: 30 });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].content, 'What is O(n)?');
  assert.equal(page.items[1].content, 'Linear time');
  const second = store.createConversation({ title: 'Second' });
  assert.notEqual(second.id, firstConversation);
  assert.equal(store.getConversation(firstConversation).id, firstConversation);
  store.close();
  store.initialize(root);
  assert.equal(store.getMessage(turn.assistant.id).content, 'Linear time');
  assert.equal(store.listConversations().items.find(item => item.id === firstConversation).preview, 'What is O(n)?');
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('screenshot attachments remain private files and missing files are detectable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-captures-'));
  store.initialize(root);
  const turn = store.createTurn({ source: 'screenshot', content: 'Screenshot request · 1 image' });
  store.addAttachments(turn.user.id, [{ imageBuffer: Buffer.from('image'), mimeType: 'image/png', metadata: { displayId: 2 } }]);
  assert.equal(store.getMessage(turn.user.id).attachmentCount, 1);
  const [attachment] = store.loadAttachments(turn.user.id);
  assert.equal(attachment.exists, true);
  assert.ok(attachment.localPath.startsWith(path.join(root, 'conversations', 'captures')));
  fs.unlinkSync(attachment.localPath);
  assert.equal(store.loadAttachments(turn.user.id)[0].exists, false);
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('mobile bridge rejects unauthenticated requests and authenticates HTTP and WebSocket clients', async (t) => {
  const address = bridge.getLanAddresses()[0]?.address;
  if (!address) return t.skip('No private LAN interface available');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-bridge-'));
  auth.initialize(root); store.initialize(root);
  let captureCount = 0; let resendCount = 0; let requestedSource;
  actions.configure({ capture: async ({ sourceId }) => { requestedSource = sourceId; await new Promise(resolve => setTimeout(resolve, 30)); return { success: true, id: 'shot-1', count: ++captureCount }; }, resendMessage: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return { sequence: ++resendCount }; } });
  const port = 33000 + Math.floor(Math.random() * 10000);
  const speech = new (require('events').EventEmitter)();
  Object.assign(speech, { isRecording: false, isAvailable: () => true, startRecording({ source }) { this.captureSource = source; this.isRecording = true; this.emit('recording-started'); }, stopRecording() { this.isRecording = false; }, ingestMobilePcm(data) { this.bytes = (this.bytes || 0) + data.length; } });
  await bridge.start({ host: address, port, auth, store, events, actions, speech, stateProvider: Object.assign(async () => ({ ready: true, displays: [] }), { getJob: () => null }), autoConnect: false });
  const base = `http://${address}:${port}`;
  const denied = await fetch(`${base}/api/v1/state`);
  assert.equal(denied.status, 401);
  const automaticResponse = await fetch(`${base}/api/v1/dev-connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceName: 'Expo Go test' }) });
  assert.equal(automaticResponse.status, 401);
  assert.equal((await fetch(`${base}/api/v1/screenshots/shot-1/preview`)).status, 401);
  const pairing = auth.generatePairingCode();
  const pairedResponse = await fetch(`${base}/api/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code, deviceName: 'Bridge test' }) });
  assert.equal(pairedResponse.status, 201);
  const paired = (await pairedResponse.json()).data;
  const state = await fetch(`${base}/api/v1/state`, { headers: { authorization: `Bearer ${paired.token}` } });
  assert.equal(state.status, 200);
  const captureBody = JSON.stringify({ requestId: 'same-capture-request', sourceId: 'window:123:0' });
  const captureResponses = await Promise.all([1, 2].map(() => fetch(`${base}/api/v1/actions/capture`, { method: 'POST', headers: { authorization: `Bearer ${paired.token}`, 'content-type': 'application/json' }, body: captureBody })));
  for (const capture of captureResponses) { assert.equal(capture.status, 202); assert.equal((await capture.json()).data.id, 'shot-1'); }
  assert.equal(captureCount, 1);
  assert.equal(requestedSource, 'window:123:0');
  const preview = await fetch(`${base}/api/v1/screenshots/shot-1/preview`, { headers: { authorization: `Bearer ${paired.token}` } });
  assert.equal(preview.status, 404);
  assert.equal((await fetch(`${base}/api/v1/actions/toggle-interaction`, { method: 'POST', headers: { authorization: `Bearer ${paired.token}` } })).status, 404);
  const secondCode = auth.generatePairingCode().code;
  const second = (await fetch(`${base}/api/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: secondCode, deviceName: 'Second phone' }) }).then(response => response.json())).data;
  const resend = token => fetch(`${base}/api/v1/messages/example/resend`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'same-resend' }) }).then(response => response.json());
  const [r1, r2] = await Promise.all([resend(paired.token), resend(paired.token)]);
  assert.equal(r1.data.sequence, 1); assert.equal(r2.data.sequence, 1); assert.equal(resendCount, 1);
  const otherResend = await resend(second.token); assert.equal(otherResend.data.sequence, 2); assert.equal(resendCount, 2);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}:${port}/api/v1/events`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'audio.start', sessionId: 'session-123' })));
    ws.on('close', code => { try { assert.equal(code, 4001); assert.equal(speech.isRecording, false); resolve(); } catch (error) { reject(error); } });
    ws.on('error', reject);
  });
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}:${port}/api/v1/events`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'authenticate', token: paired.token, lastSequence: events.sequence })));
    ws.on('message', raw => { const value = JSON.parse(raw); if (value.type === 'authenticated') ws.send(JSON.stringify({ type: 'audio.start', sessionId: 'session-123', encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }));
      if (value.type === 'audio.status' && value.status === 'listening') { ws.send(JSON.stringify({ type: 'audio.chunk', sessionId: 'session-123', sequence: 1, pcm: Buffer.alloc(320, 1).toString('base64') })); ws.send(JSON.stringify({ type: 'audio.stop', sessionId: 'session-123' })); }
      if (value.type === 'audio.status' && value.status === 'stopped') { try { assert.ok(speech.bytes > 0); assert.equal(speech.isRecording, false); ws.close(); resolve(); } catch (error) { reject(error); } }
      if (value.type === 'audio.error') reject(new Error(value.message)); });
    ws.on('error', reject);
  });
  auth.revoke(paired.device.id);
  const revoked = await fetch(`${base}/api/v1/state`, { headers: { authorization: `Bearer ${paired.token}` } });
  assert.equal(revoked.status, 401);
  await bridge.stop(); store.close(); fs.rmSync(root, { recursive: true, force: true });
});
