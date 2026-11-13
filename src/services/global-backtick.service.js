const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class GlobalBacktickService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.globalShortcut = options.globalShortcut;
    this.platform = options.platform || process.platform;
    const developmentScript = path.join(__dirname, '..', '..', 'scripts', 'backtick-key-listener.ps1');
    const unpackedScript = process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'backtick-key-listener.ps1')
      : null;
    this.scriptPath = options.scriptPath || (unpackedScript && fs.existsSync(unpackedScript) ? unpackedScript : developmentScript);
    this.spawn = options.spawn || spawn;
    this.child = null;
    this.registered = false;
    this.mode = null;
    this.keyDown = false;
  }

  start(onPress) {
    if (this.registered) return this.getStatus();
    if (typeof onPress !== 'function') throw new Error('Backtick listener requires a callback.');

    // Verify this Electron build understands the literal grave accelerator.
    // Windows uses a non-consuming physical-key listener after the probe.
    let electronSupported = false;
    try {
      const probe = this.globalShortcut?.register('`', () => {});
      electronSupported = !!probe && !!this.globalShortcut?.isRegistered('`');
    } finally {
      this.globalShortcut?.unregister('`');
    }

    if (this.platform === 'win32') {
      this._startWindowsListener(onPress);
      this.electronSupported = electronSupported;
      return this.getStatus();
    }

    if (!electronSupported || !this.globalShortcut.register('`', onPress)) {
      throw new Error('The unmodified backtick key could not be registered globally.');
    }
    this.registered = true;
    this.mode = 'electron-globalShortcut';
    this.electronSupported = true;
    return this.getStatus();
  }

  _startWindowsListener(onPress) {
    const child = this.spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.registered = true;
    this.mode = 'windows-vk-oem-3';
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      pending += data;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const event = line.trim().toUpperCase();
        if (event === 'DOWN' && !this.keyDown) {
          this.keyDown = true;
          onPress();
        } else if (event === 'UP') {
          this.keyDown = false;
        }
      }
    });
    child.once('error', error => {
      this.registered = false;
      this.emit('error', error);
    });
    child.once('exit', code => {
      if (this.child !== child) return;
      this.child = null;
      this.registered = false;
      this.emit('exit', code);
    });
  }

  getStatus() {
    return { registered: this.registered, mode: this.mode, electronSupported: !!this.electronSupported };
  }

  stop() {
    if (this.child) {
      const child = this.child;
      this.child = null;
      child.kill();
    }
    if (this.mode === 'electron-globalShortcut') this.globalShortcut?.unregister('`');
    this.registered = false;
    this.mode = null;
    this.keyDown = false;
  }
}

module.exports = GlobalBacktickService;
