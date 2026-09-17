import {savedKey} from './saved-key.js';
import {send} from './client.js';
const $=s=>document.querySelector(s),origins=['https://openspeech.bytedance.com/*','https://*.bilivideo.com/*','https://*.bilivideo.cn/*'];
const key=savedKey($('#voice-key'),$('#voice-key-change'));
let busy=true,configured=false;
const show=text=>$('#voice-config-status').textContent=text;
function controls(){$('#voice-key-change').disabled=busy;$('#voice-save').disabled=busy;$('#voice-import').disabled=busy;$('#voice-connect').disabled=busy||!configured;}
async function read(){const state=await send('VOICE_STATUS');configured=state.configured;const allowed=await chrome.permissions.contains({origins});$('#voice-connect').hidden=allowed;$('#voice-permission').textContent=allowed?'连接权限已开启。':'连接权限尚未开启。';return state;}
async function saveVoice(apiKey){
 if(busy)return;busy=true;controls();
 try{const r=await send('SAVE_VOICE_SETTINGS',{apiKey});configured=r.configured;if(configured){key.display(true);show('语音配置已保存，Key 已隐藏；需要修改时点“更换 Key”。');}else show('请先填写火山语音 API Key。');}
 catch{show('语音配置保存失败，输入仍保留，请重试。');}finally{busy=false;controls();}
}
$('#voice-save').onclick=()=>saveVoice(key.value());
$('#voice-import').onclick=()=>{if(!busy)$('#voice-file').click();};
$('#voice-file').onchange=async()=>{
 const file=$('#voice-file').files?.[0];if(!file||busy)return;
 try{
  if(file.size>8192)throw new Error();
  const data=JSON.parse(await file.text());
  if(data.provider!=='volcengine-speech'||typeof data.apiKey!=='string'||!data.apiKey.trim())throw new Error();
  await saveVoice(data.apiKey);
 }catch{show('未导入：请选择有效的火山语音配置文件；已有设置保留。');}
 finally{$('#voice-file').value='';}
};
$('#voice-connect').onclick=()=>{
 if(busy||!configured)return;busy=true;controls();
 let request;try{request=chrome.permissions.request({origins});}catch{request=Promise.reject();}
 Promise.resolve(request).then(async allowed=>{await read();show(allowed?'语音配置已保存，连接已允许。':'语音配置已保存；连接权限未开启，可稍后再试。');}).catch(()=>show('语音配置已保存；授权暂未完成。')).finally(()=>{busy=false;controls();});
};
controls();read().then(s=>{key.display(s.configured);show(s.configured?'语音配置已保存，Key 已隐藏。':'尚未配置语音服务。');}).catch(()=>show('语音设置暂未读到，请重新打开设置页。')).finally(()=>{busy=false;controls();});
