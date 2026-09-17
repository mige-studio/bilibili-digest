import test from 'node:test';
import assert from 'node:assert/strict';
import {videoRef,noteId,sourceUrl,normalizeCapture,mergeCapture,hash,makeNote,validateOverview} from '../src/core.js';
import {transcriptBody,transcriptRanges,normalizeVideo} from '../src/video.js';

const bvid='BV1MA4y1R7J1',base=`https://www.bilibili.com/video/${bvid}/`;

test('BV 与当前分 P 共同确定资料，播放时间参数不改变身份',()=>{
  assert.deepEqual(videoRef(base+'?p=2&t=38'),{bvid,p:2,id:bvid+'-p2'});
  assert.equal(noteId(base),bvid+'-p1');
  assert.equal(sourceUrl(bvid+'-p2'),base+'?p=2');
  assert.equal(noteId('https://www.bilibili.com/bangumi/play/ep1'),null);
});

test('公开视频资料只保留当前分 P、互动数据与已校验音轨',async()=>{
  const raw={id:bvid+'-p2',url:base+'?p=2',bvid,cid:'2002',p:2,title:'对话 · P2',author:'测试作者',body:'视频简介',kind:'video',engagement:{view:1000,danmaku:20,reply:8,like:100,coin:30,favorite:40,share:5},video:{url:'https://a.mcdn.bilivideo.cn:8082/audio.m4s',mediaId:bvid+'-2002',duration:60}};
  const item=mergeCapture(null,normalizeCapture(raw),await hash(raw.body));
  assert.equal(item.id,bvid+'-p2');assert.equal(item.video.key,'video:'+bvid+'-2002');assert.equal(item.engagement.coins,30);assert.equal(item.engagement.views,1000);
  assert.throws(()=>normalizeCapture({...raw,id:bvid+'-p1'}),/当前 B 站视频/);
  assert.throws(()=>normalizeCapture({...raw,video:{url:'https://evil.example/a.m4s',duration:60}}),/音轨/);
});

test('画线笔记和概览必须绑定完整逐字稿原话',async()=>{
  const video=normalizeVideo({url:'https://a.mcdn.bilivideo.cn/audio.m4s',mediaId:bvid+'-2002',duration:60});
  const transcript={mediaKey:video.key,duration:60,rows:[{text:'第一位讲者先说明问题。',start:0,end:4,speaker:'1'},{text:'第二位讲者补充方法。',start:5,end:9,speaker:'2'}]};
  const caption='视频简介',body=transcriptBody(caption,transcript),item={id:bvid+'-p2',url:base+'?p=2',bvid,cid:'2002',p:2,title:'对话',author:'测试',kind:'video',caption,body,bodyHash:await hash(body),video,transcript,notes:[],overviews:{},revisions:[],speakerNames:{}};
  const ranges=transcriptRanges(item),note=makeNote(item,ranges[1].text,ranges[1].offset);
  assert.deepEqual(note.times,[{start:5,end:9,speaker:'2'}]);
  const overview=validateOverview({chapters:[{sourceIndex:0,title:'问题',summary:'先提出问题。'},{sourceIndex:1,title:'方法',summary:'再补充方法。'}],keyQuotes:[{sourceIndex:1,quote:'第二位讲者补充方法。'}]},item);
  assert.equal(overview.keyQuotes[0].quote,ranges[1].text);
  assert.throws(()=>validateOverview({chapters:[{sourceIndex:1,title:'错误',summary:'未覆盖开头'}],keyQuotes:[]},item),/顺序/);
});
