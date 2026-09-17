// Shared whole-recording transport adapted from Douyin Digest (MIT).
import transport from './volc-transport.js';
export const RESOURCE='volc.seedasr.auc';
export const submitOutcome=transport.submitOutcome;
export async function voiceRequest(action,key,job,audio,fetcher=fetch){
 try{
  const result=await transport.request(action,key,{...job,resourceId:job.resourceId||RESOURCE},audio,fetcher);
  if(result.pending)return result;
  return {rows:result.transcript.map(r=>({text:r.text,start_time:r.start*1000,end_time:(r.start+r.duration)*1000,additions:{speaker:r.localSpeaker}})),duration:result.durationMs/1000};
 }catch(error){
  const result=transport.submitOutcome(error);
  const safe=new Error(action==='submit'?result.error:error.serviceCode==='20000003'?'未识别到人声；原稿和笔记保留。':error.serviceCode?'语音服务未完成这次转写（'+error.serviceCode+'），请查询原任务。':'语音连接未完成，请查询原任务。');
  Object.assign(safe,result,{missing:error.taskNotFound===true,serviceCode:error.serviceCode,terminal:['20000003','45000151'].includes(error.serviceCode)});
  throw safe;
 }
}
