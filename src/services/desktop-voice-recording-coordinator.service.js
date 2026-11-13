class DesktopVoiceRecordingCoordinator {
  constructor(speech, enrollment, options = {}) {
    this.speech = speech;
    this.enrollment = enrollment;
    this.stopTimeoutMs = options.stopTimeoutMs || 15000;
    this.active = null;
  }

  async start(sessionId, mode) {
    if (this.active) throw new Error('Another voice recording is already active.');
    const resumeSource = this.speech.isRecording ? (this.speech.captureSource || 'desktop') : null;
    this.active = { sessionId, resumeSource };
    try {
      if (this.speech.isRecording) this.speech.stopRecording();
      const deadline = Date.now() + this.stopTimeoutMs;
      while (this.speech.isRecording || this.speech.isProcessingAudio || this.speech.liveTranscription || this.speech.recognizer) {
        if (Date.now() >= deadline) throw new Error('Live transcription is still stopping. Try again in a moment.');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return this.enrollment.start({ sessionId, mode });
    } catch (error) {
      this._resume(sessionId);
      throw error;
    }
  }

  async finish(sessionId) {
    this._requireActive(sessionId);
    try { return await this.enrollment.finish({ sessionId }); }
    finally { this._resume(sessionId); }
  }

  cancel(sessionId) {
    this._requireActive(sessionId);
    const cancelled = this.enrollment.cancel(sessionId);
    this._resume(sessionId);
    return { cancelled };
  }

  _requireActive(sessionId) {
    if (!this.active || this.active.sessionId !== sessionId) throw new Error('Voice recording session is no longer active.');
  }

  _resume(sessionId) {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) return;
    this.active = null;
    if (active.resumeSource && this.speech.isAvailable() && !this.speech.isRecording && !this.speech.isProcessingAudio) {
      this.speech.startRecording({ source: active.resumeSource });
    }
  }
}

module.exports = DesktopVoiceRecordingCoordinator;
