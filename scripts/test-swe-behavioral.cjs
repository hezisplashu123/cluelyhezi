const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { ResumeContext } = require('../src/core/resume-context');
const { ConversationContext } = require('../src/services/conversation-context.service');
const store = require('../src/services/conversation-store.service');
const modes = require('../src/services/assistant-mode.service');
const catalog = require('./fixtures/swe-behavioral-questions.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'openclue-swe-unit-'));
  store.initialize(root); modes.initialize(store);
  return { root, close() { store.close(); fs.rmSync(root,{recursive:true,force:true}); } };
}

test('SWE evaluation catalog covers all requested competencies without classifying runtime questions', () => {
  assert.equal(catalog.length,20); assert.equal(new Set(catalog.map(c=>c.id)).size,20);
  for (const id of ['conflict','failure','feedback','ambiguity','tradeoff','motivation','introduction','reflection']) assert.ok(catalog.some(c=>c.id===id));
});

test('every evaluation question uses shared instructions, truthful resume context and the requested model', () => {
  const f=fixture();
  try {
    const file=path.join(f.root,'resume.txt'); fs.writeFileSync(file,'Student at Example University. Led DemoLab mentoring. Built an API; latency reduced 28%.');
    const resume=new ResumeContext({getPath:()=>file});
    const context=new ConversationContext(store,{resume}); modes.set('behavioral_star');
    for (const entry of catalog) {
      const turn=store.createTurn({source:'speech',content:entry.question});
      const request=context.build(turn);
      assert.equal(request.model,'gpt-6.1-sol'); assert.equal(request.reasoning.effort,'medium');
      assert.equal(request.resumeLoaded,true); assert.match(request.instructions,/Software Engineering Intern/);
      assert.match(request.instructions,/28%/); assert.match(request.instructions,/450-650/);
      assert.match(request.instructions,/usually in 2-5 focused sentences/);
      assert.match(request.instructions,/without literal STAR labels/);
      assert.match(request.instructions,/Never ask the user a clarification/);
      assert.match(request.instructions,/prioritize MuMix/);
      assert.match(request.instructions,/Practice draft - incident details are illustrative/);
      assert.match(request.instructions,/Do not turn a successful accomplishment into an invented failure or conflict/);
      assert.match(request.instructions,/current saved resume takes priority/i);
      assert.equal(request.input.at(-1).content[0].text,entry.question);
    }
    modes.set('normal');
    const normal=context.build(store.createTurn({source:'chat',content:'What is an API?'}));
    assert.equal(normal.reasoning.effort,'low'); assert.equal(normal.model,'gpt-6-luna');
    assert.match(normal.instructions,/Always answer the current question rather than asking/);
    assert.doesNotMatch(normal.instructions,/prioritize MuMix/);
    assert.doesNotMatch(normal.instructions,/450-650|QUESTION AND EXPERIENCE SELECTION|Software Engineering Intern/);
  } finally {f.close();}
});

test('missing resume exposes a safe status and limits personalization; saved resume changes invalidate its snapshot', () => {
  const f=fixture();
  try {
    const file=path.join(f.root,'resume.txt'); const resume=new ResumeContext({getPath:()=>file});
    modes.set('behavioral_star'); const context=new ConversationContext(store,{resume});
    const turn=store.createTurn({source:'chat',content:'Describe a disagreement I had.'});
    const missing=context.build(turn); assert.equal(missing.resumeLoaded,false);
    assert.match(missing.instructions,/personalization is limited/); assert.match(missing.instructions,/Never request more details/); assert.equal(resume.getPublicStatus().path,undefined);
    fs.writeFileSync(file,'OldProject: API implementation.');
    const old=context.build(turn);
    fs.writeFileSync(file,'CurrentProject: on-device caching and swipe-feedback ranking.');
    const current=context.build(turn);
    assert.notEqual(old.resumeSourceHash,current.resumeSourceHash);
    assert.match(current.instructions,/CurrentProject/); assert.doesNotMatch(current.instructions,/OldProject/);
    assert.equal(resume.getStatus().message,'Resume context loaded');
  } finally {f.close();}
});

test('in-flight requests retain a prompt/resume hash; unavailable model errors are actionable and never substitute a model', async () => {
  const f=fixture(); const llm=require('../src/services/llm.service');
  const originalClient=llm.client, originalInitialized=llm.isInitialized, originalPath=process.env.RESUME_CONTEXT_PATH;
  try {
    const file=path.join(f.root,'resume.txt');fs.writeFileSync(file,'ActualCandidate: DemoLab; improved test coverage by 30%.');process.env.RESUME_CONTEXT_PATH=file;
    modes.set('behavioral_star'); llm.isInitialized=true; let captured;
    llm.client={responses:{create:async function* (request) {
      captured=request;
      fs.writeFileSync(file,'UpdatedCandidate: NewProject only.');modes.set('normal');
      yield {type:'response.output_text.delta',delta:'A grounded draft.'};yield {type:'response.completed'};
    }}};
    const turn=store.createTurn({source:'chat',content:'Tell me about my testing work.'});
    const result=await llm.processConversation(turn);
    assert.equal(captured.resumeLoaded,undefined);assert.equal(captured.resumeSourceHash,undefined);
    assert.match(captured.instructions,/ActualCandidate/);assert.doesNotMatch(captured.instructions,/UpdatedCandidate/);
    assert.equal(result.metadata.model,'gpt-6.1-sol');assert.equal(result.metadata.reasoningEffort,'medium');
    assert.equal(result.metadata.instructionsHash,crypto.createHash('sha256').update(captured.instructions).digest('hex'));
    assert.equal(result.metadata.resumeLoaded,true);assert.equal(JSON.stringify(result.metadata).includes('ActualCandidate'),false);
    modes.set('behavioral_star');let calls=0;
    llm.client.responses.create=async()=>{calls++;throw Object.assign(new Error('Model not found or no access'),{status:404});};
    const failed=store.createTurn({source:'chat',content:'Another question'});
    await assert.rejects(llm.processConversation(failed),/gpt-6.1-sol with medium reasoning.*Check model access.*No model was substituted/);
    assert.equal(calls,1);assert.match(store.getMessage(failed.assistant.id).metadata.providerError,/No model was substituted/);
  } finally {
    llm.client=originalClient;llm.isInitialized=originalInitialized;
    if(originalPath===undefined)delete process.env.RESUME_CONTEXT_PATH;else process.env.RESUME_CONTEXT_PATH=originalPath;
    require('../src/core/resume-context').resumeContext.clearCache();f.close();
  }
});
