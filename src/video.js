// Platform-specific media identity and source-bound transcript ranges.
export const MAX_VIDEO_SECONDS=18000;
export const VOICE_SETTINGS='bilid_voice_settings';
export function mediaUrl(value){
 try{const u=new URL(value);const host=u.hostname.toLowerCase();if(u.protocol!=='https:'||(!host.endsWith('.bilivideo.com')&&!host.endsWith('.bilivideo.cn'))||u.username||u.password)return null;u.hash='';return u.href;}catch{return null;}
}
export function normalizeVideo(raw){
 if(!raw)return null;
 const url=mediaUrl(raw.url),duration=Number(raw.duration);
 const mediaId=typeof raw.mediaId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(raw.mediaId)?raw.mediaId:null;
 const aliases=[...new Set([url,...(Array.isArray(raw.sourceUrls)?raw.sourceUrls.slice(0,50):[])].map(mediaUrl).filter(Boolean).map(u=>new URL(u).pathname))];
 const diagnostic=typeof raw.diagnostic==='string'&&/^[A-Za-z0-9_,: |]*$/.test(raw.diagnostic)?raw.diagnostic.slice(0,1500):'';
 return {...(diagnostic?{diagnostic}:{}),url,key:mediaId?'video:'+mediaId:url?new URL(url).pathname:null,aliases,...(mediaId?{mediaId}:{}),duration:Number.isFinite(duration)&&duration>0?duration:null,...(['bridge-missing','meta-missing','meta-mismatch','streams-missing','duration-mismatch','url-unsupported'].includes(raw.reason)?{reason:raw.reason}:{})};
}
export function videoEligible(video){return !!video?.url&&Number.isFinite(video.duration)&&video.duration>0&&video.duration<=MAX_VIDEO_SECONDS;}
export function sameVideoSource(key,video){return !!key&&(key===video?.key||video?.aliases?.includes(key));}
export function currentTranscript(item){const t=item?.transcript,v=item?.video;return t&&v?.key&&sameVideoSource(t.mediaKey,v)&&Math.abs(t.duration-v.duration)<1?t:null;}
export function validateTranscript(rows,duration){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw new Error('未取得带时间点的逐字稿。');
 let previous=-1;
 return rows.map(r=>{
  const start=r.start_time/1000,end=r.end_time/1000;
  if(typeof r.text!=='string'||!r.text.trim()||r.text.length>10000||!Number.isFinite(start)||!Number.isFinite(end)||start<0||start<previous||end<=start||end>duration+1)throw new Error('转写时间或文字不完整，未覆盖已有结果。');
  previous=start;const speaker=String(r.additions?.speaker??'');
  return {text:r.text.trim(),start,end,...(/^\d{1,3}$/.test(speaker)?{speaker}:{})};
 });
}
export function transcriptBody(caption,transcript){return transcript?caption+'\n\n【视频逐字稿】\n'+transcript.rows.map(r=>r.text).join('\n'):caption;}
export function transcriptRanges(item){
 const t=currentTranscript(item);if(!t)return [];
 let at=(item.caption??'').length+'\n\n【视频逐字稿】\n'.length;
 return t.rows.map((r,index)=>{const result={...r,index,offset:at,length:r.text.length};at+=r.text.length+1;return result;});
}
export function quoteTimes(item,start,length){return transcriptRanges(item).filter(r=>start<r.offset+r.length&&start+length>r.offset).map(r=>({start:r.start,end:r.end,speaker:r.speaker}));}
export function clockTime(n){if(!Number.isFinite(n))return '时长未确认';const t=Math.floor(n);return Math.floor(t/60)+':'+String(t%60).padStart(2,'0');}
export function videoMarkdown(item){const t=currentTranscript(item);return t?t.rows.map(r=>'['+clockTime(r.start)+'] '+(r.speaker?(item.speakerNames?.[r.speaker]||'说话人 '+r.speaker)+'：':'')+r.text).join('\n\n'):'';}

export function videoTimeLink(item,time){const u=new URL(item.url);u.searchParams.set('t',String(Math.max(0,Math.floor(time))));return u.href;}
