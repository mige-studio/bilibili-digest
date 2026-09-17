// Whole-recording path adapted from Douyin Digest 0.2.2 (MIT).
import {wholeAudio} from './audio-whole.mjs';
import {compactRecording} from './audio-compact.mjs';
import {voiceRequest,RESOURCE} from './voice.js';
import {mediaUrl} from './video.js';
const PROTOCOL='bili-whole-1';let active=null;
async function tell(type,data={}){
 const response=await chrome.runtime.sendMessage({type,...data});
 if(!response?.ok)throw new Error(response?.error||'无法保存处理进度。');return response;
}
async function run(message){
 const {id,jobId}=message;const tag={id,jobId};let stage='download';
 const heartbeat=setInterval(()=>tell('AUDIO_HEARTBEAT',tag).catch(()=>{}),20000);
 try{
  const url=mediaUrl(message.mediaUrl);if(!url)throw new Error('当前音频来源不可读取。');
  const response=await fetch(url,{headers:{Range:'bytes=0-'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(4*60*60*1000)});
  if(!response.ok||!response.body)throw new Error('音频下载失败（'+response.status+'），请重新读取视频后再试。');
  const reader=response.body.getReader();let downloaded=0,lastProgress=0;const totalBytes=Number(response.headers.get('Content-Length'))||0;
  async function* stream(){try{while(true){const next=await reader.read();if(next.done)break;downloaded+=next.value.length;
   if(Date.now()-lastProgress>1500){lastProgress=Date.now();await tell('AUDIO_PROGRESS',{...tag,phase:'download',downloaded,totalBytes});}
   yield next.value;
  }}finally{await reader.cancel().catch(()=>{});}}
  let audio=await wholeAudio(stream());
  if(audio.buffer.size>16000000){
   stage='prepare';let last=0;
   audio=await compactRecording(audio,async(processed,total)=>{if(Date.now()-last>1500){last=Date.now();await tell('AUDIO_PROGRESS',{...tag,phase:'prepare',processed,total});}});
  }
  await tell('AUDIO_PREPARED',{...tag,resourceId:RESOURCE,offset:audio.offset,duration:audio.duration,bytes:audio.buffer.size});
  stage='upload';let outcome={rejected:false,uncertain:false,submissionAccepted:true};
  try{await voiceRequest('submit',message.apiKey,{jobId,resourceId:RESOURCE,whole:true},audio.buffer);}catch(e){outcome={rejected:e.rejected===true,uncertain:e.uncertain===true,notSubmitted:e.notSubmitted===true,error:e.message};}
  await tell('AUDIO_SUBMITTED',{...tag,...outcome});
 }catch(e){
  const safe=/^(音频|音轨|当前|无法|没有|整期|压缩|浏览器|未取得)/.test(e.message||'')?e.message:'音轨处理未完成，已有资料保留。';
  await tell('AUDIO_FAILED',{...tag,error:safe,uncertain:stage==='upload'}).catch(()=>{});
 }finally{clearInterval(heartbeat);active=null;message.apiKey='';message.mediaUrl='';}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('src/background.js')||message.target!=='bili-audio')return false;
 if(message.type==='AUDIO_STATE'){
  tell('AUDIO_PREFLIGHT',{protocol:PROTOCOL}).then(()=>reply({ok:true,protocol:PROTOCOL,active})).catch(()=>reply({ok:false,error:'音轨处理模块未正确连接，请重新加载B站精读。'}));return true;
 }
 if(message.type!=='AUDIO_START')return false;
 if(message.protocol!==PROTOCOL||!mediaUrl(message.mediaUrl)||!message.apiKey){reply({ok:false,error:'音轨模块或来源不一致，未开始转写。'});return false;}
 if(active){reply({ok:false,error:'另一条视频正在准备音轨，请等它完成。'});return false;}
 active={id:message.id,jobId:message.jobId};reply({ok:true});void run(message);return false;
});
