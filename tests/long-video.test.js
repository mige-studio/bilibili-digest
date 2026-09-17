import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoJobs} from '../src/video-jobs.js';
import {normalizeCapture,mergeCapture,hash,makeNote,exportNotes} from '../src/core.js';
import {transcriptRanges,validateTranscript} from '../src/video.js';

const id='BV1MA4y1R7J1-p1';
const url='https://www.bilibili.com/video/BV1MA4y1R7J1/?p=1';
const media='https://xy.mcdn.bilivideo.cn:8082/long.m4s';

async function setup(duration=12878){
  const state={},sent=[],alarms=[];let queue=Promise.resolve();
  const capture={id,url,bvid:'BV1MA4y1R7J1',cid:'739618564',p:1,title:'模拟长对话',author:'测试',kind:'video',body:'作者简介',video:{url:media,mediaId:'BV1MA4y1R7J1-739618564',duration}};
  const input=normalizeCapture(capture);state['bilid_item_'+id]=mergeCapture(null,input,await hash(input.body));state.bilid_voice_settings={apiKey:'placeholder-not-real'};
  const getItem=async key=>structuredClone(state['bilid_item_'+key]);
  const putItem=async item=>{state['bilid_item_'+item.id]=structuredClone(item);};
  const atomic=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  globalThis.chrome={
    storage:{local:{get:async key=>structuredClone(key===null?state:{[key]:state[key]})}},
    permissions:{contains:async()=>true},tabs:{get:async()=>({url}),sendMessage:async()=>({ok:true,data:capture})},
    runtime:{id:'unit',getURL:p=>'chrome-extension://unit/'+p,getContexts:async()=>[],sendMessage:async message=>{sent.push(message);return message.type==='AUDIO_STATE'?{ok:true,protocol:'bili-whole-1',active:null}:{ok:true};}},
    offscreen:{createDocument:async()=>{}},alarms:{create:async(name,o)=>alarms.push({name,...o}),clear:async()=>{}},declarativeNetRequest:{updateSessionRules:async()=>{}}
  };
  const jobs=createVideoJobs({getItem,putItem,atomic});return {jobs,state,sent,alarms,getItem,putItem};
}

async function prepared(h){
  const item=await h.getItem(id),j=item.voiceJob;
  await h.jobs.audioMessage({type:'AUDIO_PREPARED',id,jobId:j.jobId,resourceId:j.resourceId,offset:0,duration:j.duration,bytes:12000000});
  return j;
}

test('超长当前分 P 只创建一次整轨任务，且不将 Key 写入资料',async()=>{
  const h=await setup();const results=await Promise.all([h.jobs.start({id,tabId:1}),h.jobs.start({id,tabId:1})]);
  assert.ok(results.every(r=>r.item.voiceJob.transport==='whole'));assert.equal(h.sent.filter(m=>m.type==='AUDIO_START').length,1);assert.ok(h.alarms.length);
  assert.ok(!JSON.stringify(await h.getItem(id)).includes('placeholder-not-real'));
});

test('万句回稿保留跨小时时间与说话人，只查询原任务',async()=>{
  const h=await setup();await h.jobs.start({id,tabId:1});const j=await prepared(h);
  await h.jobs.audioMessage({type:'AUDIO_SUBMITTED',id,jobId:j.jobId,uncertain:true,error:'网络响应丢失'});
  const original=globalThis.fetch;let queries=0;
  const rows=Array.from({length:10000},(_,i)=>({text:'测试原话 '+i,start_time:i*1200,end_time:i*1200+1000,additions:{speaker:i%2}}));
  globalThis.fetch=async(endpoint,options)=>{assert.ok(endpoint.endsWith('/query'));assert.equal(options.headers['X-Api-Request-Id'],j.jobId);queries++;return new Response(JSON.stringify({audio_info:{duration:j.duration*1000},result:{utterances:rows}}),{headers:{'X-Api-Status-Code':'20000000'}});};
  try{const r=await h.jobs.start({id,tabId:1});assert.equal(r.item.voiceJob.state,'done');assert.equal(r.item.transcript.rows.length,10000);assert.equal(r.item.transcript.rows.at(-1).start,11998.8);assert.equal(r.item.transcript.rows.at(-1).speaker,'2');assert.equal(queries,1);}finally{globalThis.fetch=original;}
});

test('时长不一致、重复提交或切换来源都不能覆盖当前任务',async()=>{
  const h=await setup();await h.jobs.start({id,tabId:1});let j=(await h.getItem(id)).voiceJob;
  await assert.rejects(h.jobs.audioMessage({type:'AUDIO_PREPARED',id,jobId:j.jobId,resourceId:j.resourceId,offset:0,duration:60,bytes:1000}),/时长/);
  j=await prepared(h);await assert.rejects(prepared(h),/不能重复提交/);
  const item=await h.getItem(id);item.video.key='video:changed';await h.putItem(item);
  await assert.rejects(h.jobs.audioMessage({type:'AUDIO_FAILED',id,jobId:j.jobId,error:'bad'}),/任务已变化/);
});

test('重新转写在新稿成功前保留旧稿和笔记',async()=>{
  const h=await setup(60);let item=await h.getItem(id);
  item.caption='作者简介';item.transcript={mediaKey:item.video.key,duration:60,jobId:'old',rows:[{text:'原有一句话',start:1,end:4,speaker:'1'}]};item.body='作者简介\n\n【视频逐字稿】\n原有一句话';item.bodyHash=await hash(item.body);item.speakerNames={'1':'甲'};item.notes.push(makeNote(item,'原有一句话',transcriptRanges(item)[0].offset));await h.putItem(item);
  await h.jobs.start({id,tabId:1,replace:true});assert.equal((await h.getItem(id)).transcript.jobId,'old');
  const j=await prepared(h);await h.jobs.audioMessage({type:'AUDIO_SUBMITTED',id,jobId:j.jobId});
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({audio_info:{duration:60000},result:{utterances:[{text:'另一句原话',start_time:5000,end_time:8000,additions:{speaker:1}}]}}),{headers:{'X-Api-Status-Code':'20000000'}});
  try{const r=await h.jobs.query(id);assert.equal(r.item.speakerNames['1'],undefined);assert.equal(r.item.notes[0].speakerNames['1'],'甲');assert.match(exportNotes(r.item),/甲/);assert.ok(r.item.revisions.some(x=>x.transcript?.jobId==='old'));}finally{globalThis.fetch=original;}
});

test('大结果不被两千句截断，仍拒绝倒序与假时长',()=>{
  const rows=Array.from({length:12000},(_,i)=>({text:'原句',start_time:i*1000,end_time:i*1000+800,additions:{speaker:i%3}}));assert.equal(validateTranscript(rows,12878).length,12000);
  assert.throws(()=>validateTranscript([...rows,{text:'错时',start_time:1,end_time:2}],12878));assert.throws(()=>validateTranscript(rows,60));
});
