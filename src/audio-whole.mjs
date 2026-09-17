// Derived from douyin-digest 0.2.2, MIT. See NOTICE.md.
import {createFile,DataStream} from './vendor/mp4box/mp4box.all.mjs';
// Keep the source AAC samples intact. The provider receives one recording and
// assigns speakers once; no PCM decoding, reference voices or per-chunk ASR.
export async function wholeAudio(stream) {
  // Serialize small MP4 fragments immediately. addSample() retains a moof/mdat
  // object tree per AAC frame, which exhausted the renderer on long recordings.
  // All fragments below still form ONE recording and ONE recognition request.
  const file=createFile(),writer=createFile(),fragments=[];
  let track,outputId,first,last,editOffset=0,fileStart=0,count=0,bytes=0,error;
  file.onError=()=>{error=new Error('无法读取这份音频，目前支持 MP4/M4A 音轨。');};
  file.onReady=info=>{
    track=info.audioTracks?.[0];
    if(!track||!track.codec.startsWith('mp4a.')||track.duration/track.timescale>18000)throw new Error('没有可处理的 AAC 音轨，或节目超过五小时。');
    const raw=file.getTrackById(track.id),entry=raw.mdia.minf.stbl.stsd.entries[0],edits=raw.edts?.elst?.entries||[];
    for(const e of edits){if(e.media_time===-1)editOffset+=e.segment_duration/info.timescale;else{editOffset-=e.media_time/track.timescale;break;}}
    if(edits.length>2)throw new Error('音轨时间结构暂不支持，未提交转写。');
    outputId=writer.addTrack({type:entry.type,hdlr:'soun',timescale:track.timescale,samplerate:entry.samplerate,channel_count:entry.channel_count,description_boxes:entry.boxes});
    file.setExtractionOptions(track.id,null,{nbSamples:512});file.start();
  };
  file.onSamples=(id,user,samples)=>{
    if(!samples.length)return;
    first??={cts:samples[0].cts,dts:samples[0].dts};
    const entries=[];let dataBytes=0;
    for(const sample of samples){
      if(last&&Math.abs(sample.cts-last.cts-last.duration)/track.timescale>.01)throw new Error('音轨时间不连续，已停止处理。');
      entries.push({track_id:outputId,dts:sample.dts-first.dts,cts:sample.cts-first.cts,duration:sample.duration,size:sample.data.byteLength,is_sync:true});
      dataBytes+=sample.data.byteLength;last={cts:sample.cts,duration:sample.duration};count++;
    }
    const moof=writer.createMoof(entries);moof.computeSize();moof.trafs[0].truns[0].data_offset=moof.size+8;
    const out=new DataStream();moof.write(out);
    const data=new Uint8Array(dataBytes+8),view=new DataView(data.buffer);view.setUint32(0,data.length);data.set([109,100,97,116],4);
    let at=8;for(const sample of samples){data.set(sample.data,at);at+=sample.data.length;}
    const fragment=new Blob([out.buffer,data]);bytes+=fragment.size;
    if(bytes>450000000)throw new Error('整期音轨超过 450 MB，未提交转写。');
    fragments.push(fragment);file.releaseUsedSamples(id,samples.at(-1).number+1);
  };
  try{
    for await(const input of stream)for(let i=0;i<input.byteLength;i+=262144){
      const part=input.subarray(i,i+262144),buffer=part.buffer.slice(part.byteOffset,part.byteOffset+part.byteLength);
      buffer.fileStart=fileStart;fileStart+=buffer.byteLength;
      if(fileStart>1073741824)throw new Error('音视频文件超过 1 GB，已停止读取。');
      file.appendBuffer(buffer);if(error)throw error;
    }
    file.flush();if(error)throw error;
    if(!track||!count||count!==file.getTrackSamplesInfo(track.id).length)throw new Error('音频未下载完整，未提交转写。');
    const duration=(last.cts+last.duration-first.cts)/track.timescale,offset=first.cts/track.timescale+editOffset;
    if(duration>18000||Math.abs(offset)>1)throw new Error('音轨时长或起点不支持整期识别，未提交转写。');
    const raw=writer.getTrackById(outputId);writer.moov.mvhd.timescale=track.timescale;writer.moov.mvhd.duration=duration*track.timescale;
    raw.tkhd.duration=duration*track.timescale;raw.mdia.mdhd.duration=duration*track.timescale;
    const buffer=new Blob([writer.getBuffer().buffer,...fragments],{type:'audio/mp4'});
    if(buffer.size>450000000)throw new Error('整期音轨超过 450 MB，未提交转写。');
    return {buffer,duration,offset,index:0};
  }finally{file.stop();}
}
