import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/core.js';
import {transcriptBody} from '../src/video.js';

const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});

test('后台只保存当前分 P，姓名、笔记和回听都绑定同一份逐字稿',async()=>{
  const bvid='BV1MA4y1R7J1',id=bvid+'-p1';let currentUrl=`https://www.bilibili.com/video/${bvid}/?p=1`,listener,seek;
  const capture={id,url:currentUrl,bvid,cid:'739618564',p:1,title:'后台模拟对话',author:'测试',body:'公开简介',kind:'video',engagement:{view:100},video:{url:'https://xy.mcdn.bilivideo.cn:8082/a.m4s',mediaId:bvid+'-739618564',duration:60}};
  const local={},session={};
  const area=data=>({
    async get(key){if(key===null)return structuredClone(data);if(Array.isArray(key))return Object.fromEntries(key.filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));return {[key]:structuredClone(data[key])};},
    async set(values){for(const [key,value]of Object.entries(values))data[key]=structuredClone(value);},async remove(key){for(const k of Array.isArray(key)?key:[key])delete data[k];},async setAccessLevel(){}
  });
  globalThis.chrome={
    runtime:{id:'unit',getURL:path=>'chrome-extension://unit/'+path,onMessage:{addListener:fn=>listener=fn},onInstalled:event(),onStartup:event(),getContexts:async()=>[]},
    storage:{local:area(local),session:area(session)},sidePanel:{setOptions:async()=>{},setPanelBehavior:async()=>{},open:async()=>{}},
    tabs:{get:async()=>({id:7,url:currentUrl}),sendMessage:async(tabId,message)=>{if(message.type==='BILI_CAPTURE')return {ok:true,data:structuredClone(capture)};if(message.type==='BILI_VIDEO_SEEK'){seek=message.time;return {ok:true};}if(message.type==='BILI_VIDEO_STATE')return {ok:true,time:7,duration:60,paused:false};return {ok:true};},onRemoved:event(),onUpdated:event(),create:async()=>({})},
    action:{onClicked:event(),setTitle:async()=>{}},alarms:{onAlarm:event(),create:async()=>{},clear:async()=>{}},permissions:{contains:async()=>true},offscreen:{createDocument:async()=>{}},declarativeNetRequest:{updateSessionRules:async()=>{}}
  };
  await import('../src/background.js?background-test='+Date.now());
  const internal={id:'unit',url:'chrome-extension://unit/src/panel.html',frameId:0};
  const call=(message,sender=internal)=>new Promise(resolve=>{assert.equal(listener(message,sender,resolve),true);});
  const read=await call({type:'READ',tabId:7,videoOnly:true});assert.equal(read.ok,true);assert.equal(read.item.id,id);assert.equal(read.item.p,1);assert.equal(read.item.caption,'公开简介');
  let item=local['bilid_item_'+id];
  item.transcript={mediaKey:item.video.key,duration:60,rows:[{text:'主讲人先说。',start:0,end:5,speaker:'1'},{text:'嘉宾再补充。',start:5,end:10,speaker:'2'}]};
  item.body=transcriptBody(item.caption,item.transcript);item.bodyHash=await hash(item.body);local['bilid_item_'+id]=structuredClone(item);
  const named=await call({type:'SPEAKER_NAMES',id,bodyHash:item.bodyHash,names:{'1':'主讲人','2':'嘉宾'}});assert.equal(named.ok,true);assert.deepEqual(named.item.speakerNames,{'1':'主讲人','2':'嘉宾'});
  const start=item.body.indexOf('嘉宾再补充。'),noted=await call({type:'NOTE',id,bodyHash:item.bodyHash,quote:'嘉宾再补充。',start});assert.equal(noted.ok,true);assert.equal(noted.item.notes[0].times[0].speaker,'2');
  const replay=await call({type:'VIDEO_SEEK',id,tabId:7,index:1});assert.equal(replay.ok,true);assert.equal(seek,5);
  currentUrl=`https://www.bilibili.com/video/${bvid}/?p=2`;
  const switched=await call({type:'VIDEO_SEEK',id,tabId:7,index:1});assert.equal(switched.ok,false);assert.match(switched.error,/请先打开这篇视频/);
});
