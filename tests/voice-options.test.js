import {savedKey} from '../src/saved-key.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../src/options.html',import.meta.url),'utf8'),script=fs.readFileSync(new URL('../src/voice-options.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(r=>setTimeout(r,0));
test('语音配置导入独立保存，不回显，不触发连接或导航；错误文件保留配置',async()=>{
 const dom=new JSDOM(html,{url:'https://preview.test/options.html',runScripts:'outside-only'}),w=dom.window,$=s=>w.document.querySelector(s);let stored='',permissions=0;
 w.chrome={permissions:{contains:async()=>false,request:async()=>{permissions++;return false;}}};w.send=async(type,data)=>{if(type==='VOICE_STATUS')return {configured:!!stored};if(type==='SAVE_VOICE_SETTINGS'){stored=data.apiKey||stored;return {configured:!!stored};}};
 w.savedKey=savedKey;w.eval(script);await tick();
 try{
  const input=$('#voice-file');Object.defineProperty(input,'files',{configurable:true,value:[{size:80,text:async()=>JSON.stringify({provider:'volcengine-speech',apiKey:'unit-test-voice-value'})}]});
  await input.onchange();assert.equal(stored,'unit-test-voice-value');assert.match($('#voice-config-status').textContent,/已保存/);assert.equal($('#voice-key').value,'••••••••');assert.ok(!w.document.body.textContent.includes(stored));assert.equal(permissions,0);assert.equal(w.location.href,'https://preview.test/options.html');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:80,text:async()=>JSON.stringify({provider:'wrong',apiKey:'reject'})}]});await input.onchange();assert.equal(stored,'unit-test-voice-value');assert.match($('#voice-config-status').textContent,/未导入/);
  $('#voice-connect').click();await tick();assert.equal(permissions,1);assert.equal(stored,'unit-test-voice-value');assert.match($('#voice-config-status').textContent,/配置已保存/);
 }finally{w.close();}
});
