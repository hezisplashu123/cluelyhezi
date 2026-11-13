const { EventEmitter } = require('events');

const SESSION_ID = /^[a-zA-Z0-9-]{8,100}$/;
const MAX_ENROLLMENT_BYTES = 45 * 16000 * 2;
const MAX_TEST_BYTES = 15 * 16000 * 2;

class DesktopVoiceEnrollment extends EventEmitter {
  constructor(verifier) {
    super();
    this.verifier = verifier;
    this.session = null;
    this.generation = 0;
  }

  start({ sessionId, mode }) {
    if (!SESSION_ID.test(String(sessionId || ''))) throw new Error('Invalid voice recording session.');
    if (!['enrollment', 'test'].includes(mode)) throw new Error('Invalid voice recording mode.');
    this.cancel();
    this.session = { sessionId, mode, chunks: [], bytes: 0, generation: ++this.generation, startedAt: Date.now() };
    return { sessionId, mode, startedAt: this.session.startedAt };
  }

  append({ sessionId, buffer }) {
    const session = this._get(sessionId);
    const pcm = Buffer.isBuffer(buffer) ? Buffer.from(buffer) : Buffer.from(buffer || []);
    if (!pcm.length || pcm.length % 2 || pcm.length > 256 * 1024) throw new Error('Invalid PCM chunk.');
    const limit = session.mode === 'test' ? MAX_TEST_BYTES : MAX_ENROLLMENT_BYTES;
    if (session.bytes + pcm.length > limit) throw new Error('Voice recording duration limit exceeded.');
    session.chunks.push(pcm);
    session.bytes += pcm.length;
    const quality = this.verifier.inspectPcm(Buffer.concat(session.chunks, session.bytes));
    return { sessionId, mode: session.mode, ...quality };
  }

  async finish({ sessionId }) {
    const session = this._get(sessionId);
    this.session = null;
    const generation = session.generation;
    const pcm = Buffer.concat(session.chunks, session.bytes);
    session.chunks.forEach(chunk => chunk.fill(0));
    session.chunks.length = 0;
    try {
      const result = session.mode === 'test'
        ? await this.verifier.verify(pcm, { test: true })
        : await this.verifier.enroll(pcm);
      if (generation !== this.generation) throw new Error('Voice recording session was superseded.');
      return { sessionId, mode: session.mode, result, status: this.verifier.getStatus() };
    } finally {
      pcm.fill(0);
    }
  }

  cancel(sessionId) {
    if (!this.session || (sessionId && this.session.sessionId !== sessionId)) return false;
    this.session.chunks.forEach(chunk => chunk.fill(0));
    this.session.chunks.length = 0;
    this.session = null;
    this.generation++;
    return true;
  }

  _get(sessionId) {
    if (!this.session || this.session.sessionId !== sessionId) throw new Error('Voice recording session is no longer active.');
    return this.session;
  }
}

module.exports = DesktopVoiceEnrollment;
