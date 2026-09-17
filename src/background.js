import {requestAiCompletion,parseLooseJson} from './ai.js';
import {VOICE_SETTINGS,transcriptRanges,clockTime,currentTranscript,sameVideoSource,transcriptBody,videoEligible,validateTranscript} from './video.js';
import {createVideoJobs} from './video-jobs.js';
import {PREFIX,SETTINGS,noteId,normalizeCapture,mergeCapture,makeNote,hash,overviewSegments,validateOverview} from './core.js';
let queue=Promise.resolve();
const atomic=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
const getItem=async id=>(await chrome.storage.local.get(PREFIX+id))[PREFIX+id];
const putItem=async item=>{try{await chrome.storage.local.set({[PREFIX+item.id]:item});}catch{throw new Error('本机保存未完成，可能空间不足。请先导出已有资料后重试。');}};
const videoJobs=createVideoJobs({getItem,putItem,atomic});videoJobs.install();
const contextKey=id=>'bilid_tab_'+id;
async function init(){
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.sidePanel.setOptions({enabled:false});
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false});
}
chrome.runtime.onInstalled.addListener(()=>{init().catch(()=>{});});
chrome.tabs.onRemoved.addListener(id=>{chrome.storage.session.remove(contextKey(id));});
const panelPath='src/panel.html';
function panelOptions(tabId,url){return {tabId,path:panelPath+'?tab='+tabId,enabled:!!noteId(url)};}
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(change.status==='loading' || change.url) chrome.storage.session.remove(contextKey(id));
  if(change.url || change.status==='complete') chrome.sidePanel.setOptions(panelOptions(id,change.url||tab?.url)).catch(()=>{});
});
function openingMessage(error){
  const text=String(error?.message||error||'');
  if(/user gesture/i.test(text)) return '请点击浏览器工具栏中的B站精读图标打开阅读栏。';
  if(/No active side panel|not enabled/i.test(text)) return '阅读栏配置正在恢复，请再点一次精读。';
  return '阅读栏打开失败，请从工具栏重试（OPEN_FAILED）。';
}
function openPanel(tab){
  if(!noteId(tab?.url))return Promise.reject(new Error('请先打开一条 B 站普通视频。'));
  // Both API calls are issued in the click handler without losing the gesture.
  const prepared=chrome.sidePanel.setOptions(panelOptions(tab.id,tab.url));
  const opened=chrome.sidePanel.open({tabId:tab.id});
  return Promise.all([prepared,opened]);
}
chrome.action.onClicked.addListener(tab=>{
  openPanel(tab).catch(error=>{
    chrome.action.setTitle({tabId:tab.id,title:openingMessage(error)}).catch(()=>{});
  });
});
function isPage(sender){
  if(sender.id!==chrome.runtime.id || !sender.tab || sender.frameId!==0) return false;
  try {return new URL(sender.url).origin==='https://www.bilibili.com' && new URL(sender.tab.url).origin==='https://www.bilibili.com';} catch {return false;}
}
function internal(sender){return sender.id===chrome.runtime.id && typeof sender.url==='string' && sender.url.startsWith(chrome.runtime.getURL('src/'));}
async function context(tabId){return (await chrome.storage.session.get(contextKey(tabId)))[contextKey(tabId)] || null;}
async function handle(msg,sender){
  if(msg.type?.startsWith('AUDIO_')){
    if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('src/offscreen.html'))throw new Error('无效的音轨处理来源。');
    return videoJobs.audioMessage(msg);
  }
  if(msg.type==='BILI_SCOPE'){
    if(!isPage(sender)) throw new Error('来源无效');
    const id=msg.id && noteId(sender.tab.url)===msg.id ? msg.id:null;
    await chrome.sidePanel.setOptions({...panelOptions(sender.tab.id,sender.tab.url),enabled:!!id});
    await chrome.storage.session.set({[contextKey(sender.tab.id)]:id});return {};
  }
  if(msg.type==='BILI_NOTE'){
    if(!isPage(sender)||!msg.id||noteId(sender.tab.url)!==msg.id)throw new Error('请先打开当前视频。');
    const saved=await getItem(msg.id);
    if(!saved||!currentTranscript(saved))throw new Error('请先生成这条视频的逐字稿，再记笔记。');
    await handle({type:'NOTE_CURRENT',id:msg.id,tabId:sender.tab.id},{id:chrome.runtime.id,url:chrome.runtime.getURL('src/panel.html')});return {saved:true};
  }
  if(!internal(sender)) throw new Error('此操作只能在B站精读内使用。');
  if(msg.type==='CONTEXT') {const tab=await chrome.tabs.get(msg.tabId);return {id:noteId(tab.url)};}
  if(msg.type==='READ'){
    const current=noteId((await chrome.tabs.get(msg.tabId)).url);
    if(!current) throw new Error('请打开B站内容页，再点页面上的“精读”。');
    const response=await chrome.tabs.sendMessage(msg.tabId,{type:'BILI_CAPTURE'});
    if(!response?.ok) throw new Error(response?.error||'页面尚未准备好，请刷新B站页面。');
    const input=normalizeCapture(response.data);
    const tab=await chrome.tabs.get(msg.tabId);
    if(input.id!==current || noteId(tab.url)!==current) throw new Error('内容已切换，请重新读取。');
    return atomic(async()=>{
      const old=await getItem(input.id);
      const caption=input.body,videoItem={...old,...input};
      const reused=currentTranscript(videoItem);
      const transcript=reused?{...reused,mediaKey:input.video.key}:old?.transcript;
      const voiceJob=old?.voiceJob&&sameVideoSource(old.voiceJob.mediaKey,input.video)?{...old.voiceJob,mediaKey:input.video.key}:old?.voiceJob;
      const body=transcriptBody(caption,reused);
      const item=mergeCapture(old,{...input,caption,body,...(transcript?{transcript}:{}),...(voiceJob?{voiceJob}:{})},await hash(body));await putItem(item);return {item};
    });
  }
  if(msg.type==='LIST'){
    const data=await chrome.storage.local.get(null);
    return {items:Object.entries(data).filter(([k])=>k.startsWith(PREFIX)).map(([,v])=>v).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))};
  }
  if(msg.type==='GET'){const item=await getItem(msg.id);if(!item) throw new Error('没有找到这份资料');return {item};}
  if(['NOTE','DELETE_NOTE','UNDO_NOTE','POSITION','EDIT_NOTE'].includes(msg.type)) return atomic(async()=>{
    const item=await getItem(msg.id);if(!item) throw new Error('请先读取原文');
    if(msg.type==='NOTE'){
      if(msg.bodyHash!==item.bodyHash) throw new Error('正文已更新，请重新选段。');
      item.notes.push(makeNote(item,msg.quote,msg.start,msg.thought));
    } else if(msg.type==='EDIT_NOTE'){
      const n=item.notes.find(n=>n.id===msg.noteId);if(!n)throw new Error('没有找到笔记');n.thought=String(msg.thought||'').slice(0,20000);
    } else if(msg.type==='POSITION') {
      if(msg.bodyHash===item.bodyHash) item.position=Math.max(0,Math.min(1,Number(msg.position)||0));
    } else { const n=item.notes.find(n=>n.id===msg.noteId);if(!n)throw new Error('没有找到笔记');n.deleted=msg.type==='DELETE_NOTE'; }
    await putItem(item);return {item};
  });
  if(msg.type==='VOICE_STATUS'){
    const settings=(await chrome.storage.local.get(VOICE_SETTINGS))[VOICE_SETTINGS];return {configured:!!settings?.apiKey};
  }
  if(msg.type==='SAVE_VOICE_SETTINGS'){
    if(!sender.url.startsWith(chrome.runtime.getURL('src/options.html')))throw new Error('请从设置页操作');
    const old=(await chrome.storage.local.get(VOICE_SETTINGS))[VOICE_SETTINGS];
    const apiKey=typeof msg.apiKey==='string'&&msg.apiKey.trim()?msg.apiKey.trim():old?.apiKey||'';
    if(apiKey.length>1000||/[\r\n]/.test(apiKey))throw new Error('语音配置格式无效。');
    await chrome.storage.local.set({[VOICE_SETTINGS]:{apiKey}});
    if((await chrome.storage.local.get(VOICE_SETTINGS))[VOICE_SETTINGS]?.apiKey!==apiKey)throw new Error('保存未完成。');
    return {configured:!!apiKey};
  }
  if(msg.type==='SPEAKER_NAMES')return atomic(async()=>{
    const item=await getItem(msg.id),t=currentTranscript(item);
    if(!t||item.bodyHash!==msg.bodyHash)throw new Error('逐字稿已变化，请重新对应姓名。');
    const names={};for(const id of new Set(t.rows.map(r=>r.speaker).filter(Boolean))){const value=msg.names?.[id];if(value!==undefined&&(typeof value!=='string'||value.length>30))throw new Error('姓名请保持在30字以内。');if(value?.trim())names[id]=value.trim();}
    item.speakerNames=names;await putItem(item);return {item};
  });
  if(msg.type==='VIDEO_STATE'||msg.type==='NOTE_CURRENT'){
    const item=await getItem(msg.id),t=currentTranscript(item);
    if(!item)throw new Error('请先打开 B站精读，读取当前视频。');
    if(!t)throw new Error('请先生成这条视频的逐字稿，再记笔记。');
    if(noteId((await chrome.tabs.get(msg.tabId)).url)!==msg.id)throw new Error('视频已经切换，请重新打开 B站精读。');
    const state=await chrome.tabs.sendMessage(msg.tabId,{type:'BILI_VIDEO_STATE',id:msg.id});
    if(!state?.ok||!Number.isFinite(state.time)||Math.abs(state.duration-t.duration)>1)throw new Error('播放器尚未就绪，请先在原页播放视频。');
    if(msg.type==='VIDEO_STATE')return {time:state.time,paused:state.paused};
    const fresh=await chrome.tabs.sendMessage(msg.tabId,{type:'BILI_CAPTURE'});
    if(!fresh?.ok||!currentTranscript({...normalizeCapture(fresh.data),transcript:t}))throw new Error('视频来源已变化，请重新读取。');
    const point=Math.max(0,state.time-3),ranges=transcriptRanges(item),row=ranges.find(r=>point>=r.start&&point<r.end)||[...ranges].reverse().find(r=>r.start<=point);
    if(!row)throw new Error('这个时间还没有可保存的原话，请从逐字稿选段。');
    return atomic(async()=>{const latest=await getItem(msg.id);if(noteId((await chrome.tabs.get(msg.tabId)).url)!==msg.id||latest.bodyHash!==item.bodyHash)throw new Error('逐字稿已变化，请重新选段。');latest.notes.push(makeNote(latest,row.text,row.offset));await putItem(latest);return {item:latest};});
  }
  if(msg.type==='EXPLAIN'){
    const item=await getItem(msg.id);
    if(!currentTranscript(item)||item.bodyHash!==msg.bodyHash||typeof msg.quote!=='string'||msg.quote.length>5000)throw new Error('请重新选择逐字稿中的一段。');
    makeNote(item,msg.quote,msg.start);
    if(!transcriptRanges(item).some(r=>msg.start>=r.offset&&msg.start<r.offset+r.length))throw new Error('请选择声音逐字稿中的原话。');
    const key='bilid_explain_'+await hash(item.id+item.bodyHash+msg.start+msg.quote),cached=(await chrome.storage.session.get(key))[key];if(cached)return {text:cached};
    const settings=(await chrome.storage.local.get(SETTINGS))[SETTINGS];
    if(!settings?.apiKey)throw new Error('请先在设置中配置 DeepSeek 服务。');
    if(!await chrome.permissions.contains({origins:['https://api.deepseek.com/*']}))throw new Error('请在设置中允许连接 DeepSeek。');
    const prompt=await (await fetch(chrome.runtime.getURL('prompts/explain.md'))).text();let response;
    try{response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${settings.apiKey}`},body:JSON.stringify({model:settings.model,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({title:item.title,selected:msg.quote,context:item.body.slice(Math.max(0,msg.start-500),msg.start+msg.quote.length+500)})}],thinking:{type:'disabled'},max_tokens:600}),signal:AbortSignal.timeout(25000)});}catch{throw new Error('解释请求未完成，原话仍保留，请稍后重试。');}
    if(!response.ok)throw new Error('解释服务暂时不可用，请检查配置或稍后重试。');
    const result=await response.json(),text=result.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim()||text.length>10000)throw new Error('未取得完整解释，请稍后重试。');
    await chrome.storage.session.set({[key]:text});return {text};
  }
  if(msg.type==='VIDEO_SEEK'){
    const item=await getItem(msg.id),t=currentTranscript(item);
    if(!t||!Number.isInteger(msg.index)||!t.rows[msg.index]||noteId((await chrome.tabs.get(msg.tabId)).url)!==msg.id)throw new Error('请先打开这篇视频再回听。');
    const fresh=await chrome.tabs.sendMessage(msg.tabId,{type:'BILI_CAPTURE'});
    const input=fresh?.ok?normalizeCapture(fresh.data):null;
    if(!input||!currentTranscript({...input,transcript:t}))throw new Error('视频来源已变化，请重新读取。');
    const result=await chrome.tabs.sendMessage(msg.tabId,{type:'BILI_VIDEO_SEEK',id:msg.id,time:t.rows[msg.index].start});
    if(!result?.ok)throw new Error(result?.error||'暂时不能回听，请使用原播放器。');return {};
  }
  if(msg.type==='VIDEO_START')return videoJobs.start(msg);
  if(msg.type==='VIDEO_QUERY')return videoJobs.query(msg.id);
  if(msg.type==='SETTINGS_STATUS'){
    const s=(await chrome.storage.local.get(SETTINGS))[SETTINGS]||{};
    return {configured:!!s.apiKey,model:s.model||'deepseek-v4-flash'};
  }
  if(msg.type==='SAVE_SETTINGS'){
    if(!sender.url.startsWith(chrome.runtime.getURL('src/options.html'))) throw new Error('请从设置页操作');
    const s=(await chrome.storage.local.get(SETTINGS))[SETTINGS]||{};
    const model=String(msg.model||'deepseek-v4-flash').trim();
    if(!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('请填写有效的模型名称。');
    const apiKey=typeof msg.apiKey==='string'&&msg.apiKey.trim()?msg.apiKey.trim():s.apiKey||'';
    if(apiKey.length>1000 || /[\r\n]/.test(apiKey))throw new Error('服务配置格式无效');
    await chrome.storage.local.set({[SETTINGS]:{apiKey,model}});
    const saved=(await chrome.storage.local.get(SETTINGS))[SETTINGS];
    if(saved?.apiKey!==apiKey||saved?.model!==model)throw new Error('设置未保存成功，请重试。');
    return {configured:!!apiKey};
  }
  if(msg.type==='CLEAR_SETTINGS'){
    if(!sender.url.startsWith(chrome.runtime.getURL('src/options.html'))) throw new Error('请从设置页操作');
    await chrome.storage.local.remove(SETTINGS); return {};
  }
  if(msg.type==='OVERVIEW'){
    const item=await getItem(msg.id);
    if(item?.kind==='video'&&!currentTranscript(item))throw new Error('请先完成视频转写，再生成概览。'); if(!item || item.bodyHash!==msg.bodyHash)throw new Error('正文已变化，请重新读取。');
    if(item.overviews[item.bodyHash]) return {item};
    const settings=(await chrome.storage.local.get(SETTINGS))[SETTINGS];
    if(!settings?.apiKey)throw new Error('请先在设置中配置你自己的 DeepSeek 服务。');
    if(!await chrome.permissions.contains({origins:['https://api.deepseek.com/*']})) throw new Error('请在设置中允许连接 DeepSeek。');
    const jobKey='bilid_job_'+item.id;
    await atomic(async()=>{
      const existing=(await chrome.storage.session.get(jobKey))[jobKey];
      if(existing && Date.now()-existing<130000)throw new Error('这篇内容正在生成概览，请稍后查看。');
      await chrome.storage.session.set({[jobKey]:Date.now()});
    });
    try {
      let prompt=await (await fetch(chrome.runtime.getURL('prompts/analysis-video.md'))).text();
      prompt=prompt.replaceAll('{durationFormatted}',clockTime(item.video.duration)).replaceAll('{lateThreshold}',clockTime(item.video.duration*0.75)).replaceAll('{maxTimestampSeconds}',String(item.video.duration));
      const source=overviewSegments(item);
      const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo?.().catch(()=>{}),20000);
      let parsed;
      try{
        const result=await requestAiCompletion({settings,maxTokens:8192,responseFormat:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({title:item.title,author:item.author,sourceKind:'video-transcript',description:item.caption,transcript:source.map(r=>'['+clockTime(r.time)+'] sourceIndex='+r.index+' '+r.text).join('\n')})}]});
        parsed=parseLooseJson(result.text);
      }finally{clearInterval(keepAlive);}
      const overview=validateOverview(parsed,item);
      return atomic(async()=>{const latest=await getItem(item.id);latest.overviews[item.bodyHash]=overview;await putItem(latest);return {item:latest};});
    }finally{await chrome.storage.session.remove(jobKey);}
  }
  throw new Error('不支持此操作。');
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg?.target==='bili-audio')return false;
  if(msg?.type==='BILI_OPEN'){
    if(!isPage(sender) || !msg.id || noteId(sender.tab.url)!==msg.id){reply({ok:false,error:'请在当前 B 站视频显示后再点精读。'});return;}
    // 必须直接在用户点击触发的消息内打开，前面不能先等待异步读取。
    openPanel(sender.tab).then(()=>reply({ok:true})).catch(error=>reply({ok:false,error:openingMessage(error)}));return true;
  }
  handle(msg||{},sender).then(data=>reply({ok:true,...data})).catch(e=>{
    const error=/Receiving end does not exist|Could not establish connection|message port closed|Extension context invalidated/i.test(e.message||'')?'页面与精读的连接尚未恢复。请刷新当前B站标签页，等正文显示后再点“读取当前视频”；已有资料仍保留。':e.message||'操作未完成，请重试。';
    reply({ok:false,error});
  });return true;
});
