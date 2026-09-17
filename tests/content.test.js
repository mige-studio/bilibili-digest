import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const script=readFileSync(new URL('../src/content.js',import.meta.url),'utf8');

test('真实页面适配只读取当前分 P，并选择可转写的 B 站 AAC 音轨',async()=>{
  const bvid='BV1MA4y1R7J1',messages=[];let listener;
  const dom=new JSDOM('<video></video>',{url:`https://www.bilibili.com/video/${bvid}/?p=2`,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,video=w.document.querySelector('video');Object.defineProperty(video,'duration',{value:120});Object.defineProperty(video,'currentTime',{value:0,writable:true});video.play=async()=>{};
  w.structuredClone=structuredClone;w.setInterval=()=>{};w.AbortSignal.timeout=()=>undefined;
  w.chrome={runtime:{sendMessage:async message=>{messages.push(message);return {ok:true};},onMessage:{addListener:fn=>listener=fn}}};
  w.fetch=async url=>({ok:true,json:async()=>String(url).includes('/view?')?{code:0,data:{bvid,title:'多 P 对话',desc:'公开简介',owner:{name:'测试作者'},duration:180,pages:[{cid:1001,duration:60,part:'第一段'},{cid:1002,duration:120,part:'第二段'}],stat:{view:1000,danmaku:20,reply:8,like:100,coin:30,favorite:40,share:5}}}:{code:0,data:{dash:{audio:[{bandwidth:128000,baseUrl:'https://high.mcdn.bilivideo.cn:8082/high.m4s'},{bandwidth:64000,baseUrl:'https://low.mcdn.bilivideo.cn:8082/low.m4s',backupUrl:['https://backup.bilivideo.com/low.m4s']}]}}}});
  w.eval(script);await new Promise(r=>setTimeout(r,0));
  const call=message=>new Promise(resolve=>{const async=listener(message,{},resolve);assert.equal(async,true);});
  try{
    const result=await call({type:'BILI_CAPTURE'});assert.ok(result.ok,result.error);
    assert.equal(result.data.id,bvid+'-p2');assert.equal(result.data.cid,'1002');assert.match(result.data.title,/P2 第二段/);assert.equal(result.data.video.url,'https://low.mcdn.bilivideo.cn:8082/low.m4s');assert.equal(result.data.video.mediaId,bvid+'-1002');assert.equal(result.data.engagement.coin,30);
    const state=await new Promise(resolve=>listener({type:'BILI_VIDEO_STATE',id:bvid+'-p2'},{},resolve));assert.equal(state.duration,120);
    await new Promise(resolve=>listener({type:'BILI_VIDEO_SEEK',id:bvid+'-p2',time:35},{},resolve));assert.equal(video.currentTime,35);
    assert.ok(messages.some(m=>m.type==='BILI_SCOPE'&&m.id===bvid+'-p2'));
  }finally{w.close();}
});
