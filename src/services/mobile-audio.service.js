const MAX_CHUNK = 32 * 1024;
const MAX_DURATION = 30 * 60 * 1000;
const logger = require('../core/logger').createServiceLogger('MOBILE-AUDIO');

// Stateful linear interpolation keeps the resampling clock continuous between chunks.
class Resampler {
  constructor(rate) { this.step = rate / 16000; this.position = 0; this.tail = []; }
  convert(input) {
    const samples = this.tail.concat(Array.from({ length: input.length / 2 }, (_, i) => input.readInt16LE(i * 2)));
    const out = [];
    while (this.position + 1 < samples.length) {
      const i = Math.floor(this.position), f = this.position - i;
      out.push(Math.round(samples[i] * (1 - f) + samples[i + 1] * f));
      this.position += this.step;
    }
    const consumed = Math.min(Math.floor(this.position), samples.length - 1);
    this.tail = samples.slice(consumed); this.position -= consumed;
    const buffer = Buffer.alloc(out.length * 2);
    out.forEach((sample, i) => buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2));
    return buffer;
  }
}

class MobileAudio {
  constructor(speech, onError = () => {}, verifier = null, publish = () => {}) {
    this.speech = speech; this.active = null; this.enrollment = null; this.closedRecordings = new Map(); this.onError = onError; this.verifier = verifier; this.publish = publish;
    this.speechError = error => { if (this.active) { const id = this.active.deviceId; this.stop(id); this.onError(id, String(error?.message || error)); } };
    this.speechStopped = () => { if (this.active) { const id = this.active.deviceId; this.active = null; this.onError(id, 'Speech capture stopped.'); } };
    speech.on('error', this.speechError); speech.on('recording-stopped', this.speechStopped);
  }
  dispose() { if (this.active) this.stop(this.active.deviceId); this.speech.off?.('error', this.speechError); this.speech.off?.('recording-stopped', this.speechStopped); }
  async start(deviceId, data) {
    if (this.active) throw new Error('A phone microphone session is already active.');
    if (!data || typeof data.sessionId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(data.sessionId) || data.encoding !== 'pcm_s16le' || data.channels !== 1 || !Number.isInteger(data.sampleRate) || data.sampleRate < 8000 || data.sampleRate > 96000) throw new Error('Invalid audio format.');
    if (!this.speech.isAvailable() || this.speech.isRecording || this.speech.isProcessingAudio || this.speech.liveTranscription || this.speech.recognizer) throw new Error('Speech is unavailable or the desktop audio source is active or still stopping. Stop it first.');
    const gated = !!this.verifier?.filterEnabled;
    const session = this.active = { deviceId, sessionId: data.sessionId, sequence: 0, bytes: 0, rate: data.sampleRate, started: Date.now(), resampler: new Resampler(data.sampleRate), gated, state: gated ? 'SILENCE' : 'OTHER_ACCEPTED', buffer: [], bufferedBytes: 0, voicedMs: 0, silenceMs: 0, verifying: false };
    if (gated) { this.publish('voice.filter.status', { status: 'listening', source: 'phone_microphone' }); return; }
    await this._startSpeech(session);
  }
  async _startSpeech(session) {
    try {
      await new Promise((resolve, reject) => {
        const done = error => { clearTimeout(timer); this.speech.off('recording-started', ready); this.speech.off('error', failed); error ? reject(error) : resolve(); };
        const ready = () => done(); const failed = error => done(new Error(String(error)));
        const timer = setTimeout(() => done(new Error('Speech provider did not start.')), 15000);
        this.speech.once('recording-started', ready); this.speech.once('error', failed);
        this.speech.startRecording({ source: 'mobile' });
      });
      if (this.active !== session) throw new Error('Audio session ended.');
    } catch (error) { if (this.active === session) this.stop(session.deviceId); throw error; }
  }
  chunk(deviceId, data) {
    const s = this.active;
    if (!s || s.deviceId !== deviceId || data.sessionId !== s.sessionId) throw new Error('No matching phone microphone session.');
    if (Date.now() - s.started > MAX_DURATION) { this.stop(deviceId); throw new Error('Maximum listening duration reached.'); }
    if (!Number.isSafeInteger(data.sequence) || data.sequence !== s.sequence + 1) throw new Error('Invalid audio sequence.');
    if (typeof data.pcm !== 'string' || data.pcm.length > Math.ceil(MAX_CHUNK / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.pcm)) throw new Error('Invalid audio chunk.');
    const bytes = Buffer.from(data.pcm, 'base64');
    if (!bytes.length || bytes.length > MAX_CHUNK || bytes.length % 2) throw new Error('Invalid audio chunk size.');
    if (s.bytes + bytes.length > s.rate * 2 * ((Date.now() - s.started) / 1000 + 10) || data.sequence > 200 * ((Date.now() - s.started) / 1000 + 1)) throw new Error('Audio rate limit exceeded.');
    s.bytes += bytes.length;
    s.sequence = data.sequence;
    if (s.sequence === 1) logger.info('First phone audio received', { at: new Date().toISOString() });
    const pcm = s.resampler.convert(bytes);
    if (!pcm.length) return;
    if (!s.gated) { this.speech.ingestMobilePcm(pcm); return; }
    this._gatePcm(s, pcm);
  }
  _rms(pcm) { let sum = 0; for (let i = 0; i < pcm.length; i += 2) { const x = pcm.readInt16LE(i); sum += x * x; } return Math.sqrt(sum / Math.max(1, pcm.length / 2)); }
  _gatePcm(s, pcm) {
    if (this.active !== s) return;
    const duration = pcm.length / 32;
    const voiced = this._rms(pcm) >= 500;
    if (s.state === 'OTHER_ACCEPTED') { this.speech.ingestMobilePcm(pcm); if (voiced) s.silenceMs = 0; else s.silenceMs += duration; if (s.silenceMs >= 900) { this.speech.stopRecording(); s.state = 'TURN_ENDED'; this.publish('voice.filter.status', { status: 'listening', source: 'phone_microphone' }); } return; }
    if (s.state === 'SELF_IGNORED' || s.state === 'UNCERTAIN' || s.state === 'TURN_ENDED') { if (voiced) s.silenceMs = 0; else s.silenceMs += duration; if (s.silenceMs >= 700) { s.state = 'SILENCE'; s.buffer = []; s.bufferedBytes = 0; s.voicedMs = 0; s.silenceMs = 0; } return; }
    if (voiced && s.state === 'SILENCE') { s.state = 'COLLECTING_SPEECH'; this.publish('voice.filter.status', { status: 'checking_speaker', source: 'phone_microphone' }); }
    if (s.state !== 'COLLECTING_SPEECH' && s.state !== 'VERIFYING') return;
    s.buffer.push(pcm); s.bufferedBytes += pcm.length; if (voiced) { s.voicedMs += duration; s.silenceMs = 0; } else s.silenceMs += duration;
    if (s.bufferedBytes > 16 * 2 * 1000 * 8) { s.buffer.shift(); s.bufferedBytes = s.buffer.reduce((n, b) => n + b.length, 0); }
    if (s.voicedMs >= 1800 && !s.verifying) {
      s.verifying = true; s.state = 'VERIFYING'; const opening = Buffer.concat(s.buffer);
      this.verifier.verify(opening).then(async result => {
        if (this.active !== s) return;
        this.publish('voice.filter.decision', { decision: result.decision, reason: result.reason, inferenceMs: result.inferenceMs, source: 'phone_microphone' });
        if (result.decision === 'OTHER_SPEAKER') { try { await this._startSpeech(s); if (this.active !== s) return; s.state = 'OTHER_ACCEPTED'; this.speech.ingestMobilePcm(opening); this.publish('voice.filter.status', { status: 'speech_accepted', source: 'phone_microphone' }); } catch (error) { s.state = 'UNCERTAIN'; this.onError(s.deviceId, error.message); } }
        else { s.state = result.decision === 'SELF_MATCH' ? 'SELF_IGNORED' : 'UNCERTAIN'; this.publish('voice.filter.status', { status: result.decision === 'SELF_MATCH' ? 'self_ignored' : 'uncertain_skipped', source: 'phone_microphone' }); }
        s.buffer = []; s.bufferedBytes = 0; s.verifying = false;
      }).catch(error => { if (this.active === s) { s.state = 'UNCERTAIN'; s.verifying = false; this.publish('voice.filter.decision', { decision: 'UNCERTAIN', reason: 'MODEL_FAILURE', source: 'phone_microphone' }); this.onError(s.deviceId, error.message); } });
    }
  }

