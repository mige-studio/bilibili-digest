import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {makeNote,hash,exportMarkdown,exportNotes} from '../src/core.js';
import {normalizeVideo,currentTranscript,videoEligible,clockTime,videoMarkdown,transcriptRanges,videoTimeLink,MAX_VIDEO_SECONDS,transcriptBody} from '../src/video.js';

const html=readFileSync(new URL('../src/panel.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../src/panel.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,12));

function makeItem(){
  const video=normalizeVideo({url:'https://xy.mcdn.bilivideo.cn:8082/test.m4s',duration:60,mediaId:'BV1MA4y1R7J1-739618564'});
  const transcript={mediaKey:video.key,duration:60,rows:[{text:'第一位说话人先提出问题。',start:0,end:5,speaker:'1'},{text:'第二位说话人再补充做法。',start:5,end:10,speaker:'2'}]};
  const caption='公开视频简介',body=transcriptBody(caption,transcript);
  return {id:'BV1MA4y1R7J1-p1',bvid:'BV1MA4y1R7J1',cid:'739618564',p:1,title:'模拟 B 站对话',author:'测试作者',url:'https://www.bilibili.com/video/BV1MA4y1R7J1/?p=1',kind:'video',caption,body,video,transcript,bodyHash:null,notes:[],overviews:{},speakerNames:{},engagement:{views:1000,danmaku:20,likes:100,coins:30,favorites:40,comments:8,shares:5}};
}

function boot(item,handler){
  const dom=new JSDOM(html,{url:'https://preview.test/src/panel.html?tab=9',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  const intervals=[];let clipboard='',exported='';
  w.chrome={runtime:{id:'simulation'},tabs:{query:async()=>[{id:9}],create:async()=>({})}};
  w.setInterval=fn=>{intervals.push(fn);return intervals.length;};w.clearInterval=()=>{};w.scrollTo=()=>{};w.scrollBy=()=>{};
  w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};w.Range.prototype.getBoundingClientRect=()=>({left:20,top:200,bottom:240});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{clipboard=text;}}});
  w.el=(tag,text='',cls='')=>{const e=w.document.createElement(tag);e.textContent=text;e.className=cls;return e;};
  w.action=(label,fn,cls='')=>{const b=w.el('button',label,cls);b.onclick=fn;return b;};
  w.flash=message=>w.document.querySelector('#status').textContent=message;w.attempt=async fn=>{try{await fn();}catch(error){w.flash(error.message);}};
  w.download=(name,text)=>{exported=text;};
  Object.assign(w,{exportMarkdown,exportNotes,currentTranscript,videoEligible,clockTime,videoMarkdown,transcriptRanges,videoTimeLink,MAX_VIDEO_SECONDS});
  w.send=handler;w.eval(script);
  return {dom,w,intervals,getClipboard:()=>clipboard,getExported:()=>exported};
}

test('阅读栏只保留 B 站视频任务，不混入图文识别',()=>{
  const dom=new JSDOM(html),d=dom.window.document;
  assert.equal(d.querySelector('#read-images, #reading-modes, #restore-reading, script[src*=ocr]'),null);
  assert.equal(d.querySelector('#transcribe-video').textContent.trim(),'生成说话人逐字稿');
  assert.deepEqual([...d.querySelectorAll('nav button')].map(x=>x.textContent.trim()),['逐字稿','内容概览','我的笔记']);dom.window.close();
});

test('说话人逐字稿可回听、搜索、画线、解释、总结、记笔记和改姓名',async()=>{
  let item=makeItem();item.bodyHash=await hash(item.body);const ranges=transcriptRanges(item);
  item.overviews[item.bodyHash]={chapters:[{title:'问题',summary:'先提出问题。',sourceIndex:0,start:ranges[0].offset,time:0}],keyQuotes:[{quote:ranges[1].text,sourceIndex:1,start:ranges[1].offset}],bodyHash:item.bodyHash};
  const calls=[];
  const h=boot(item,async(type,data={})=>{
    calls.push({type,data});
    if(type==='READ'||type==='GET'||type==='LIST')return type==='LIST'?{items:[structuredClone(item)]}:{item:structuredClone(item)};
    if(type==='NOTE'){item.notes.push(makeNote(item,data.quote,data.start));return {item:structuredClone(item)};}
    if(type==='SPEAKER_NAMES'){item.speakerNames=Object.fromEntries(Object.entries(data.names).filter(([,v])=>v));return {item:structuredClone(item)};}
    if(type==='EXPLAIN')return {text:'先确认问题，再根据对话选择做法。'};
    if(type==='VIDEO_STATE')return {time:6,paused:false};
    return {item:structuredClone(item)};
  });
  const {w}=h,$=selector=>w.document.querySelector(selector);await tick();
  try{
    assert.equal(calls[0].type,'READ');assert.equal(calls[0].data.videoOnly,true);
    assert.deepEqual([...w.document.querySelectorAll('.engagement-item small')].map(x=>x.textContent),['播放','弹幕','点赞','投币','收藏','评论','分享']);
    const lines=w.document.querySelectorAll('.transcript-line');assert.equal(lines.length,2);assert.match(lines[0].dataset.label,/说话人 1/);
    lines[1].click();await tick();assert.equal(calls.at(-1).type,'VIDEO_SEEK');assert.equal(calls.at(-1).data.index,1);
    $('#search').value='补充';$('#search').dispatchEvent(new w.Event('input'));assert.equal($('#count').textContent,'1/1');$('#search').value='';$('#search').dispatchEvent(new w.Event('input'));
    const current=w.document.querySelectorAll('.transcript-line'),range=w.document.createRange();range.setStart(current[0].firstChild,2);range.setEnd(current[1].firstChild,6);w.getSelection().addRange(range);w.document.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
    assert.equal($('#selection').hidden,false);$('#explain-selection').click();await tick();assert.match($('#explanation-text').textContent,/确认问题/);$('#close-explanation').click();
    $('#save-selection').click();await tick();assert.equal(item.notes.length,1);assert.equal(item.notes[0].times.length,2);
    $('[data-view="overview"]').click();$('.chapter').click();await tick();assert.equal(calls.at(-1).type,'VIDEO_SEEK');
    [...$('.keyquote').querySelectorAll('button')].find(b=>b.textContent==='存笔记').click();await tick();assert.equal(item.notes.length,2);
    $('[data-view="notes"]').click();await tick();[...$('#notes').querySelectorAll('button')].find(b=>b.textContent==='复制时间链接').click();await tick();assert.match(h.getClipboard(),/p=1&t=0/);
    $('[data-view="text"]').click();$('#speaker-settings').click();$('#speaker-fields input').value='主讲人';$('#save-speakers').click();await tick();assert.match($('.transcript-line').dataset.label,/主讲人/);
    $('#export-video').click();assert.match(h.getExported(),/主讲人/);
    $('#follow-video').click();await h.intervals[1]();assert.equal(w.document.querySelector('.transcript-line[data-index="1"]').classList.contains('playing'),true);
  }finally{h.dom.window.close();}
});
