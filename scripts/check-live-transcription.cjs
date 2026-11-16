// Optional API check using synthetic speech only. Generate the fixture in TEMP first.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { LiveTranscription } = require('../src/services/live-transcription.service');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const wave = fs.readFileSync(process.env.LIVE_TRANSCRIPTION_FIXTURE || path.join(os.tmpdir(), 'opencluely-live-fixture.wav'));
  let audio;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const size = wave.readUInt32LE(offset + 4);
    if (wave.toString('ascii', offset, offset + 4) === 'data') { audio = wave.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + size % 2;
  }
  assert.ok(audio?.length);
  const live = new LiveTranscription({ apiKey: process.env.OPENAI_API_KEY });
  live.manualSendEnabled = true;
  let interimBeforeCommit = false;
  let commits = 0;
  const fail = new Promise((_, reject) => live.on('error', reject));
  const final = new Promise(resolve => live.once('transcription', resolve));
  const timeout = setTimeout(() => { live.emit('error', new Error('Live fixture timed out')); }, 25000);
  live.on('interim', text => { if (text && !commits) interimBeforeCommit = true; });
  const send = live.send.bind(live);
  live.send = event => { if (event.type === 'input_audio_buffer.commit') commits++; send(event); };
  try {
    await Promise.race([live.connect(), fail]);
    const feeding = (async () => {
      for (let offset = 0; offset < audio.length; offset += 2048) {
        live.append(audio.subarray(offset, offset + 2048));
        await delay(64);
      }
      for (let i = 0; i < 30; i++) { live.append(Buffer.alloc(2048)); await delay(64); }
    })();
    await feeding;
    assert.equal(commits, 0, 'Pauses must not finalize manual recordings');
    await Promise.race([live.flush(), fail]);
    const transcript = await Promise.race([final, fail]);
    assert.match(transcript, /binary|search/i);
    assert.equal(commits, 1);
    assert.ok(live.ready, 'Provider remains available until the controller stops it after finalization');
    console.log(JSON.stringify({ success: true, manualFinalization: true, interimBeforeCommit, commits, transcript }));
  } finally { clearTimeout(timeout); live.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
