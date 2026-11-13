// Hardware-backed offline diagnostic. Record WAV files with the target desktop
// microphone/system-playback route, then run:
// npm run voice-diagnostic -- --self me.wav --other colleague.wav --system playback.wav
const fs = require('fs');
const path = require('path');

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--health-only') return { healthOnly: true, samples: [] };
  const samples = [];
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], file = args[i + 1];
    if (!['--self', '--other', '--system'].includes(flag) || !file) throw new Error('Use --self, --other, or --system followed by a WAV path.');
    samples.push({ expected: flag.slice(2), file: path.resolve(file) });
  }
  if (!samples.length) throw new Error('Provide at least one real 16 kHz mono PCM16 WAV recording.');
  return { healthOnly: false, samples };
}

function readWav(filename) {
  const wav = fs.readFileSync(filename);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${filename} is not a WAV file.`);
  let offset = 12, format = null, pcm = null;
  while (offset + 8 <= wav.length) {
    const kind = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (kind === 'fmt ') format = { encoding: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) };
    if (kind === 'data') pcm = Buffer.from(wav.subarray(start, start + size));
    offset = start + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.rate !== 16000 || format.bits !== 16 || !pcm) throw new Error(`${filename} must be uncompressed 16 kHz mono PCM16 WAV.`);
  return pcm;
}

async function run() {
  const { app, safeStorage } = require('electron');
  try {
    const options = parseArgs(process.argv.slice(2));
    app.setAppPath(path.resolve(__dirname, '..'));
    app.setName('opencluely');
    await app.whenReady();
    const verifier = require('../src/services/speaker-verification.service');
    const status = await verifier.initialize(app.getPath('userData'), safeStorage);
    if (status.model !== 'ready') throw new Error(status.error || 'Install the voice model in desktop Settings first.');
    if (options.healthOnly) {
      console.log(JSON.stringify({ model: status.model, revision: status.modelRevision, python: status.health?.python,
        torch: status.health?.torch, speechbrain: status.health?.speechbrain, inferenceMs: status.health?.inferenceMs,
        profile: status.profile, userData: app.getPath('userData') }, null, 2));
      verifier.shutdown(); app.quit(); return;
    }
    if (status.profile !== 'ready') throw new Error('Enroll a profile in desktop Settings before classifying recordings.');
    const rows = [];
    for (const sample of options.samples) {
      const pcm = readWav(sample.file);
      const result = await verifier.verify(pcm, { test: true });
      const expectedDecision = sample.expected === 'self' ? 'SELF_MATCH' : sample.expected === 'other' ? 'OTHER_SPEAKER' : null;
      rows.push({ file: sample.file, expected: sample.expected, frames: pcm.length / 2, seconds: pcm.length / 32000,
        decision: result.decision, score: result.score, latencyMs: result.totalMs, correct: expectedDecision ? result.decision === expectedDecision : null,
        qualityIssues: result.quality?.qualityIssues || [], source: sample.expected === 'system' ? 'system_playback' : 'physical_microphone' });
      pcm.fill(0);
    }
    console.table(rows);
    const judged = rows.filter(row => row.correct !== null);
    console.log(JSON.stringify({ samples: rows.length, correct: judged.filter(row => row.correct).length,
      uncertain: rows.filter(row => row.decision === 'UNCERTAIN' || row.decision === 'INSUFFICIENT_AUDIO').length,
      meanLatencyMs: Math.round(rows.reduce((sum, row) => sum + (row.latencyMs || 0), 0) / rows.length), rows }, null, 2));
    verifier.shutdown(); app.quit();
  } catch (error) {
    console.error('DESKTOP_VOICE_DIAGNOSTIC_FAILED', error.message);
    app.exit(1);
  }
}

if (require.main === module || (process.versions.electron && process.type === 'browser')) run();
module.exports = { parseArgs, readWav };
