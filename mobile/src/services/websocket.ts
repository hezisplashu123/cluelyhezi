import type { DesktopConfig, LiveEvent } from '../types/protocol';

export class DesktopSocket {
  socket?: WebSocket; stopped = false; attempt = 0; timer?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval>; lastPong = 0; authenticated = false;
  constructor(private config: DesktopConfig, private lastSequence: () => number, private onEvent: (e: LiveEvent) => void, private onStatus: (ok: boolean, serverSequence?: number, reason?: 'unauthorized') => void, private onAudio: (value: any) => void = () => {}) {}
  start() { this.stopped = false; this.connect(); }
  connect() {
    if (this.stopped) return;
    const wsUrl = this.config.baseUrl.replace(/^http/, 'ws') + '/api/v1/events';
    const socket = this.socket = new WebSocket(wsUrl);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', token: this.config.token, lastSequence: this.lastSequence() }));
    socket.onmessage = message => { let value; try { value = JSON.parse(String(message.data)); } catch { return; } if (value.type === 'authenticated') { this.authenticated = true; this.lastPong = Date.now(); this.attempt = 0; this.onStatus(true, value.sequence); this.heartbeat = setInterval(() => { if (Date.now() - this.lastPong > 30000) socket.close(); else this.send({ type: 'ping' }); }, 10000); } else if (value.type === 'pong') this.lastPong = Date.now(); else if (value.type === 'audio.status' || value.type === 'audio.error' || value.type === 'replay.completed' || value.type?.startsWith('voice.recording.')) this.onAudio(value); else if (value.sequence) this.onEvent(value); };
    socket.onerror = () => this.onStatus(false);
    socket.onclose = event => {
      this.authenticated = false; if (this.heartbeat) clearInterval(this.heartbeat);
      const unauthorized = event.code === 4003;
      this.onStatus(false, undefined, unauthorized ? 'unauthorized' : undefined);
      if (!this.stopped && !unauthorized) {
        const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
        this.timer = setTimeout(() => this.connect(), delay);
      }
    };
  }
  send(value: object) { if (!this.authenticated || this.socket?.readyState !== 1 || this.socket.bufferedAmount > 128 * 1024) return false; this.socket.send(JSON.stringify(value)); return true; }
  stop() { this.stopped = true; this.authenticated = false; if (this.timer) clearTimeout(this.timer); if (this.heartbeat) clearInterval(this.heartbeat); this.socket?.close(); }
}
