const { spawn } = require('child_process');
const path = require('path');
const { screen } = require('electron');
const logger = require('../core/logger').createServiceLogger('HOST-INPUT');

class WindowsInput {
  start(manager, actions) {
    if (process.platform !== 'win32' || this.child) return;
    const script = path.join(__dirname, '../../scripts/windows-input.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (line === 'ready') { this.ready = true; logger.info('Host keyboard and scroll hooks ready'); this.update(manager); }
        else if (line === 'manual-release') {
          logger.info('Manual Ctrl+Alt release detected; host control keys rearmed');
        } else if (line.startsWith('key:')) {
          logger.info('Host shortcut received', { action: line.slice(4) });
          const action = actions[line.slice(4)];
          if (action) Promise.resolve().then(action).catch(error => logger.error('Host shortcut failed', { error: error.message }));
        } else if (line.startsWith('scroll-through:')) {
          manager.scrollBypassPanel = line.slice('scroll-through:'.length);
        } else if (line.startsWith('wheel:')) {
          const [, name, axis, value] = line.split(':');
          manager.getWindow(name)?.webContents.send('panel-scroll', { x: axis === 'x' ? Number(value) / 120 * 90 : 0, y: axis === 'y' ? -Number(value) / 120 * 90 : 0 });
        }
      }
    });
    this.child.stderr.on('data', chunk => logger.warn('Host input helper', { message: chunk.toString().slice(0, 1500) }));
    this.child.on('error', error => logger.error('Host input unavailable', { error: error.message }));
    this.child.stdin.on('error', () => {});
    this.child.on('exit', () => { this.ready = false; this.child = null; });
    this.timer = setInterval(() => this.update(manager), 150);
  }

  update(manager) {
    if (!this.ready || !this.child?.stdin.writable) return;
    const regions = [];
    if (!manager.isInteractive) {
      for (const name of ['llmResponse', 'codeResponse']) {
        const win = manager.getWindow(name);
        if (!win || win.isDestroyed() || !win.isVisible()) continue;
        const b = screen.dipToScreenRect(win, win.getBounds());
        regions.push([name, b.x, b.y, b.width, b.height].join(','));
      }
    }
    this.child.stdin.write('panels|' + regions.join('|') + '\n');
    this.child.stdin.write('bypass|' + (manager.scrollBypassPanel || '') + '\n');
  }

  stop() {
    clearInterval(this.timer);
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
}
module.exports = new WindowsInput();
