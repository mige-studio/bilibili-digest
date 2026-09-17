import {currentTranscript,videoEligible,clockTime,videoMarkdown,transcriptRanges,videoTimeLink,MAX_VIDEO_SECONDS} from './video.js';
import {send,el,action,flash,attempt,download} from './client.js';
import {exportMarkdown,exportNotes} from './core.js';
const $=s=>document.querySelector(s);
let tabId=null,voiceBusy=false,voiceTimer=null,voicePolls=0;
async function bindTab(){
  if(tabId!==null)return;
  const explicit=new URL(location.href).searchParams.get('tab');
  if(explicit && /^\d+$/.test(explicit)){tabId=Number(explicit);return;}
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!Number.isInteger(tab?.id))throw new Error('没有找到当前视频标签，请重新打开精读。');
  tabId=tab.id;
}
let following=false, playbackIndex=-1, polling=false, textScroll=0, explanationEpoch=0;
let item=null, view='text', selection=null, matches=[], matchIndex=0, reading=false, allNotes=false, renderEpoch=0;
function renderEngagement(raw){
  const host=$('#engagement'),counts=$('#engagement-counts'),data=raw&&typeof raw==='object'?raw:null;
  host.hidden=!data;counts.replaceChildren();if(!data)return;
  const labels=[['views','播放'],['danmaku','弹幕'],['likes','点赞'],['coins','投币'],['favorites','收藏'],['comments','评论'],['shares','分享']];
  const relative=key=>Number.isFinite(data[key])&&data.likes>0?(data[key]/data.likes*100).toFixed(1):'—';
  for(const [key,label] of labels){
    const cell=el('span','','engagement-item'),value=Number.isFinite(data[key])?data[key].toLocaleString('zh-CN'):'—';
    const ratio=['likes','coins','favorites','comments','shares'].includes(key)&&data.likes>0?'相对 '+(key==='likes'?'100':relative(key)):'';
    cell.append(el('small',label),el('strong',value),el('span',ratio,'engagement-relative'));counts.append(cell);
  }
}
function showView(name){
  if(view==='text')textScroll=scrollY;
  if(name==='text')requestAnimationFrame(()=>window.scrollTo(0,textScroll));
  getSelection()?.removeAllRanges();view=name;for(const s of ['text','overview','notes'])$('#'+s).hidden=s!==name;
  for(const b of document.querySelectorAll('nav button'))b.classList.toggle('active',b.dataset.view===name);
  $('#selection').hidden=true;selection=null;
  if(name==='overview')renderOverview();if(name==='notes')attempt(renderNotes);
}
for(const b of document.querySelectorAll('nav button'))b.onclick=()=>showView(b.dataset.view);
async function read(){
  if(reading)return;reading=true;$('#refresh').disabled=true;flash('正在刷新视频资料…');
  try{
    await bindTab();
    const r=await send('READ',{tabId,videoOnly:true});item=r.item;selection=null;$('#selection').hidden=true;
    $('#title').textContent=item.title;$('#source').textContent=item.author||'作者尚未读取';renderEngagement(item.engagement);
    $('#boundary').textContent='当前读到视频简介；尚未读取视频语音。';
    renderText(); if(view==='overview')renderOverview();if(view==='notes')await renderNotes();
    flash('已保存到“我的资料”。');
    if(view==='text'&&!$('#search').value)requestAnimationFrame(()=>window.scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*(item.position||0)));
  }catch(e){flash(e.message);}finally{reading=false;$('#refresh').disabled=false;}
}
$('#refresh').onclick=read;
function voiceProgress(job){
 const wait=Math.max(0,Math.floor((Date.now()-job.startedAt)/1000));
 const phase=job.phase==='download'?'正在读取完整音轨'+(job.downloaded?'（'+Math.round(job.downloaded/1048576)+' MB）':''):job.phase==='prepare'?'正在压缩整场音轨'+(job.processed?'（已处理 '+clockTime(job.processed)+'）':''):job.phase==='upload'?'正在上传完整音轨':'正在同时识别文字、时间与说话人';
 return (job.error||phase)+'；已等待 '+clockTime(wait)+'。关闭阅读栏后仍会查询原任务，不重复提交。';
}
function renderVideoControls(){
  const video=item?.kind==='video';$('#video-controls').hidden=!video;
  const nav=document.querySelector('[data-view="text"]');nav.textContent=video?(currentTranscript(item)?'逐字稿':'视频简介'):'逐字稿';
  if(!video){clearTimeout(voiceTimer);for(const id of ['current-video','export-video','video-times','follow-video','note-current','speaker-settings'])$('#'+id).hidden=true;return;}
  $('#video-source-check')?.remove();
  if(item.video?.diagnostic){const d=el('details');d.id='video-source-check';d.append(el('summary','播放检查信息'),el('p',item.video.diagnostic,'muted'));$('#video-controls').append(d);}
  const t=currentTranscript(item),job=item.voiceJob,active=job&&job.mediaKey===item.video?.key&&!['failed','done'].includes(job.state);
  $('#transcript-options').hidden=!t;$(t?'#transcript-options':'#generation-actions').append($('#transcribe-video'));
  $('#transcribe-video').hidden=!!active;
  $('#transcribe-video').disabled=voiceBusy||!videoEligible(item.video);
  const failed=job&&job.mediaKey===item.video?.key&&job.state==='failed';
  $('#transcribe-video').textContent=(t?'重新转写（含说话人）':failed?'重新尝试 · 生成逐字稿':'开始精读 · 生成逐字稿')+(item.video?.duration?'（'+clockTime(item.video.duration)+'）':'');
  $('#query-video').hidden=!active;$('#query-video').disabled=voiceBusy;
  $('#current-video').hidden=$('#export-video').hidden=$('#video-times').hidden=$('#follow-video').hidden=$('#note-current').hidden=$('#speaker-settings').hidden=!t;
  $('#video-status').classList.toggle('error',!!failed);
  $('#video-status').textContent=active?voiceProgress(job):t?'说话人逐字稿已保存；可搜索、画线、回听并为说话人编号填写姓名。':failed?'上次精读未完成：'+job.error+' 已读取的视频资料仍保留，可点击“重新尝试”。':!item.video?.duration?'视频时长尚未确认，请先在原播放器加载后重新读取。':item.video.duration>MAX_VIDEO_SECONDS?'单个分 P 的整场识别上限为五小时；本视频尚未提交。':!item.video.url?({'meta-missing':'当前视频暂未提供可读取音轨。','streams-missing':'当前视频没有可用的公开音轨。'}[item.video.reason]||'尚未找到可读取的音轨。')+' 当前只保留简介。':'点击后只转写当前分 P，并将整段音轨发送给你配置的火山语音服务，可能产生费用。';
  $('#boundary').textContent=t?'当前分 P 的视频简介与逐字稿分开保留；说话人编号和重要原话请回听核对。':'当前只有视频简介，尚未生成说话人逐字稿。';
  if(active&&!voiceBusy){clearTimeout(voiceTimer);voiceTimer=setTimeout(()=>attempt(()=>voiceAction('VIDEO_QUERY')),10000);}
  const list=$('#video-time-list');if(list.dataset.rendered===item.id+':'+item.bodyHash+':'+JSON.stringify(item.speakerNames||{}))return;list.dataset.rendered=item.id+':'+item.bodyHash+':'+JSON.stringify(item.speakerNames||{});list.replaceChildren();
  for(const [index,row] of (t?.rows||[]).entries())list.append(action(clockTime(row.start)+' · '+(row.speaker?(item.speakerNames?.[row.speaker]||'说话人 '+row.speaker)+' · ':'')+row.text.slice(0,90),()=>attempt(async()=>{await send('VIDEO_SEEK',{id:item.id,tabId,index});flash('已定位到 '+clockTime(row.start));}),'time-link'));
}
async function voiceAction(type){
  if(voiceBusy||item?.kind!=='video')return;
  const id=item.id;voiceBusy=true;renderVideoControls();
  if(type==='VIDEO_START'){voicePolls=0;flash('正在准备完整音轨，原稿和笔记保留…');}
  try{const previous=item.bodyHash,r=await send(type,{id,tabId,replace:type==='VIDEO_START'&&!!currentTranscript(item)});if(item?.id!==id)return;item=r.item;if(previous!==item.bodyHash){renderText();if(view==='overview')renderOverview();}else renderVideoControls();
    if(currentTranscript(item)&&(!item.voiceJob||item.voiceJob.state==='done'))flash('逐字稿已保存，可按时间点回听。');
    else if(item.voiceJob?.state==='failed')flash(item.voiceJob.error);
    else if(item.voiceJob){clearTimeout(voiceTimer);voicePolls++;voiceTimer=setTimeout(()=>attempt(()=>voiceAction('VIDEO_QUERY')),8000);}
  }finally{voiceBusy=false;renderVideoControls();}
}
$('#transcribe-video').onclick=()=>{if(currentTranscript(item)&&!confirm('重新识别整场视频的文字和说话人会再次使用语音服务。旧稿、概览和笔记在成功前保留。继续吗？'))return;attempt(()=>voiceAction('VIDEO_START'));};
$('#query-video').onclick=()=>{voicePolls=0;attempt(()=>voiceAction('VIDEO_QUERY'));};
$('#export-video').onclick=()=>{if(currentTranscript(item))download('B站精读-'+item.id+'-逐字稿.md',['# '+item.title,'来源：'+item.url,'机器转写，请对照声音核对。',videoMarkdown(item)].join('\n\n'));};

