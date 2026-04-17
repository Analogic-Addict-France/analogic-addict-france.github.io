'use strict';
// ── CONSTANTS ─────────────────────────────────────────────
const PAPER = { a3:{w:420,h:297}, a4:{w:297,h:210}, a5:{w:210,h:148}, letter:{w:279,h:216}, tabloid:{w:432,h:279} };
const VHS_FACE_MM  = { w: 77.8,  h: 46.8  };
const VHS_SPINE_MM = { w: 147.6, h: 16.9  };
const VHS_SLIPCASE_MM = { w: 257.2, h: 200 };
const JCARD_MM     = { w: 101.6, h: 101.6 };
const LABEL_LOGO_DEFAULT = 'https://analogic-addict-france.site/img/logo.png';

// ── STATE ──────────────────────────────────────────────────
const state = {
  vhs:   { format:'a4', logos:new Set(), customLogos:[], img:null, labelLogo:null },
  jcard: { format:'a4', tracksA:[], tracksB:[], img:null, labelLogo:null },
  cd:    { format:'a4', tracksCD:[], img:null, searchMode:'tmdb', labelLogo:null }
};
const imgTransform = {
  vhs:   {zoom:1,ox:0,oy:0},
  jcard: {zoom:1,ox:0,oy:0},
  cd:    {zoom:1,ox:0,oy:0}
};
const textItems = { vhs:[], jcard:[], cd:[] };
const editState = { vhs:{ editing:false, selected:null }, jcard:{ editing:false, selected:null }, cd:{ editing:false, selected:null } };
let labelLogoCache = {};

// ── CANVAS ACCESSORS ──────────────────────────────────────
function getCanvas(mode){ return document.getElementById(mode==='vhs'?'vhsCanvas':mode==='jcard'?'jcardCanvas':'cdCanvas'); }
function getLayer(mode){ return document.getElementById(mode+'TextLayer'); }
function getWrapper(mode){ return document.getElementById(mode+'Wrapper'); }

// ── HELPERS ──────────────────────────────────────────────
function loadImg(src){
  return new Promise(res=>{
    if(!src) return res(null);
    const img=new Image(); img.crossOrigin='anonymous';
    img.onload=()=>res(img); img.onerror=()=>res(null); img.src=src;
  });
}
function roundRect(ctx,x,y,w,h,r){
  if(typeof r==='number') r=[r,r,r,r];
  const[tl,tr,br,bl]=r;
  ctx.beginPath();ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.arcTo(x+w,y,x+w,y+tr,tr);
  ctx.lineTo(x+w,y+h-br);ctx.arcTo(x+w,y+h,x+w-br,y+h,br);
  ctx.lineTo(x+bl,y+h);ctx.arcTo(x,y+h,x,y+h-bl,bl);
  ctx.lineTo(x,y+tl);ctx.arcTo(x,y,x+tl,y,tl);ctx.closePath();
}
function roundRectClip(ctx,x,y,w,h,r){roundRect(ctx,x,y,w,h,r);ctx.clip();}
function shadeColor(hex,pct){
  hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');
  let[r,g,b]=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
  r=Math.max(0,Math.min(255,r+pct));g=Math.max(0,Math.min(255,g+pct));b=Math.max(0,Math.min(255,b+pct));
  return'#'+(r|0).toString(16).padStart(2,'0')+(g|0).toString(16).padStart(2,'0')+(b|0).toString(16).padStart(2,'0');
}
function wrapText(ctx,text,x,y,maxW,lineH,maxLines){
  if(!text) return y;
  // Support explicit newlines in text
  const paragraphs = text.split('\n');
  for(const para of paragraphs){
    if(maxLines && (y-arguments[2])/lineH >= maxLines) break;
    if(!para){ y+=lineH; continue; }
    const words=para.split(' ');let line='';
    for(let i=0;i<words.length;i++){
      const test=line+(line?' ':'')+words[i];
      if(ctx.measureText(test).width>maxW&&line!==''){
        ctx.fillText(line,x,y);line=words[i];y+=lineH;
        if(maxLines&&Math.round((y-arguments[2])/lineH)>=maxLines-1){
          const rest=words.slice(i+1).join(' ');
          let ll=line+(rest?' '+rest:'');
          while(ctx.measureText(ll+'…').width>maxW&&ll.length>3) ll=ll.slice(0,-1);
          if(ll!==line+(rest?' '+rest:'')) ctx.fillText(ll+'…',x,y); else ctx.fillText(ll,x,y);
          return y+lineH;
        }
      }else line=test;
    }
    if(line) ctx.fillText(line,x,y);
    y+=lineH;
  }
  return y;
}
function drawImgTransformed(ctx,img,x,y,w,h,mode){
  if(!img)return;
  const{zoom,ox,oy}=imgTransform[mode];
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
  const iA=img.width/img.height,fA=w/h;
  let bw,bh;
  if(iA>fA){bh=h;bw=bh*iA;}else{bw=w;bh=bw/iA;}
  bw*=zoom;bh*=zoom;
  ctx.drawImage(img,x+(w-bw)/2+ox,y+(h-bh)/2+oy,bw,bh);
  ctx.restore();
}
function resetImgTransform(mode){imgTransform[mode]={zoom:1,ox:0,oy:0};rerenderMode(mode);}
function drawBadge(ctx,text,x,y,bg,fg,fontSize){
  ctx.save();const fs=fontSize||11;ctx.font=`bold ${fs}px "DM Sans",sans-serif`;
  const tw=ctx.measureText(text).width;const pad=4,r=3,bw=tw+pad*2,bh=fs+6;
  roundRect(ctx,x,y,bw,bh,r);ctx.fillStyle=bg;ctx.fill();
  ctx.fillStyle=fg;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(text,x+pad,y+bh/2);
  ctx.restore();return bw+3;
}
function drawBadgeFit(ctx,text,x,y,bg,fg,fontSize,maxW){
  ctx.save();let fs=fontSize||11;ctx.font=`bold ${fs}px "DM Sans",sans-serif`;
  const pad=4,r=3;let tw=ctx.measureText(text).width;let bw=tw+pad*2;
  while(bw>maxW&&fs>5){fs--;ctx.font=`bold ${fs}px "DM Sans",sans-serif`;tw=ctx.measureText(text).width;bw=tw+pad*2;}
  const bh=fs+6;roundRect(ctx,x,y,bw,bh,r);ctx.fillStyle=bg;ctx.fill();
  ctx.fillStyle=fg;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(text,x+pad,y+bh/2);
  ctx.restore();return bw+3;
}

