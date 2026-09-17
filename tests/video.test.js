import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeVideo,videoEligible,validateTranscript,currentTranscript,transcriptBody,transcriptRanges,videoMarkdown,videoTimeLink} from '../src/video.js';
import {makeNote,exportMarkdown} from '../src/core.js';
import {voiceRequest} from '../src/voice.js';
const media='https://xy.mcdn.bilivideo.cn:8082/audio.m4s';
test('视频只接受 B 站公开媒体域名和五小时内时长',()=>{
  assert.equal(videoEligible(normalizeVideo({url:media,duration:90,mediaId:'BV1-test'})),true);
  for(const raw of [{url:'blob:https://www.bilibili.com/a',duration:60},{url:'https://evil.test/a.mp4',duration:60},{url:media,duration:18001},{url:media,duration:null}])assert.equal(videoEligible(normalizeVideo(raw)),false);
});
test('逐字稿、说话人、选段和时间链接保留来源',()=>{
  const rows=validateTranscript([{text:'先看这一点。',start_time:1000,end_time:4000,additions:{speaker:1}},{text:'再看最后一点。',start_time:55000,end_time:58000,additions:{speaker:2}}],60);
  const video=normalizeVideo({url:media,duration:60,mediaId:'BV1MA4y1R7J1-739618564'}),transcript={mediaKey:video.key,duration:60,rows};
  const item={id:'BV1MA4y1R7J1-p1',p:1,title:'模拟短视频',author:'测试',url:'https://www.bilibili.com/video/BV1MA4y1R7J1/?p=1',caption:'作者简介',video,transcript,body:transcriptBody('作者简介',transcript),bodyHash:'test',kind:'video',notes:[],overviews:{},capturedAt:'2026-09-16T00:00:00Z'};
  const ranges=transcriptRanges(item);for(const r of ranges)assert.equal(item.body.slice(r.offset,r.offset+r.length),r.text);
  const n=makeNote(item,rows[1].text,ranges[1].offset);item.notes.push(n);assert.match(exportMarkdown(item),/视频时间：0:55—0:58/);assert.match(videoMarkdown(item),/\[0:55\] 说话人 2/);assert.match(videoTimeLink(item,55),/p=1&t=55/);
  assert.equal(currentTranscript({...item,video:normalizeVideo({url:media,duration:60,mediaId:'BV1MA4y1R7J1-other'})}),null);
});
test('同一 CID 的签名地址变化仍复用，换 CID 立即失效',()=>{
  const video=normalizeVideo({url:media,duration:149.7,mediaId:'BV1MA4y1R7J1-1002'}),transcript={mediaKey:'video:BV1MA4y1R7J1-1002',duration:149.7,rows:[]};assert.equal(currentTranscript({video,transcript}),transcript);
  const changed=normalizeVideo({url:'https://backup.bilivideo.com/other.m4s',duration:149.7,mediaId:'BV1MA4y1R7J1-1003'});assert.equal(currentTranscript({video:changed,transcript}),null);
});
test('语音提交请求启用说话人字段，未知网络结果不伪装拒绝',async()=>{
  const fetcher=async(url,o)=>{assert.match(url,/\/submit$/);const body=JSON.parse(o.body);assert.equal(body.audio.url,media);assert.equal(body.request.enable_speaker_info,true);return new Response('{}',{headers:{'X-Api-Status-Code':'20000000'}});};
  assert.deepEqual(await voiceRequest('submit','test-placeholder',{jobId:'test-id'},media,fetcher),{pending:true});
  await assert.rejects(voiceRequest('submit','test-placeholder',{jobId:'test-id'},media,async()=>{throw new Error('offline');}),e=>e.uncertain===true&&!e.rejected);
});