  enrollmentStart(deviceId, data, mode = 'enroll') {
    if (this.active) {
      if (this.active.deviceId !== deviceId) throw new Error('Another phone audio session is already active.');
      this.stop(deviceId);
    }
    if (this.enrollment) {
      if (this.enrollment.deviceId !== deviceId) throw new Error('Another phone voice recording is already active.');
      for (const chunk of this.enrollment.chunks) chunk.fill(0);
      this.enrollment.resampler.tail.fill(0);
      this.enrollment = null;
    }
    if (!data || typeof data.sessionId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(data.sessionId) || data.encoding !== 'pcm_s16le' || data.channels !== 1 || !Number.isInteger(data.sampleRate) || data.sampleRate < 8000 || data.sampleRate > 96000) throw new Error('Invalid audio format.');
    if (!this.verifier) throw new Error('Voice recognition is unavailable.');
    this.closedRecordings.delete(data.sessionId);
    this.enrollment = { deviceId, sessionId: data.sessionId, sequence: 0, started: Date.now(), mode, rate: data.sampleRate, resampler: new Resampler(data.sampleRate), chunks: [], bytes: 0 };
    this.publish('voice.enrollment.started', { mode });
  }
  enrollmentChunk(deviceId, data) {
    let s = this.enrollment;
    if (!s && this.closedRecordings.get(data.sessionId) > Date.now()) return { ignored: true, reason: 'recording_already_closed' };
    if (!s && data.encoding === 'pcm_s16le' && data.channels === 1 && Number.isInteger(data.sampleRate)) { this.enrollmentStart(deviceId, data, data.mode === 'test' ? 'test' : 'enroll'); s = this.enrollment; }
    if (!s || s.deviceId !== deviceId || s.sessionId !== data.sessionId) throw new Error('No matching voice recording session.');
    if (!Number.isSafeInteger(data.sequence) || data.sequence !== s.sequence + 1) throw new Error('Invalid audio sequence.');
    if (typeof data.pcm !== 'string' || data.pcm.length > Math.ceil(MAX_CHUNK / 3) * 4) throw new Error('Invalid audio chunk.');
    const raw = Buffer.from(data.pcm, 'base64'); if (!raw.length || raw.length > MAX_CHUNK || raw.length % 2) throw new Error('Invalid audio chunk size.');
    const pcm = s.resampler.convert(raw); s.sequence = data.sequence; s.bytes += pcm.length;
    const max = s.mode === 'test' ? 12 * 16000 * 2 : 45 * 16000 * 2; if (s.bytes > max) throw new Error('Voice recording duration limit exceeded.');
    s.chunks.push(pcm); const quality = this.verifier.inspectPcm(Buffer.concat(s.chunks)); this.publish('voice.enrollment.progress', { mode: s.mode, ...quality }); return quality;
  }
  async enrollmentFinish(deviceId, sessionId) {
    const s = this.enrollment; if (!s || s.deviceId !== deviceId || s.sessionId !== sessionId) throw new Error('No matching voice recording session.');
    this.enrollment = null; this.closedRecordings.set(sessionId, Date.now() + 10000); const pcm = Buffer.concat(s.chunks); for (const chunk of s.chunks) chunk.fill(0); s.chunks.length = 0;
    try { const result = s.mode === 'test' ? await this.verifier.verify(pcm, { test: true }) : await this.verifier.enroll(pcm); this.publish('voice.enrollment.completed', { mode: s.mode, result: s.mode === 'test' ? result : undefined }); return result; }
    catch (error) { this.publish('voice.enrollment.failed', { mode: s.mode, message: error.message }); throw error; }
    finally { pcm.fill(0); s.resampler.tail.fill(0); }
  }
  enrollmentCancel(deviceId) { if (this.enrollment?.deviceId === deviceId) { const mode = this.enrollment.mode; this.closedRecordings.set(this.enrollment.sessionId, Date.now() + 10000); for (const chunk of this.enrollment.chunks) chunk.fill(0); this.enrollment.resampler.tail.fill(0); this.enrollment.chunks.length = 0; this.enrollment = null; this.publish('voice.enrollment.failed', { mode, message: 'Recording cancelled.' }); } }
  stop(deviceId, sessionId) {
    if (!this.active || this.active.deviceId !== deviceId || (sessionId && sessionId !== this.active.sessionId)) return;
    this.active = null;
    if (this.speech.captureSource === 'mobile' && this.speech.isRecording) this.speech.stopRecording();
  }
}
module.exports = { MobileAudio, Resampler, MAX_CHUNK };
