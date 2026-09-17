// Persistent folder selection and non-overwriting exports, following Douyin Digest (MIT).
import {exportMarkdown,exportNotes} from './core.js';
import {currentTranscript,videoMarkdown,clockTime} from './video.js';
let opened;
function db(){return opened??=(new Promise((resolve,reject)=>{const r=indexedDB.open('bilid-library-files-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('meta');r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opened=null;reject(r.error);};}));}
export async function meta(key,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('meta',value===undefined?'readonly':'readwrite'),store=tx.objectStore('meta'),r=value===undefined?store.get(key):store.put(value,key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export function documents(item){
 const header='# '+item.title+'\n\n作者：'+(item.author||'未读取')+'\n\n来源：'+item.url+'\n\n';
 const docs=[{name:'完整资料',text:exportMarkdown(item)}];
 if(currentTranscript(item))docs.push({name:'逐字稿',text:header+videoMarkdown(item)+'\n'});
 const o=item.overviews[item.bodyHash];if(o)docs.push({name:'内容概览',text:header+o.chapters.map(c=>'## '+(Number.isFinite(c.time)?clockTime(c.time)+' ':'')+c.title+'\n\n'+c.summary).join('\n\n')+'\n\n## 关键原话\n\n'+o.keyQuotes.map(q=>q.quote).join('\n\n')+'\n'});
 if(item.notes.some(n=>!n.deleted))docs.push({name:'我的笔记',text:exportNotes(item)});return docs;
}
export async function writeUnique(dir,name,text,extension='md'){
 for(let i=1;i<=1000;i++){
  const filename=name+(i===1?'':'（'+i+'）')+'.'+extension;
  try{const existing=await dir.getFileHandle(filename);if(await(await existing.getFile()).text()===text)return {name:filename,written:false};continue;}
  catch(e){if(e.name!=='NotFoundError')throw e;}
  const handle=await dir.getFileHandle(filename,{create:true}),writer=await handle.createWritable();
  try{await writer.write(text);await writer.close();}catch(e){await writer.abort().catch(()=>{});throw e;}
  return {name:filename,written:true};
 }throw new Error('同名文件过多，请另选资料文件夹。');
}
export async function saveFiles(root,items,onProgress=()=>{}){
 const platform=await root.getDirectoryHandle('B站',{create:true});let written=0;const saved=[];
 for(const item of items){
  const title=item.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').trim().slice(0,100)||'未命名视频',folder=title+' ['+item.id+']',dir=await platform.getDirectoryHandle(folder,{create:true}),files=[];
  for(const doc of documents(item)){const r=await writeUnique(dir,doc.name,doc.text);written+=Number(r.written);files.push(r.name);}
  const backup=await writeUnique(dir,'完整备份',JSON.stringify({format:'bilibili-digest',schemaVersion:1,items:[item]},null,2),'json');written+=Number(backup.written);files.push(backup.name);
  const result={id:item.id,folder:'B站/'+folder,files,rootName:root.name,rootHandle:root,savedAt:Date.now()};saved.push(result);await onProgress(result);
 }
 return {saved,written};
}
