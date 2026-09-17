(() => {
  if(globalThis.__bilibiliDigest)return;
  globalThis.__bilibiliDigest=true;

  const ref=()=>{
    const match=location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{8,20})(?:\/|$)/);
    if(!match)return null;
    const p=Number(new URL(location.href).searchParams.get('p')||1);
    return Number.isInteger(p)&&p>0&&p<=1000?{bvid:match[1],p,id:`${match[1]}-p${p}`} : null;
  };
  const player=()=>document.querySelector('.bpx-player-video-wrap video, #bilibili-player video, video');
  const safeMedia=value=>{
    try{const u=new URL(value);const host=u.hostname.toLowerCase();return u.protocol==='https:'&&(host.endsWith('.bilivideo.com')||host.endsWith('.bilivideo.cn'))&&!u.username&&!u.password?u.href:null;}catch{return null;}
  };
  const getJson=async url=>{
    const response=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('B 站视频资料暂时无法读取。');
    const result=await response.json();
    if(result?.code!==0||!result.data)throw new Error(result?.message||'B 站视频资料暂时无法读取。');
    return result.data;
  };

  let cache=null;
  async function capture(){
    const current=ref();
    if(!current)throw new Error('请先打开电脑端 B 站普通视频页。');
    const key=current.id;
    if(cache?.key===key&&Date.now()-cache.at<8000)return structuredClone(cache.value);
    const view=await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(current.bvid)}`);
    const page=view.pages?.[current.p-1];
    if(view.bvid!==current.bvid||!page?.cid)throw new Error('当前分 P 尚未加载，请在原页确认后重试。');
    let playData=null,reason='streams-missing';
    try{playData=await getJson(`https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(current.bvid)}&cid=${encodeURIComponent(page.cid)}&fnval=16&qn=64&fourk=0`);}catch{reason='meta-missing';}
    const audio=(playData?.dash?.audio||[]).map(stream=>({
      url:safeMedia(stream.baseUrl||stream.base_url),
      backup:Array.isArray(stream.backupUrl||stream.backup_url)?(stream.backupUrl||stream.backup_url).map(safeMedia).filter(Boolean):[],
      bandwidth:Number(stream.bandwidth)||0
    })).filter(stream=>stream.url).sort((a,b)=>a.bandwidth-b.bandwidth);
    const chosen=audio[0];
    const title=view.pages?.length>1?`${view.title} · P${current.p}${page.part?' '+page.part:''}`:view.title;
    const value={
      id:current.id,url:location.href,bvid:current.bvid,cid:String(page.cid),p:current.p,title,author:view.owner?.name||'',
      body:String(view.desc||''),kind:'video',engagement:view.stat||null,
      video:{url:chosen?.url||null,sourceUrls:audio.flatMap(x=>[x.url,...x.backup]),mediaId:`${current.bvid}-${page.cid}`,duration:Number(page.duration||view.duration)||null,...(!chosen?{reason}:{})}
    };
    if(ref()?.id!==key)throw new Error('视频已经切换，请重新读取。');
    cache={key,at:Date.now(),value};
    return structuredClone(value);
  }

  const holder=document.createElement('div');
  holder.id='bilid-entry';
  const shadow=holder.attachShadow({mode:'closed'});
  shadow.innerHTML='<style>:host{position:fixed;right:22px;bottom:86px;z-index:2147483000;display:flex;gap:7px}button{font:600 14px/1.5 system-ui;padding:10px 18px;color:#fff;background:#1684c7;border:1px solid #fff;border-radius:24px;box-shadow:0 3px 16px #0003;cursor:pointer}button.secondary{background:#fff;color:#1678b5;border-color:#cce8f7}button:disabled{opacity:.65;cursor:wait}</style><button id="open" type="button">B站精读</button><button id="note" class="secondary" type="button">记下当前</button>';
  const openButton=shadow.querySelector('#open'),noteButton=shadow.querySelector('#note');

  const finish=(button,text)=>{button.disabled=false;button.textContent=text;setTimeout(()=>{button.textContent=button===openButton?'B站精读':'记下当前';},3000);};
  openButton.onclick=()=>{
    if(openButton.disabled)return;openButton.disabled=true;openButton.textContent='正在打开…';
    try{chrome.runtime.sendMessage({type:'BILI_OPEN',id:ref()?.id}).then(r=>finish(openButton,r?.ok?'B站精读':r?.error||'请再点一次')).catch(()=>finish(openButton,'请刷新页面后重试'));}
    catch{finish(openButton,'请刷新页面后重试');}
  };
  noteButton.onclick=()=>{
    if(noteButton.disabled)return;noteButton.disabled=true;noteButton.textContent='正在保存…';
    try{chrome.runtime.sendMessage({type:'BILI_NOTE',id:ref()?.id}).then(r=>finish(noteButton,r?.ok?'原话已保存':r?.error||'请先完成转写')).catch(()=>finish(noteButton,'请刷新页面后重试'));}
    catch{finish(noteButton,'请刷新页面后重试');}
  };

  let last='__initial__';
  function update(){
    const current=ref();holder.hidden=!current;
    if(!holder.isConnected)document.documentElement.append(holder);
    const next=current?.id||'';
    if(next!==last){last=next;cache=null;chrome.runtime.sendMessage({type:'BILI_SCOPE',id:next||null}).then(r=>{if(!r?.ok&&last===next)last='__retry__';}).catch(()=>{if(last===next)last='__retry__';});}
  }

  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type==='BILI_CAPTURE'){
      capture().then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));return true;
    }
    if(msg.type==='BILI_VIDEO_STATE'){
      const video=player();
      if(ref()?.id!==msg.id||!video||!Number.isFinite(video.duration)){reply({ok:false});return;}
      reply({ok:true,time:video.currentTime,duration:video.duration,paused:video.paused});return;
    }
    if(msg.type==='BILI_VIDEO_SEEK'){
      const video=player();
      if(ref()?.id!==msg.id||!video||!Number.isFinite(video.duration)||!Number.isFinite(msg.time)||msg.time<0||msg.time>video.duration){reply({ok:false,error:'视频已切换或时间不可用。'});return;}
      video.currentTime=msg.time;
      video.play().then(()=>reply({ok:true}),()=>reply({ok:true,message:'已定位，请在原播放器点击播放。'}));return true;
    }
  });

  let pending;
  new MutationObserver(()=>{clearTimeout(pending);pending=setTimeout(update,180);}).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(update,750);update();
  addEventListener('pageshow',()=>{last='__refresh__';update();});
})();
