// Windows integration check: native playback -> real renderer PCM callback.
// Run: electron scripts/test-system-audio.cjs (ELECTRON_RUN_AS_NODE unset).
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const { configureSystemAudioCapture, allowAudioCapturePermission } = require('../src/core/system-audio');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-audio-check-'));
const testPage = path.join(testDir, 'check.html');
fs.writeFileSync(testPage, '<html><body>System audio integration check</body></html>');
app.on('quit', () => { fs.unlinkSync(testPage); fs.rmdirSync(testDir); });

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const timeout = setTimeout(() => { console.error('System audio test timed out'); app.exit(1); }, 25000);
app.whenReady().then(async () => {
  assert.equal(process.platform, 'win32', 'This integration check requires Windows');
  const testSession = session.fromPartition('system-audio-test');
  testSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowAudioCapturePermission(appPage, permission));
  });
  let handler;
  configureSystemAudioCapture({ setDisplayMediaRequestHandler(fn) { handler = fn; } });
  const appPage = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  const frame = { url: appPage, isDestroyed: () => false };
  frame.top = frame;
  const denied = await new Promise(resolve => handler({ frame: { url: 'https://example.com' }, audioRequested: true }, resolve));
  assert.equal(denied, null, 'Untrusted pages must not capture system audio');
  // The harness uses a blank page; exercise the production handler with the
  // trusted app-frame identity, then use its real OS capture streams.
  testSession.setDisplayMediaRequestHandler((request, callback) => handler({ ...request, frame }, streams => {
    // Use the real blank harness frame for Electron's native video binding.
    callback(streams ? { ...streams, video: request.frame } : null);
  }));
  const win = new BrowserWindow({ show: false, webPreferences: { session: testSession, backgroundThrottling: false } });
  await win.loadFile(testPage);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/ui/main-window.js'), 'utf8').split('let mainWindowUI;')[0];
  const result = await win.webContents.executeJavaScript(`(async () => {
    ${source}
    let chunks = 0, peak = 0, micRequests = 0, errors = [];
    navigator.mediaDevices.getUserMedia = () => { micRequests++; throw new Error('Microphone must never open'); };
    window.electronAPI = {
      sendAudioChunk(buffer) {
        chunks++;
        for (const value of new Int16Array(buffer)) peak = Math.max(peak, Math.abs(value));
      },
      stopSpeechRecognition: async () => {},
      reportAudioCaptureError: message => errors.push(message)
    };
    const ui = Object.create(MainWindowUI.prototype);
    Object.assign(ui, { isRecording: true, _captureGeneration: 0 });
    const playback = new AudioContext();
    await playback.resume();
    const oscillator = playback.createOscillator();
    const gain = playback.createGain();
    gain.gain.value = 0.015;
    oscillator.connect(gain); gain.connect(playback.destination); oscillator.start();
    await new Promise(resolve => setTimeout(resolve, 300));
    await ui._startRendererAudioCapture();
    const audio = ui._mediaStream;
    const rate = ui._audioContext && ui._audioContext.sampleRate;
    await new Promise(resolve => setTimeout(resolve, 2200));
    oscillator.stop(); await playback.close();
    const videoStopped = audio && audio.getVideoTracks().every(track => track.readyState === 'ended');
    ui.isRecording = false; ui._stopRendererAudioCapture();
    const stopped = audio && audio.getTracks().every(track => track.readyState === 'ended');
    return { chunks, peak, micRequests, errors, rate, videoStopped, stopped };
  })()`, false);
  console.log(JSON.stringify(result));
  assert.deepEqual(result.errors, []);
  assert.equal(result.micRequests, 0);
  assert.equal(result.rate, 16000);
  assert.ok(result.chunks > 0, 'Expected PCM chunks from system loopback');
  assert.ok(result.peak > 10, 'Expected audible playback in captured PCM');
  assert.ok(result.videoStopped, 'Video track must be stopped immediately');
  assert.ok(result.stopped, 'All capture tracks must stop');
  clearTimeout(timeout);
  console.log('PASS: playback captured, microphone excluded, 16 kHz PCM, clean stop.');
  win.destroy(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
