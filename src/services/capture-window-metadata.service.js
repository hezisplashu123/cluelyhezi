const { execFile } = require('child_process');
const path = require('path');
module.exports = async function windowMetadata() {
  if (process.platform !== 'win32') return [];
  const script = path.join(__dirname, '../../scripts/capture-window-metadata.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
    if (error) return reject(error);
    try { const value = JSON.parse(stdout); resolve(Array.isArray(value) ? value : []); } catch (parseError) { reject(parseError); }
  }));
};
