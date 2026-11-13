const { EventEmitter } = require('events');

const STATES = Object.freeze({
  OFF: 'OFF',
  STARTING: 'STARTING',
  LISTENING: 'LISTENING',
  STOPPING: 'STOPPING',
  ERROR: 'ERROR'
});

class ListeningController extends EventEmitter {
  constructor(speechService, options = {}) {
    super();
    this.speech = speechService;
    this.startTimeoutMs = options.startTimeoutMs || 15000;
    this.state = STATES.OFF;
    this.desiredOn = false;
    this.source = 'desktop';
    this.sessionId = null;
    this.generation = 0;
    this.providerReady = false;
    this.captureReady = false;
    this.acceptAudio = false;
    this.pcmFrames = 0;
    this.pcmBytes = 0;
    this.lastPcmAt = null;
    this.activeDevice = null;
    this.error = null;
    this._queue = Promise.resolve();
    this._startAbort = null;

    this._onSpeechError = error => {
      if (!this.desiredOn || ![STATES.STARTING, STATES.LISTENING].includes(this.state)) return;
      const message = typeof error === 'string' ? error : error?.message || 'Speech provider failed.';
      this.fail(message);
    };
    this.speech.on?.('error', this._onSpeechError);
  }

  getStatus() {
    return {
      state: this.state,
      listening: this.state === STATES.LISTENING,
      desiredOn: this.desiredOn,
      source: this.source,
      sessionId: this.sessionId,
      generation: this.generation,
      providerReady: this.providerReady,
      captureReady: this.captureReady,
      pcmFrames: this.pcmFrames,
      pcmBytes: this.pcmBytes,
      lastPcmAt: this.lastPcmAt,
      activeDevice: this.activeDevice,
      error: this.error
    };
  }

  _publish() {
    const status = this.getStatus();
    this.emit('status', status);
    return status;
  }

  _setState(state, error = null) {
    this.state = state;
    this.error = error;
    return this._publish();
  }

  _enqueue(work) {
    const next = this._queue.then(work, work);
    this._queue = next.catch(() => {});
    return next;
  }

  toggle() {
    this.desiredOn = !this.desiredOn;
    if (!this.desiredOn) this._blockAudioImmediately('Listening disabled.');
    return this._enqueue(() => this.desiredOn ? this._startInternal(this.source) : this._stopInternal(false));
  }

  start({ source = this.source } = {}) {
    this.source = source;
    this.desiredOn = true;
    return this._enqueue(() => this._startInternal(source));
  }

  stop() {
    this.desiredOn = false;
    this._blockAudioImmediately('Listening disabled.');
    return this._enqueue(() => this._stopInternal(false));
  }

  _blockAudioImmediately(reason, code = 'LISTENING_CANCELLED') {
    this.acceptAudio = false;
    if (this._startAbort) {
      this._startAbort(Object.assign(new Error(reason), { code }));
      this._startAbort = null;
    }
  }

  async _startInternal(source) {
    if (!this.desiredOn) return this.getStatus();
    if ([STATES.STARTING, STATES.LISTENING].includes(this.state)) return this.getStatus();
    if (!this.speech.isAvailable?.()) {
      const error = `Speech provider "${this.speech.provider || 'configured'}" is unavailable.`;
      this.desiredOn = false;
      this._setState(STATES.ERROR, error);
      throw new Error(error);
    }

    const generation = ++this.generation;
    const sessionId = `${Date.now()}-${generation}`;
    this.sessionId = sessionId;
    this.source = source || 'desktop';
    this.providerReady = false;
    this.captureReady = false;
    this.acceptAudio = true;
    this.pcmFrames = 0;
    this.pcmBytes = 0;
    this.lastPcmAt = null;
    this.activeDevice = null;
    this._setState(STATES.STARTING);

    try {
      await this._waitForProvider(sessionId, generation);
      if (!this.desiredOn || generation !== this.generation) throw Object.assign(new Error('Listening start cancelled.'), { code: 'LISTENING_CANCELLED' });
      this.providerReady = true;
      this.emit('capture-requested', { source: this.source, sessionId, generation });
      this._publish();
      await this._waitForFirstPcm(sessionId, generation);
      return this.getStatus();
    } catch (error) {
      this.acceptAudio = false;
      await this._discardSpeech();
      if (error.code === 'LISTENING_CANCELLED') {
        this.sessionId = null;
        this.providerReady = false;
        this.captureReady = false;
        return this._setState(STATES.OFF);
      }
      this.desiredOn = false;
      this.sessionId = null;
      this.providerReady = false;
      this.captureReady = false;
      this._setState(STATES.ERROR, error.message);
      throw error;
    } finally {
      this._startAbort = null;
    }
  }