// ── LABEL LOGO ─────────────────────────────────────────────
async function getLabelLogoImg(mode){
  const src=state[mode].labelLogo||LABEL_LOGO_DEFAULT;
  if(labelLogoCache[src]) return labelLogoCache[src];
  const img=await loadImg(src);if(img) labelLogoCache[src]=img;return img;
}
function setLabelLogo(mode,input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    state[mode].labelLogo=e.target.result;labelLogoCache={};
    const prev=document.getElementById(mode+'LabelLogoPreview');
    if(prev){prev.src=e.target.result;prev.style.display='';}
    rerenderMode(mode);
  };reader.readAsDataURL(file);
}
async function drawWatermark(ctx,zx,zy,zw,zh,mode,size='normal'){
  const logoImg=await getLabelLogoImg(mode);
  const pct=size==='large'?0.065:0.04;
  const logoH=Math.max(14,Math.min(size==='large'?28:20,Math.round(zh*pct)));
  const logoW=logoImg?Math.round(logoImg.width/logoImg.height*logoH):logoH*3;
  const textSize=Math.max(7,Math.round(logoH*0.62));
  const text='Analogic Addict France';
  ctx.save();
  ctx.font=`600 ${textSize}px "DM Sans",sans-serif`;
  const textW=ctx.measureText(text).width;
  const pillW=(logoImg?logoW+4:0)+textW+10;
  const pillH=logoH+6;
  const px=zx+zw-pillW-6;
  const py=zy+zh-pillH-6;
  ctx.globalAlpha=0.55;
  ctx.fillStyle='rgba(0,0,0,0.65)';
  roundRect(ctx,px-3,py-3,pillW+6,pillH+6,4);ctx.fill();
  let tx=px+2;
  if(logoImg){ctx.globalAlpha=0.7;ctx.drawImage(logoImg,tx,py,logoW,logoH);tx+=logoW+5;}
  ctx.globalAlpha=0.85;
  ctx.font=`600 ${textSize}px "DM Sans",sans-serif`;
  ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.textAlign='left';
  ctx.fillText(text,tx,py+logoH/2);
  ctx.globalAlpha=1;ctx.restore();
}

