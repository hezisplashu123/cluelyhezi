const fs = require('fs');
const path = require('path');
const target = path.resolve(__dirname, '..', 'dist');
if (path.dirname(target) !== path.resolve(__dirname, '..')) throw new Error('Refusing to clean outside the project.');
fs.rmSync(target, { recursive: true, force: true });
