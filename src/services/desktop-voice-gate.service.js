const { EventEmitter } = require('events');

const MAX_BUFFER_BYTES = 12 * 16000 * 2;

class DesktopVoiceGate extends EventEmitter {
  constructor(verifier, forward) {
    super();
    this.verifier = verifier;
    this.forward = forward;
    this.generation = 0;
    this.diagnostics = { receivedBytes: 0, forwardedBytes: 0, discardedBytes: 0, decisions: 0, lastDecision: null };
    this.reset();
  }

  shouldGate(source) {
    return source !== 'mobile' && !!this.verifier.filterEnabled;
  }

  startSession(source = 'desktop') {
    this.stopSession();
    this.source = source;
    this.active = true;
    this.generation++;
    this.reset(false);
    this.emit('status', { status: this.shouldGate(source) ? 'listening' : 'disabled', source });
  }

  filterChanged(enabled) {
    this.generation++;
    this._discardBuffered();
    for (const chunk of this.preRoll || []) chunk.fill(0);
    this.preRoll = [];
    this.preRollBytes = 0;
    this.reset(true);
    this.emit('status', { status: enabled ? 'listening' : 'disabled', source: this.source });
  }

  stopSession() {
    this.active = false;
    this.generation++;
    this._discardBuffered();
    for (const chunk of this.preRoll || []) chunk.fill(0);
    this.preRoll = [];
    this.preRollBytes = 0;
    this.reset(true);
  }

  reset(clearPreRoll = true) {
    this.state = 'SILENCE';
    this.buffer = [];
    this.bufferedBytes = 0;
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.acceptedVoicedMs = 0;
    this.verifying = false;
    if (clearPreRoll) {
      this.preRoll = [];
      this.preRollBytes = 0;
    } else {
      this.preRoll = this.preRoll || [];
      this.preRollBytes = this.preRollBytes || 0;
    }
  }

  handlePcm(value, { source = this.source || 'desktop' } = {}) {
    const pcm = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
    if (!this.active || !pcm.length || pcm.length % 2) return;
    this.diagnostics.receivedBytes += pcm.length;
    if (!this.shouldGate(source)) {
      this._forward(pcm);
      return;
    }
    if (this.verifier.status !== 'ready' || !this.verifier.profile) {
      this.diagnostics.discardedBytes += pcm.length;
      this.emit('status', { status: 'unavailable', source, message: 'Voice recognition unavailable — audio filtering paused.' });
      return;
    }

    const durationMs = pcm.length / 32;
    const rms = this._rms(pcm);
    const voiced = rms >= 500;
    let beganUtterance = false;
    if (this.state === 'SILENCE') {
      this._pushPreRoll(pcm);
      if (!voiced) return;
      this.state = 'COLLECTING';
      this.buffer = this.preRoll.splice(0);
      this.bufferedBytes = this.preRollBytes;
      this.preRollBytes = 0;
      beganUtterance = true;
      this.emit('status', { status: 'checking_speaker', source });
    }

    if (this.state === 'DROPPING') {
      this.diagnostics.discardedBytes += pcm.length;
      this.silenceMs = voiced ? 0 : this.silenceMs + durationMs;
      if (this.silenceMs >= 700) this.reset();
      return;
    }

    if (this.state === 'ACCEPTED') {
      this.silenceMs = voiced ? 0 : this.silenceMs + durationMs;
      if (voiced) this.acceptedVoicedMs += durationMs;
      if (this.acceptedVoicedMs >= 2500) {
        this.state = 'RECHECKING';
        this.buffer = [Buffer.from(pcm)];
        this.bufferedBytes = pcm.length;
        this.voicedMs = voiced ? durationMs : 0;
        this.acceptedVoicedMs = 0;
      } else {
        this._forward(pcm);
      }
      if (this.silenceMs >= 750) this.reset();
      return;
    }

    if (!beganUtterance) this._pushBuffer(pcm);
    if (voiced) {
      this.voicedMs += durationMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += durationMs;
    }
    if (this.silenceMs >= 800 && this.voicedMs < 1200) {
      this._discardBuffered();
      this.reset();
      return;
    }
    if (this.voicedMs >= 1800 && !this.verifying) this._verifyBuffered(source);
  }

  _verifyBuffered(source) {
    const generation = this.generation;
    const snapshot = Buffer.concat(this.buffer, this.bufferedBytes);
    this.verifying = true;
    const previousState = this.state;
    this.state = 'VERIFYING';
    this.verifier.verify(snapshot).then(result => {
      snapshot.fill(0);
      if (!this.active || generation !== this.generation) return;
      this.verifying = false;
      this.diagnostics.decisions++;
      this.diagnostics.lastDecision = { ...result, at: new Date().toISOString(), source };
      this.emit('decision', this.diagnostics.lastDecision);
      if (result.decision === 'OTHER_SPEAKER') {
        const approved = Buffer.concat(this.buffer, this.bufferedBytes);
        this.buffer = [];
        this.bufferedBytes = 0;
        this.state = 'ACCEPTED';
        this.voicedMs = 0;
        this.silenceMs = 0;
        this._forward(approved);
        this.emit('status', { status: 'speech_accepted', source, decision: result.decision });
      } else {
        this._discardBuffered();
        this.state = 'DROPPING';
        this.silenceMs = 0;
        this.emit('status', { status: result.decision === 'SELF_MATCH' ? 'self_ignored' : 'uncertain_skipped', source, decision: result.decision, reason: result.reason });
      }
    }).catch(error => {
      snapshot.fill(0);
      if (!this.active || generation !== this.generation) return;
      this.verifying = false;
      this._discardBuffered();
      this.state = 'DROPPING';
      this.diagnostics.lastDecision = { decision: 'MODEL_FAILURE', reason: error.message, source, at: new Date().toISOString() };
      this.emit('decision', this.diagnostics.lastDecision);
      this.emit('status', { status: 'unavailable', source, message: 'Voice recognition unavailable — audio filtering paused.' });
    });
  }

  _pushBuffer(pcm) {
    const copy = Buffer.from(pcm);
    this.buffer.push(copy);
    this.bufferedBytes += copy.length;
    while (this.bufferedBytes > MAX_BUFFER_BYTES && this.buffer.length) {
      const removed = this.buffer.shift();
      this.bufferedBytes -= removed.length;
      this.diagnostics.discardedBytes += removed.length;
      removed.fill(0);
    }
  }

  _pushPreRoll(pcm) {
    const copy = Buffer.from(pcm);
    this.preRoll.push(copy);
    this.preRollBytes += copy.length;
    const max = 400 * 32;
    while (this.preRollBytes > max && this.preRoll.length) {
      const removed = this.preRoll.shift();
      this.preRollBytes -= removed.length;
      removed.fill(0);
    }
  }

  _discardBuffered() {
    for (const chunk of this.buffer || []) {
      this.diagnostics.discardedBytes += chunk.length;
      chunk.fill(0);
    }
    this.buffer = [];
    this.bufferedBytes = 0;
  }

  _forward(pcm) {
    this.diagnostics.forwardedBytes += pcm.length;
    this.forward(pcm);
  }

  _rms(pcm) {
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const value = pcm.readInt16LE(i);
      sum += value * value;
    }
    return Math.sqrt(sum / Math.max(1, pcm.length / 2));
  }

  getDiagnostics() {
    return { ...this.diagnostics, state: this.state, bufferedBytes: this.bufferedBytes, active: this.active, source: this.source };
  }
}

module.exports = DesktopVoiceGate;
