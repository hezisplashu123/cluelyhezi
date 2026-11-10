const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

class MobileAuthService {
  initialize(userDataPath) {
    this.filePath = path.join(userDataPath, 'mobile-devices.json');
    this.devices = [];
    try { this.devices = JSON.parse(fs.readFileSync(this.filePath, 'utf8')).devices || []; } catch (_) { this.devices = []; }
    this.devices = this.devices.filter(device => !device.expiresAt || Date.parse(device.expiresAt) > Date.now());
    this.pairing = null;
    this.attempts = new Map();
  }

  generatePairingCode(ttlMs = 5 * 60 * 1000) {
    this.pairing = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expiresAt: Date.now() + ttlMs, attempts: 0 };
    return { code: this.pairing.code, expiresAt: new Date(this.pairing.expiresAt).toISOString() };
  }

  pair(code, deviceName = 'Mobile device', remoteAddress = '') {
    if (!this.pairing || Date.now() > this.pairing.expiresAt) throw Object.assign(new Error('Pairing code expired.'), { statusCode: 410 });
    this.pairing.attempts += 1;
    if (this.pairing.attempts > 8) {
      this.pairing = null;
      throw Object.assign(new Error('Too many pairing attempts.'), { statusCode: 429 });
    }
    const supplied = String(code || '');
    if (!/^\d{6}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(this.pairing.code))) {
      throw Object.assign(new Error('Invalid pairing code.'), { statusCode: 401 });
    }
    const result = this.issueDevice(deviceName, remoteAddress);
    this.pairing = null;
    return result;
  }

  issueDevelopmentDevice(deviceName = 'Expo Go', remoteAddress = '', ttlMs = 12 * 60 * 60 * 1000) {
    return this.issueDevice(deviceName, remoteAddress, ttlMs);
  }

  issueDevice(deviceName, remoteAddress, ttlMs = null) {
    const token = crypto.randomBytes(32).toString('base64url');
    const device = {
      id: crypto.randomUUID(), name: String(deviceName).slice(0, 80), tokenHash: digest(token),
      createdAt: new Date().toISOString(), remoteAddress,
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null
    };
    this.devices.push(device);
    this.persist();
    return { token, device: this.publicDevice(device) };
  }

  authenticate(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = digest(token);
    const device = this.devices.find(item => (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()) && item.tokenHash.length === hash.length && crypto.timingSafeEqual(Buffer.from(item.tokenHash), Buffer.from(hash)));
    return device ? this.publicDevice(device) : null;
  }

  revoke(deviceId) {
    const before = this.devices.length;
    this.devices = this.devices.filter(device => device.id !== deviceId);
    if (this.devices.length !== before) this.persist();
    return this.devices.length !== before;
  }

  revokeAll() { this.devices = []; this.persist(); }
  listDevices() { return (this.devices || []).map(device => this.publicDevice(device)); }
  publicDevice(device) { return { id: device.id, name: device.name, createdAt: device.createdAt, remoteAddress: device.remoteAddress, expiresAt: device.expiresAt || null }; }
  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ devices: this.devices }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
}

module.exports = new MobileAuthService();
