const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');
const logger = require('../core/logger').createServiceLogger('MOBILE-BRIDGE');
const { MobileAudio } = require('./mobile-audio.service');

const MAX_BODY = 64 * 1024;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

class MobileBridge {
  constructor() {
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    this.rate = new Map();
    this.inflight = new Map();
  }

  getLanAddresses() {
    const found = [];
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      for (const item of entries || []) {
        if (item.family === 'IPv4' && !item.internal && PRIVATE_IPV4.test(item.address)) found.push({ name, address: item.address });
      }
    }
    const score = item => {
      const name = item.name.toLowerCase();
      if (/wi-?fi|wlan|ethernet/.test(name) && !/vmware|virtual|vethernet|hyper-v/.test(name)) return 0;
      if (/vmware|virtualbox|vethernet|hyper-v|tailscale|docker|wsl/.test(name)) return 3;
      if (item.address.startsWith('169.254.')) return 4;
      return 1;
    };
    return found.sort((a, b) => score(a) - score(b));
  }

  async start({ host, port = 32190, auth, store, events, actions, stateProvider, speech, verification, autoConnect = false }) {
    if (this.server) return this.getStatus();
    this.auth = auth; this.store = store; this.events = events; this.actions = actions; this.stateProvider = stateProvider; this.autoConnect = !!autoConnect;
    this.verification = verification;
    this.audio = speech ? new MobileAudio(speech, (deviceId, message) => {
      for (const client of this.clients) if (client.device?.id === deviceId && client.ws.readyState === 1) client.ws.send(JSON.stringify({ type: 'audio.error', message }));
    }, verification, (type, payload) => events.publish(type, payload)) : null;
    const addresses = this.getLanAddresses();
    const bindHost = host || addresses[0]?.address;
    if (!bindHost || !PRIVATE_IPV4.test(bindHost)) throw new Error('No private LAN IPv4 interface is available.');
    if (!addresses.some(item => item.address === bindHost)) throw new Error('Selected LAN interface is unavailable.');
    this.host = bindHost;
    this.port = Number(port) || 32190;
    // Expo Go cannot trust a desktop-generated certificate. This bridge is
    // private-LAN-only and authenticates controls with random device tokens.
    this.secure = false;
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
    this.server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/api/v1/events') return socket.destroy();
      try { this.limit(req, 'socket', 30, 60_000); } catch (_) { return socket.destroy(); }
      if (this.clients.size >= 20) return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, ws => this.acceptSocket(ws, req));
    });
    this.eventListener = event => this.broadcast(event);
    events.on('event', this.eventListener);
    await new Promise((resolve, reject) => {
      const onError = error => { this.server = null; reject(new Error(error.code === 'EADDRINUSE' ? `Port ${this.port} is already in use.` : error.message)); };
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => { this.server.off('error', onError); resolve(); });
    });
    logger.info('Mobile bridge listening', { address: `http://${this.host}:${this.port}` });
    return this.getStatus();
  }

  acceptSocket(ws, req) {
    const client = { ws, authenticated: false, device: null, pendingAudio: 0, pendingBytes: 0, failedRecordings: new Map(), audioQueue: Promise.resolve(), timer: setTimeout(() => ws.close(4001, 'Authentication required'), 10000) };
    this.clients.add(client);
    ws.on('message', raw => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (_) { return ws.close(4002, 'Invalid JSON'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return ws.close(4002, 'Invalid message');
      if (!client.authenticated) {
        if (data.type !== 'authenticate') return ws.close(4001, 'Authentication required');
        const device = this.auth.authenticate(data.token);
        if (!device) return ws.close(4003, 'Invalid credential');
        clearTimeout(client.timer); client.authenticated = true; client.device = device; client.token = data.token;
        const requested = Number(data.lastSequence) || 0;
        const oldest = this.events.buffer[0]?.sequence || this.events.sequence + 1;
        ws.send(JSON.stringify({ type: 'authenticated', device, sequence: this.events.sequence, replayComplete: requested <= this.events.sequence && requested >= oldest - 1 }));
        for (const event of this.events.since(data.lastSequence || 0)) ws.send(JSON.stringify(event));
        ws.send(JSON.stringify({ type: 'replay.completed', sequence: this.events.sequence }));
        return;
      }
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      if (typeof data.type === 'string' && data.type.startsWith('audio.')) {
        ws.send(JSON.stringify({ type: 'audio.error', message: 'Phone audio capture has moved to desktop Settings.' }));
        return;
      }
      if (typeof data.type === 'string' && data.type.startsWith('voice.recording.')) {
        ws.send(JSON.stringify({ type: 'voice.recording.error', sessionId: data.sessionId, message: 'Voice enrollment and testing are available only in desktop Settings.' }));
        return;
      }
    });
    ws.on('close', () => { clearTimeout(client.timer); if (client.device) { this.audio?.stop(client.device.id); this.audio?.enrollmentCancel(client.device.id); } this.clients.delete(client); });
    ws.on('error', () => this.clients.delete(client));
  }

  broadcast(event) {
    const payload = JSON.stringify(event);
    for (const client of this.clients) if (client.authenticated && client.ws.readyState === 1) { if (client.ws.bufferedAmount > 1024 * 1024) client.ws.close(4008, 'Connection too slow'); else client.ws.send(payload); }
  }

  async handle(req, res) {
    this.setCors(req, res);
    if (req.method === 'OPTIONS') return this.json(res, 204, null);
    try {
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname === '/') return this.json(res, 200, { success: true, data: { message: 'OpenCluely trusted mobile bridge is running.', health: '/api/v1/health' } });
      if (req.method === 'GET' && url.pathname === '/api/v1/health') return this.json(res, 200, { success: true, data: { available: true, version: 1 } });
      if (req.method === 'POST' && url.pathname === '/api/v1/login') {
        this.limit(req, 'login', 8, 60_000);
        const body = await this.body(req);
        const result = this.auth.login(body.password, body.deviceName, req.socket.remoteAddress);
        return this.json(res, 201, { success: true, data: result });
      }
      const device = this.authenticateRequest(req);
      if (!device) return this.json(res, 401, { success: false, error: { code: 'UNAUTHORIZED_DEVICE', message: 'Authentication required.' } });
      // Reads and writes have separate budgets so a reconnect/replay burst can
      // never prevent the microphone stop command from getting through.
      const isRead = req.method === 'GET';
      this.limit(req, `${isRead ? 'read' : 'write'}:${device.id}`, isRead ? 600 : 180, 60_000);

      if (req.method === 'GET' && url.pathname === '/api/v1/state') return this.ok(res, await this.stateProvider());
      if (req.method === 'GET' && url.pathname === '/api/v1/voice-profile') return this.ok(res, this.verification?.getStatus() || { profile: 'not_set_up', model: 'unavailable', filterEnabled: false });
      if (req.method === 'GET' && url.pathname === '/api/v1/displays') return this.ok(res, (await this.stateProvider()).displays);
      if (req.method === 'GET' && url.pathname === '/api/v1/conversations') {
        return this.ok(res, this.store.listConversations({ limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor') }));
      }
      let match = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
      if (req.method === 'GET' && match) {
        const cursor = this.store.decodeCursor(url.searchParams.get('cursor'));
        return this.ok(res, this.store.getMessages(decodeURIComponent(match[1]), { limit: url.searchParams.get('limit'), cursor }));
      }
      match = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && match) return this.ok(res, this.stateProvider.getJob?.(decodeURIComponent(match[1])) || null);

      const routes = {
        '/api/v1/actions/capture': 'capture', '/api/v1/actions/submit': 'submit', '/api/v1/actions/clear-queue': 'clearQueue',
        '/api/v1/actions/select-target': 'selectTarget', '/api/v1/actions/set-crop': 'setCrop',
        '/api/v1/actions/new-conversation': 'newConversation', '/api/v1/actions/select-conversation': 'selectConversation', '/api/v1/actions/audio-source': 'audioSource', '/api/v1/actions/computer-microphone': 'computerMicrophone', '/api/v1/messages': 'sendMessage'
      };
      if (req.method === 'POST' && routes[url.pathname]) {
        const body = await this.body(req);
        body.mobileOrigin = true;
        const kind = routes[url.pathname];
        const scopedId = body.requestId ? `${device.id}:${body.requestId}` : null;
        const cached = this.store.getIdempotent(scopedId, kind);
        if (cached) return this.ok(res, cached);
        const key = body.requestId ? `${device.id}:${kind}:${body.requestId}` : null;
        let pending = key && this.inflight.get(key);
        if (!pending) {
          pending = Promise.resolve().then(() => this.actions.execute(kind, body)).then(result => {
            if (result?.success === false) throw Object.assign(new Error(result.error || 'Action failed.'), { code: result.code || 'REQUEST_FAILED' });
            this.store.saveIdempotent(scopedId, kind, result);
            return result;
          });
          if (key) this.inflight.set(key, pending);
        }
        let result;
        try { result = await pending; } finally { if (key && this.inflight.get(key) === pending) this.inflight.delete(key); }
        return this.json(res, 202, { success: true, data: result });
      }
      match = url.pathname.match(/^\/api\/v1\/messages\/([^/]+)\/resend$/);
      if (req.method === 'POST' && match) {
        const body = await this.body(req); body.messageId = decodeURIComponent(match[1]); body.mobileOrigin = true;
        const scopedId = body.requestId ? `${device.id}:${body.requestId}` : null;
        const cached = this.store.getIdempotent(scopedId, 'resend');
        if (cached) return this.ok(res, cached);
        const key = scopedId ? `${device.id}:resend:${body.requestId}` : null;
        let pending = key && this.inflight.get(key);
        if (!pending) {
          pending = Promise.resolve().then(() => this.actions.execute('resendMessage', body)).then(result => {
            if (result?.success === false) throw Object.assign(new Error(result.error || 'Action failed.'), { code: result.code || 'REQUEST_FAILED' });
            this.store.saveIdempotent(scopedId, 'resend', result); return result;
          });
          if (key) this.inflight.set(key, pending);
        }
        let result;
        try { result = await pending; } finally { if (key && this.inflight.get(key) === pending) this.inflight.delete(key); }
        return this.json(res, 202, { success: true, data: result });
      }
      return this.json(res, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
    } catch (error) {
      logger.warn('Mobile request failed', { path: req.url, error: error.message });
      return this.json(res, error.statusCode || 400, { success: false, error: { code: error.code || 'REQUEST_FAILED', message: error.message } });
    }
  }

  authenticateRequest(req) {
    const value = req.headers.authorization || '';
    return value.startsWith('Bearer ') ? this.auth.authenticate(value.slice(7)) : null;
  }

  async body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 }); chunks.push(chunk); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { throw new Error('Invalid JSON body.'); }
  }

  limit(req, key, max, windowMs) {
    const fullKey = `${req.socket.remoteAddress}:${key}`; const current = this.rate.get(fullKey); const time = Date.now();
    if (!current || time > current.reset) return this.rate.set(fullKey, { count: 1, reset: time + windowMs });
    if (++current.count > max) throw Object.assign(new Error('Rate limit exceeded.'), { statusCode: 429 });
  }

  setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin.startsWith('exp://'))) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  ok(res, data) { return this.json(res, 200, { success: true, data }); }
  json(res, status, value) { res.statusCode = status; if (value == null) return res.end(); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
  getStatus() { return { enabled: !!this.server, autoConnect: !!this.autoConnect, secure: false, host: this.host || null, port: this.port || null, address: this.server ? `http://${this.host}:${this.port}` : null, interfaces: this.getLanAddresses(), connectedDevices: [...this.clients].filter(c => c.authenticated).map(c => c.device) }; }
  disconnectDevice(deviceId) {
    this.audio?.stop(deviceId);
    for (const client of this.clients) if (client.device?.id === deviceId) client.ws.close(4003, 'Credential revoked');
  }
  async stop() {
    this.audio?.dispose(); this.audio = null;
    if (this.events && this.eventListener) this.events.off('event', this.eventListener);
    for (const client of this.clients) client.ws.close(1001, 'Desktop closing');
    this.clients.clear();
    if (this.wss) this.wss.close();
    const server = this.server; this.server = null; this.wss = null;
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

module.exports = new MobileBridge();