  _waitForProvider(sessionId, generation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.speech.off?.('recording-started', ready);
        this.speech.off?.('error', failed);
        error ? reject(error) : resolve();
      };
      const ready = () => {
        if (generation === this.generation && sessionId === this.sessionId) done();
      };
      const failed = value => done(new Error(typeof value === 'string' ? value : value?.message || 'Speech provider failed to start.'));
      const timer = setTimeout(() => done(new Error('Speech provider did not become ready in time.')), this.startTimeoutMs);
      this._startAbort = error => done(error);
      this.speech.once?.('recording-started', ready);
      this.speech.once?.('error', failed);
      try {
        this.speech.startRecording({ source: this.source });
      } catch (error) {
        done(error);
      }
    });
  }

  _waitForFirstPcm(sessionId, generation) {
    if (this.captureReady && this.pcmFrames > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('first-pcm', ready);
        error ? reject(error) : resolve();
      };
      const ready = value => {
        if (value.sessionId === sessionId && value.generation === generation) done();
      };
      const timer = setTimeout(() => done(new Error('Audio capture started but no PCM frames reached the main process.')), this.startTimeoutMs);
      this._startAbort = error => done(error);
      this.on('first-pcm', ready);
    });
  }

  ingestPcm(sessionId, chunk) {
    if (!this.acceptAudio || !sessionId || sessionId !== this.sessionId) return false;
    if (![STATES.STARTING, STATES.LISTENING].includes(this.state) || !this.providerReady) return false;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    if (!buffer.length) return false;
    this.speech.handleAudioChunkFromRenderer(buffer);
    this.pcmFrames += 1;
    this.pcmBytes += buffer.length;
    this.lastPcmAt = Date.now();
    if (!this.captureReady) {
      this.captureReady = true;
      this._setState(STATES.LISTENING);
      this.emit('first-pcm', { sessionId, generation: this.generation });
    }
    return true;
  }

  reportCaptureReady(sessionId, details = {}) {
    if (sessionId !== this.sessionId || ![STATES.STARTING, STATES.LISTENING].includes(this.state)) return false;
    this.activeDevice = {
      label: String(details.label || 'Windows default microphone'),
      deviceId: details.deviceId ? String(details.deviceId) : null,
      sampleRate: Number(details.sampleRate) || null,
      channelCount: Number(details.channelCount) || null
    };
    this._publish();
    return true;
  }

  reportCaptureError(sessionId, message) {
    if (sessionId !== this.sessionId || ![STATES.STARTING, STATES.LISTENING].includes(this.state)) return false;
    this.fail(`Audio capture failed: ${String(message || 'unknown error').slice(0, 300)}`);
    return true;
  }

  async fail(message) {
    this.desiredOn = false;
    this._blockAudioImmediately(message, 'LISTENING_FAILED');
    ++this.generation;
    this._setState(STATES.ERROR, message);
    await this._discardSpeech();
    this.sessionId = null;
    this.providerReady = false;
    this.captureReady = false;
    this.activeDevice = null;
    this.emit('capture-stopped');
  }

  async _stopInternal(preserveError) {
    if (this.state === STATES.OFF && !this.speech.isRecording) return this.getStatus();
    if (this.state !== STATES.ERROR) this._setState(STATES.STOPPING);
    ++this.generation;
    this.acceptAudio = false;
    this.emit('capture-stopped');
    await this._discardSpeech();
    this.sessionId = null;
    this.providerReady = false;
    this.captureReady = false;
    this.activeDevice = null;
    return preserveError ? this.getStatus() : this._setState(STATES.OFF);
  }

  async _discardSpeech() {
    try {
      await Promise.resolve(this.speech.stopRecording?.({ discardPending: true }));
    } catch (_) {}
  }

  allowsTranscription() {
    return this.state === STATES.LISTENING && this.acceptAudio;
  }

  async shutdown() {
    this.desiredOn = false;
    this._blockAudioImmediately('Application shutting down.');
    await this._stopInternal(false);
    this.speech.off?.('error', this._onSpeechError);
  }
}

ListeningController.STATES = STATES;
module.exports = ListeningController;
