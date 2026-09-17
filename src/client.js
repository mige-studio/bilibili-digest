export async function send(type,data={}){
  if(!globalThis.chrome?.runtime?.id)throw new Error('请将本目录加载为 Chrome 扩展，再打开精读。');
  const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.error||'操作未完成，请重试。');return r;
}
export function el(tag,text='',cls=''){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
export function action(label,fn,cls=''){const b=el('button',label,cls);b.type='button';b.addEventListener('click',fn);return b;}
export function download(name,text,type='text/markdown;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function flash(message){document.querySelector('#status').textContent=message;}
export async function attempt(fn){try{await fn();}catch(e){flash(e.message);}}
