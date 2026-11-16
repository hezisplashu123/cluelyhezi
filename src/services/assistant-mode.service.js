const fs = require('fs');
const path = require('path');
const ASSISTANT_MODES = Object.freeze({
  normal: Object.freeze({ mode: 'normal', model: 'gpt-6-luna', reasoningEffort: 'low', starEnabled: false }),
  behavioral_star: Object.freeze({ mode: 'behavioral_star', model: 'gpt-6.1-sol', reasoningEffort: 'medium', starEnabled: true }),
  case_interview: Object.freeze({ mode: 'case_interview', model: 'gpt-6.1-sol', reasoningEffort: 'medium', starEnabled: false, caseEnabled: true })
});
class AssistantMode {
  initialize(store) { this.store = store; this.mode = ASSISTANT_MODES[store.getMeta('assistant_mode')] ? store.getMeta('assistant_mode') : 'normal'; }
  snapshot() { return Object.freeze({ ...ASSISTANT_MODES[this.mode || 'normal'] }); }
  set(mode) {
    if (!ASSISTANT_MODES[mode]) throw new Error('Unknown assistant mode.');
    this.mode = mode; this.store?.setMeta('assistant_mode', mode); return this.snapshot();
  }
  instructions(snapshot) {
    if (snapshot.mode === 'case_interview') return fs.readFileSync(path.join(__dirname, '../../prompts/capital-one-tech-case.md'), 'utf8');
    return snapshot.starEnabled ? fs.readFileSync(path.join(__dirname, '../../prompts/behavioral-star.md'), 'utf8') : 'Answer directly and conversationally. Be clear and concise, adding detail when needed. Do not force STAR formatting.';
  }
}
module.exports = new AssistantMode();
module.exports.ASSISTANT_MODES = ASSISTANT_MODES;
