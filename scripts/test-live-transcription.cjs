const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { LiveTranscription, resamplePCM } = require('../src/services/live-transcription.service');

class Socket extends EventEmitter {
  constructor() {
    super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = [];
    queueMicrotask(() => this.emit('open'));
  }
  send(json) {
    const event = JSON.parse(json); this.sent.push(event);
    if (event.type === 'session.update') queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.updated' })));
  }
  close() { this.readyState = 3; this.emit('close'); }
}
const pcm = (ms, value = 10000) => {
  const buffer = Buffer.alloc(ms * 32);
  for (let i = 0; i < buffer.length; i += 2) buffer.writeInt16LE(value, i);
  return buffer;
};
const commits = live => live.socket.sent.filter(event => event.type === 'input_audio_buffer.commit').length;

test('manual listening ignores silence boundaries until Send finalizes the recording', async () => {
  let now = 0;
  const live = new LiveTranscription({ apiKey: 'test', Socket, now: () => now });
  live.manualSendEnabled = true;
  await live.connect();
  try {
    live.append(pcm(400)); now = 10000; live.append(pcm(3000,0)); live.checkSilence();
    assert.equal(commits(live),0, 'Silence must not end the recording');
    assert.equal(live.ready,true);
    const sent = live.flush(); assert.equal(commits(live),1);
    live.handleEvent({ type: 'input_audio_buffer.committed', item_id: 'manual-recording' });
    live.handleEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'manual-recording', transcript: 'One recorded question' });
    await sent;
  } finally { live.close(); }
});

test('manual commit waits for final transcript, submits once and continues streaming capture', async () => {
  const live = new LiveTranscription({ apiKey: 'test', Socket }); await live.connect();
  try {
    live.conversationId = 'first'; live.append(pcm(200));
    const one = live.flush(), two = live.flush();
    assert.equal(commits(live),1); assert.equal(live.ready,true);
    let final;
    live.on('transcription', (text, metadata) => { final = { text, metadata }; });
    live.conversationId = 'second';
    live.handleEvent({ type: 'input_audio_buffer.committed', item_id: 'manual-one' });
    live.handleEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'manual-one', transcript: 'Complete question' });
    await Promise.all([one,two]);
    assert.equal(final.text,'Complete question'); assert.equal(final.metadata.conversationId,'first');
    assert.equal(final.metadata.utteranceId,'manual-one');
    live.append(pcm(200)); live.commit(); assert.equal(commits(live),2);
  } finally { live.close(); }
});

test('streams audio immediately, waits 1.5 seconds, and resets the pause when speech resumes', async () => {
  let now = 0;
  const live = new LiveTranscription({ apiKey: 'test', Socket, now: () => now });
  await live.connect();
  try {
    assert.equal(live.socket.sent[0].session.audio.input.turn_detection, null);
    live.append(pcm(200));
    assert.ok(live.socket.sent.some(event => event.type === 'input_audio_buffer.append'));
    now = 1499; live.checkSilence(); assert.equal(commits(live), 0);
    live.append(pcm(200));
    now = 2998; live.checkSilence(); assert.equal(commits(live), 0);
    now = 2999; live.checkSilence(); assert.equal(commits(live), 1);
    now = 6000; live.append(pcm(100, 0)); live.checkSilence();
    assert.equal(commits(live), 1, 'Silence does not generate empty questions');
    live.append(pcm(200)); now = 7500; live.checkSilence();
    assert.equal(commits(live), 2, 'A later question remains a separate turn');
  } finally { live.close(); }
});

test('shows interim words before completion and preserves question order across late final transcripts', async () => {
  const live = new LiveTranscription({ apiKey: 'test', Socket });
  await live.connect();
  try {
    const partials = [], finals = [];
    live.on('interim', text => partials.push(text));
    live.on('transcription', (text, metadata) => finals.push([text, metadata.committed]));
    const event = (type, id, rest = {}) => live.handleEvent({ type, item_id: id, ...rest });
    event('conversation.item.input_audio_transcription.delta', 'a', { delta: 'How does ' });
    event('conversation.item.input_audio_transcription.delta', 'a', { delta: 'binary search work?' });
    assert.equal(partials.at(-1), 'How does binary search work?');
    assert.deepEqual(finals, []);
    event('input_audio_buffer.committed', 'b');
    event('conversation.item.input_audio_transcription.completed', 'b', { transcript: 'What is its complexity?' });
    assert.deepEqual(finals, []);
    event('conversation.item.input_audio_transcription.completed', 'a', { transcript: 'How does binary search work?' });
    assert.deepEqual(finals, [['How does binary search work?', true], ['What is its complexity?', true]]);
    event('conversation.item.input_audio_transcription.completed', 'a', { transcript: 'Duplicate' });
    assert.equal(finals.length, 2);
  } finally { live.close(); }
});

test('resampling preserves duration and PCM range', () => {
  const input = pcm(200, -20000);
  const output = resamplePCM(input);
  assert.equal(output.length, 200 * 48);
  for (let i = 0; i < output.length; i += 2) assert.equal(output.readInt16LE(i), -20000);
});
