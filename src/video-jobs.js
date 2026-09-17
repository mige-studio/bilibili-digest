import {VOICE_SETTINGS,MAX_VIDEO_SECONDS,currentTranscript,videoEligible,validateTranscript,transcriptBody} from './video.js';
import {voiceRequest,RESOURCE} from './voice.js';
import {PREFIX,normalizeCapture,noteId,mergeCapture,hash} from './core.js';
const PROTOCOL='bili-whole-1',ALARM='bilid-video-jobs';
export function createVideoJobs({getItem,putItem,atomic}){
 let creating;
 const active=j=>j&&!['done','failed'].includes(j.state);
 const alarm=()=>chrome.alarms.create(ALARM,{periodInMinutes:1});
 async function audioState(){
  if(!creating)creating=(async()=>{
   const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('src/offscreen.html')]});
   if(!contexts.length)await chrome.offscreen.createDocument({url:'src/offscreen.html',reasons:['BLOBS'],justification:'提取和压缩当前视频的完整音轨，用于文字、时间点与说话人识别。'});
  })().finally(()=>{creating=null;});
  await creating;
  const state=await chrome.runtime.sendMessage({target:'bili-audio',type:'AUDIO_STATE'});
  if(!state?.ok||state.protocol!==PROTOCOL)throw new Error('音轨处理模块尚未正确加载，请重新加载B站精读。');
  return state;
 }
 async function start(message){
  let item=await getItem(message.id);if(!item||item.kind!=='video')throw new Error('请先读取当前视频。');
  if(active(item.voiceJob))return query(item.id);
  if(currentTranscript(item)&&!message.replace)return {item};
  const settings=(await chrome.storage.local.get(VOICE_SETTINGS))[VOICE_SETTINGS];
  if(!settings?.apiKey)throw new Error('请在设置中保存火山语音 API Key。');
  if(!await chrome.permissions.contains({origins:['https://openspeech.bytedance.com/*','https://*.bilivideo.com/*','https://*.bilivideo.cn/*']}))throw new Error('请在设置中允许读取 B 站音轨并连接火山语音。');
  if(noteId((await chrome.tabs.get(message.tabId)).url)!==item.id)throw new Error('内容已切换，未提交转写。');
  const captured=await chrome.tabs.sendMessage(message.tabId,{type:'BILI_CAPTURE'}),fresh=captured?.ok?normalizeCapture(captured.data):null;
  if(fresh?.id!==item.id||fresh.video?.key!==item.video?.key||Math.abs(fresh.video.duration-item.video.duration)>1)throw new Error('视频来源已变化，请重新读取。');
  if(!videoEligible(fresh.video))throw new Error('请等待视频时长及音轨就绪；整场识别支持五小时以内的视频。');
  const state=await audioState();if(state.active)throw new Error('另一条视频正在准备或上传音轨，请等它完成。');
  // Referrer is restricted to this extension and current platform's public CDN.
  const action={type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://www.bilibili.com/'},{header:'Origin',operation:'remove'}]};
  const condition=domain=>({urlFilter:`||${domain}/`,initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest'],requestMethods:['get']});
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1,2],addRules:[{id:1,priority:1,action,condition:condition('bilivideo.com')},{id:2,priority:1,action,condition:condition('bilivideo.cn')}]});
  let job,isNew=false;
  await atomic(async()=>{
   const latest=await getItem(item.id);if(latest?.video?.key!==fresh.video.key)throw new Error('视频已变化，未提交转写。');
   if(active(latest.voiceJob)){job=latest.voiceJob;item=latest;return;}
   const all=await chrome.storage.local.get(null);
   if(Object.entries(all).some(([key,v])=>key.startsWith(PREFIX)&&active(v?.voiceJob)&&['download','prepare','upload'].includes(v.voiceJob.phase)))throw new Error('另一条音轨还在处理中，请先查询它的进度。');
   job={jobId:crypto.randomUUID(),mediaKey:fresh.video.key,duration:fresh.video.duration,resourceId:RESOURCE,transport:'whole',state:'preparing',phase:'download',startedAt:Date.now(),heartbeatAt:Date.now(),lastQuery:0,replace:!!message.replace};
   latest.video=fresh.video;latest.voiceJob=job;await putItem(latest);item=latest;isNew=true;
  });
  if(!isNew)return {item};await alarm();
  try{
   const response=await chrome.runtime.sendMessage({target:'bili-audio',type:'AUDIO_START',protocol:PROTOCOL,id:item.id,jobId:job.jobId,mediaUrl:fresh.video.url,apiKey:settings.apiKey});
   if(!response?.ok)throw new Error(response?.error||'音轨准备未启动。');
  }catch{
   // A lost message reply may have started preparation. Query its state rather than start twice.
   await atomic(async()=>{const latest=await getItem(item.id);if(latest.voiceJob?.jobId===job.jobId){latest.voiceJob.error='音轨准备状态尚未确认，请查询原任务。';await putItem(latest);}});
  }
  return {item:await getItem(item.id)};
 }
 async function audioMessage(message){
  if(message.type==='AUDIO_PREFLIGHT'){if(message.protocol!==PROTOCOL)throw new Error('音轨模块不一致。');return {protocol:PROTOCOL};}
  return atomic(async()=>{
   const item=await getItem(message.id),job=item?.voiceJob;
   if(!job||job.transport!=='whole'||job.jobId!==message.jobId||job.mediaKey!==item.video?.key||!active(job))throw new Error('视频任务已变化，未继续上传。');
   job.heartbeatAt=Date.now();
   if(message.type==='AUDIO_PROGRESS'&&!job.submitStarted){
    job.phase=message.phase==='prepare'?'prepare':'download';
    for(const key of ['downloaded','totalBytes','processed'])if(Number.isFinite(message[key])&&message[key]>=0)job[key]=message[key];
   }else if(message.type==='AUDIO_PREPARED'){
    if(job.submitStarted||message.resourceId!==job.resourceId)throw new Error('任务已提交或服务不一致，不能重复提交。');
    if(!Number.isFinite(message.offset)||Math.abs(message.offset)>1||!Number.isFinite(message.duration)||message.duration<=0||message.duration>MAX_VIDEO_SECONDS||Math.abs(message.offset+message.duration-job.duration)>2||!Number.isInteger(message.bytes)||message.bytes<=0||message.bytes>450000000)throw new Error('完整音轨时长或大小与视频不一致，未提交转写。');
    Object.assign(job,{submitStarted:Date.now(),state:'submitting',phase:'upload',audioDuration:message.duration,audioOffset:message.offset});
   }else if(message.type==='AUDIO_SUBMITTED'){
    if(!job.submitStarted)throw new Error('转写提交状态不一致。');
    Object.assign(job,{submitFinished:true,state:message.rejected?'failed':message.uncertain?'uncertain':'pending',phase:message.rejected?'failed':'recognize',error:message.error||'',lastQuery:0});
   }else if(message.type==='AUDIO_FAILED'){
    const uncertain=!!job.submitStarted&&message.uncertain;
    Object.assign(job,{state:uncertain?'uncertain':'failed',phase:uncertain?'recognize':'failed',error:message.error||'音轨准备未完成。'});
   }else if(message.type!=='AUDIO_HEARTBEAT')throw new Error('音轨进度与当前阶段不一致。');
   await putItem(item);return {};
  });
 }
 async function query(id){
  let item=await getItem(id),job=item?.voiceJob;if(!item||!active(job)||job.mediaKey!==item.video?.key)return {item};
  if(job.transport==='whole'&&(!job.submitStarted||job.phase==='upload'&&!job.submitFinished)){
   if(Date.now()-(job.heartbeatAt||job.startedAt)<90000)return {item};
   if(!job.submitStarted){
    await atomic(async()=>{const latest=await getItem(id);if(latest?.voiceJob?.jobId===job.jobId&&!latest.voiceJob.submitStarted){latest.voiceJob={...latest.voiceJob,state:'failed',phase:'failed',error:'音轨准备已中断，尚未提交收费转写；可重新读取后重试。'};await putItem(latest);}});return {item:await getItem(id)};
   }
  }
  const settings=(await chrome.storage.local.get(VOICE_SETTINGS))[VOICE_SETTINGS];
  if(!settings?.apiKey)throw new Error('请在设置中保存火山语音 API Key 后查询原任务。');
  if(!await chrome.permissions.contains({origins:['https://openspeech.bytedance.com/*']}))throw new Error('请在设置中允许连接火山语音。');
  const claimed=await atomic(async()=>{
   const latest=await getItem(id);if(latest?.voiceJob?.jobId!==job.jobId||!active(latest.voiceJob)||Date.now()-(latest.voiceJob.lastQuery||0)<10000)return false;
   latest.voiceJob.lastQuery=Date.now();await putItem(latest);job=latest.voiceJob;return true;
  });if(!claimed)return {item:await getItem(id)};
  let result,failure;try{result=await voiceRequest('query',settings.apiKey,job,null);}catch(e){failure=e;}
  return atomic(async()=>{
   const latest=await getItem(id);if(latest?.voiceJob?.jobId!==job.jobId||latest.video?.key!==job.mediaKey||!active(latest.voiceJob))return {item:latest};
   if(failure){latest.voiceJob.state=failure.terminal?'failed':'uncertain';latest.voiceJob.phase=failure.terminal?'failed':'recognize';latest.voiceJob.error=failure.message;}
   else if(result.pending){latest.voiceJob.state='pending';latest.voiceJob.phase='recognize';delete latest.voiceJob.error;}
   else try{
    const duration=job.audioDuration??job.duration;
    if(!Number.isFinite(result.duration)||Math.abs(result.duration-duration)>2)throw new Error('返回音轨长度与整场视频不一致，原稿和笔记已保留。');
    const speakerIds=new Map();
    const rows=validateTranscript(result.rows,duration).map(r=>{if(r.speaker&&!speakerIds.has(r.speaker))speakerIds.set(r.speaker,String(speakerIds.size+1));return r;}).map(r=>({...r,...(job.transport==='whole'&&r.speaker?{speaker:speakerIds.get(r.speaker)}:{}),start:Math.max(0,r.start+(job.audioOffset||0)),end:Math.min(job.duration,r.end+(job.audioOffset||0))}));
    const transcript={mediaKey:job.mediaKey,duration:job.duration,rows,generatedAt:new Date().toISOString(),provider:'火山语音 2.0',jobId:job.jobId};
    const body=transcriptBody(latest.caption??'',transcript),bodyHash=await hash(body);
    const updated=mergeCapture(latest,{...latest,transcript,body},bodyHash);
    if(latest.transcript?.jobId!==job.jobId){
     if(latest.transcript&&latest.bodyHash===bodyHash)updated.revisions=[...updated.revisions,{body:latest.body,bodyHash:latest.bodyHash,caption:latest.caption,transcript:latest.transcript,speakerNames:latest.speakerNames,overview:latest.overviews[bodyHash],capturedAt:latest.capturedAt}];
     updated.overviews={...latest.overviews};delete updated.overviews[bodyHash];
     updated.notes=latest.notes.map(n=>({...n,speakerNames:n.speakerNames||{...latest.speakerNames}}));updated.speakerNames={};}
    updated.voiceJob={...latest.voiceJob,state:'done',phase:'done',error:''};await putItem(updated);return {item:updated};
   }catch(e){latest.voiceJob.state='failed';latest.voiceJob.phase='failed';latest.voiceJob.error=e.message;}
   await putItem(latest);return {item:latest};
  });
 }
 async function tick(){
  const all=await chrome.storage.local.get(null),items=Object.entries(all).filter(([k,v])=>k.startsWith(PREFIX)&&active(v?.voiceJob));
  for(const [,item]of items)await query(item.id).catch(()=>{});
  if(!items.length)await chrome.alarms.clear(ALARM);
 }
 function install(){
  chrome.alarms?.onAlarm.addListener(a=>{if(a.name===ALARM)void tick();});
  chrome.runtime.onStartup?.addListener(()=>void alarm().then(tick));
  chrome.runtime.onInstalled?.addListener(()=>void alarm().then(tick));
 }
 return {start,query,audioMessage,install,ALARM};
}
