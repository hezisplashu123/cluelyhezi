const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const profileStore = require('./voice-profile-store.service');

const MODEL = 'speechbrain/spkrec-ecapa-voxceleb';
const REVISION = '0f99f2d0ebe89ac095bcc5903c4dd8f72b367286';
const DIMENSION = 192;
const cosine = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
};
const normalize = vector => {
  const n = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map(value => value / (n || 1));
};

class SpeakerVerification extends EventEmitter {
  constructor() {
    super();
    this.status = 'uninitialized';
    this.profile = null;
    this.filterEnabled = false;
    this.requests = new Map();
    this.nextId = 0;
    this.workerGeneration = 0;
    this.shuttingDown = false;
    this.recoveryAttempts = 0;
  }

  async initialize(userDataPath, safeStorage, options = {}) {
    this.userDataPath = userDataPath;
    this.shuttingDown = false;
    profileStore.initialize(userDataPath, safeStorage);
    try {
      this.profile = profileStore.load();
      this.filterEnabled = !!this.profile?.filterEnabled;
    } catch (error) {
      this.status = 'unavailable'; this.lastError = error.message; return this.getStatus();
    }
    const packaged = process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'speaker_worker.py');
    const venvPython = process.platform === 'win32'
      ? path.join(userDataPath, 'speaker-python', 'Scripts', 'python.exe')
      : path.join(userDataPath, 'speaker-python', 'bin', 'python');
    this.python = options.python || process.env.SPEAKER_PYTHON || venvPython;
    this.modelDir = options.modelDir || process.env.SPEAKER_MODEL_DIR || path.join(userDataPath, 'speaker-models', 'spkrec-ecapa-voxceleb-0f99f2d');
    this.workerScript = options.workerScript || (packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, '../../scripts/speaker_worker.py'));
    this.status = 'loading'; this.emitStatus();
    try {
      this._validatePaths();
      const health = await this._request({ command: 'health' }, 120000);
      if (health.embeddingDimension !== DIMENSION || !Number.isFinite(health.inferenceMs)) throw new Error('Speaker model health inference returned an invalid embedding.');
      this.health = health; this.status = 'ready'; this.lastError = null;
      this.recoveryAttempts = 0;
    } catch (error) {
      this.status = 'unavailable'; this.lastError = error.message; this._stopWorker(error);
    }
    this.emitStatus();
    return this.getStatus();
  }

  _validatePaths() {
    if (!fs.existsSync(this.python)) throw new Error(`Voice model Python environment is missing at ${this.python}. Use Install / Repair Voice Model.`);
    if (!fs.existsSync(this.workerScript)) throw new Error(`Speaker worker is missing at ${this.workerScript}. Reinstall the application.`);
    const required = ['hyperparams.yaml', 'embedding_model.ckpt', 'mean_var_norm_emb.ckpt'];
    const missing = required.filter(file => !fs.existsSync(path.join(this.modelDir, file)));
    if (missing.length) throw new Error(`Voice model is incomplete (${missing.join(', ')} missing). Use Install / Repair Voice Model.`);
  }

  _spawn() {
    if (this.worker && !this.worker.killed) return;
    if (this.shuttingDown) throw new Error('Speaker inference is shutting down.');
    const generation = ++this.workerGeneration;
    const child = spawn(this.python, ['-u', this.workerScript], {
      env: { ...process.env, SPEAKER_MODEL_DIR: this.modelDir, HF_HUB_OFFLINE: '1', PYTHONNOUSERSITE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    this.worker = child;
    let pending = '', stderr = '';
    child.stdout.on('data', chunk => {
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
        if (!line) continue;
        try {
          const value = JSON.parse(line); const request = this.requests.get(value.id);
          if (!request || request.generation !== generation) continue;
          this.requests.delete(value.id); clearTimeout(request.timer);
          value.ok ? request.resolve(value) : request.reject(new Error(value.error || 'Speaker inference failed.'));
        } catch (error) { this.lastError = `Invalid response from speaker worker: ${error.message}`; }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
    child.stdin.on('error', error => this._workerFailed(child, generation, error));
    child.on('error', error => this._workerFailed(child, generation, new Error(`Could not start speaker worker: ${error.message}`)));
    child.on('exit', (code, signal) => {
      const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ');
      this._workerFailed(child, generation, new Error(`Speaker worker stopped (${signal || `exit ${code}`})${detail ? `: ${detail}` : '.'}`));
    });
  }

  _workerFailed(child, generation, error) {
    if (this.worker !== child || generation !== this.workerGeneration) return;
    this.worker = null;
    for (const [id, request] of this.requests) {
      if (request.generation !== generation) continue;
      clearTimeout(request.timer); request.reject(error); this.requests.delete(id);
    }
    if (!this.shuttingDown) { this.status = 'unavailable'; this.lastError = error.message; this.emitStatus(); this._scheduleRecovery(); }
  }

  _scheduleRecovery() {
    if (this.shuttingDown || this.recoveryTimer || this.recoveryAttempts >= 3 || !this.python || !fs.existsSync(this.python)) return;
    const delay = 1000 * (2 ** this.recoveryAttempts++);
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      if (this.shuttingDown) return;
      this.status = 'loading'; this.emitStatus();
      try {
        this._validatePaths();
        const health = await this._request({ command: 'health' }, 120000);
        if (health.embeddingDimension !== DIMENSION) throw new Error('Speaker recovery health check returned an invalid embedding.');
        this.health = health; this.status = 'ready'; this.lastError = null; this.recoveryAttempts = 0; this.emitStatus();
      } catch (error) {
        this.status = 'unavailable'; this.lastError = error.message; this.emitStatus(); this._scheduleRecovery();
      }
    }, delay);
    this.recoveryTimer.unref?.();
  }

  _request(value, timeout = 30000) {
    if (this.requests.size >= 4) return Promise.reject(new Error('Speaker inference queue is full; audio was not forwarded.'));
    try { this._spawn(); } catch (error) { return Promise.reject(error); }
    const id = ++this.nextId, generation = this.workerGeneration;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id); const error = new Error('Speaker inference timed out; audio was not forwarded.');
        reject(error); this.status = 'unavailable'; this.lastError = error.message; this._stopWorker(error); this.emitStatus(); this._scheduleRecovery();
      }, timeout);
      this.requests.set(id, { resolve, reject, timer, generation });
      try {
        this.worker.stdin.write(`${JSON.stringify({ ...value, id })}\n`, error => {
          if (error && this.worker) this._workerFailed(this.worker, generation, error);
        });
      } catch (error) { clearTimeout(timer); this.requests.delete(id); reject(error); }
    });
  }

  _stopWorker(reason = new Error('Speaker inference stopped.')) {
    const worker = this.worker; this.worker = null; this.workerGeneration++;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(reason); }
    this.requests.clear();
    if (worker && !worker.killed) { try { worker.stdin.end(); } catch (_) {} try { worker.kill(); } catch (_) {} }
  }

  emitStatus() { this.emit('status', this.getStatus()); }
  getStatus() {
    return {
      profile: this.profile ? 'ready' : 'not_set_up', model: this.status, modelName: MODEL, modelRevision: REVISION,
      filterEnabled: !!this.filterEnabled, filteringActive: !!this.filterEnabled && this.status === 'ready' && !!this.profile,
      lastTestAt: this.profile?.lastTestAt || null, createdAt: this.profile?.createdAt || null,
      quality: this.profile?.quality || null, benchmark: this.profile?.benchmark || null, error: this.lastError || null,
      sourceScope: 'desktop_microphone_and_system_playback', secureStorage: profileStore.isEncryptionAvailable(),
      python: this.python || null, modelDir: this.modelDir || null,
      health: this.health ? { inferenceMs: this.health.inferenceMs, python: this.health.python, torch: this.health.torch, speechbrain: this.health.speechbrain } : null
    };
  }

  setFilterEnabled(enabled) {
    if (enabled && (this.status !== 'ready' || !this.profile)) throw new Error('Install the local model and record a valid voice profile before enabling filtering.');
    this.filterEnabled = !!enabled;
    if (this.profile) { this.profile.filterEnabled = this.filterEnabled; profileStore.save(this.profile); }
    this.emitStatus(); return this.getStatus();
  }
  deleteProfile() {
    this.filterEnabled = false;
    if (this.profile?.embedding) this.profile.embedding.fill(0);
    this.profile = null; profileStore.delete(); this.emit('profile', this.getStatus()); this.emitStatus();
  }

  inspectPcm(pcm) {
    if (!Buffer.isBuffer(pcm) || pcm.length < 2 || pcm.length % 2) return { elapsedSeconds: 0, usableSpeechSeconds: 0, speechRatio: 0, rms: 0, clippingRatio: 0, qualityIssues: ['INVALID_PCM'] };
    const samples = pcm.length / 2, frameBytes = 640, frameRms = [];
    let clipped = 0, sum = 0;
    for (let i = 0; i < samples; i++) { const x = pcm.readInt16LE(i * 2); sum += x * x; if (Math.abs(x) >= 32100) clipped++; }
    for (let offset = 0; offset + frameBytes <= pcm.length; offset += frameBytes) {
      let frameSum = 0; for (let i = offset; i < offset + frameBytes; i += 2) { const x = pcm.readInt16LE(i); frameSum += x * x; }
      frameRms.push(Math.sqrt(frameSum / 320));
    }
    const sorted = [...frameRms].sort((a, b) => a - b), noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
    const speechThreshold = Math.max(350, Math.min(1500, noiseFloor * 2.8)), voicedFrames = frameRms.filter(value => value >= speechThreshold).length;
    const quality = {
      elapsedSeconds: samples / 16000, usableSpeechSeconds: voicedFrames * 0.02,
      speechRatio: frameRms.length ? voicedFrames / frameRms.length : 0,
      rms: Math.sqrt(sum / samples) / 32768, clippingRatio: clipped / samples,
      noiseFloor: noiseFloor / 32768, speechThreshold: speechThreshold / 32768, qualityIssues: []
    };
    if (quality.rms < 0.012) quality.qualityIssues.push('TOO_QUIET');
    if (quality.clippingRatio > 0.015) quality.qualityIssues.push('CLIPPING');
    if (quality.speechRatio < 0.2) quality.qualityIssues.push('TOO_LITTLE_SPEECH');
    if (quality.noiseFloor > 0.045 && quality.speechRatio < 0.7) quality.qualityIssues.push('HIGH_BACKGROUND_NOISE');
    return quality;
  }

  _speechWindows(pcm, seconds = 3, limit = 10) {
    const frameBytes = 640, frames = [], rmsValues = [];
    for (let offset = 0; offset + frameBytes <= pcm.length; offset += frameBytes) {
      let sum = 0; for (let i = offset; i < offset + frameBytes; i += 2) { const value = pcm.readInt16LE(i); sum += value * value; }
      const rms = Math.sqrt(sum / 320); frames.push(rms); rmsValues.push(rms);
    }
    const sorted = [...rmsValues].sort((a, b) => a - b), threshold = Math.max(350, Math.min(1500, (sorted[Math.floor(sorted.length * 0.2)] || 0) * 2.8));
    const segments = []; let start = null, lastVoiced = null;
    for (let index = 0; index < frames.length; index++) {
      if (frames[index] >= threshold) { if (start === null) start = Math.max(0, index - 10); lastVoiced = index; }
      else if (start !== null && lastVoiced !== null && index - lastVoiced >= 20) {
        segments.push([start * frameBytes, Math.min(pcm.length, (lastVoiced + 11) * frameBytes)]); start = null; lastVoiced = null;
      }
    }
    if (start !== null && lastVoiced !== null) segments.push([start * frameBytes, Math.min(pcm.length, (lastVoiced + 11) * frameBytes)]);
    const windowBytes = Math.round(seconds * 16000 * 2), windows = [];
    for (const [segmentStart, segmentEnd] of segments) {
      for (let offset = segmentStart; offset + windowBytes <= segmentEnd; offset += windowBytes) {
        windows.push(pcm.subarray(offset, offset + windowBytes)); if (windows.length >= limit) return windows;
      }
    }
    return windows;
  }

  async _embed(pcm) {
    const result = await this._request({ command: 'embed', pcm: pcm.toString('base64') }, 60000);
    if (!Array.isArray(result.embedding) || result.embedding.length !== DIMENSION || result.embedding.some(value => !Number.isFinite(value))) throw new Error('Speaker worker returned an invalid embedding. Repair the voice model.');
    return { vector: normalize(result.embedding), inferenceMs: result.inferenceMs };
  }

  async enroll(pcm) {
    if (this.status !== 'ready') throw new Error(this.lastError || 'Local speaker model is unavailable.');
    const quality = this.inspectPcm(pcm);
    if (quality.usableSpeechSeconds < 20) throw new Error(`Only ${quality.usableSpeechSeconds.toFixed(1)} seconds of usable speech were detected; record at least 20 seconds.`);
    if (quality.rms < 0.012) throw new Error('The recording is too quiet. Move closer to the computer microphone and try again.');
    if (quality.clippingRatio > 0.015) throw new Error('The recording is clipping. Reduce microphone gain or move farther away.');
    if (quality.noiseFloor > 0.06 && quality.speechRatio < 0.7) throw new Error('Background noise is too high for a reliable profile. Record in a quieter place.');
    const windows = this._speechWindows(pcm, 3, 10);
    if (windows.length < 7) throw new Error('Record several natural phrases with pauses so at least seven clean voice samples are available.');
    const outputs = []; for (const window of windows) outputs.push(await this._embed(window));
    const training = outputs.slice(0, Math.max(5, outputs.length - 2)), heldOut = outputs.slice(training.length);
    const centroid = normalize(training[0].vector.map((_, index) => training.reduce((sum, output) => sum + output.vector[index], 0) / training.length));
    const scores = outputs.map(output => cosine(output.vector, centroid)), heldOutScores = heldOut.map(output => cosine(output.vector, centroid));
    const minimum = Math.min(...scores);
    if (minimum < 0.45) throw new Error('The samples are not speaker-consistent enough. Use one microphone, one speaker, and a quieter room.');
    const selfThreshold = Math.max(0.55, Math.min(0.82, Math.min(...heldOutScores) - 0.06));
    this.filterEnabled = false;
    this.profile = {
      schemaVersion: 2, model: MODEL, modelRevision: REVISION, createdAt: new Date().toISOString(), sampleRate: 16000,
      windowCount: outputs.length, filterEnabled: false, embedding: centroid,
      thresholds: { self: selfThreshold, other: Math.max(0.35, selfThreshold - 0.14) },
      quality: { ...quality, consistencyMin: minimum, heldOutScores },
      benchmark: { meanInferenceMs: outputs.reduce((sum, output) => sum + output.inferenceMs, 0) / outputs.length }
    };
    profileStore.save(this.profile); this.emit('profile', this.getStatus()); this.emitStatus(); return this.getStatus();
  }

  async verify(pcm, { test = false } = {}) {
    if (!this.profile) return { decision: 'MODEL_FAILURE', reason: 'PROFILE_MISSING' };
    if (this.status !== 'ready') return { decision: 'MODEL_FAILURE', reason: 'MODEL_UNAVAILABLE', error: this.lastError };
    const quality = this.inspectPcm(pcm);
    if (quality.usableSpeechSeconds < 1.2) return { decision: 'INSUFFICIENT_AUDIO', reason: 'INSUFFICIENT_SPEECH', quality };
    const windows = this._speechWindows(pcm, quality.usableSpeechSeconds >= 3 ? 1.5 : 1.2, 4);
    if (!windows.length) return { decision: 'INSUFFICIENT_AUDIO', reason: 'NO_COMPLETE_SPEECH_WINDOW', quality };
    try {
      const started = Date.now(), outputs = [];
      for (const window of windows) outputs.push(await this._embed(window));
      const scores = outputs.map(output => cosine(output.vector, this.profile.embedding));
      const decisions = scores.map(score => score >= this.profile.thresholds.self ? 'SELF_MATCH' : score <= this.profile.thresholds.other ? 'OTHER_SPEAKER' : 'UNCERTAIN');
      let decision = decisions.every(value => value === 'SELF_MATCH') ? 'SELF_MATCH' : decisions.every(value => value === 'OTHER_SPEAKER') ? 'OTHER_SPEAKER' : 'UNCERTAIN';
      if (Math.max(...scores) - Math.min(...scores) > 0.18) decision = 'UNCERTAIN';
      const result = { decision, score: scores.reduce((sum, score) => sum + score, 0) / scores.length, scores, quality,
        inferenceMs: outputs.reduce((sum, output) => sum + output.inferenceMs, 0), totalMs: Date.now() - started };
      if (test) { this.profile.lastTestAt = new Date().toISOString(); profileStore.save(this.profile); this.emitStatus(); }
      return result;
    } catch (error) {
      this.status = 'unavailable'; this.lastError = error.message; this.emitStatus();
      return { decision: 'MODEL_FAILURE', reason: 'MODEL_FAILURE', error: error.message, quality };
    }
  }

  shutdown() { this.shuttingDown = true; clearTimeout(this.recoveryTimer); this.recoveryTimer = null; this._stopWorker(new Error('Application is shutting down.')); }
}

module.exports = new SpeakerVerification();
module.exports.SpeakerVerification = SpeakerVerification;
module.exports.cosine = cosine;
