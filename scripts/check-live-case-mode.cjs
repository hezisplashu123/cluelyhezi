// Optional paid API smoke checks. Every case and image is synthetic, not an actual interview question.
require('dotenv').config({quiet:true});
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const sharp=require('sharp');
const store=require('../src/services/conversation-store.service');
const modes=require('../src/services/assistant-mode.service');
const llm=require('../src/services/llm.service');

async function main() {
  if(!llm.isInitialized)throw new Error('Configure an OpenAI API key before running live Case checks.');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'openclue-live-case-'));const results=[];
  async function ask(id,content,{conversationId=store.createConversation().id,image=null}={}) {
    const turn=store.createTurn({conversationId,source:image?'screenshot':'chat',content});
    if(image)store.addAttachments(turn.user.id,[{imageBuffer:image,mimeType:'image/png'}]);
    const result=await llm.processConversation(turn,{skill:'dsa',programmingLanguage:'java'});
    store.completeAssistant(turn.assistant.id,result.response,result.metadata);
    assert.equal(result.metadata.model,'gpt-6.1-sol');assert.equal(result.metadata.reasoningEffort,'medium');
    assert.equal(result.metadata.mode,'case_interview');assert.equal(result.metadata.resumeLoaded,false);
    assert.doesNotMatch(result.response,/Situation:|Task:|Action:|Result:|MuMix|Forge Labs|Prod AI/);
    assert.doesNotMatch(result.response,/\?/,'Give an answer, not a clarification question');
    assert.doesNotMatch(result.response,/\\(?:frac|text|boxed|left|right|\[|\()/,'Case math should be readable without a LaTeX renderer');
    results.push({id,question:content,...result});console.log(`CASE ${id}: ${result.metadata.processingTime} ms`);
    return {answer:result.response,conversationId};
  }
  try {
    store.initialize(root);modes.initialize(store);modes.set('case_interview');
    await Promise.all([
      (async()=>{
        const first=await ask('break-even','A hypothetical service has a one-time fixed cost of $10000, charges $8 per user for the period, and costs $3 per user for the same period. How many whole users break even? Show the formula and recommendation briefly.');
        assert.match(first.answer,/2,?000/);
        const next=await ask('updated-cost','For that same case, fixed cost becomes $12000 and variable cost becomes $4 per user; price stays $8. Recalculate break-even.',{conversationId:first.conversationId});
        assert.match(next.answer,/3,?000/);
      })(),
      (async()=>{
        const result=await ask('annual-units','For a hypothetical product, launch costs $20000 once and operations cost $5000 each month. Net contribution is $2 per customer per month. How many whole customers, each present for all 12 months, cover the entire first-year cost? Show units.');
        assert.match(result.answer,/3,?334/);
      })(),
      (async()=>{
        const result=await ask('code-trace','In Java, values is {2,4,6}. Code: int total=0; for(int i=0;i<values.length-1;i++){total+=values[i];} System.out.println(total); What is printed, what is the bug if the goal is to sum all entries, and what is the minimal fix? Keep it brief.');
        assert.match(result.answer,/\b6\b/);assert.match(result.answer,/\b12\b/);assert.match(result.answer,/length|bound/i);
      })(),
      (async()=>{
        const result=await ask('payment-retry','In a hypothetical payments app, a customer retries a transfer after an HTTP timeout. Recommend a design that avoids duplicate transfers under concurrent retries, explain the tradeoff, and name a test. Do not assume any specific Capital One implementation.');
        assert.match(result.answer,/idempot|unique/i);assert.match(result.answer,/atomic|transaction|unique|constraint/i);
      })(),
      (async()=>{
        const result=await ask('missing-data','For a hypothetical banking app, recommend push notifications or SMS for transaction alerts. No costs, adoption numbers, or delivery rates have been supplied. Give a useful conditional recommendation and success metrics.');
        assert.match(result.answer,/assum|if|pilot|would/i);assert.match(result.answer,/push|SMS/i);
      })(),
      (async()=>{
        const image=await sharp(Buffer.from('<svg width="800" height="250"><rect width="800" height="250" fill="white"/><text x="20" y="45" font-size="26" fill="black">Hypothetical options (equal accuracy)</text><text x="20" y="110" font-size="28" fill="black">Option A: p95 120 ms, monthly cost $1000</text><text x="20" y="175" font-size="28" fill="black">Option B: p95 80 ms, monthly cost $2000</text></svg>')).png().toBuffer();
        const first=await ask('image-options','Read this table. We require p95 latency strictly below 100 ms and a monthly budget of at most $2000. Which option qualifies? Explain briefly.',{image});
        assert.match(first.answer,/Option B|\bB\b/);assert.match(first.answer,/80/);
        const next=await ask('image-followup','Using the previous image, the monthly budget falls to $1500 while p95 below 100 ms remains mandatory. Which listed option now satisfies both requirements?',{conversationId:first.conversationId});
        assert.match(next.answer,/neither|none|no (?:listed )?option|not.*satisf|not.*meet/i);
      })()
    ]);
    fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/case-mode-live-checks.json',JSON.stringify(results,null,2));
    console.log('LIVE_CASE_PASS',JSON.stringify({requests:results.length,model:'gpt-6.1-sol',reasoning:'medium',meanMs:Math.round(results.reduce((sum,r)=>sum+r.metadata.processingTime,0)/results.length)}));
  } finally {store.close();fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error('LIVE_CASE_FAILED',error.message);process.exitCode=1;});
