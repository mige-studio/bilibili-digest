import {normalizeVideo,currentTranscript,quoteTimes,transcriptRanges,videoMarkdown,clockTime} from './video.js';

export const PREFIX='bilid_item_';
export const SETTINGS='bilid_settings';

export function videoRef(url){
  try{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.hostname!=='www.bilibili.com')return null;
    const match=u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{8,20})(?:\/|$)/);
    if(!match)return null;
    const p=Number(u.searchParams.get('p')||1);
    if(!Number.isInteger(p)||p<1||p>1000)return null;
    return {bvid:match[1],p,id:`${match[1]}-p${p}`};
  }catch{return null;}
}

export function noteId(url){return videoRef(url)?.id||null;}

export function sourceUrl(id){
  const match=String(id).match(/^(BV[0-9A-Za-z]{8,20})-p([1-9]\d{0,2})$/);
  if(!match)throw new Error('来源无效');
  return `https://www.bilibili.com/video/${match[1]}/?p=${match[2]}`;
}

export async function hash(text){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export function normalizeEngagement(raw){
  if(!raw||typeof raw!=='object')return null;
  const count=(...keys)=>{
    for(const key of keys)if(raw[key]!==undefined&&raw[key]!==null&&raw[key]!==''){
      const value=Number(raw[key]);
      if(Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)return Math.floor(value);
    }
    return null;
  };
  const result={
    views:count('views','view'),danmaku:count('danmaku'),comments:count('comments','reply'),
    likes:count('likes','like'),coins:count('coins','coin'),favorites:count('favorites','favorite'),shares:count('shares','share')
  };
  return Object.values(result).some(Number.isFinite)?result:null;
}

export function normalizeCapture(raw){
  const ref=videoRef(raw?.url),id=ref?.id;
  if(!raw||!id||id!==raw.id||raw.bvid!==ref.bvid||Number(raw.p)!==ref.p||!/^[1-9]\d{0,19}$/.test(String(raw.cid||''))||raw.kind!=='video'||typeof raw.body!=='string'||raw.body.length>200000)throw new Error('没有读到当前 B 站视频，请刷新页面后重试。');
  const video=normalizeVideo(raw.video);
  if(!video||raw.video?.url&&!video.url||video.mediaId!==`${ref.bvid}-${raw.cid}`)throw new Error('当前视频的音轨资料尚未准备好。');
  return {
    id,url:sourceUrl(id),bvid:String(raw.bvid||'').slice(0,32),cid:String(raw.cid||'').slice(0,32),p:Number(raw.p)||1,
    title:String(raw.title||'未命名视频').slice(0,1000),author:String(raw.author||'').slice(0,300),
    body:raw.body,kind:'video',engagement:normalizeEngagement(raw.engagement),video,capturedAt:new Date().toISOString()
  };
}

export function mergeCapture(old,input,bodyHash){
  if(!old)return {...input,bodyHash,notes:[],overviews:{},revisions:[],position:0,speakerNames:{}};
  if(old.id!==input.id)throw new Error('来源不一致');
  const changed=old.bodyHash!==bodyHash;
  return {...old,...input,bodyHash,position:changed?0:old.position,
    revisions:changed?[...old.revisions,{body:old.body,bodyHash:old.bodyHash,caption:old.caption,transcript:old.transcript,speakerNames:old.speakerNames,capturedAt:old.capturedAt}]:old.revisions};
}

export function makeNote(item,quote,start,thought=''){
  if(typeof quote!=='string'||!quote.trim()||!Number.isInteger(start)||start<0||item.body.slice(start,start+quote.length)!==quote)throw new Error('选区已变化，请重新选择原话。');
  return {id:crypto.randomUUID(),quote,start,times:quoteTimes(item,start,quote.length),bodyHash:item.bodyHash,thought:String(thought).slice(0,20000),createdAt:new Date().toISOString(),deleted:false};
}

export function overviewSegments(item){return currentTranscript(item)?transcriptRanges(item).map((r,index)=>({index,start:r.offset,text:r.text,time:r.start})):[];}

export function validateOverview(raw,item){
  const rows=overviewSegments(item);
  if(!rows.length||!Array.isArray(raw?.chapters)||!raw.chapters.length||raw.chapters.length>100||!Array.isArray(raw.keyQuotes)||raw.keyQuotes.length>5)throw new Error('概览格式不完整，逐字稿与笔记已保留。');
  const chapters=raw.chapters.map(c=>{
    if(!Number.isInteger(c.sourceIndex)||!rows[c.sourceIndex]||typeof c.title!=='string'||!c.title.trim()||typeof c.summary!=='string'||!c.summary.trim())throw new Error('概览缺少有效原话定位。');
    return {title:c.title.slice(0,300),summary:c.summary.slice(0,3000),sourceIndex:c.sourceIndex,start:rows[c.sourceIndex].start,time:rows[c.sourceIndex].time};
  });
  if(chapters[0].sourceIndex!==0||chapters.some((c,i)=>i>0&&c.sourceIndex<=chapters[i-1].sourceIndex))throw new Error('章节没有按逐字稿顺序覆盖。');
  const compact=text=>text.replace(/\s/gu,'');
  const keyQuotes=[];
  for(const q of raw.keyQuotes){
    if(typeof q?.quote!=='string'||!q.quote.trim())continue;
    const needle=compact(q.quote);if(!needle)continue;
    const matches=[];
    for(const row of rows){
      const normalized=compact(row.text),at=normalized.indexOf(needle);if(at<0)continue;
      const positions=[];for(let i=0;i<row.text.length;i++)if(!/\s/u.test(row.text[i]))positions.push(i);
      const start=positions[at],end=positions[at+needle.length-1]+1;
      matches.push({quote:row.text.slice(start,end),sourceIndex:row.index,start:row.start+start});
    }
    const verified=matches.find(m=>m.sourceIndex===q.sourceIndex)||(matches.length===1?matches[0]:null);
    if(verified&&!keyQuotes.some(v=>v.start===verified.start&&v.quote===verified.quote))keyQuotes.push(verified);
  }
  return {chapters,keyQuotes,omittedQuotes:raw.keyQuotes.length-keyQuotes.length,bodyHash:item.bodyHash,generatedAt:new Date().toISOString()};
}

export function searchItems(items,query){
  const q=query.trim().toLocaleLowerCase();
  return items.filter(x=>!q||[x.title,x.author,x.body,...x.notes.filter(n=>!n.deleted).flatMap(n=>[n.quote,n.thought]),JSON.stringify(x.overviews[x.bodyHash]||{})].join('\n').toLocaleLowerCase().includes(q));
}

function noteSpeakers(item,n){
  const names=n.speakerNames||item.speakerNames;
  return [...new Set((n.times||[]).map(t=>t.speaker).filter(Boolean))].map(id=>names?.[id]||'说话人 '+id).join('、');
}

export function exportMarkdown(item){
  const overview=item.overviews[item.bodyHash];
  const out=[`# ${item.title}`,`作者：${item.author||'未读取'}`,`来源：${item.url}`,`分 P：P${item.p||1}`,`读取时间：${item.capturedAt}`,currentTranscript(item)?'范围：视频简介与机器转写逐字稿；说话人编号和重要引用需对照声音核对。':'范围：视频简介；尚未提交声音转写。','## 视频简介',item.caption||'（页面没有公开简介）'];
  if(currentTranscript(item))out.push('## 带时间点逐字稿',videoMarkdown(item));
  if(overview){out.push('## 内容概览');for(const c of overview.chapters)out.push(`### ${clockTime(c.time)} ${c.title}`,c.summary);out.push('## 关键观点');for(const q of overview.keyQuotes){const row=transcriptRanges(item).find(r=>q.start>=r.offset&&q.start<r.offset+r.length);out.push((row?'['+clockTime(row.start)+'] ':'')+q.quote);}}
  out.push('## 我的笔记');
  for(const n of item.notes.filter(n=>!n.deleted))out.push(n.quote,noteSpeakers(item,n),n.times?.length?`视频时间：${clockTime(n.times[0].start)}—${clockTime(n.times.at(-1).end)}`:'',n.thought?`个人想法：${n.thought}`:'',`保存时间：${n.createdAt}${n.bodyHash!==item.bodyHash?'（摘自先前逐字稿）':''}`);
  return out.filter(Boolean).join('\n\n')+'\n';
}

export function exportNotes(item){
  const out=['# '+item.title+' · 我的笔记','来源：'+item.url];
  for(const n of item.notes.filter(n=>!n.deleted))out.push(n.quote,noteSpeakers(item,n),n.times?.length?'视频时间：'+clockTime(n.times[0].start)+'—'+clockTime(n.times.at(-1).end):'',n.thought?'个人想法：'+n.thought:'',n.bodyHash!==item.bodyHash?'摘自先前逐字稿版本':'');
  return out.filter(Boolean).join('\n\n')+'\n';
}
