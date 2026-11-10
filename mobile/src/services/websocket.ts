import type { DesktopConfig, LiveEvent } from '../types/protocol';

export class DesktopSocket {
  socket?: WebSocket; stopped = false; attempt = 0; timer?: ReturnType<typeof setTimeout>;
  constructor(private config: DesktopConfig, private lastSequence: () => number, private onEvent: (e: LiveEvent) => void, private onStatus: (ok: boolean, serverSequence?: number, reason?: 'unauthorized') => void) {}
  start() { this.stopped = false; this.connect(); }
  connect() {
    if (this.stopped) return;
    const wsUrl = this.config.baseUrl.replace(/^http/, 'ws') + '/api/v1/events';
    const socket = this.socket = new WebSocket(wsUrl);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', token: this.config.token, lastSequence: this.lastSequence() }));
    socket.onmessage = message => { const value = JSON.parse(String(message.data)); if (value.type === 'authenticated') { this.attempt = 0; this.onStatus(true, value.sequence); } else if (value.sequence) this.onEvent(value); };
    socket.onerror = () => this.onStatus(false);
    socket.onclose = event => {
      const unauthorized = event.code === 4003;
      this.onStatus(false, undefined, unauthorized ? 'unauthorized' : undefined);
      if (!this.stopped && !unauthorized) {
        const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
        this.timer = setTimeout(() => this.connect(), delay);
      }
    };
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.socket?.close(); }
}