// ── COLOR EXTRACT ──────────────────────────────────────────
function extractColors(mode){
  const imgSrc=state[mode].img||document.getElementById(mode+'ImageUrl')?.value.trim();
  if(!imgSrc){alert('Charge une image d\'abord !');return;}
  const img=new Image();img.crossOrigin='anonymous';
  img.onload=()=>{
    const c=document.createElement('canvas');c.width=80;c.height=80;
    const cx=c.getContext('2d');cx.drawImage(img,0,0,80,80);
    const data=cx.getImageData(0,0,80,80).data;
    const samples=[];
    for(let i=0;i<data.length;i+=16) samples.push([data[i],data[i+1],data[i+2]]);
    samples.sort((a,b)=>(a[0]+a[1]+a[2])-(b[0]+b[1]+b[2]));
    const toHex=([r,g,b])=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
    const dark=samples[Math.floor(samples.length*0.1)];
    const ac=samples[Math.floor(samples.length*0.65)];
    if(mode==='vhs'){setColorPair('vhsBg','vhsBgTxt',toHex(dark));setColorPair('vhsAccent','vhsAccentTxt',toHex(ac));renderVHS();}
    else if(mode==='jcard'){setColorPair('jcardBg','jcardBgTxt',toHex(dark));setColorPair('jcardAccent','jcardAccentTxt',toHex(ac));renderJCard();}
    else{setColorPair('cdBg','cdBgTxt',toHex(dark));setColorPair('cdAccent','cdAccentTxt',toHex(ac));renderCD();}
  };img.src=imgSrc;
}
function setColorPair(cId,tId,val){const c=document.getElementById(cId),t=document.getElementById(tId);if(c)c.value=val;if(t)t.value=val;}
function syncColor(cId,tId){
  const ce=document.getElementById(cId),te=document.getElementById(tId);if(!ce||!te)return;
  if(document.activeElement===te){const v=te.value;if(/^#[0-9a-fA-F]{6}$/.test(v))ce.value=v;}else{te.value=ce.value;}
}
function rerenderMode(mode){ if(mode==='vhs')renderVHS();else if(mode==='jcard')renderJCard();else renderCD(); }

// ── FORMAT SELECT ──────────────────────────────────────────
function selectFormat(mode,fmt){
  state[mode].format=fmt;
  document.querySelectorAll('#'+mode+'FormatGrid .format-btn').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById(mode+'fmt-'+fmt);if(el)el.classList.add('active');
  checkFormat(mode);
}
function checkFormat(mode){
  const paper=PAPER[state[mode].format]||PAPER.a4;
  const warnEl=document.getElementById(mode+'FormatWarn');
  let minW=120,minH=60;
  if(mode==='vhs'){const m=document.getElementById('vhsMode')?.value;if(m==='cover'){minW=258;minH=200;}else{minW=150;minH=70;}}
  else if(mode==='jcard'){minW=102;minH=101.6;}
  else{minW=130;minH=130;}
  const pw=Math.max(paper.w,paper.h),ph=Math.min(paper.w,paper.h);
  const ok=pw>=minW&&ph>=minH;
  if(warnEl){warnEl.classList.toggle('show',!ok);if(!ok)warnEl.textContent=`⚠️ Format trop petit ! Min requis : ${Math.ceil(minW)}×${Math.ceil(minH)} mm.`;}
  return ok;
}

// ── SEARCH ─────────────────────────────────────────────────
function setCdSearchMode(mode){
  state.cd.searchMode=mode;
  const aS='background:rgba(139,106,139,0.2);color:var(--primary-light);border-color:var(--primary);';
  const iS='background:#111;border:1px solid var(--border);color:var(--text-muted);';
  const base='padding:4px 12px;border-radius:6px;font-size:0.75em;font-weight:600;cursor:pointer;';
  const t=document.getElementById('cdSearchTabTMDB'),m=document.getElementById('cdSearchTabMB');
  if(t)t.style.cssText=base+(mode==='tmdb'?aS:iS);
  if(m)m.style.cssText=base+(mode==='mb'?aS:iS);
}
async function searchAuto(mode){ if(mode==='cd'){ if(state.cd.searchMode==='mb') await searchMusicBrainzCD(); else await searchTMDB('cd'); } }
async function searchTMDB(mode){
  const inputId=mode==='vhs'?'vhsSearchInput':'cdSearchInput';
  const q=document.getElementById(inputId).value.trim();if(!q)return;
  const resEl=document.getElementById(mode==='vhs'?'vhsSearchResults':'cdSearchResults');
  resEl.innerHTML='<div class="search-loading">Recherche…</div>';resEl.classList.add('show');
  try{
    const res=await fetch(`https://api.themoviedb.org/3/search/multi?api_key=8265bd1679663a7ea12ac168da84d2e8&query=${encodeURIComponent(q)}&language=fr-FR`);
    const data=await res.json();
    if(data.results?.length){
      resEl.innerHTML='';
      data.results.slice(0,8).forEach(item=>{
        const title=item.title||item.name||'';const year=(item.release_date||item.first_air_date||'').slice(0,4);
        const poster=item.poster_path?`https://image.tmdb.org/t/p/w92${item.poster_path}`:'';
        const div=document.createElement('div');div.className='search-result-item';
        div.innerHTML=`<img src="${poster}" onerror="this.style.display='none'" alt="${title}"><div class="sr-info"><div class="sr-title">${title}</div><div class="sr-sub">${year}</div></div>`;
        div.onclick=()=>fillFromTMDB(item,mode);resEl.appendChild(div);
      });
    }else resEl.innerHTML='<div class="search-loading">Aucun résultat.</div>';
  }catch{resEl.innerHTML='<div class="search-loading">Erreur réseau.</div>';}
}
function fillFromTMDB(item,mode){
  const title=item.title||item.name||'';
  const year=(item.release_date||item.first_air_date||'').slice(0,4);
  const overview=(item.overview||'').slice(0,300);
  const poster=item.poster_path?`https://image.tmdb.org/t/p/w500${item.poster_path}`:'';
  document.getElementById(mode==='vhs'?'vhsSearchResults':'cdSearchResults').classList.remove('show');
  if(mode==='vhs'){
    document.getElementById('vhsTitle').value=title;
    document.getElementById('vhsYear').value=year;
    document.getElementById('vhsDesc').value=overview;
    if(poster){document.getElementById('vhsImageUrl').value=poster;state.vhs.img=null;}
    renderVHS();
  }else{
    document.getElementById('cdAlbum').value=title;
    document.getElementById('cdYear').value=year;
    if(poster){document.getElementById('cdImageUrl').value=poster;state.cd.img=null;}
    renderCD();
  }
}
async function searchMusicBrainz(){
  const q=document.getElementById('jcardSearchInput').value.trim();if(!q)return;
  const resEl=document.getElementById('jcardSearchResults');
  resEl.innerHTML='<div class="search-loading">Recherche MusicBrainz…</div>';resEl.classList.add('show');
  try{
    const res=await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&limit=8&fmt=json`);
    const data=await res.json();
    if(data.releases?.length){
      resEl.innerHTML='';
      for(const r of data.releases.slice(0,8)){
        const artist=r['artist-credit']?.[0]?.name||'';const mbid=r.id;
        const div=document.createElement('div');div.className='search-result-item';
        div.innerHTML=`<img src="https://coverartarchive.org/release/${mbid}/front-250" onerror="this.style.display='none'" alt="${r.title}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"><div class="sr-info"><div class="sr-title">${artist} — ${r.title}</div><div class="sr-sub">${(r.date||'').slice(0,4)}</div></div>`;
        div.onclick=()=>fillFromMB(r,mbid);resEl.appendChild(div);
      }
    }else resEl.innerHTML='<div class="search-loading">Aucun résultat.</div>';
  }catch{resEl.innerHTML='<div class="search-loading">Erreur réseau.</div>';}
}
async function fillFromMB(release,mbid){
  document.getElementById('jcardSearchResults').classList.remove('show');
  const artist=release['artist-credit']?.[0]?.name||'';
  document.getElementById('jcardArtist').value=artist;
  document.getElementById('jcardAlbum').value=release.title||'';
  document.getElementById('jcardYear').value=(release.date||'').slice(0,4);
  try{const r=await fetch(`https://coverartarchive.org/release/${mbid}/front`);if(r.ok){document.getElementById('jcardImageUrl').value=r.url;state.jcard.img=null;}}catch{}
  try{
    const r2=await fetch(`https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings&fmt=json`);
    const d2=await r2.json();state.jcard.tracksA=[];state.jcard.tracksB=[];
    const media=d2.media||[];
    if(media.length){
      const tracks=media[0].tracks||[];const half=Math.ceil(tracks.length/2);
      tracks.forEach((t,i)=>{const dur=t.length?formatMs(t.length):'';if(i<half)state.jcard.tracksA.push({title:t.title,dur});else state.jcard.tracksB.push({title:t.title,dur});});
    }
    renderTrackList('A');renderTrackList('B');
  }catch{}
  renderJCard();
}
async function searchMusicBrainzCD(){
  const q=document.getElementById('cdSearchInput').value.trim();if(!q)return;
  const resEl=document.getElementById('cdSearchResults');
  resEl.innerHTML='<div class="search-loading">Recherche MusicBrainz…</div>';resEl.classList.add('show');
  try{
    const res=await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&limit=8&fmt=json`);
    const data=await res.json();
    if(data.releases?.length){
      resEl.innerHTML='';
      for(const r of data.releases.slice(0,8)){
        const artist=r['artist-credit']?.[0]?.name||'';const mbid=r.id;
        const div=document.createElement('div');div.className='search-result-item';
        div.innerHTML=`<img src="https://coverartarchive.org/release/${mbid}/front-250" onerror="this.style.display='none'" alt="${r.title}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"><div class="sr-info"><div class="sr-title">${artist} — ${r.title}</div><div class="sr-sub">${(r.date||'').slice(0,4)}</div></div>`;
        div.onclick=()=>fillMBCD(r,mbid);resEl.appendChild(div);
      }
    }else resEl.innerHTML='<div class="search-loading">Aucun résultat.</div>';
  }catch{resEl.innerHTML='<div class="search-loading">Erreur réseau.</div>';}
}
async function fillMBCD(release,mbid){
  document.getElementById('cdSearchResults').classList.remove('show');
  const artist=release['artist-credit']?.[0]?.name||'';
  document.getElementById('cdArtist').value=artist;document.getElementById('cdAlbum').value=release.title||'';
  document.getElementById('cdYear').value=(release.date||'').slice(0,4);
  try{const r=await fetch(`https://coverartarchive.org/release/${mbid}/front`);if(r.ok){document.getElementById('cdImageUrl').value=r.url;state.cd.img=null;}}catch{}
  try{
    const r2=await fetch(`https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings&fmt=json`);
    const d2=await r2.json();state.cd.tracksCD=[];
    const media=d2.media||[];
    if(media.length)for(const t of(media[0].tracks||[])) state.cd.tracksCD.push({title:t.title,dur:t.length?formatMs(t.length):''});
    renderTrackList('CD');
  }catch{}
  renderCD();
}
function formatMs(ms){const s=Math.floor(ms/1000);return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}

// ── TRACK LIST ─────────────────────────────────────────────
function addTrack(side){
  const tEl=document.getElementById('track'+side+'Title'),dEl=document.getElementById('track'+side+'Dur');
  const title=tEl.value.trim();if(!title)return;
  const track={title,dur:dEl.value.trim()};
  if(side==='A')state.jcard.tracksA.push(track);
  else if(side==='B')state.jcard.tracksB.push(track);
  else state.cd.tracksCD.push(track);
  tEl.value='';dEl.value='';renderTrackList(side);
  if(side!=='CD')renderJCard();else renderCD();
}
function removeTrack(side,idx){
  if(side==='A')state.jcard.tracksA.splice(idx,1);
  else if(side==='B')state.jcard.tracksB.splice(idx,1);
  else state.cd.tracksCD.splice(idx,1);
  renderTrackList(side);if(side!=='CD')renderJCard();else renderCD();
}
function renderTrackList(side){
  const listEl=document.getElementById('tracks'+side);if(!listEl)return;
  const tracks=side==='A'?state.jcard.tracksA:side==='B'?state.jcard.tracksB:state.cd.tracksCD;
  listEl.innerHTML=tracks.map((t,i)=>`<li class="track-item"><span class="track-num">${i+1}.</span><span class="track-title">${t.title}</span><span class="track-dur">${t.dur}</span><button class="track-remove" onclick="removeTrack('${side}',${i})">✕</button></li>`).join('');
}

// ── IMAGE UPLOAD ───────────────────────────────────────────
function handleImageUpload(mode){
  const file=document.getElementById(mode+'ImageFile').files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{state[mode].img=e.target.result;rerenderMode(mode);};
  reader.readAsDataURL(file);
}

// ── VHS LOGOS ──────────────────────────────────────────────
function toggleLogo(id){
  const el=document.getElementById('logo-'+id);
  if(state.vhs.logos.has(id)){state.vhs.logos.delete(id);el.classList.remove('selected');}
  else{state.vhs.logos.add(id);el.classList.add('selected');}
  renderVHS();
}
function addCustomLogo(){
  const txt=document.getElementById('customLogoText').value.trim();
  const col=document.getElementById('customLogoColor').value;if(!txt)return;
  const id='custom_'+Date.now();
  state.vhs.customLogos.push({id,text:txt,color:col});
  const chip=document.createElement('div');chip.className='logo-chip selected';chip.id=id;chip.textContent=txt;
  chip.onclick=()=>{const idx=state.vhs.customLogos.findIndex(l=>l.id===id);if(idx!==-1){state.vhs.customLogos.splice(idx,1);chip.remove();renderVHS();}};
  document.getElementById('vhsLogoGrid').appendChild(chip);document.getElementById('customLogoText').value='';renderVHS();
}

// ── CD MODE CHANGE ──────────────────────────────────────────
function cdModeChanged(){
  const mode=document.getElementById('cdMode').value;
  const discOpts=document.getElementById('cdDiscOptions');
  if(discOpts) discOpts.style.display=(mode==='disc')?'':'none';
  renderCD();
}

// ══════════════════════════════════════════════════════════
// TEXT OVERLAY SYSTEM
// ══════════════════════════════════════════════════════════
function mkId(){ return 'te_'+Date.now()+'_'+Math.floor(Math.random()*9999); }
function createTextItem(mode,text,xPct,yPct,sizePx,color,font,rotation=0){
  const id=mkId();
  const item={id,text,xPct,yPct,sizePx,color,font,rotation,widthPct:null};
  textItems[mode].push(item);buildTextEl(mode,item);return item;
}
function buildTextEl(mode,item){
  const layer=getLayer(mode);
  const existing=document.getElementById(item.id);if(existing) existing.remove();
  const el=document.createElement('div');el.id=item.id;el.className='txt-el';el.style.pointerEvents='none';
  const del=document.createElement('button');del.className='te-del';del.textContent='×';
  del.addEventListener('mousedown',e=>{e.stopPropagation();e.preventDefault();removeTextItem(mode,item.id);});el.appendChild(del);
  const rot=document.createElement('button');rot.className='te-rot';rot.textContent='↻';
  rot.addEventListener('mousedown',e=>startRotate(e,mode,item,el));el.appendChild(rot);
  const res=document.createElement('div');res.className='te-resize';
  res.addEventListener('mousedown',e=>startResize(e,mode,item,el));el.appendChild(res);
  el.addEventListener('mousedown',e=>startDrag(e,mode,item,el));
  el.addEventListener('touchstart',e=>startDragTouch(e,mode,item,el),{passive:false});
  el.addEventListener('click',e=>{e.stopPropagation();selectTextItem(mode,item.id);});
  el.addEventListener('dblclick',e=>{e.stopPropagation();startInlineEdit(mode,item,el);});
  layer.appendChild(el);syncTextElStyle(mode,item,el);return el;
}
function syncTextElStyle(mode,item,el){
  if(!el) el=document.getElementById(item.id);if(!el) return;
  const canvas=getCanvas(mode);const rect=canvas.getBoundingClientRect();const scaleY=rect.height/canvas.height;
  el.style.left=item.xPct+'%';el.style.top=item.yPct+'%';
  el.style.fontSize=(item.sizePx*scaleY)+'px';el.style.color=item.color;el.style.fontFamily=item.font;
  el.style.transform=`rotate(${item.rotation||0}deg)`;
  if(item.widthPct) el.style.width=item.widthPct+'%';else el.style.width='auto';
  const controls=[...el.querySelectorAll('.te-del,.te-rot,.te-resize')];
  el.textContent='';controls.forEach(c=>el.appendChild(c));
  const lines=item.text.split('\n');
  lines.forEach((line,i)=>{
    el.insertBefore(document.createTextNode(line),el.querySelector('.te-del'));
    if(i<lines.length-1){const br=document.createElement('br');el.insertBefore(br,el.querySelector('.te-del'));}
  });
}
function removeTextItem(mode,id){
  textItems[mode]=textItems[mode].filter(i=>i.id!==id);
  const el=document.getElementById(id);if(el)el.remove();
  if(editState[mode].selected===id){editState[mode].selected=null;updateToolbarVisibility(mode);}
}
function clearTextItems(mode){
  textItems[mode].forEach(i=>{const el=document.getElementById(i.id);if(el)el.remove();});
  textItems[mode]=[];editState[mode].selected=null;
}
function addTextEl(mode){
  const canvas=getCanvas(mode);
  const item=createTextItem(mode,'Nouveau texte',10,10,Math.round(canvas.height*0.06),'#ffffff',"'DM Sans',sans-serif",0);
  if(!editState[mode].editing) toggleEdit(mode);
  selectTextItem(mode,item.id);
}
function populateTextItems(mode,items){
  const existing=new Map(textItems[mode].map(i=>[i.id,i]));
  const incomingIds=new Set(items.map(i=>i.id));
  textItems[mode]=textItems[mode].filter(i=>{
    if(i.id.startsWith('te_')) return true;
    if(!incomingIds.has(i.id)){const el=document.getElementById(i.id);if(el)el.remove();return false;}
    return true;
  });
  items.forEach(incoming=>{
    const ex=existing.get(incoming.id);
    if(ex){
      ex.text=incoming.text;ex.color=incoming.color;ex.font=incoming.font;
      if(!ex._userMoved){ex.xPct=incoming.xPct;ex.yPct=incoming.yPct;ex.sizePx=incoming.sizePx;ex.rotation=incoming.rotation||0;if(incoming.widthPct!=null)ex.widthPct=incoming.widthPct;}
      syncTextElStyle(mode,ex,null);
    }else{
      const item={id:incoming.id,text:incoming.text,xPct:incoming.xPct,yPct:incoming.yPct,sizePx:incoming.sizePx,color:incoming.color,font:incoming.font,rotation:incoming.rotation||0,widthPct:incoming.widthPct||null,_userMoved:false};
      textItems[mode].push(item);buildTextEl(mode,item);
    }
  });
  applyEditMode(mode);
}
function applyEditMode(mode){
  const layer=getLayer(mode);const editing=editState[mode].editing;
  layer.classList.toggle('edit-mode',editing);
  textItems[mode].forEach(item=>{
    const el=document.getElementById(item.id);if(!el)return;
    el.style.pointerEvents=editing?'all':'none';
    const isSelected=item.id===editState[mode].selected;
    el.classList.toggle('selected',isSelected&&editing);
    if(!editing){el.style.borderColor='transparent';el.style.background='transparent';}
  });
}
function selectTextItem(mode,id){
  editState[mode].selected=id;
  const item=textItems[mode].find(i=>i.id===id);
  textItems[mode].forEach(i=>{const el=document.getElementById(i.id);if(el)el.classList.toggle('selected',i.id===id);});
  if(item&&editState[mode].editing){
    const s=document.getElementById(mode+'SelSize'),c=document.getElementById(mode+'SelColor');
    const f=document.getElementById(mode+'SelFont'),ct=document.getElementById(mode+'SelContent');
    if(s)s.value=Math.round(item.sizePx);if(c)c.value=item.color;if(f)f.value=item.font;if(ct)ct.value=item.text;
  }
  updateToolbarVisibility(mode);
}
function updateToolbarVisibility(mode){
  const toolbar=document.getElementById(mode+'Toolbar');
  if(toolbar) toolbar.classList.toggle('show',editState[mode].editing);
}
function toggleEdit(mode){
  editState[mode].editing=!editState[mode].editing;
  const btn=document.getElementById(mode+'EditBtn');const hint=document.getElementById(mode+'DragHint');
  if(btn){btn.textContent=editState[mode].editing?'✅ Terminer édition':'✏️ Éditer textes';btn.style.background=editState[mode].editing?'rgba(139,106,139,0.45)':'rgba(139,106,139,0.2)';}
  if(hint)hint.classList.toggle('show',editState[mode].editing);
  if(!editState[mode].editing)editState[mode].selected=null;
  applyEditMode(mode);updateToolbarVisibility(mode);
}
function updateSelectedText(mode){
  const id=editState[mode].selected;if(!id)return;
  const item=textItems[mode].find(i=>i.id===id);if(!item)return;
  const s=document.getElementById(mode+'SelSize'),c=document.getElementById(mode+'SelColor');
  const f=document.getElementById(mode+'SelFont'),ct=document.getElementById(mode+'SelContent');
  if(s)item.sizePx=Math.max(4,parseInt(s.value)||16);
  if(c)item.color=c.value;if(f)item.font=f.value;if(ct)item.text=ct.value;
  item._userMoved=true;syncTextElStyle(mode,item,null);
}
function deleteSelectedText(mode){const id=editState[mode].selected;if(!id)return;removeTextItem(mode,id);}

// ── DRAG ──────────────────────────────────────────────────
function startDrag(e,mode,item,el){
  if(!editState[mode].editing) return;
  if(e.target.classList.contains('te-del')||e.target.classList.contains('te-rot')||e.target.classList.contains('te-resize')) return;
  e.preventDefault();e.stopPropagation();selectTextItem(mode,item.id);
  const layer=getLayer(mode);const layerRect=layer.getBoundingClientRect();
  const startX=e.clientX,startY=e.clientY,startXPct=item.xPct,startYPct=item.yPct;
  const mm=e2=>{const dx=(e2.clientX-startX)/layerRect.width*100,dy=(e2.clientY-startY)/layerRect.height*100;item.xPct=Math.max(0,Math.min(95,startXPct+dx));item.yPct=Math.max(0,Math.min(95,startYPct+dy));item._userMoved=true;el.style.left=item.xPct+'%';el.style.top=item.yPct+'%';};
  const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
}
function startDragTouch(e,mode,item,el){
  if(!editState[mode].editing) return;
  if(e.target.classList.contains('te-del')||e.target.classList.contains('te-rot')||e.target.classList.contains('te-resize')) return;
  e.preventDefault();
  const layer=getLayer(mode);const layerRect=layer.getBoundingClientRect();
  const t0=e.touches[0];const startX=t0.clientX,startY=t0.clientY,startXPct=item.xPct,startYPct=item.yPct;
  const tm=e2=>{const t=e2.touches[0];const dx=(t.clientX-startX)/layerRect.width*100,dy=(t.clientY-startY)/layerRect.height*100;item.xPct=Math.max(0,Math.min(95,startXPct+dx));item.yPct=Math.max(0,Math.min(95,startYPct+dy));item._userMoved=true;el.style.left=item.xPct+'%';el.style.top=item.yPct+'%';};
  const te=()=>{document.removeEventListener('touchmove',tm);document.removeEventListener('touchend',te);};
  document.addEventListener('touchmove',tm,{passive:false});document.addEventListener('touchend',te);
}
function startRotate(e,mode,item,el){
  if(!editState[mode].editing) return;e.preventDefault();e.stopPropagation();
  const rect=el.getBoundingClientRect();const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  const startA=Math.atan2(e.clientY-cy,e.clientX-cx),startRot=item.rotation||0;
  const mm=e2=>{const a=Math.atan2(e2.clientY-cy,e2.clientX-cx);item.rotation=startRot+(a-startA)*180/Math.PI;item._userMoved=true;el.style.transform=`rotate(${item.rotation}deg)`;};
  const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
}
function startResize(e,mode,item,el){
  if(!editState[mode].editing) return;e.preventDefault();e.stopPropagation();
  const canvas=getCanvas(mode);const rect=canvas.getBoundingClientRect();const scaleY=rect.height/canvas.height;
  const startY=e.clientY,startSize=item.sizePx;
  const mm=e2=>{const dy=e2.clientY-startY;item.sizePx=Math.max(4,Math.round(startSize+dy/scaleY*0.5));item._userMoved=true;el.style.fontSize=(item.sizePx*scaleY)+'px';const s=document.getElementById(mode+'SelSize');if(s)s.value=Math.round(item.sizePx);};
  const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
}
document.addEventListener('wheel',e=>{
  ['vhs','jcard','cd'].forEach(mode=>{
    const id=editState[mode].selected;if(!id||!editState[mode].editing)return;
    const el=document.getElementById(id);if(!el||!el.matches(':hover'))return;
    e.preventDefault();const item=textItems[mode].find(i=>i.id===id);if(!item)return;
    const canvas=getCanvas(mode);const rect=canvas.getBoundingClientRect();const scaleY=rect.height/canvas.height;
    item.sizePx=Math.max(4,item.sizePx+(e.deltaY>0?-1:1)*0.5);item._userMoved=true;
    el.style.fontSize=(item.sizePx*scaleY)+'px';const s=document.getElementById(mode+'SelSize');if(s)s.value=Math.round(item.sizePx);
  });
},{passive:false});
function initPinchResize(mode){
  const layer=getLayer(mode);if(!layer)return;let lastDist=null;
  layer.addEventListener('touchstart',e=>{if(e.touches.length===2)lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
  layer.addEventListener('touchmove',e=>{
    if(e.touches.length!==2)return;const id=editState[mode].selected;if(!id)return;
    const item=textItems[mode].find(i=>i.id===id);if(!item)return;
    const dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    if(lastDist&&Math.abs(dist-lastDist)>1){const canvas=getCanvas(mode);const rect=canvas.getBoundingClientRect();const scaleY=rect.height/canvas.height;item.sizePx=Math.max(4,item.sizePx*(dist/lastDist));item._userMoved=true;const el=document.getElementById(id);if(el)el.style.fontSize=(item.sizePx*scaleY)+'px';}
    lastDist=dist;
  },{passive:true});
}
function startInlineEdit(mode,item,el){
  if(!editState[mode].editing)return;
  const controls=[...el.querySelectorAll('.te-del,.te-rot,.te-resize')];
  controls.forEach(c=>c.style.display='none');
  el.contentEditable='true';el.focus();
  const range=document.createRange();range.selectNodeContents(el);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  const finish=()=>{
    el.contentEditable='false';controls.forEach(c=>c.style.display='');
    let text='';
    el.childNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE)text+=n.textContent;else if(n.nodeName==='BR')text+='\n';});
    text=text.replace(/\n$/,'');
    item.text=text;item._userMoved=true;syncTextElStyle(mode,item,el);
    const ct=document.getElementById(mode+'SelContent');if(ct)ct.value=item.text;
  };
  el.addEventListener('blur',finish,{once:true});
  el.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();el.blur();}
    if(e.key==='Enter'&&(e.ctrlKey||e.shiftKey)){e.preventDefault();el.blur();}
  });
}

