import {savedKey} from '../src/saved-key.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../src/options.html',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../src/options.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup({saved=null,allowed=false}={}){
 const dom=new JSDOM(html,{url:'https://preview.test/options.html',runScripts:'outside-only'}),w=dom.window;
 let stored=saved,requests=0,failSave=false,requestError=false;
 w.chrome={runtime:{getManifest:()=>({version_name:'test'})},permissions:{contains:async()=>allowed,request:()=>{requests++;return requestError?Promise.reject(new Error('interrupted')):Promise.resolve(allowed);}}};
 w.flash=message=>w.document.querySelector('#status').textContent=message;
 w.send=async(type,data)=>{
  if(type==='SAVE_SETTINGS'){if(failSave)throw new Error('context invalidated');stored={apiKey:data.apiKey.trim()||stored?.apiKey||'',model:data.model};return {configured:!!stored.apiKey};}
  if(type==='SETTINGS_STATUS')return {configured:!!stored?.apiKey,model:stored?.model||'test-model'};
  if(type==='CLEAR_SETTINGS'){stored=null;return {};}
 };
 w.savedKey=savedKey;w.eval(script);
 return {dom,w,$:s=>w.document.querySelector(s),get stored(){return stored;},get requests(){return requests;},allow:()=>allowed=true,fail:()=>failSave=true,interrupt:()=>requestError=true};
}
test('设置页先保存和回读，无权限弹窗；拒绝或中断授权不丢已保存配置',async()=>{
 const p=setup();await tick();
 try{
  p.$('#key').value='unit-test-placeholder';p.$('#save').click();await tick();
  assert.equal(p.requests,0);assert.equal(p.stored.apiKey,'unit-test-placeholder');assert.equal(p.$('#key').value,'••••••••');assert.match(p.$('#status').textContent,/设置已保存/);assert.equal(p.$('#connect').disabled,false);
  p.$('#connect').click();await tick();assert.equal(p.requests,1);assert.match(p.$('#status').textContent,/设置已保存；尚未允许连接/);assert.equal(p.stored.apiKey,'unit-test-placeholder');
  p.interrupt();p.$('#connect').click();await tick();assert.match(p.$('#status').textContent,/设置已保存；连接授权暂未完成/);assert.equal(p.stored.apiKey,'unit-test-placeholder');
  assert.equal(p.w.location.href,'https://preview.test/options.html');
 }finally{p.dom.window.close();}
});
test('重新打开只显示配置状态，空白保存保留Key，单独允许连接后可使用',async()=>{
 const p=setup({saved:{apiKey:'unit-test-placeholder',model:'test-model'}});await tick();
 try{
  assert.match(p.$('#status').textContent,/已保存服务配置/);assert.equal(p.$('#key').value,'••••••••');assert.ok(!p.w.document.body.textContent.includes('unit-test-placeholder'));
  p.$('#save').click();await tick();assert.equal(p.stored.apiKey,'unit-test-placeholder');
  p.allow();p.$('#connect').click();await tick();assert.equal(p.$('#connect').hidden,true);assert.match(p.$('#status').textContent,/火山方舟连接已开启/);
 }finally{p.dom.window.close();}
});
test('保存失败不清输入且不跳页，表单回车也阻止默认导航',async()=>{
 const p=setup();await tick();
 try{
  p.fail();p.$('#key').value='unit-test-placeholder';
  const event=new p.w.Event('submit',{cancelable:true});p.$('#form').dispatchEvent(event);await tick();
  assert.equal(event.defaultPrevented,true);assert.equal(p.$('#key').value,'unit-test-placeholder');assert.equal(p.stored,null);assert.match(p.$('#status').textContent,/未保存成功/);assert.equal(p.requests,0);assert.equal(p.$('#save').disabled,false);
 }finally{p.dom.window.close();}
});

test('已保存掩码不会覆盖 Key；更换可取消，清除后恢复未配置',async()=>{
 const p=setup({saved:{apiKey:'unit-test-original',model:'test-model'}});await tick();
 try{
  assert.equal(p.$('#key').readOnly,true);p.$('#save').click();await tick();assert.equal(p.stored.apiKey,'unit-test-original');
  p.$('#key-change').click();assert.equal(p.$('#key').readOnly,false);assert.equal(p.$('#key').value,'');p.$('#key').value='discard-me';p.$('#key-change').click();p.$('#save').click();await tick();assert.equal(p.stored.apiKey,'unit-test-original');
  p.$('#key-change').click();p.$('#key').value='unit-test-replaced';p.$('#save').click();await tick();assert.equal(p.stored.apiKey,'unit-test-replaced');assert.equal(p.$('#key').readOnly,true);
  p.$('#clear').click();await tick();assert.equal(p.stored,null);assert.equal(p.$('#key').value,'');assert.equal(p.$('#key').readOnly,false);assert.equal(p.$('#key-change').hidden,true);
 }finally{p.dom.window.close();}
});
