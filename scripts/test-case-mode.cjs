const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const store = require('../src/services/conversation-store.service');
const modes = require('../src/services/assistant-mode.service');
const { ConversationContext } = require('../src/services/conversation-context.service');
const events = require('../src/services/conversation-events.service');
const actions = require('../src/services/action-controller.service');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'openclue-case-mode-'));
  store.initialize(root); modes.initialize(store);
  return { root, close() { store.close(); fs.rmSync(root,{recursive:true,force:true}); } };
}

test('Case uses Sol medium with a dedicated prompt and persists without resetting history', () => {
  const f=fixture();
  try {
    const turn=store.createTurn({source:'chat',content:'Analyze a feature rollout.'});
    store.completeAssistant(turn.assistant.id,'Existing answer.');
    const selected=modes.set('case_interview');
    assert.equal(selected.model,'gpt-6.1-sol'); assert.equal(selected.reasoningEffort,'medium');
    assert.equal(selected.starEnabled,false); assert.equal(selected.caseEnabled,true);
    const request=new ConversationContext(store).build(turn,{skill:'dsa'});
    assert.match(request.instructions,/Technology Internship Program/);
    assert.match(request.instructions,/QUANTITATIVE QUESTIONS/);
    assert.match(request.instructions,/TECHNICAL AND CODE-BASED CASES/);
    assert.match(request.instructions,/250-450 words/);
    assert.doesNotMatch(request.instructions,/Experience preference:|SPEAKING-PRACTICE DELIVERY|Output code ONLY/);
    store.createConversation(); assert.equal(modes.snapshot().mode,'case_interview');
    store.close();store.initialize(f.root);modes.initialize(store);
    assert.equal(modes.snapshot().mode,'case_interview'); assert.equal(store.getMessage(turn.assistant.id).content,'Existing answer.');
    modes.set('normal'); assert.equal(modes.snapshot().model,'gpt-6-luna');
    assert.doesNotMatch(modes.instructions(modes.snapshot()),/Technology Internship Program/);
    modes.set('behavioral_star'); assert.match(modes.instructions(modes.snapshot()),/prioritize MuMix/);
    assert.doesNotMatch(modes.instructions(modes.snapshot()),/QUANTITATIVE QUESTIONS/);
  } finally {f.close();}
});

test('Case ignores resume and legacy DSA instructions, but retains case facts and selected coding language', () => {
  const f=fixture();
  try {
    const previous=store.createTurn({source:'chat',content:'Our hypothetical API has 2000 requests per second and 150 ms p95 latency.'});
    store.completeAssistant(previous.assistant.id,'Consider reducing sequential network calls.');
    modes.set('case_interview');
    const context=new ConversationContext(store,{resume:{ getModelContext() { throw new Error('Case should not load personal resume'); } }});
    const current=store.createTurn({source:'speech',content:'How would the recommendation change at 4000 requests per second?'});
    const request=context.build(current,{skill:'dsa',programmingLanguage:'java'});
    assert.equal(request.resumeLoaded,false);assert.equal(request.resumeSourceHash,null);
    assert.match(JSON.stringify(request.input),/2000 requests per second/);
    assert.match(request.instructions,/implementation is requested use java/);
    assert.doesNotMatch(request.instructions,/Candidate Resume Context|competitive programming expert/);
    assert.equal(request.input.filter(m=>m.content.some(p=>p.text===current.user.content)).length,1);
  } finally {f.close();}
});

test('all input sources use Case and actual streamed requests retain the initial model/prompt across a toggle', async () => {
  const f=fixture();const llm=require('../src/services/llm.service');
  const originalClient=llm.client, originalInitialized=llm.isInitialized;
  try {
    llm.isInitialized=true;modes.set('case_interview');const captured=[];
    llm.client={responses:{create:async function* (request) {
      captured.push(request);
      modes.set('behavioral_star');
      yield {type:'response.output_text.delta',delta:'The break-even volume is 2,000 users.'};yield {type:'response.completed'};
    }}};
    for(const source of ['chat','mobile_text','speech','screenshot','resend']) {
      modes.set('case_interview');
      const turn=store.createTurn({source,content:'Fixed cost is $10000 and contribution is $5 per user. Find break-even.'});
      if(source==='screenshot')store.addAttachments(turn.user.id,[{imageBuffer:Buffer.from('test-image-bytes'),mimeType:'image/png'}]);
      let deltas='';const answer=await llm.processConversation(turn,{skill:'dsa'},delta=>{deltas+=delta;});
      assert.equal(answer.metadata.mode,'case_interview');assert.equal(answer.metadata.model,'gpt-6.1-sol');
      assert.equal(answer.metadata.reasoningEffort,'medium');assert.equal(answer.response,deltas);
      store.completeAssistant(turn.assistant.id,answer.response,answer.metadata);
      const request=captured.at(-1);assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.reasoning.effort,'medium');
      assert.match(request.instructions,/Technology Internship Program/);assert.doesNotMatch(request.instructions,/Experience preference:/);
      assert.equal(store.getMessage(turn.assistant.id).metadata.mode,'case_interview');
      if(source==='screenshot')assert.equal(request.input.at(-1).content.filter(p=>p.type==='input_image').length,1);
    }
  } finally {llm.client=originalClient;llm.isInitialized=originalInitialized;f.close();}
});

test('existing mode action broadcasts authoritative Case state without changing the conversation', async () => {
  const f=fixture();
  try {
    const conversationId=store.currentConversationId;let published;
    const listener=event=>{if(event.type==='status.updated')published=event.payload.assistantMode;};events.on('event',listener);
    try {
      actions.configure({setMode:mode=>{const result=modes.set(mode);events.publish('status.updated',{assistantMode:result});return result;}});
      const result=await actions.execute('setMode',{mode:'case_interview'});
      assert.deepEqual(published,result);assert.equal(result.mode,'case_interview');
      assert.equal(store.currentConversationId,conversationId);
    } finally {events.off('event',listener);}
  } finally {f.close();}
});
