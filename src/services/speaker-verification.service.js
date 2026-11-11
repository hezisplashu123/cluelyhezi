const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const profileStore = require('./voice-profile-store.service');

const MODEL = 'speechbrain/spkrec-ecapa-voxceleb';
const REVISION = '0f99f2d0ebe89ac095bcc5903c4dd8f72b367286';
const cosine = (a, b) => {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
};
const normalize = vector => { const n = Math.sqrt(vector.reduce((s, x) => s + x * x, 0)); return vector.map(x => x / (n || 1)); };

class SpeakerVerification extends EventEmitter {
  constructor() { super(); this.status = 'uninitialized'; this.profile = null; this.filterEnabled = false; this.requests = new Map(); this.nextId = 0; }
  async initialize(userDataPath, safeStorage, options = {}) {
    profileStore.initialize(userDataPath, safeStorage);
    try { this.profile = profileStore.load(); this.filterEnabled = !!this.profile?.filterEnabled; } catch (error) { this.status = 'unavailable'; this.lastError = error.message; return this.getStatus(); }
    this.python = options.python || process.env.SPEAKER_PYTHON || 'python';
    this.modelDir = options.modelDir || process.env.SPEAKER_MODEL_DIR || path.join(userDataPath, 'speaker-models', 'spkrec-ecapa-voxceleb-0f99f2d');
    const packagedWorker = process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'speaker_worker.py');
    this.workerScript = options.workerScript || (packagedWorker && require('fs').existsSync(packagedWorker) ? packagedWorker : path.join(__dirname, '../../scripts/speaker_worker.py'));
    this.status = 'loading'; this.emitStatus();
    try { await this._request({ command: 'health' }, 90000); this.status = 'ready'; this.lastError = null; }
    catch (error) { this.status = 'unavailable'; this.lastError = error.message; }
    this.emitStatus(); return this.getStatus();
  }
  _spawn() {
    if (this.worker) return;
    this.worker = spawn(this.python, [this.workerScript], { env: { ...process.env, SPEAKER_MODEL_DIR: this.modelDir, HF_HUB_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let pending = '';
    this.worker.stdout.on('data', chunk => { pending += chunk; let i; while ((i = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, i); pending = pending.slice(i + 1); try { const value = JSON.parse(line); const request = this.requests.get(value.id); if (request) { this.requests.delete(value.id); clearTimeout(request.timer); value.ok ? request.resolve(value) : request.reject(new Error(value.error)); } } catch (_) {} } });
    this.worker.stderr.on('data', () => {});
    this.worker.on('exit', () => { const error = new Error('Speaker inference worker stopped.'); for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); } this.requests.clear(); this.worker = null; if (this.status === 'ready') { this.status = 'unavailable'; this.lastError = error.message; this.emitStatus(); } });
  }
  _request(value, timeout = 20000) {
    if (this.requests.size >= 4) return Promise.reject(new Error('Speaker inference queue is full.'));
    this._spawn(); const id = ++this.nextId;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('Speaker inference timed out.')); }, timeout); this.requests.set(id, { resolve, reject, timer }); this.worker.stdin.write(`${JSON.stringify({ ...value, id })}\n`); });
  }
  emitStatus() { this.emit('status', this.getStatus()); }
  getStatus() { return { profile: this.profile ? 'ready' : 'not_set_up', model: this.status, filterEnabled: !!this.filterEnabled, lastTestAt: this.profile?.lastTestAt || null, createdAt: this.profile?.createdAt || null, quality: this.profile?.quality || null, error: this.lastError || null, sourceScope: 'phone_microphone_only', secureStorage: profileStore.isEncryptionAvailable() }; }
  setFilterEnabled(enabled) { if (enabled && (this.status !== 'ready' || !this.profile)) throw new Error('A ready local model and valid voice profile are required.'); this.filterEnabled = !!enabled; if (this.profile) { this.profile.filterEnabled = this.filterEnabled; profileStore.save(this.profile); } this.emitStatus(); return this.getStatus(); }
  deleteProfile() { this.filterEnabled = false; this.profile = null; profileStore.delete(); this.emit('profile', this.getStatus()); this.emitStatus(); }
  inspectPcm(pcm) {
    const samples = pcm.length / 2; let clipped = 0, sum = 0, voicedFrames = 0, frames = 0;
    for (let i = 0; i < samples; i++) { const x = pcm.readInt16LE(i * 2); sum += x * x; if (Math.abs(x) >= 32100) clipped++; }
    for (let offset = 0; offset + 640 <= pcm.length; offset += 640) { let frameSum = 0; for (let i = offset; i < offset + 640; i += 2) { const x = pcm.readInt16LE(i); frameSum += x * x; } frames++; if (Math.sqrt(frameSum / 320) >= 500) voicedFrames++; }
    return { elapsedSeconds: samples / 16000, usableSpeechSeconds: voicedFrames * 0.02, speechRatio: frames ? voicedFrames / frames : 0, rms: samples ? Math.sqrt(sum / samples) / 32768 : 0, clippingRatio: samples ? clipped / samples : 0 };
  }
  async _embed(pcm) { const result = await this._request({ command: 'embed', pcm: pcm.toString('base64') }, 60000); return { vector: result.embedding, inferenceMs: result.inferenceMs }; }
  _voicedWindows(pcm, seconds = 3) {
    const frameBytes = 640, frames = []; for (let o = 0; o + frameBytes <= pcm.length; o += frameBytes) { const frame = pcm.subarray(o, o + frameBytes); let sum = 0; for (let i = 0; i < frame.length; i += 2) { const x = frame.readInt16LE(i); sum += x * x; } if (Math.sqrt(sum / 320) >= 500) frames.push(frame); }
    const voiced = Buffer.concat(frames), size = seconds * 16000 * 2, windows = []; for (let o = 0; o + size <= voiced.length; o += size) windows.push(voiced.subarray(o, o + size)); return windows.slice(0, 8);
  }
  async enroll(pcm) {
    if (this.status !== 'ready') throw new Error(this.lastError || 'Local speaker model is unavailable.');
    const quality = this.inspectPcm(pcm);
    if (quality.usableSpeechSeconds < 20) throw new Error(`Only ${quality.usableSpeechSeconds.toFixed(1)} seconds of usable speech were detected; record at least 20 seconds.`);
    if (quality.rms < 0.018) throw new Error('The recording is too quiet. Move closer to the phone and try again.');
    if (quality.clippingRatio > 0.02) throw new Error('The recording is clipping. Move farther from the phone and try again.');
    const windows = this._voicedWindows(pcm); if (windows.length < 5) throw new Error('Not enough consistent voiced audio was available for enrollment.');
    const outputs = []; for (const window of windows) outputs.push(await this._embed(window));
    const similarities = []; for (let i = 0; i < outputs.length; i++) for (let j = i + 1; j < outputs.length; j++) similarities.push(cosine(outputs[i].vector, outputs[j].vector));
    similarities.sort((a, b) => a - b); const p10 = similarities[Math.floor(similarities.length * 0.1)] || 0;
    if (p10 < 0.25) throw new Error('The sample is not speaker-consistent enough. Record in a quieter place with one speaker.');
    const embedding = normalize(outputs[0].vector.map((_, i) => outputs.reduce((sum, output) => sum + output.vector[i], 0) / outputs.length));
    this.filterEnabled = false;
    this.profile = { schemaVersion: 1, model: MODEL, modelRevision: REVISION, createdAt: new Date().toISOString(), sampleRate: 16000, windowCount: windows.length, filterEnabled: false, embedding, thresholds: { self: Math.max(0.25, p10 - 0.08), other: Math.max(0.05, Math.max(0.25, p10 - 0.08) - 0.12) }, quality: { ...quality, consistencyP10: p10 }, benchmark: { meanInferenceMs: outputs.reduce((s, o) => s + o.inferenceMs, 0) / outputs.length } };
    profileStore.save(this.profile); this.emit('profile', this.getStatus()); this.emitStatus(); return this.getStatus();
  }
  async verify(pcm, { test = false } = {}) {
    if (!this.profile || this.status !== 'ready') return { decision: 'UNCERTAIN', reason: this.profile ? 'MODEL_UNAVAILABLE' : 'PROFILE_MISSING' };
    const quality = this.inspectPcm(pcm); if (quality.usableSpeechSeconds < 1.5) return { decision: 'UNCERTAIN', reason: 'INSUFFICIENT_SPEECH', quality };
    try { const started = Date.now(); const output = await this._embed(Buffer.concat(this._voicedWindows(pcm, Math.min(3, Math.max(1.5, quality.usableSpeechSeconds))) .slice(0, 1))); const score = cosine(output.vector, this.profile.embedding); const decision = score >= this.profile.thresholds.self ? 'SELF_MATCH' : score < this.profile.thresholds.other ? 'OTHER_SPEAKER' : 'UNCERTAIN'; const result = { decision, score, quality, inferenceMs: output.inferenceMs, totalMs: Date.now() - started }; if (test) { this.profile.lastTestAt = new Date().toISOString(); profileStore.save(this.profile); this.emitStatus(); } return result; }
    catch (error) { return { decision: 'UNCERTAIN', reason: 'MODEL_FAILURE', error: error.message, quality }; }
  }
  shutdown() { if (this.worker) this.worker.kill(); this.worker = null; }
}
module.exports = new SpeakerVerification();
module.exports.SpeakerVerification = SpeakerVerification;
module.exports.cosine = cosine;
