const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VMControlBridge } = require('../src/services/vm-control.service');
test('guest controls require pairing, accept only reserved actions, and dispatch capture before submit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-control-test-'));
  const bridge = new VMControlBridge();
  const received = [];
  try {
    const config = await bridge.start({ isInteractive: false }, { capture: () => received.push('capture'), submit: () => received.push('submit') }, { directory, addresses: ['127.0.0.1'], port: 0 });
    const endpoint = config.hosts[0];
    assert.equal((await fetch(endpoint + '/state')).status, 401);
    const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(endpoint + '/control', { method: 'POST', headers, body: JSON.stringify({ action: 'execute-command' }) })).status, 400);
    for (const action of ['capture', 'submit']) assert.equal((await fetch(endpoint + '/control', { method: 'POST', headers, body: JSON.stringify({ action }) })).status, 202);
    assert.deepEqual(received, ['capture', 'submit']);
    const state = await (await fetch(endpoint + '/state', { headers })).json();
    assert.equal(state.connected, true);
    assert.equal(state.scrollTarget, '');
    let hovered = 'codeResponse';
    bridge.hoveredPanel = () => hovered;
    assert.equal((await (await fetch(endpoint + '/state', { headers })).json()).scrollTarget, 'codeResponse');
    assert.equal((await fetch(endpoint + '/control', { method: 'POST', headers, body: JSON.stringify({ action: 'scroll-through' }) })).status, 200);
    assert.equal((await (await fetch(endpoint + '/state', { headers })).json()).scrollTarget, '', 'Clicking lets wheel input pass behind the panel');
    assert.equal((await (await fetch(endpoint + '/state', { headers })).json()).hoveredPanel, 'codeResponse', 'Guest can distinguish scroll-through from leaving the panel');
    assert.equal(bridge.scrollTarget(), '', 'Scroll-through stays enabled while hovering');
    hovered = '';
    assert.equal(bridge.scrollTarget(), '');
    hovered = 'codeResponse';
    assert.equal(bridge.scrollTarget(), 'codeResponse', 'Leaving and re-entering restores panel scrolling');
    bridge.manager.scrollBypassPanel = 'codeResponse';
    hovered = 'llmResponse';
    assert.equal(bridge.scrollTarget(), 'llmResponse', 'Moving to another panel restores scrolling there');
  } finally {
    bridge.stop();
    fs.unlinkSync(path.join(directory, 'vm-controls.json'));
    fs.rmdirSync(directory);
  }
});
