const { randomUUID } = require('crypto');

function mergeFragments(fragments) {
  let result = '';
  for (const raw of fragments) {
    const text = String(raw || '').trim();
    if (!text) continue;
    if (!result) { result = text; continue; }
    if (result.toLowerCase() === text.toLowerCase()) continue;
    const left = result.split(/\s+/), right = text.split(/\s+/);
    let overlap = Math.min(left.length, right.length);
    while (overlap && left.slice(-overlap).join(' ').toLowerCase() !== right.slice(0, overlap).join(' ').toLowerCase()) overlap--;
    result += (overlap === right.length ? '' : ' ' + right.slice(overlap).join(' '));
  }
  return result;
}

class PendingUtterance {
  constructor() { this.seen = new Set(); }
  accept(metadata = {}) {
    const id = metadata.utteranceId;
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
    return true;
  }
  createId() { return randomUUID(); }
  merge(fragments) { return mergeFragments(fragments); }
}
module.exports = { PendingUtterance, mergeFragments };
