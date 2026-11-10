// Local-only diagnostic: list targets and optionally save one image.
const fs = require('fs');
const path = require('path');

function parseArgs(args, env = {}) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--save', '--source', '--capture-crop'].includes(name)) throw new Error(`Unknown option: ${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: ${name}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    options[name] = value;
  }
  if ((options['--source'] || options['--capture-crop']) && !options['--save']) throw new Error('--source and --capture-crop require --save');
  const envCrop = env.OPENCLUELY_DIAGNOSTIC_CROP;
  if (envCrop != null && options['--capture-crop']) throw new Error('Specify the diagnostic crop only once');
  const cropValue = envCrop ?? options['--capture-crop'];
  if (cropValue != null) {
    const parts = cropValue.split(',');
    if (parts.length !== 4 || parts.some(part => !part.trim() || !Number.isFinite(Number(part)))) throw new Error('Diagnostic crop requires four normalized numbers: x,y,width,height');
    const [x, y, width, height] = parts.map(Number);
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw new Error('Diagnostic crop must fit within the image using normalized coordinates from 0 to 1');
    options.crop = { x, y, width, height };
  }
  return options;
}

async function run() {
  const { app } = require('electron');
  const timeout = setTimeout(() => app.exit(1), 90000);
  try {
    const options = parseArgs(process.argv.slice(2), process.env);
    await app.whenReady();
    const capture = require('../src/services/capture.service');
    // Do not initialize a store: selections and crops exist only in this process.
    const targets = await capture.listTargets();
    console.log('Capture targets:', JSON.stringify(targets, null, 2));
    if (options.crop) console.log('Diagnostic crop:', JSON.stringify(options.crop));
    if (options['--save']) {
      let source = options['--source'];
      if (!source && options.crop) {
        const windows = targets.filter(target => target.kind === 'window' && target.application === 'vmware');
        if (windows.length !== 1) throw new Error('Diagnostic crop requires --source when there is not exactly one VMware window');
        source = windows[0].sourceId;
      }
      if (source) await capture.selectTarget(source);
      if (options.crop) capture.setCrop(options.crop);
      const result = await capture.captureAndProcess();
      fs.writeFileSync(path.resolve(options['--save']), result.imageBuffer, { flag: 'wx' });
      console.log('Saved local PNG:', path.resolve(options['--save']), JSON.stringify(result.metadata));
    }
    clearTimeout(timeout); app.quit();
  } catch (error) {
    console.error(error.code || 'CAPTURE_FAILED', error.message);
    clearTimeout(timeout); app.exit(1);
  }
}

if (require.main === module || (process.versions.electron && process.type === 'browser')) run();
module.exports = { parseArgs };
