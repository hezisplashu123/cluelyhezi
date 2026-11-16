const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const store = require('../src/services/conversation-store.service');
const modes = require('../src/services/assistant-mode.service');
const { ConversationContext } = require('../src/services/conversation-context.service');
const { PendingUtterance, mergeFragments } = require('../src/services/pending-utterance.service');
const { validate } = require('../src/services/image-validation.service');
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-phase2-'));
  store.initialize(root); modes.initialize(store);
  return { root, context: new ConversationContext(store), close() { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
};
const completed = (content, answer, source = 'speech') => {
  const turn = store.createTurn({ source, content }); store.completeAssistant(turn.assistant.id, answer); return turn;
};
const text = request => JSON.stringify(request.input);

test('version-one attachment records migrate without losing original messages, hashes or files', () => {
  const f = fixture();
  try {
    const turn = completed('Original screenshot', 'Original answer');
    store.addAttachments(turn.user.id, [{ imageBuffer: Buffer.from('legacy file'), mimeType: 'image/png' }]);
    const original = store.loadAttachments(turn.user.id)[0]; const filename = store.dbPath;
    store.close();
    const legacy = new (require('node:sqlite').DatabaseSync)(filename);
    legacy.exec(`PRAGMA foreign_keys=OFF; DROP INDEX idx_attachments_message;
      ALTER TABLE attachments RENAME TO temp_attachments_v2;
      CREATE TABLE attachments(id TEXT PRIMARY KEY,message_id TEXT NOT NULL,local_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,size INTEGER NOT NULL,content_hash TEXT,created_at TEXT NOT NULL,metadata_json TEXT,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE);
      INSERT INTO attachments SELECT id,message_id,local_path,mime_type,size,content_hash,created_at,metadata_json FROM temp_attachments_v2;
      DROP TABLE temp_attachments_v2; CREATE INDEX idx_attachments_message ON attachments(message_id);
      DROP TABLE conversation_context; DELETE FROM schema_migrations WHERE version=2;`);
    legacy.close(); store.initialize(f.root);
    const migrated = store.loadAttachments(turn.user.id)[0];
    assert.equal(migrated.id,original.id); assert.equal(migrated.contentHash,original.contentHash);
    assert.equal(fs.readFileSync(migrated.localPath,'utf8'),'legacy file');
    assert.equal(store.getMessage(turn.assistant.id).content,'Original answer');
    assert.equal(store.getAttachment(original.id,'paired-device').conversation_id,turn.user.conversationId);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { f.close(); }
});

test('SQLite context isolates conversations, includes current input once and excludes pending/failed/interrupted answers', () => {
  const f = fixture();
  try {
    const first = store.currentConversationId;
    completed('Our project is Apollo, budget $12345.', 'First issue: locking. Second problem: cache invalidation.');
    const failed = store.createTurn({ source: 'chat', content: 'failed question' }); store.failAssistant(failed.assistant.id, 'offline', 'bad answer');
    const pending = store.createTurn({ source: 'chat', content: 'pending question' }); store.appendAssistant(pending.assistant.id, 'unfinished');
    const current = store.createTurn({ source: 'mobile_text', content: 'How would you fix the second problem?' });
    const request = f.context.build(current);
    assert.match(text(request), /Second problem: cache invalidation/);
    assert.equal(request.input.filter(m => m.content.some(p => p.text === current.user.content)).length, 1);
    assert.doesNotMatch(text(request), /failed question|bad answer|pending question|unfinished/);
    store.createConversation();
    const clean = store.createTurn({ source: 'chat', content: 'Hello' });
    assert.doesNotMatch(text(f.context.build(clean)), /Apollo|12345|cache invalidation/);
    store.selectConversation(first);
    store.close(); store.initialize(f.root); modes.initialize(store);
    assert.match(text(f.context.build(store.createTurn({ source: 'speech', content: 'Recall the budget' }))), /12345/);
    assert.equal(store.getMessage(pending.assistant.id).status, 'interrupted');
  } finally { f.close(); }
});

test('budgeted recent complete turns, extractive rolling notes, exact retrieval and pinned facts survive restart', () => {
  const f = fixture();
  try {
    const original = completed('Project Zeppelin needs exactly 1777 replicas.', 'Use port 8123. The second issue is lock starvation.');
    for (let i = 0; i < 40; i++) completed(`Topic ${i}`, 'Unrelated discussion. '.repeat(150));
    f.context.pin(store.currentConversationId, ['Owner: Amira; hard limit 2027.']);
    const current = store.createTurn({ source: 'chat', content: 'What is the Zeppelin replica count and port?' });
    const request = f.context.build(current);
    assert.match(text(request), /1777 replicas/); assert.match(text(request), /8123/); assert.match(text(request), /Amira/);
    assert.ok(text(request).length < 85000);
    assert.equal(store.getMessage(original.user.id).content, 'Project Zeppelin needs exactly 1777 replicas.');
    const summary = store.db.prepare('SELECT * FROM conversation_context WHERE conversation_id=?').get(store.currentConversationId);
    assert.ok(summary.through_rowid > 0); assert.ok(summary.summary.length <= 14000);
    store.close(); store.initialize(f.root);
    assert.equal(store.getMessage(original.assistant.id).content, 'Use port 8123. The second issue is lock starvation.');
  } finally { f.close(); }
});

test('mode defaults, prompt, reasoning, persistence and clean New Chat use one authoritative setting', () => {
  const f = fixture();
  try {
    assert.deepEqual(modes.snapshot(), { mode: 'normal', model: 'gpt-6-luna', reasoningEffort: 'low', starEnabled: false });
    const turn = completed('A question', 'An answer');
    const normal = f.context.build(turn);
    modes.set('behavioral_star'); const star = f.context.build(turn);
    assert.equal(normal.reasoning.effort, 'low'); assert.equal(star.reasoning.effort, 'medium');
    assert.equal(normal.model, 'gpt-6-luna'); assert.equal(star.model, 'gpt-6.1-sol');
    assert.match(star.instructions, /Situation:|Task:|Action:|Result:/);
    assert.match(star.instructions, /technical or factual questions answer directly/);
    assert.match(star.instructions, /Never invent experience/);
    assert.doesNotMatch(normal.instructions, /For behavioral questions use exactly/);
    store.createConversation(); assert.equal(modes.snapshot().mode, 'behavioral_star');
    store.close(); store.initialize(f.root); modes.initialize(store);
    assert.equal(modes.snapshot().mode, 'behavioral_star'); assert.ok(store.getMessage(turn.user.id));
    modes.set('normal'); assert.ok(store.getMessage(turn.assistant.id));
  } finally { f.close(); }
});

test('images validate actual decoded content, persist dimensions, scope ownership and bind atomically', async () => {
  const f = fixture();
  try {
    const buffer = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#2468ac' } }).png().toBuffer();
    await assert.rejects(validate(Buffer.from('<svg>not an allowed still image</svg>')));
    await assert.rejects(validate(buffer.subarray(0, 40)));
    await assert.rejects(validate(Buffer.alloc(10 * 1024 * 1024 + 1)));
    const options = { conversationId: store.currentConversationId, deviceId: 'phone-a', requestId: 'upload-one' };
    const [image, retry] = await Promise.all([store.uploadImage(buffer, options), store.uploadImage(buffer, options)]);
    assert.equal(image.id, retry.id); assert.equal(image.width, 30); assert.equal(image.height, 20);
    assert.equal(fs.readdirSync(store.captureDir).length, 1);
    assert.equal(store.getAttachment(image.id, 'phone-b'), null);
    assert.throws(() => store.createTurn({ source: 'mobile_text', content: '', attachmentIds: [image.id], ownerDeviceId: 'phone-b' }));
    assert.equal(store.getMessages(options.conversationId).items.length, 0, 'Invalid ownership rolls back the entire turn');
    const turn = store.createTurn({ source: 'mobile_text', content: 'Remember this diagram', attachmentIds: [image.id], ownerDeviceId: 'phone-a' });
    const request = f.context.build(turn);
    assert.equal(request.input.at(-1).content.filter(p => p.type === 'input_image').length, 1);
    store.completeAssistant(turn.assistant.id, 'The diagram contains a blue block.');
    const followup = store.createTurn({ source: 'speech', content: 'Look at the previous image and explain its second section.' });
    assert.equal(f.context.build(followup).input.flatMap(m => m.content).filter(p => p.type === 'input_image').length, 1);
    const unrelated = store.createTurn({ source: 'chat', content: 'What is a race condition?' });
    assert.equal(f.context.build(unrelated).input.flatMap(m => m.content).filter(p => p.type === 'input_image').length, 0);
    const second = store.createConversation();
    assert.throws(() => store.createTurn({ conversationId: second.id, source: 'chat', content: '', attachmentIds: [image.id], ownerDeviceId: 'phone-a' }));
    store.deleteConversation(options.conversationId); assert.equal(fs.readdirSync(store.captureDir).length, 0);
  } finally { f.close(); }
});

test('all request sources use the mode model; an active request retains its model and mode after a toggle', async () => {
  const f = fixture(); const llm = require('../src/services/llm.service');
  const oldClient = llm.client, oldInitialized = llm.isInitialized;
  try {
    llm.isInitialized = true;
    const requests = []; let release; let started;
    const held = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    llm.client = { responses: { create: async function* (request) {
      requests.push(request); started(); if (requests.length === 1) await held;
      yield { type: 'response.output_text.delta', delta: 'A useful answer.' }; yield { type: 'response.completed' };
    } } };
    const turn = store.createTurn({ source: 'chat', content: 'A typed question' });
    const deltas = []; const pending = llm.processConversation(turn, {}, d => deltas.push(d));
    await entered; modes.set('behavioral_star'); release();
    const answer = await pending;
    assert.equal(answer.metadata.mode, 'normal'); assert.equal(answer.metadata.reasoningEffort, 'low');
    assert.deepEqual(deltas, ['A useful answer.']); assert.ok(answer.metadata.firstTokenMs >= 0);
    store.completeAssistant(turn.assistant.id, answer.response, answer.metadata);
    for (const source of ['speech','mobile_text','mobile_voice','screenshot','force_send']) {
      const next = store.createTurn({ source, content: `Question from ${source}` });
      const result = await llm.processConversation(next);
      assert.equal(result.metadata.mode, 'behavioral_star'); assert.equal(result.metadata.reasoningEffort, 'medium');
      store.completeAssistant(next.assistant.id, result.response, result.metadata);
    }
    assert.ok(requests.every(r => r.stream && r.store === false));
    assert.equal(requests[0].model, 'gpt-6-luna');
    assert.ok(requests.slice(1).every(r => r.model === 'gpt-6.1-sol'));
    assert.equal(requests[0].reasoning.effort, 'low');
    assert.ok(requests.slice(1).every(r => r.reasoning.effort === 'medium'));
    assert.match(text(requests.at(-1)), /A typed question/);
  } finally { llm.client = oldClient; llm.isInitialized = oldInitialized; f.close(); }
});

test('utterance IDs reject duplicate callbacks; overlap merging preserves the complete question', () => {
  const pending = new PendingUtterance();
  assert.equal(pending.accept({ utteranceId: 'one' }), true);
  assert.equal(pending.accept({ utteranceId: 'one' }), false);
  assert.equal(pending.accept({ utteranceId: 'two' }), true);
  assert.equal(mergeFragments(['How would you', 'you fix the second issue?', 'How would you you fix the second issue?']).includes('second issue?'), true);
  assert.equal(mergeFragments(['How would you', 'you fix the second issue?']), 'How would you fix the second issue?');
  assert.equal(mergeFragments(['A question', 'A question']), 'A question');
});

test('authenticated multipart upload, thumbnails, retries, malformed images and destructive confirmations', async t => {
  const f = fixture();
  const bridge = require('../src/services/mobile-bridge.service');
  const auth = require('../src/services/mobile-auth.service');
  const actions = require('../src/services/action-controller.service');
  const events = require('../src/services/conversation-events.service');
  const address = bridge.getLanAddresses()[0]?.address;
  if (!address) { f.close(); return t.skip('No LAN interface'); }
  try {
    auth.initialize(f.root, '9898');
    const login = auth.login('9898','Upload test'); const second = auth.login('9898','Other device');
    actions.configure({ clearHistory: () => store.deleteAllHistory(), deleteConversation: id => store.deleteConversation(id), setMode: mode => modes.set(mode) });
    await bridge.start({ host: address, port: 45000 + Math.floor(Math.random()*1000), auth, store, events, actions, stateProvider: () => ({ currentConversationId: store.currentConversationId }) });
    const base = bridge.getStatus().address; const headers = { Authorization: `Bearer ${login.token}` };
    const bytes = await sharp({ create: { width: 20, height: 30, channels: 3, background: 'red' } }).png().toBuffer();
    const upload = async (buffer, key, token = login.token) => {
      const form = new FormData(); form.append('conversationId',store.currentConversationId); form.append('requestId',key); form.append('image',new Blob([buffer], {type:'text/plain'}),'misleading.exe');
      return fetch(`${base}/api/v1/attachments`, { method:'POST',headers:{Authorization:`Bearer ${token}`},body:form });
    };
    assert.equal((await fetch(`${base}/api/v1/attachments`,{method:'POST'})).status,401);
    const response = await upload(bytes,'first'); assert.equal(response.status,201); const image = (await response.json()).data;
    assert.equal(image.mimeType,'image/png'); assert.equal(image.width,20); assert.equal(image.localPath,undefined);
    const again = await upload(bytes,'first'); assert.equal((await again.json()).data.id,image.id);
    assert.equal((await upload(Buffer.from('not an image'),'invalid')).status,400);
    assert.equal((await upload(Buffer.from('changed'),'first')).status,400);
    // A dropped multipart stream writes no permanent file. The same key can retry.
    await new Promise(resolve => {
      const req = require('http').request(`${base}/api/v1/attachments`, { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=interrupted' } });
      req.on('error', resolve); req.on('close', resolve);
      req.write('--interrupted\r\nContent-Disposition: form-data; name="conversationId"\r\n\r\n' + store.currentConversationId + '\r\n--interrupted\r\nContent-Disposition: form-data; name="requestId"\r\n\r\nretry-interrupted\r\n--interrupted\r\nContent-Disposition: form-data; name="image"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n');
      req.write(bytes.subarray(0,20)); setTimeout(() => req.destroy(),20);
    });
    await new Promise(resolve => setTimeout(resolve,20));
    assert.equal(fs.readdirSync(store.captureDir).length,1);
    assert.equal((await upload(bytes,'retry-interrupted')).status,201);
    const endpoint = `${base}/api/v1/attachments/${image.id}/thumbnail`;
    assert.equal((await fetch(endpoint)).status,401);
    assert.equal((await fetch(endpoint,{headers:{Authorization:`Bearer ${second.token}`}})).status,404);
    const thumbnail = await fetch(endpoint,{headers}); assert.equal(thumbnail.status,200);
    assert.equal((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).format,'jpeg');
    assert.equal((await fetch(`${base}/api/v1/attachments/..%2F..%2F.env/original`,{headers})).status,404);
    const destructive = confirm => fetch(`${base}/api/v1/actions/clear-history`, { method:'POST', headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({confirm,requestId:`clear-${confirm}`}) });
    assert.equal((await destructive(false)).status,400); assert.ok(store.getAttachment(image.id,login.device.id));
    modes.set('behavioral_star'); assert.equal((await destructive(true)).status,202);
    assert.equal(modes.snapshot().mode,'behavioral_star'); assert.equal(store.getStorageUsage().attachmentCount,0);
  } finally { await bridge.stop(); f.close(); }
});
