const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expoCli = path.join(root, 'mobile', 'node_modules', 'expo', 'bin', 'cli');
const desktopEnv = { ...process.env };
delete desktopEnv.ELECTRON_RUN_AS_NODE;

const desktop = spawn(process.execPath, ['scripts/start-electron.cjs'], {
  cwd: root, env: desktopEnv, stdio: 'inherit'
});
const phone = spawn(process.execPath, [expoCli, 'start', '--lan', '--clear'], {
  cwd: path.join(root, 'mobile'), env: process.env, stdio: 'inherit'
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (!desktop.killed) desktop.kill();
  if (!phone.killed) phone.kill();
  process.exitCode = code;
}

desktop.on('error', error => { console.error(`Desktop failed to start: ${error.message}`); stop(1); });
phone.on('error', error => { console.error(`Phone development server failed to start: ${error.message}`); stop(1); });
desktop.on('exit', code => stop(code ?? 1));
phone.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
