const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { screen } = require('electron');
const logger = require('../core/logger').createServiceLogger('VM-CONTROLS');

class VMControlBridge {
  async start(manager, actions, options = {}) {
    this.manager = manager;
    this.actions = actions;
    this.servers = [];
    const directory = options.directory || path.join(os.homedir(), '.OpenCluely/vm-controls');
    fs.mkdirSync(directory, { recursive: true });
    const configPath = path.join(directory, 'vm-controls.json');
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) {}
    this.token = previous.token || crypto.randomBytes(32).toString('hex');
    const addresses = options.addresses || Object.entries(os.networkInterfaces())
      .filter(([name]) => /vmnet|vmware/i.test(name))
      .sort(([a], [b]) => Number(/vmnet8/i.test(b)) - Number(/vmnet8/i.test(a)))
      .flatMap(([, values]) => values.filter(value => value.family === 'IPv4').map(value => value.address));
    this.addresses = addresses;
    const hosts = [];
    for (const address of addresses) {
      const server = http.createServer((request, response) => this.handle(request, response));
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(options.port ?? 32189, address, resolve);
        });
        this.servers.push(server);
        hosts.push(`http://${address}:${server.address().port}`);
      } catch (error) { logger.warn('VM control listener unavailable', { address, error: error.message }); }
    }
    this.clientConfig = { hosts, token: this.token };
    fs.writeFileSync(configPath, JSON.stringify(this.clientConfig, null, 2));
    logger.info('VM controls listening', { hosts, configPath });
    return this.clientConfig;
  }

  hoveredPanel() {
    if (this.manager.isInteractive) return '';
    const point = screen?.getCursorScreenPoint();
    if (!point) return '';
    for (const name of ['codeResponse', 'llmResponse']) {
      const window = this.manager.getWindow(name);
      if (!window || window.isDestroyed() || !window.isVisible()) continue;
      const b = window.getBounds();
      if (point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height) return name;
    }
    return '';
  }

  scrollTarget() {
    const hovered = this.hoveredPanel();
    if (this.manager.scrollBypassPanel && this.manager.scrollBypassPanel !== hovered) this.manager.scrollBypassPanel = '';
    return this.manager.scrollBypassPanel === hovered ? '' : hovered;
  }

  async handle(request, response) {
    const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (request.headers.authorization !== `Bearer ${this.token}`) return reply(401, { error: 'Pairing token required.' });
    if (request.method === 'GET' && request.url === '/state') {
      return reply(200, { connected: true, scrollTarget: this.scrollTarget(), hoveredPanel: this.hoveredPanel(), status: this.status || 'Ready' });
    }
    if (request.method !== 'POST' || request.url !== '/control') return reply(404, {});
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > 2048) request.destroy(); });
    request.on('end', () => {
      try {
        const event = JSON.parse(body);
        if (event.action === 'scroll-through') {
          this.manager.scrollBypassPanel = this.hoveredPanel();
          return reply(200, { success: true });
        }
        if (event.action === 'scroll') {
          const target = this.scrollTarget();
          if (target) this.manager.getWindow(target).webContents.send('panel-scroll', { x: Math.max(-1000, Math.min(1000, Number(event.x) || 0)), y: Math.max(-1000, Math.min(1000, Number(event.y) || 0)) });
          return reply(200, { success: true });
        }
        if (!['capture', 'submit', 'interact', 'panels'].includes(event.action)) return reply(400, { error: 'Unknown control.' });
        const action = this.actions[event.action];
        if (!action) return reply(400, { error: 'Control unavailable.' });
        logger.info('VM control received', { action: event.action });
        // Acknowledge immediately; capture/model processing continues in the host.
        Promise.resolve().then(action).catch(error => logger.error('VM control failed', { error: error.message }));
        reply(202, { accepted: true });
      } catch (_) { reply(400, { error: 'Invalid control message.' }); }
    });
  }

  stop() { for (const server of this.servers || []) server.close(); this.servers = []; }
}
module.exports = new VMControlBridge();
module.exports.VMControlBridge = VMControlBridge;
