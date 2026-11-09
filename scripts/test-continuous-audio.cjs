// Run with Electron. Exercises the real app, permission handlers, IPC and
// automatic startup while the overlay is hidden, then simulates a stream loss.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const assert = require('assert/strict');
const fs = require('fs');
app.setAppPath(path.resolve(__dirname, '..'));
app.setPath('userData', path.join(app.getPath('appData'), 'opencluely'));
require('../main');
const speech = require('../src/services/speech.service');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('CONTINUOUS_TEST timed out'); app.exit(1); }, process.env.AUDIO_TEST_SPOKEN_QUESTION ? 120000 : 35000);

app.whenReady().then(async () => {
  await wait(4500);
  const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html'));
  assert.ok(main, 'App main window must load');
  const state = () => main.webContents.executeJavaScript(`(() => {
    const ui = window.mainWindowUI;
    return { recording: ui.isRecording, context: ui._audioContext && ui._audioContext.state,
      tracks: ui._mediaStream && ui._mediaStream.getAudioTracks().map(track => track.readyState),
      lastChunkAgeMs: Date.now() - ui._lastAudioChunkAt };
  })()`);
  const started = await state();
  assert.equal(speech.isRecording, true, 'Service must auto-start');
  assert.equal(started.recording, true);
  assert.deepEqual(started.tracks, ['live']);
  if (process.env.AUDIO_TEST_SPOKEN_QUESTION) {
    const llm = require('../src/services/llm.service');
    const original = llm.processTranscriptionWithIntelligentResponseStream.bind(llm);
    let transcript;
    speech.once('transcription', text => { transcript = text; });
    const answered = new Promise((resolve, reject) => {
      llm.processTranscriptionWithIntelligentResponseStream = async (...args) => {
        try { const result = await original(...args); resolve(result); return result; }
        catch (error) { reject(error); throw error; }
      };
    });
    const wav = fs.readFileSync(process.env.AUDIO_TEST_SPOKEN_QUESTION).toString('base64');
    await main.webContents.executeJavaScript(`(async () => {
      const context = new AudioContext(); await context.resume();
      const bytes = Uint8Array.from(atob(${JSON.stringify(wav)}), value => value.charCodeAt(0));
      const audio = await context.decodeAudioData(bytes.buffer);
      const source = context.createBufferSource(); source.buffer = audio;
      source.connect(context.destination); source.start();
      await new Promise(resolve => { source.onended = resolve; });
      await context.close();
    })()`, true);
    const answer = await answered;
    assert.match(transcript, /binary search/i);
    assert.ok(answer.response && answer.response.length > 20);
    console.log('SPOKEN_QUESTION_TEST', JSON.stringify({ transcript, answerCharacters: answer.response.length }));
    llm.processTranscriptionWithIntelligentResponseStream = original;
  }
  main.hide();
  await wait(7500);
  const background = await state();
  assert.equal(background.context, 'running');
  assert.ok(background.lastChunkAgeMs < 2000, 'Background capture must keep sending PCM');
  // Simulate an ended device track and exercise the same recovery callback
  // invoked by Windows when a stream is interrupted.
  await main.webContents.executeJavaScript(`(() => {
    const track = window.mainWindowUI._mediaStream.getAudioTracks()[0];
    track.stop(); track.dispatchEvent(new Event('ended'));
  })()`);
  await wait(4500);
  const recovered = await state();
  assert.equal(recovered.recording, true);
  assert.deepEqual(recovered.tracks, ['live']);
  assert.ok(recovered.lastChunkAgeMs < 2000);
  speech.stopRecording();
  await wait(500);
  const stopped = await state();
  assert.equal(stopped.recording, false);
  assert.equal(stopped.tracks, null);
  console.log('CONTINUOUS_TEST', JSON.stringify({ started, background, recovered, stopped }));
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => { console.error('CONTINUOUS_TEST_FAILED', error.message); clearTimeout(timeout); app.exit(1); });
