const { spawn } = require('child_process');
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = process.argv.slice(2);
const entry = args[0] === '--script' ? args.splice(0, 2)[1] : '.';
const child = spawn(electron, [entry, ...args], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', code => process.exitCode = code ?? 1);