// ══════════════════════════════════════════════════════════
// IMAGE PAN/ZOOM
// ══════════════════════════════════════════════════════════
function initImageInteraction(mode){
  const canvas=getCanvas(mode);if(!canvas||canvas._imgInit)return;canvas._imgInit=true;
  const T=imgTransform[mode];let dragging=false,lastX=0,lastY=0;
  canvas.addEventListener('mousedown',e=>{if(editState[mode].editing)return;if(e.button!==0)return;dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.style.cursor='grabbing';});
  document.addEventListener('mousemove',e=>{if(!dragging)return;const rect=canvas.getBoundingClientRect(),sc=canvas.width/rect.width;T.ox+=(e.clientX-lastX)*sc;T.oy+=(e.clientY-lastY)*sc;lastX=e.clientX;lastY=e.clientY;rerenderMode(mode);});
  document.addEventListener('mouseup',()=>{dragging=false;if(canvas&&!editState[mode].editing)canvas.style.cursor='grab';});
  if(!editState[mode].editing)canvas.style.cursor='grab';
  canvas.addEventListener('wheel',e=>{if(editState[mode].editing)return;e.preventDefault();T.zoom=Math.max(0.2,Math.min(5,T.zoom*(e.deltaY>0?0.92:1.09)));rerenderMode(mode);},{passive:false});
  let lastTouches=[];
  canvas.addEventListener('touchstart',e=>{lastTouches=[...e.touches];},{passive:true});
  canvas.addEventListener('touchmove',e=>{
    if(editState[mode].editing)return;e.preventDefault();const rect=canvas.getBoundingClientRect(),sc=canvas.width/rect.width;
    if(e.touches.length===1&&lastTouches.length===1){T.ox+=(e.touches[0].clientX-lastTouches[0].clientX)*sc;T.oy+=(e.touches[0].clientY-lastTouches[0].clientY)*sc;}
    else if(e.touches.length===2&&lastTouches.length===2){const d0=Math.hypot(lastTouches[0].clientX-lastTouches[1].clientX,lastTouches[0].clientY-lastTouches[1].clientY),d1=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(d0>1)T.zoom=Math.max(0.2,Math.min(5,T.zoom*(d1/d0)));}
    lastTouches=[...e.touches];rerenderMode(mode);
  },{passive:false});
}