function appendSearch(box,text,offset){
  const q=$('#search').value;let from=0,at;
  if(q)while((at=text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase(),from))!==-1){
    box.append(document.createTextNode(text.slice(from,at)));const m=el('mark',text.slice(at,at+q.length));m.dataset.offset=offset+at;box.append(m);matches.push(m);from=at+q.length;
  }
  box.append(document.createTextNode(text.slice(from)));
}
function renderText(){
  renderVideoControls();const box=$('#body');box.replaceChildren();matches=[];matchIndex=0;playbackIndex=-1;
  if(!item)return;
  const rows=transcriptRanges(item);let from=0;
  for(const row of rows){
    appendSearch(box,item.body.slice(from,row.offset),from);
    const line=el('span','','transcript-line');line.dataset.index=row.index;
    line.dataset.label=clockTime(row.start)+(row.speaker?' · '+(item.speakerNames?.[row.speaker]||'说话人 '+row.speaker):'');
    line.tabIndex=0;line.setAttribute('role','button');line.setAttribute('aria-label','回听 '+line.dataset.label+' '+row.text);
    appendSearch(line,row.text,row.offset);
    line.onclick=()=>{if(getSelection()?.isCollapsed!==false)attempt(()=>seekIndex(row.index));};
    line.onkeydown=e=>{if(e.key==='Enter'&&getSelection()?.isCollapsed!==false)attempt(()=>seekIndex(row.index));};
    box.append(line);from=row.offset+row.length;
  }
  appendSearch(box,item.body.slice(from),from);
  $('#count').textContent=$('#search').value?`${matches.length}处`:'';
  if(matches.length)focusMatch(0);$('#previous').disabled=$('#next').disabled=!matches.length;
}
async function seekIndex(index){
  const id=item?.id;if(!id)return;
  await send('VIDEO_SEEK',{id,tabId,index});if(item?.id===id)flash('已定位到 '+clockTime(currentTranscript(item).rows[index].start));
}
async function playOffset(start){
  const rows=transcriptRanges(item),row=rows.find(r=>start>=r.offset&&start<r.offset+r.length);
  if(!row)throw new Error('这段文字没有当前逐字稿的时间点。');
  await seekIndex(row.index);
}
$('#current-video').onclick=()=>attempt(async()=>{const id=item.id,r=await send('VIDEO_STATE',{id,tabId});if(item?.id!==id)return;const rows=currentTranscript(item).rows,index=rows.findIndex(row=>r.time>=row.start&&r.time<row.end);if(index<0){flash('当前播放位置附近暂无语音文字。');return;}showView('text');requestAnimationFrame(()=>document.querySelector(`.transcript-line[data-index="${index}"]`)?.scrollIntoView({block:'center'}));});
$('#follow-video').onclick=()=>{following=!following;$('#follow-video').textContent=following?'跟随播放：开':'跟随播放：关';$('#follow-video').setAttribute('aria-pressed',String(following));};
$('#note-current').onclick=()=>attempt(async()=>{const id=item.id;const r=await send('NOTE_CURRENT',{id,tabId});if(item?.id===id)item=r.item;flash('刚才听到的原话与时间点已保存。');});
$('#speaker-settings').onclick=()=>{
  const box=$('#speaker-fields');box.replaceChildren();
  for(const id of [...new Set(currentTranscript(item).rows.map(r=>r.speaker).filter(Boolean))]){
    const label=el('label','说话人 '+id),input=el('input');input.dataset.speaker=id;input.maxLength=30;input.value=item.speakerNames?.[id]||'';input.placeholder='姓名可留空';label.append(input);const rows=currentTranscript(item).rows,indices=rows.map((r,i)=>r.speaker===id?i:-1).filter(i=>i>=0),samples=[...new Set([indices[0],indices[Math.floor(indices.length/2)],indices.at(-1)])],audition=el('div','','actions');for(const index of samples)audition.append(action('回听 '+clockTime(rows[index].start),()=>attempt(async()=>{if(item?.id!==$('#speakers').dataset.id||item.bodyHash!==$('#speakers').dataset.hash)throw new Error('视频已变化，请重新打开姓名。');await seekIndex(index);}),''));label.append(audition);box.append(label);
  }
  $('#speakers').dataset.id=item.id;$('#speakers').dataset.hash=item.bodyHash;$('#speakers').showModal();
};
$('#save-speakers').onclick=()=>attempt(async()=>{const names={};for(const input of $('#speaker-fields').querySelectorAll('input'))names[input.dataset.speaker]=input.value;const r=await send('SPEAKER_NAMES',{id:$('#speakers').dataset.id,bodyHash:$('#speakers').dataset.hash,names});if(item?.id===r.item.id){item=r.item;renderText();}$('#speakers').close();flash('姓名对应已保存，逐字稿和导出同步使用。');});
$('#close-speakers').onclick=()=>$('#speakers').close();
function focusMatch(delta){if(!matches.length)return;matches[matchIndex]?.classList.remove('current-match');matchIndex=(matchIndex+delta+matches.length)%matches.length;matches[matchIndex].classList.add('current-match');for(let parent=matches[matchIndex].parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;matches[matchIndex].scrollIntoView({block:'center'});$('#count').textContent=`${matchIndex+1}/${matches.length}`;}
$('#search').oninput=()=>{selection=null;$('#selection').hidden=true;renderText();};$('#previous').onclick=()=>focusMatch(-1);$('#next').onclick=()=>focusMatch(1);
document.addEventListener('mouseup',event=>{
  if($('#selection').contains(event.target))return;
  const s=getSelection();selection=null;$('#selection').hidden=true;
  if(!item||view!=='text'||!s?.rangeCount||s.isCollapsed)return;
  const range=s.getRangeAt(0),box=$('#body');if(!box.contains(range.startContainer)||!box.contains(range.endContainer))return;
  const before=range.cloneRange();before.selectNodeContents(box);before.setEnd(range.startContainer,range.startOffset);
  const quote=range.toString(),start=before.toString().length;
  if(!quote.trim()||item.body.slice(start,start+quote.length)!==quote)return;
  selection={quote,start,id:item.id,bodyHash:item.bodyHash};const rect=range.getBoundingClientRect();
  $('#selection').style.left=Math.max(8,Math.min(rect.left,innerWidth-270))+'px';
  $('#selection').style.top=Math.max(6,Math.min(rect.bottom+6,innerHeight-52))+'px';$('#selection').hidden=false;
});
$('#selection').addEventListener('mousedown',e=>e.preventDefault());
$('#save-selection').onclick=()=>attempt(async()=>{
  if(!selection)return;const saved={...selection};const r=await send('NOTE',saved);if(item?.id===r.item.id)item=r.item;$('#selection').hidden=true;selection=null;getSelection()?.removeAllRanges();flash('已按原话保存到“我的笔记”。');
});
$('#copy-selection').onclick=()=>attempt(async()=>{if(selection){await navigator.clipboard.writeText(selection.quote);flash('原话已复制。');}});
function locate(start){
  if(!item)return;showView('text');$('#search').value='';renderText();
  const walker=document.createTreeWalker($('#body'),NodeFilter.SHOW_TEXT);let node,offset=0;
  while((node=walker.nextNode())){if(offset+node.length>start){const range=document.createRange();range.setStart(node,Math.max(0,start-offset));range.setEnd(node,Math.min(node.length,start-offset+40));const selected=getSelection();selected.removeAllRanges();selected.addRange(range);const rect=range.getBoundingClientRect();window.scrollBy({top:rect.top-innerHeight/3,behavior:'smooth'});return;}offset+=node.length;}
}
$('#explain-selection').onclick=()=>attempt(async()=>{
  if(!selection)return;const epoch=++explanationEpoch,saved={...selection};$('#explanation-quote').textContent=saved.quote;$('#explanation-text').textContent='正在解释…';$('#explanation').showModal();
  try{const r=await send('EXPLAIN',saved);if(epoch===explanationEpoch&&item?.id===saved.id&&$('#explanation').open)$('#explanation-text').textContent=r.text;}catch(e){if(epoch===explanationEpoch)$('#explanation-text').textContent=e.message;}
});
$('#close-explanation').onclick=()=>$('#explanation').close();
function renderOverview(){
  const box=$('#overview');box.replaceChildren();if(!item){box.append(el('p','先读取一条视频。','empty'));return;}
  const summary=item.overviews[item.bodyHash];
  if(!currentTranscript(item)){box.append(el('p','先完成视频转写，再根据完整逐字稿生成概览。','empty'));return;}
  if(!summary){
    box.append(el('p','依据完整逐字稿分章，保留有出处的关键观点。','empty'));
    const b=action('生成内容概览',()=>attempt(async()=>{
      b.disabled=true;const id=item.id,bodyHash=item.bodyHash;flash('正在生成概览，原文和笔记仍可阅读…');
      try{const r=await send('OVERVIEW',{id,bodyHash});if(item?.id===id){item=r.item;if(view==='overview')renderOverview();flash(r.item.overviews[bodyHash]?.omittedQuotes?'概览已保存；无法逐字核对的引用已省略。':'概览已保存。');}}finally{b.disabled=false;}
    }),'primary');box.append(b,el('p','点击后将正文发送至你配置的 DeepSeek 服务。','muted'));return;
  }
  box.append(el('h2','内容章节'));
  for(const c of summary.chapters){
    const card=el('div','','card chapter');card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','回听章节：'+c.title);
    card.append(el('span',Number.isFinite(c.time)?clockTime(c.time):`第${c.sourceIndex+1}段`,'pill'));const text=el('div');text.append(el('h3',c.title),el('p',c.summary));card.append(text);
    card.onclick=()=>attempt(()=>playOffset(c.start));card.onkeydown=e=>{if(e.key==='Enter')attempt(()=>playOffset(c.start));};box.append(card);
  }
  box.append(el('h2','关键观点'));if(!summary.keyQuotes.length)box.append(el('p','正文没有足够明确的可引用观点。','muted'));
  for(const q of summary.keyQuotes){const card=el('article','','card keyquote');card.append(el('p',q.quote,'quote'));const tools=el('div','','actions');const row=transcriptRanges(item).find(r=>q.start>=r.offset&&q.start<r.offset+r.length);if(row)tools.append(action(clockTime(row.start)+' 回听',()=>attempt(()=>seekIndex(row.index)),'pill'));tools.append(action('查看原文',()=>locate(q.start)),action('存笔记',()=>attempt(async()=>{const r=await send('NOTE',{id:item.id,bodyHash:item.bodyHash,quote:q.quote,start:q.start});item=r.item;flash('原话已保存。');})),action('复制',()=>attempt(async()=>{await navigator.clipboard.writeText(q.quote);flash('原话已复制。');})));card.append(tools);box.append(card);}
}
async function renderNotes(){
  const epoch=++renderEpoch,box=$('#notes');box.replaceChildren();
  const filter=el('div','','toolbar');filter.append(action(allNotes?'查看当前内容':'查看全部笔记',()=>{allNotes=!allNotes;attempt(renderNotes);}),action('导出当前笔记',()=>{if(item)download(`B站精读-${item.id}-笔记.md`,exportNotes(item));}));box.append(filter);
  const data=allNotes?(await send('LIST')).items.filter(x=>x.kind==='video'):item?[item]:[];if(epoch!==renderEpoch||view!=='notes')return;
  let count=0;
  for(const source of data)for(const n of source.notes.filter(n=>!n.deleted)){
    count++;const card=el('article','','card');const people=[...new Set((n.times||[]).map(t=>t.speaker).filter(Boolean))].map(id=>source.speakerNames?.[id]||'说话人 '+id);if(people.length)card.append(el('p',people.join('、'),'meta'));card.append(el('p',n.quote,'quote'));
    if(n.thought)card.append(el('p',n.thought,'thought'));
    card.append(el('p',`${source.title}${n.times?.length?' · '+clockTime(n.times[0].start)+'—'+clockTime(n.times.at(-1).end):''}${n.bodyHash!==source.bodyHash?' · 摘自先前正文':''}`,'note-source'));
    const tools=el('div','','actions');if(n.times?.length)tools.append(action('播放 '+clockTime(n.times[0].start),()=>attempt(async()=>{if(source.id!==item?.id){await chrome.tabs.create({url:videoTimeLink(source,n.times[0].start)});return;}if(n.bodyHash!==item.bodyHash)throw new Error('这条笔记来自先前逐字稿，请对照导出的时间回听。');await playOffset(n.start);}))); tools.append(action('复制文字',()=>attempt(async()=>{await navigator.clipboard.writeText(n.quote);flash('已复制。');})),action('复制时间链接',()=>attempt(async()=>{await navigator.clipboard.writeText(n.times?.length?videoTimeLink(source,n.times[0].start):source.url);flash('来源与回听时间已复制。');})),action('移到回收站',()=>attempt(async()=>{const r=await send('DELETE_NOTE',{id:source.id,noteId:n.id});if(item?.id===source.id)item=r.item;await renderNotes();flash('已移到回收站，可在下方恢复。');})));
    card.append(tools);
    const edit=el('details');edit.append(el('summary',n.thought?'编辑个人想法':'补充个人想法'));const input=el('textarea');input.value=n.thought||'';input.setAttribute('aria-label','个人想法');edit.append(input,action('保存想法',()=>attempt(async()=>{const r=await send('EDIT_NOTE',{id:source.id,noteId:n.id,thought:input.value});if(item?.id===source.id)item=r.item;await renderNotes();flash('个人想法已保存，原话保持不变。');})));card.append(edit);box.append(card);
  }
  if(!count)box.append(el('p','在原文中拖选一段文字，再点击选区旁的“记笔记”。','empty'));
  const deleted=data.flatMap(source=>source.notes.filter(n=>n.deleted).map(n=>({source,n})));
  if(deleted.length){const details=el('details');details.append(el('summary',`回收站（${deleted.length}）`));for(const {source,n}of deleted){const row=el('article','','card trash');row.append(el('p',n.quote,'quote'),action('恢复笔记',()=>attempt(async()=>{const r=await send('UNDO_NOTE',{id:source.id,noteId:n.id});if(item?.id===source.id)item=r.item;await renderNotes();flash('笔记已恢复。');})));details.append(row);}box.append(details);}
}
let scrollTimer;addEventListener('scroll',()=>{
  clearTimeout(scrollTimer);if(!item||view!=='text'||$('#search').value)return;
  const id=item.id,bodyHash=item.bodyHash;scrollTimer=setTimeout(()=>{const height=document.documentElement.scrollHeight-innerHeight;send('POSITION',{id,bodyHash,position:height>0?scrollY/height:0}).catch(()=>{});},300);
});
setInterval(async()=>{
  if(!chrome?.runtime?.id||reading||tabId===null)return;
  try{if(polling)return;polling=true;const r=await send('CONTEXT',{tabId});if(item && r.id!==item.id){item=null;renderEngagement(null);$('#explanation').close();$('#speakers').close();selection=null;$('#selection').hidden=true;$('#body').replaceChildren();renderText();$('#title').textContent='内容已切换';$('#source').textContent='';$('#boundary').textContent='请打开一条视频；支持视频逐字稿及对话阅读。';$('#overview').replaceChildren();$('#notes').replaceChildren();flash('请打开视频后点“刷新视频资料”。');}}
  catch{}finally{polling=false;}
},1200);
let stateBusy=false;
setInterval(async()=>{
  if(stateBusy||reading||view!=='text'||!currentTranscript(item)||document.hidden)return;
  stateBusy=true;const id=item.id;
  try{const r=await send('VIDEO_STATE',{id,tabId});if(item?.id!==id)return;
    const rows=currentTranscript(item).rows,index=rows.findIndex(row=>r.time>=row.start&&r.time<row.end);
    if(index===playbackIndex)return;playbackIndex=index;
    for(const line of document.querySelectorAll('.transcript-line'))line.classList.toggle('playing',Number(line.dataset.index)===index);
    if(following&&!r.paused&&!$('#search').value&&getSelection()?.isCollapsed!==false)document.querySelector(`.transcript-line[data-index="${index}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});
  }catch{}finally{stateBusy=false;}
},1200);

read();
