import {meta,documents,saveFiles} from './library-files.js';
import {currentTranscript} from './video.js';
import {send,el,action,flash,attempt,download} from './client.js';
import {searchItems,exportMarkdown} from './core.js';
let items=[],folder=null,exportsById={},saving=false;const $=s=>document.querySelector(s);
async function load(){items=(await send('LIST')).items;render();}
function render(){
  const selected=items.filter(x=>x.kind==='video'),found=searchItems(selected,$('#query').value);$('#total').textContent=`${found.length} 条视频资料 · 共 ${selected.reduce((n,x)=>n+x.notes.filter(n=>!n.deleted).length,0)} 条笔记`;
  const list=$('#list');list.replaceChildren();
  if(!found.length)list.append(el('p',items.length?'没有找到匹配内容。':'在B站内容页打开精读后，资料会出现在这里。','empty'));
  for(const item of found){const card=el('article','','card');card.append(el('h2',item.title),el('p',`${item.author||'作者未读取'} · P${item.p||1} · ${currentTranscript(item)?'说话人逐字稿':'视频简介'} · ${item.notes.filter(n=>!n.deleted).length}条笔记`,'muted'));const tools=el('div','','actions');
    const link=el('a','打开原页');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
    tools.append(action('阅读资料',()=>show(item)),action('保存到本机',()=>attempt(()=>save([item]))),action('下载阅读文件',()=>{download(`B站精读-${item.id}.md`,exportMarkdown(item));flash('已发起下载，请在浏览器下载记录中查看。');}),link);card.append(tools);list.append(card);
  }
}
function show(item){
 const box=$('#detail');box.hidden=false;box.replaceChildren();box.append(action('收起资料',()=>{box.hidden=true;}),el('h2',item.title));
 const tabs=el('div','','actions'),body=el('pre','','card');for(const doc of documents(item))tabs.append(action(doc.name,()=>{body.textContent=doc.text;}));box.append(tabs,body);body.textContent=documents(item)[0].text;
 const saved=exportsById[item.id];if(saved){box.append(el('p','上次保存：'+saved.rootName+' / '+saved.folder,'muted'));const details=el('details');details.append(el('summary','查看已保存的本机文件'));
  for(const filename of saved.files)details.append(action(filename,()=>attempt(async()=>{
   const root=saved.rootHandle;if(await root.queryPermission({mode:'read'})!=='granted'&&await root.requestPermission({mode:'read'})!=='granted')throw new Error('请允许读取已选择的资料文件夹。');
   let dir=root;for(const part of saved.folder.split('/'))dir=await dir.getDirectoryHandle(part);const file=await(await dir.getFileHandle(filename)).getFile();if(file.size>20*1024*1024)throw new Error('文件较大，请在本机打开。');body.textContent=await file.text();flash('正在阅读已保存的本机文件：'+filename);
  })));box.append(details);
 }
 box.scrollIntoView({behavior:'smooth'});
}
function folderLabel(){$('#choose-folder').textContent=folder?'更换资料文件夹':'选择资料文件夹';$('#folder-name').textContent=folder?'保存位置：'+folder.name+' / B站 / 视频标题（点击保存后写入）':'尚未选择资料文件夹；资料仍在浏览器内。';}
async function choose(){if(!window.showDirectoryPicker)throw new Error('请使用 Chrome 选择文件夹，或使用下载按钮。');const picked=await showDirectoryPicker({id:'bilibili-digest-exports',mode:'readwrite'});await meta('folder',picked);folder=picked;folderLabel();flash('保存位置已记住。点击保存后才写入文件。');}
async function save(snapshot){
 if(saving)return;if(!snapshot.length)throw new Error('还没有可保存的资料');saving=true;$('#folder').disabled=$('#choose-folder').disabled=true;
 try{
  if(!folder)await choose();if(await folder.queryPermission({mode:'readwrite'})!=='granted'&&await folder.requestPermission({mode:'readwrite'})!=='granted')throw new Error('写入权限未开启，资料仍在扩展中。');
  const run=()=>saveFiles(folder,snapshot,async record=>{exportsById[record.id]=record;await meta('exports',exportsById);});
  const result=navigator.locks?await navigator.locks.request('bilid-file-export',run):await run();
  flash('已保存 '+result.saved.length+' 篇资料，新增 '+result.written+' 个文件；相同内容不重复保存，不覆盖已有文件。');
 }finally{saving=false;$('#folder').disabled=$('#choose-folder').disabled=false;folderLabel();}
}
$('#choose-folder').onclick=()=>attempt(choose);
$('#query').oninput=render;$('#reload').onclick=()=>attempt(load);
$('#backup').onclick=()=>attempt(async()=>{await load();if(!items.length)throw new Error('还没有可备份的资料');download('B站精读-资料备份-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'bilibili-digest',schemaVersion:1,exportedAt:new Date().toISOString(),items},null,2),'application/json');flash('已发起备份下载，含原文历史、笔记和概览，不含服务密钥。');});
$('#folder').onclick=()=>attempt(async()=>{await load();await save(items.slice());});
meta('folder').then(value=>{folder=value||null;folderLabel();}).catch(()=>flash('保存位置未能读取，请重新选择文件夹。'));
meta('exports').then(value=>exportsById=value||{}).catch(()=>{});
attempt(load);

document.addEventListener('visibilitychange',()=>{if(!document.hidden)attempt(load);});
let reloadTimer;chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(key=>key.startsWith('bilid_item_'))){clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>attempt(load),200);}});