// ══════════════════════════════════════════════════════════
// EXPORT SYSTEM — PNG capture + PDF wrapper
// ══════════════════════════════════════════════════════════
function getLabelMM(mode){
  const vhsSubmode=document.getElementById('vhsMode')?.value||'label';
  const cdSubmode=document.getElementById('cdMode')?.value||'disc';
  if(mode==='vhs'){if(vhsSubmode==='label')return{w:VHS_FACE_MM.w,h:VHS_FACE_MM.h+VHS_SPINE_MM.h+4};return{w:VHS_SLIPCASE_MM.w,h:VHS_SLIPCASE_MM.h};}
  if(mode==='jcard')return{w:25.4+12.7+63.5,h:101.6};
  if(mode==='cd'){if(cdSubmode==='disc')return{w:116,h:116};if(cdSubmode==='jewel_front')return{w:120,h:120};if(cdSubmode==='jewel_back')return{w:151,h:118};return{w:125,h:125};}
  return{w:100,h:80};
}

// Build a high-quality flat canvas by compositing canvas + text overlays
async function buildExportCanvas(mode, DPI=300){
  const srcCanvas=getCanvas(mode);
  if(!srcCanvas||srcCanvas.width===0) return null;

  const mmDim=getLabelMM(mode);
  const pxW=Math.round(mmDim.w/25.4*DPI);
  const pxH=Math.round(mmDim.h/25.4*DPI);

  const out=document.createElement('canvas');
  out.width=pxW;out.height=pxH;
  const ctx=out.getContext('2d');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';

  // Draw the base canvas scaled up
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,pxW,pxH);
  ctx.drawImage(srcCanvas,0,0,pxW,pxH);

  // Bake all text overlay items as crisp text
  const scaleX=pxW/srcCanvas.width;
  const scaleY=pxH/srcCanvas.height;

  textItems[mode].forEach(item=>{
    if(!item.text) return;
    ctx.save();
    const x=item.xPct/100*pxW;
    const y=item.yPct/100*pxH;
    const size=item.sizePx*scaleY;
    ctx.font=`${size}px ${item.font}`;
    ctx.fillStyle=item.color;
    ctx.textBaseline='top';ctx.textAlign='left';
    if(item.rotation){ctx.translate(x,y);ctx.rotate(item.rotation*Math.PI/180);ctx.translate(-x,-y);}
    const lines=item.text.split('\n');
    lines.forEach((line,i)=>ctx.fillText(line,x,y+i*size*1.35));
    ctx.restore();
  });
  return out;
}

