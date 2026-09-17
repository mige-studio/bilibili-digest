import {savedKey} from './saved-key.js';
import {send,flash} from './client.js';
const $=s=>document.querySelector(s),origins=['https://api.deepseek.com/*'];
const key=savedKey($('#key'),$('#key-change'));
let busy=true,configured=false;
function controls(){
  $('#key-change').disabled=busy;$('#save').disabled=busy;$('#clear').disabled=busy;
  $('#connect').disabled=busy||!configured;
}
async function status(){
  const state=await send('SETTINGS_STATUS');configured=state.configured;
  const allowed=await chrome.permissions.contains({origins});
  $('#connection-status').textContent=allowed?'连接权限已开启。':'连接权限尚未开启；保存设置后可单独允许连接。';
  $('#connect').hidden=allowed;
  return state;
}
async function save(){
  if(busy)return;busy=true;controls();flash('正在保存设置…');
  try{
    const model=$('#model').value;
    const saved=await send('SAVE_SETTINGS',{apiKey:key.value(),model});
    if(!saved.configured){flash('尚未填写 API Key，请填写后再保存。');return;}
    configured=true;key.display(true);
    flash('设置已保存。Key 已隐藏；需要修改时点“更换 Key”。');
    try{await status();}catch{$('#connection-status').textContent='设置已保存；连接权限状态暂未读到，可点击允许连接。';$('#connect').hidden=false;}
  }catch{flash('设置未保存成功，输入仍保留。请确认扩展已启用后重试；若刚更新过扩展，请重新打开设置页。');}
  finally{busy=false;controls();}
}
// Never navigate or depend on a permission prompt to persist the user's input.
$('#form').onsubmit=e=>{e.preventDefault();save();};
$('#save').onclick=save;
$('#connect').onclick=()=>{
  if(busy||!configured)return;
  busy=true;controls();flash('设置已保存，正在请求连接权限…');
  // Keep the request in this separate user gesture. It never saves or clears Key.
  let request;
  try{request=chrome.permissions.request({origins});}catch{request=Promise.reject();}
  Promise.resolve(request).then(async allowed=>{
    if(!allowed){flash('设置已保存；尚未允许连接，可稍后再试。');return;}
    await status();flash('设置已保存，连接权限已开启。可以回到 B 站视频生成概览或解释选段。');
  }).catch(()=>flash('设置已保存；连接授权暂未完成，可稍后再试。'))
    .finally(()=>{busy=false;controls();});
};
$('#clear').onclick=async()=>{
  if(busy)return;busy=true;controls();
  try{await send('CLEAR_SETTINGS');key.display(false);await status();flash('本扩展服务配置已清除，资料和笔记保留。');}
  catch{flash('清除未完成，已有配置保留。');}finally{busy=false;controls();}
};
controls();
(async()=>{
  try{const state=await status();$('#model').value=state.model;key.display(state.configured);flash(state.configured?'已保存服务配置；Key 已隐藏。需要修改时点“更换 Key”。':'尚未保存服务配置。');$('#version').textContent=chrome.runtime.getManifest().version_name;}
  catch{flash('设置状态暂未读取，请确认扩展已启用；若刚更新过扩展，请重新打开本页。');}
  finally{busy=false;controls();}
})();
