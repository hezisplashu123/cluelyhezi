const { EventEmitter } = require('events');
const WebSocket = require('ws');

// The capture pipeline supplies 16 kHz mono PCM16. Realtime uses 24 kHz.
function resamplePCM(buffer) {
  const count = Math.floor(buffer.length / 2);
  const output = Buffer.alloc(Math.floor(count * 1.5) * 2);
  for (let i = 0; i < output.length / 2; i++) {
    const position = i / 1.5;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = buffer.readInt16LE(left * 2);
    const b = buffer.readInt16LE(Math.min(left + 1, count - 1) * 2);
    output.writeInt16LE(Math.round(a + (b - a) * fraction), i * 2);
  }
  return output;
}

class LiveTranscription extends EventEmitter {
  constructor({ apiKey, Socket = WebSocket, now = Date.now } = {}) {
    super();
    this.apiKey = apiKey;
    this.Socket = Socket;
    this.now = now;
    this.silenceMs = 1500;
    this.items = new Map();
    this.order = [];
    this.preRoll = [];
    this.preRollBytes = 0;
    this.speaking = false;
    this.voicedMs = 0;
    this.pendingAudio = [];
    this.audioStarted = false;
    this.pendingCommits = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (!settled) { settled = true; clearTimeout(this.connectTimeout); reject(error); }
        else if (!this.closed) this.emit('error', error);
      };
      this.socket = new this.Socket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { Authorization: `Bearer ${this.apiKey}` }, handshakeTimeout: 10000
      });
      this.connectTimeout = setTimeout(() => { fail(new Error('Live transcription connection timed out')); this.close(); }, 12000);
      this.socket.on('open', () => this.send({ type: 'session.update', session: {
        type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-live-transcribe', languages: ['en'], delay: 'low' },
          turn_detection: null
        } }
      } }));
      this.socket.on('message', data => {
        try {
          const event = JSON.parse(data.toString());
          if (event.type === 'error') { fail(new Error(event.error?.message || 'Live transcription failed')); return; }
          if (event.type === 'session.updated' && !settled) {
            settled = true;
            clearTimeout(this.connectTimeout);
            this.ready = true;
            this.timer = setInterval(() => this.checkSilence(), 25);
            resolve();
          }
          this.handleEvent(event);
        } catch (error) { fail(error); }
      });
      this.socket.on('error', fail);
      this.socket.on('close', () => {
        this.ready = false;
        clearInterval(this.timer);
        if (!this.closed) fail(new Error('Live transcription disconnected. Restart recording to reconnect.'));
      });
    });
  }

  send(event) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  append(buffer) {
    if (!this.ready || this.closed || this.finishing || !buffer.length) return;
    if (this.socket.bufferedAmount > 2 * 1024 * 1024) {
      this.emit('error', new Error('Live transcription connection is too slow. Restart recording.'));
      return;
    }
    let sum = 0;
    const count = Math.floor(buffer.length / 2);
    for (let i = 0; i < count; i++) sum += (buffer.readInt16LE(i * 2) / 32768) ** 2;
    const energy = Math.sqrt(sum / Math.max(1, count));
    const voiced = energy >= (this.speaking ? 0.0056 : 0.008);
    if (voiced) {
      this.lastVoiceAt = this.now();
      this.voicedMs += count / 16;
      if (!this.speaking) {
        this.speaking = true;
        this.pendingAudio = this.preRoll;
        this.preRoll = [];
        this.preRollBytes = 0;
      }
    }
    if (this.speaking) {
      // Confirm a little speech before streaming, so clicks don't create
      // abandoned transcript items that can block later completed questions.
      if (this.audioStarted) this.sendAudio(buffer);
      else {
        this.pendingAudio.push(buffer);
        if (this.voicedMs >= 150) {
          for (const chunk of this.pendingAudio) this.sendAudio(chunk);
          this.pendingAudio = [];
          this.audioStarted = true;
        }
      }
    }
    else {
      this.preRoll.push(buffer);
      this.preRollBytes += buffer.length;
      while (this.preRollBytes > 9600 && this.preRoll.length > 1) this.preRollBytes -= this.preRoll.shift().length;
    }
    this.checkSilence();
  }

  sendAudio(buffer) {
    this.send({ type: 'input_audio_buffer.append', audio: resamplePCM(buffer).toString('base64') });
  }

  checkSilence() {
    if (this.speaking && this.now() - this.lastVoiceAt >= this.silenceMs) this.commit();
  }

  commit() {
    if (!this.speaking) return;
    this.speaking = false;
    if (this.audioStarted) {
      this.pendingCommits++;
      this.send({ type: 'input_audio_buffer.commit' });
    }
    this.voicedMs = 0;
    this.audioStarted = false;
    this.pendingAudio = [];
  }

  handleEvent(event) {
    const id = event.item_id || event.item?.id;
    const relevant = ['conversation.item.created', 'input_audio_buffer.committed',
      'conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed',
      'conversation.item.input_audio_transcription.failed'];
    if (!id || !relevant.includes(event.type)) return;
    if (!this.items.has(id)) { this.items.set(id, { text: '', done: false }); this.order.push(id); }
    const item = this.items.get(id);
    if (item.done) return;
    if (event.type.endsWith('.delta')) {
      item.text += event.delta || '';
      this.emit('interim', item.text);
    }
    if (event.type.endsWith('.completed') || event.type.endsWith('.failed')) {
      item.text = event.transcript || '';
      item.done = true;
      if (event.type.endsWith('.failed')) this.emit('error', new Error(event.error?.message || 'Could not transcribe speech'));
      while (this.order.length && this.items.get(this.order[0]).done) {
        const next = this.items.get(this.order.shift());
        this.pendingCommits = Math.max(0, this.pendingCommits - 1);
        this.emit('interim', '');
        if (next.text.trim()) this.emit('transcription', next.text.trim(), { committed: true });
      }
      // Retain IDs of recent completed items to ignore duplicate server events.
      if (this.items.size > 100) for (const [key, value] of this.items) {
        if (value.done) this.items.delete(key);
        if (this.items.size <= 50) break;
      }
      if (!this.pendingCommits) this.emit('drained');
    }
  }

  async finish() {
    this.finishing = true;
    this.commit();
    if (this.pendingCommits) await new Promise(resolve => {
      const done = () => { clearTimeout(timeout); this.removeListener('drained', done); resolve(); };
      const timeout = setTimeout(done, 5000);
      this.once('drained', done);
    });
    this.close();
  }

  close() {
    this.closed = true;
    this.ready = false;
    clearInterval(this.timer);
    clearTimeout(this.connectTimeout);
    if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.terminate();
    else this.socket?.close();
    this.preRoll = [];
  }
}

module.exports = { LiveTranscription, resamplePCM };
