const { app, BrowserWindow } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
app.whenReady().then(async () => {
  require('../src/services/speech.service');
  const llm = require('../src/services/llm.service');
  try {
    console.log('Text transport:', await llm.executeRequest({ contents: 'Reply with OK only.' }));
    const fixture = new BrowserWindow({ show: false, width: 850, height: 400, webPreferences: { offscreen: true } });
    await fixture.loadURL('data:text/html,' + encodeURIComponent('<body style="background:white;color:black;font:25px sans-serif;padding:24px"><h2>Two Sum</h2>Given an integer array nums and target, return the indices of two distinct elements whose sum equals target. Exactly one solution exists. Use C++ and a hash map. Example: nums=[2,7,11,15], target=9 gives [0,1].</body>'));
    const png = (await fixture.webContents.capturePage()).toPNG();
    const deltas = [];
    const result = await llm.processImageWithSkillStream([{ imageBuffer: png, mimeType: 'image/png' }], 'image/png', 'dsa', [], 'cpp', delta => deltas.push(delta));
    require('assert/strict').match(result.response, /unordered_map/);
    const parts = require('../lib/response-parts').splitResponse(result.response);
    require('assert/strict').ok(parts.codeBlocks.length > 0, 'Image answer contains a recognized code block');
    require('assert/strict').ok(parts.codeBlocks.every(block => block.lines.every(line => !line.code.trim() || line.explanation)), 'Every source line has an explanation');
    require('assert/strict').ok(parts.codeBlocks.every(block => block.lines.every(line => !line.explanation || !/namespace|\bclass(?:es)?\b|\bmethod\b|public interface|semicolon|brace|indentation|declar(?:e|ation)/i.test(line.explanation))), 'Descriptions explain problem-solving purpose instead of programming syntax');
    console.log('Live image answer verified:', JSON.stringify({ model: result.metadata.model, imageCount: result.metadata.imageCount, chunks: deltas.length, responseLength: result.response.length }));
    console.log('Purpose-description sample:', parts.codeBlocks[0].lines.filter(line => line.explanation).slice(0, 5).map(line => line.explanation).join(' | '));
    const spoken = await llm.processTranscriptionWithIntelligentResponseStream('Please write a Python function add(a, b) that returns the sum of its two inputs.', 'dsa', [], 'python');
    const spokenParts = require('../lib/response-parts').splitResponse(spoken.response);
    if (!spokenParts.codeBlocks.length) console.log('Dialogue diagnostic:', spoken.response);
    require('assert/strict').ok(spokenParts.codeBlocks.length > 0 && spokenParts.codeBlocks.every(block => block.lines.every(line => !line.code.trim() || line.explanation)), 'Dialogue code has explanations for every line');
    console.log('Live dialogue code annotations verified; text model:', llm.model);
    fixture.destroy();
  } catch (error) { console.error('TRANSPORT STACK:', error.stack); app.exit(1); return; }
  app.quit();
});