// Download PNG
async function downloadPNG(mode){
  const btn=document.getElementById(mode+'PngBtn');
  if(btn){btn.textContent='⏳ Génération…';btn.disabled=true;}
  try{
    const out=await buildExportCanvas(mode,300);
    if(!out){alert('Aperçu vide — générez d\'abord un label.');return;}
    const mm=getLabelMM(mode);
    const nameEl=document.getElementById(mode==='vhs'?'vhsTitle':mode==='jcard'?'jcardArtist':'cdArtist');
    const nm=(nameEl?.value||'label').replace(/[^a-zA-Z0-9_-]/g,'-');
    const a=document.createElement('a');
    a.download=`${mode}-${nm}-300dpi.png`;
    a.href=out.toDataURL('image/png');
    a.click();
  }finally{
    if(btn){btn.textContent='⬇ Télécharger PNG';btn.disabled=false;}
  }
}

// Download PDF wrapping the PNG at physical size
async function exportPDF(mode){
  const{jsPDF}=window.jspdf;if(!jsPDF){alert('jsPDF non chargé');return;}
  const btn=document.getElementById(mode+'PdfBtn');
  if(btn){btn.textContent='⏳ Génération…';btn.disabled=true;}
  try{
    const out=await buildExportCanvas(mode,300);
    if(!out){alert('Aperçu vide — générez d\'abord un label.');return;}

    const mm=getLabelMM(mode);
    const lw=mm.w,lh=mm.h;

    // PDF page = label size + small margin
    const margin=8;
    const docW=lw+margin*2,docH=lh+margin*2;
    const isL=docW>docH;
    const doc=new jsPDF({orientation:isL?'landscape':'portrait',unit:'mm',format:[docW,docH]});

    const imgData=out.toDataURL('image/png');
    doc.addImage(imgData,'PNG',margin,margin,lw,lh,undefined,'NONE');

    // Cut marks
    const mk=3,gap=2;doc.setDrawColor(160);doc.setLineWidth(0.2);
    [[margin,margin],[margin+lw,margin],[margin,margin+lh],[margin+lw,margin+lh]].forEach(([cx,cy])=>{
      const dx=cx===margin?-1:1,dy=cy===margin?-1:1;
      doc.line(cx+dx*gap,cy,cx+dx*(gap+mk),cy);
      doc.line(cx,cy+dy*gap,cx,cy+dy*(gap+mk));
    });

    doc.setTextColor(130,130,130);doc.setFontSize(7);
    doc.text(`Taille réelle : ${Math.round(lw)}×${Math.round(lh)} mm · Imprimer à 100% · Analogic Addict France`,margin,docH-margin*0.4);

    const nameEl=document.getElementById(mode==='vhs'?'vhsTitle':mode==='jcard'?'jcardArtist':'cdArtist');
    const nm=(nameEl?.value||'label').replace(/[^a-zA-Z0-9_-]/g,'-');
    doc.save(`${mode}-${nm}.pdf`);
  }finally{
    if(btn){btn.textContent='📄 Exporter PDF';btn.disabled=false;}
  }
}

// ── CLICK OUTSIDE to deselect ─────────────────────────────
document.addEventListener('click',e=>{
  ['vhs','jcard','cd'].forEach(mode=>{
    const layer=getLayer(mode);
    if(layer&&!layer.contains(e.target)){
      if(editState[mode].selected){editState[mode].selected=null;applyEditMode(mode);}
    }
  });
  document.querySelectorAll('.search-results').forEach(el=>{if(!el.parentElement.contains(e.target))el.classList.remove('show');});
});

window.addEventListener('resize',()=>{
  ['vhs','jcard','cd'].forEach(mode=>{
    const canvas=getCanvas(mode);if(!canvas)return;
    textItems[mode].forEach(item=>{
      const el=document.getElementById(item.id);if(!el)return;
      const rect=canvas.getBoundingClientRect();const scaleY=rect.height/canvas.height;
      el.style.fontSize=(item.sizePx*scaleY)+'px';
    });
  });
});
