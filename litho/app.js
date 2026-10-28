// LithoMak3r — drop photos in, get a lithophane bauble out.
//
// Shell geometry is geometry.js, sign-in and the Supabase wrappers are
// shared/sb.js; this file is the UI, the image processing and the 3MF.
//
// A design is a row in litho_models plus a row per photo in litho_photos,
// each carrying the downsampled image as a data URL — the full-size file is
// never kept, because 640 px on the long edge is all the geometry samples.

// ── Small helpers ──────────────────────────────────────────────
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setStatus(msg,cls=''){ const el=document.getElementById('status'); if(el){ el.textContent=msg; el.className='status'+(cls?' '+cls:''); } }

// Number spinners — same as BadgeMak3r's, so the inputs behave the same way.
function stepInput(input, dir){
  const step=parseFloat(input.step)||1;
  const min=input.min!==''?parseFloat(input.min):-Infinity;
  const max=input.max!==''?parseFloat(input.max): Infinity;
  const dec=step.toString().includes('.')?step.toString().split('.')[1].length:0;
  input.value=Math.min(max,Math.max(min,(parseFloat(input.value)||0)+dir*step)).toFixed(dec);
  input.dispatchEvent(new Event('change',{bubbles:true}));
}
function wrapSpinners(container){
  if(!container) return;
  container.querySelectorAll('input[type="number"]').forEach(input=>{
    if(input.closest('.spin-wrap')) return;
    const wrap=document.createElement('div'); wrap.className='spin-wrap';
    input.parentNode.insertBefore(wrap,input);
    const minus=document.createElement('button'); minus.className='spin-btn'; minus.type='button'; minus.textContent='−';
    minus.onclick=()=>stepInput(input,-1);
    const plus=document.createElement('button'); plus.className='spin-btn'; plus.type='button'; plus.textContent='+';
    plus.onclick=()=>stepInput(input,1);
    wrap.appendChild(minus); wrap.appendChild(input); wrap.appendChild(plus);
  });
}

// ── State ──────────────────────────────────────────────────────
const PRESETS={
  bauble60:{ label:'Bauble — ⌀60 mm',       dia:60, topHole:14, botHole:16 },
  bauble80:{ label:'Bauble — ⌀80 mm',       dia:80, topHole:12, botHole:14 },
  bauble45:{ label:'Small bauble — ⌀45 mm', dia:45, topHole:16, botHole:18 },
  shade:   { label:'Tealight shade — ⌀70',  dia:70, topHole:26, botHole:34 },
};

const MODEL_FIELDS={
  dia:'dia_mm', topHole:'top_hole_deg', botHole:'bot_hole_deg',
  thinMM:'thin_mm', thickMM:'thick_mm', centreDeg:'centre_deg',
  repeat:'repeat_count', reliefSide:'relief_side', detail:'detail',
  hanger:'hanger', hangerMM:'hanger_mm', bandDeg:'band_deg',
};
const PHOTO_FIELDS={ name:'name', src:'data_url', invert:'invert', bright:'bright', contrast:'contrast',
  zoom:'zoom', rot:'rot_deg', offX:'off_x', offY:'off_y' };
// Postgres `numeric` comes back over PostgREST as a string, so these get
// coerced on the way in. The rest are already text or boolean.
const NUM_FIELDS=new Set(['dia','topHole','botHole','thinMM','thickMM','centreDeg','repeat','hangerMM','bandDeg',
  'bright','contrast','zoom','rot','offX','offY']);

function defaultModel(name){
  return { id:null, name, dia:60, topHole:14, botHole:16,
    thinMM:0.7, thickMM:2.6, centreDeg:90, repeat:1,
    reliefSide:'inside', detail:'normal', hanger:true, hangerMM:3.6, bandDeg:0 };
}

let models=[], model=defaultModel('Bauble');
let images=[], selected=-1, deletedPhotoIds=[], isDirty=false;

function markDirty(){ isDirty=true; const b=document.getElementById('saveBtn'); if(b) b.classList.add('dirty'); }
function clearDirty(){ isDirty=false; const b=document.getElementById('saveBtn'); if(b) b.classList.remove('dirty'); }

function params(){
  const d=LITHO_DETAIL[model.detail]||LITHO_DETAIL.normal;
  return Object.assign({},model,{segsU:d.segsU,segsV:d.segsV});
}

// ── Images ─────────────────────────────────────────────────────
// Each image is kept twice: `gray` is the untouched luminance, `lum` is what
// the geometry samples after brightness/contrast/invert. Re-baking `lum` is
// cheap, so the sliders stay live.
const MAX_PX=640;

function fileToImage(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onerror=()=>rej(new Error('Could not read '+file.name));
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>res(img);
      img.onerror=()=>rej(new Error(file.name+' is not an image we can read'));
      img.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function dataUrlToImage(src){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>res(img);
    img.onerror=()=>rej(new Error('Could not decode a saved photo'));
    img.src=src;
  });
}

function makeImage(name, img, over={}){
  const scale=Math.min(1, MAX_PX/Math.max(img.width,img.height));
  const w=Math.max(2,Math.round(img.width*scale)), h=Math.max(2,Math.round(img.height*scale));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d');
  // White underneath, so anything transparent reads as a thin wall — and so
  // the JPEG we save keeps it that way, since JPEG has no alpha.
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
  ctx.drawImage(img,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data;
  const gray=new Float32Array(w*h);
  for(let i=0;i<gray.length;i++){
    // Rec. 709 — matches how the eye weights the channels, so colour photos
    // keep their contrast where it matters.
    gray[i]=(0.2126*d[i*4]+0.7152*d[i*4+1]+0.0722*d[i*4+2])/255;
  }
  const rec=Object.assign(
    { name, w, h, gray, lum:new Float32Array(w*h), invert:false, bright:0, contrast:1,
      zoom:1, rot:0, offX:0, offY:0,
      src:over.src||c.toDataURL('image/jpeg',0.84), id:null },
    over);
  bake(rec);
  return rec;
}

// Baking is where a photo's framing happens too: zoom, nudge and rotation
// resample `gray` into `lum`, so the geometry and the backlit view both see
// the framed picture without either of them knowing about it. Anything that
// falls outside the photo reads as 1 — thin wall, same as the plain shell.
function bake(im){
  const {gray,lum,w,h,bright,contrast,invert}=im;
  const zoom=im.zoom||1, rot=(im.rot||0)*Math.PI/180, ox=im.offX||0, oy=im.offY||0;
  const framed=zoom!==1||rot!==0||ox!==0||oy!==0;
  const cs=Math.cos(rot)/zoom, sn=Math.sin(rot)/zoom;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const k=y*w+x;
    let g=gray[k];
    if(framed){
      // Nudges are fractions of the frame, so they mean the same at any zoom.
      // Rotate in pixels, or a photo that isn't square shears instead of turning.
      const ax=((x+0.5)/w-0.5-ox)*w, ay=((y+0.5)/h-0.5-oy)*h;
      const sx=(ax*cs-ay*sn)/w+0.5, sy=(ax*sn+ay*cs)/h+0.5;
      if(sx<0||sx>1||sy<0||sy>1){ lum[k]=1; continue; }
      g=lSampleLum(im,sx,sy,gray);
    }
    let v=(g-0.5)*contrast+0.5+bright;
    v=v<0?0:v>1?1:v;
    lum[k]=invert?1-v:v;
  }
}

async function addFiles(files){
  if(!files.length) return;
  setStatus(`Reading ${files.length} image${files.length>1?'s':''}…`);
  try{
    for(const f of files){
      const img=await fileToImage(f);
      images.push(makeImage(f.name.replace(/\.[^.]+$/,''), img));
    }
    selected=images.length-1;
    markDirty(); rebuildAll();
    setStatus('');
  }catch(e){
    console.error(e);
    setStatus(e.message,'err');
  }
}

function pickFiles(){
  const inp=document.getElementById('fileInput');
  inp.value='';
  inp.onchange=()=>addFiles([...inp.files]);
  inp.click();
}

function removeImage(i){
  const [gone]=images.splice(i,1);
  if(gone.id) deletedPhotoIds.push(gone.id);
  if(selected>=images.length) selected=images.length-1;
  markDirty(); rebuildAll();
}
function moveImage(i,dir){
  const j=i+dir;
  if(j<0||j>=images.length) return;
  [images[i],images[j]]=[images[j],images[i]];
  selected=j;
  markDirty(); rebuildAll();
}
function selectImage(i){ selected=i; buildImageList(); buildImageEditor(); }
function onImgChange(field,value){
  const im=images[selected];
  if(!im) return;
  im[field]=value;
  bake(im);
  markDirty();
  buildFlatView();
  scheduleRender();
}

// ── Three.js scene ─────────────────────────────────────────────
const canvas=document.getElementById('canvas');
const pane=document.getElementById('previewPane');
let renderer=null;
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(window.devicePixelRatio);
}catch(e){
  console.error('WebGL context creation failed:',e);
  pane.insertAdjacentHTML('beforeend','<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:var(--muted,#999)">3D preview unavailable — your browser/GPU couldn\'t create a WebGL context.</div>');
}

const LS_BG='litho_bgColour', LS_GRID='litho_gridVisible', LS_LOCKX='litho_lockX';
const savedBg=parseInt(localStorage.getItem(LS_BG) ?? '0x18181b');
const scene=new THREE.Scene();
scene.background=new THREE.Color(isNaN(savedBg)?0x18181b:savedBg);
const camera=new THREE.PerspectiveCamera(45,1,0.1,3000);
scene.add(new THREE.AmbientLight(0xffffff,0.5));
const dl=new THREE.DirectionalLight(0xffffff,0.8); dl.position.set(80,-60,120); scene.add(dl);
const fl=new THREE.DirectionalLight(0xffffff,0.3); fl.position.set(-80,60,40); scene.add(fl);
// The bulb inside — the whole point of a lithophane is the backlight, and it's
// what makes the inner relief read through the translucent wall.
const bulb=new THREE.PointLight(0xffe2ad,1.5,0); scene.add(bulb);

const grid=new THREE.GridHelper(400,40,0x333337,0x222225);
grid.visible=localStorage.getItem(LS_GRID)!=='0';
const partGroup=new THREE.Group();
scene.add(partGroup);
partGroup.add(grid);

const MAT_SHELL=new THREE.MeshStandardMaterial({color:0xf2ece0,roughness:0.75,metalness:0});
const MAT_HANGER=new THREE.MeshStandardMaterial({color:0xb9bec6,roughness:0.5,metalness:0.1});

function resize(){
  if(!renderer) return;
  const w=pane.clientWidth,h=pane.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

let rotX=-1.0, rotY=0.3, zoom=1;
let isDragging=false,lastX=0,lastY=0;
// Locking the tilt leaves a drag spinning the bauble about its own axis, which
// is how you want to read panels round the equator. The rotX slider still
// moves it — this is only about the mouse.
let lockX=localStorage.getItem(LS_LOCKX)==='1';
canvas.addEventListener('mousedown',e=>{ isDragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup',()=>{ isDragging=false; });
window.addEventListener('mousemove',e=>{
  if(!isDragging) return;
  rotY+=(e.clientX-lastX)*0.01;
  if(!lockX){
    rotX+=(e.clientY-lastY)*0.01;
    rotX=Math.max(-Math.PI/2,Math.min(Math.PI/2,rotX));
  }
  lastX=e.clientX; lastY=e.clientY;
  syncSlidersFromView();
});
canvas.addEventListener('wheel',e=>{
  zoom*= e.deltaY>0 ? 1.03 : 1/1.03;
  zoom=Math.max(0.3,Math.min(4,zoom));
  syncSlidersFromView(); e.preventDefault();
},{passive:false});

let fitDistance=160;
function animate(){
  requestAnimationFrame(animate);
  if(!renderer) return;
  partGroup.rotation.x=rotX;
  partGroup.rotation.y=rotY;
  camera.position.set(0,-fitDistance*0.45*zoom,fitDistance*zoom);
  camera.lookAt(0,0,0);
  renderer.render(scene,camera);
}
animate();

function toggleGrid(){ grid.visible=!grid.visible; localStorage.setItem(LS_GRID,grid.visible?'1':'0'); syncGridBtn(); }
function syncGridBtn(){ const b=document.getElementById('toggleGridBtn'); if(b) b.classList.toggle('primary',grid.visible); }
function toggleLockX(){ lockX=!lockX; localStorage.setItem(LS_LOCKX,lockX?'1':'0'); syncLockXBtn(); }
function syncLockXBtn(){ const b=document.getElementById('lockXBtn'); if(b) b.classList.toggle('primary',lockX); }
// "Lit" draws the wall the picture is actually cut into. With the relief on
// the inside that means back faces only, so what you see is the near half's
// inner wall lit by the bulb — the outer sphere is in front of it but
// front-facing, so it's culled out of the way. Unlit shows the outside, which
// is how it looks on the tree with the lights off.
function syncShellMaterial(){
  MAT_SHELL.side=(bulb.visible&&model.reliefSide==='inside')?THREE.BackSide:THREE.FrontSide;
  MAT_SHELL.needsUpdate=true;
  const b=document.getElementById('toggleBulbBtn');
  if(b) b.classList.toggle('primary',bulb.visible);
}
function toggleBulb(){ bulb.visible=!bulb.visible; syncShellMaterial(); }
function setBg(colour,el){
  scene.background=new THREE.Color(colour);
  localStorage.setItem(LS_BG,String(colour));
  if(el){
    el.parentElement.querySelectorAll('div').forEach(d=>{ d.style.border='1px solid var(--border2)'; });
    el.style.border='2px solid var(--accent)';
  }
}
function toggleCamPanel(id){
  ['camAnglePanel','viewportPanel'].forEach(p=>{ if(p!==id) document.getElementById(p).style.display='none'; });
  const el=document.getElementById(id);
  el.style.display = el.style.display==='none' ? 'block' : 'none';
}
function applyCam(){
  rotX=parseFloat(document.getElementById('camRotX').value);
  rotY=parseFloat(document.getElementById('camRotY').value);
  zoom=parseFloat(document.getElementById('camZoom').value);
}
function syncNum(sId,nId){ document.getElementById(nId).value=parseFloat(document.getElementById(sId).value).toFixed(2); }
function syncSlider(sId,nId){ const v=parseFloat(document.getElementById(nId).value); if(!isNaN(v)) document.getElementById(sId).value=v; }
function syncSlidersFromView(){
  const set=(s,n,v)=>{ document.getElementById(s).value=v; document.getElementById(n).value=v.toFixed(2); };
  set('camRotX','camRotXN',rotX); set('camRotY','camRotYN',rotY); set('camZoom','camZoomN',zoom);
}

// ── 3D preview ─────────────────────────────────────────────────
let previewMeshes=[], _renderTimer=null, _building=false;

function scheduleRender(){
  updateSizeLabel();
  clearTimeout(_renderTimer);
  _renderTimer=setTimeout(buildPreview, 250);
}

function clearPreview(){
  for(const m of previewMeshes){ partGroup.remove(m); m.geometry.dispose(); }
  previewMeshes=[];
}

function buildPreview(){
  if(!renderer || _building) return;
  _building=true;
  const busy=document.getElementById('buildingLabel');
  if(busy) busy.style.display='';
  // Yield once so the label paints before the geometry work blocks the thread.
  setTimeout(()=>{
    try{
      const p=params();
      clearPreview();
      for(const part of lBuildParts(p,images)){
        const mesh=new THREE.Mesh(part.geo, part.name==='Hanger'?MAT_HANGER:MAT_SHELL);
        partGroup.add(mesh);
        previewMeshes.push(mesh);
      }
      fitDistance=Math.max(60, p.dia*2.1);
      setStatus(images.length?'':'Add a photo to see it on the bauble.');
    }catch(e){
      console.error(e);
      setStatus('Preview failed: '+e.message,'err');
    }finally{
      _building=false;
      if(busy) busy.style.display='none';
    }
  },0);
}

function updateSizeLabel(){
  const el=document.getElementById('sizeLabel');
  const p=params(), d=lDerived(p,images);
  if(el) el.textContent=`⌀${p.dia} mm · ${d.panels} panel${d.panels>1?'s':''} · wall ${p.thinMM}–${p.thickMM} mm · ${(d.tris/1000).toFixed(0)}k triangles`;
  const hint=document.getElementById('derivedHint');
  if(hint) hint.innerHTML= d.panel
    ? `Each panel is <b>${d.panel.w.toFixed(0)} × ${d.panel.h.toFixed(0)} mm</b> on the surface, `
      +`with <b>${d.panel.plainTopMM.toFixed(0)} mm</b> plain above and <b>${d.panel.plainBotMM.toFixed(0)} mm</b> below. `
      +`Holes <b>⌀${d.topHoleMM.toFixed(0)} mm</b> top, <b>⌀${d.botHoleMM.toFixed(0)} mm</b> bottom.`
    : `Holes <b>⌀${d.topHoleMM.toFixed(0)} mm</b> top, <b>⌀${d.botHoleMM.toFixed(0)} mm</b> bottom. `
      +`Print it hole-down — the bottom rim is the first layer.`;
}

// ── Flat view — the panels as they'll be backlit ────────────────
// The processed luminance straight onto a canvas: white is where the wall goes
// thin and the light comes through. It's the honest preview of the sliders.
function buildFlatView(){
  const box=document.getElementById('flatWrap');
  if(!box) return;
  if(!images.length){
    box.innerHTML='<div class="status">No photos yet — hit + to add some.</div>';
    return;
  }
  box.innerHTML='';
  images.forEach((im,i)=>{
    const wrap=document.createElement('div');
    wrap.className='lm-flat-panel'+(i===selected?' selected':'');
    wrap.onclick=()=>selectImage(i);
    const c=document.createElement('canvas');
    c.width=im.w; c.height=im.h;
    const ctx=c.getContext('2d');
    const out=ctx.createImageData(im.w,im.h);
    for(let k=0;k<im.lum.length;k++){
      const g=Math.round(im.lum[k]*255);
      out.data[k*4]=g; out.data[k*4+1]=g; out.data[k*4+2]=g; out.data[k*4+3]=255;
    }
    ctx.putImageData(out,0,0);
    wrap.appendChild(c);
    const label=document.createElement('div');
    label.className='lm-flat-label';
    label.textContent=`${i+1}. ${im.name}`;
    wrap.appendChild(label);
    box.appendChild(wrap);
  });
}

function setView(which){
  const flat=which==='flat';
  document.getElementById('canvas').style.display=flat?'none':'block';
  document.getElementById('flatWrap').style.display=flat?'flex':'none';
  document.getElementById('viewFlatBtn').classList.toggle('primary',flat);
  document.getElementById('view3dBtn').classList.toggle('primary',!flat);
  if(!flat) resize();
}

// ── Image list ─────────────────────────────────────────────────
function buildImageList(){
  const el=document.getElementById('imageList');
  if(!el) return;
  el.innerHTML=images.map((im,i)=>`
    <div class="layer-row${i===selected?' selected':''}" onclick="selectImage(${i})">
      <i class="ti ti-photo" style="font-size:14px;color:var(--muted);flex-shrink:0"></i>
      <span class="lr-label">${i+1}. ${esc(im.name)}</span>
      <button class="lr-btn" title="Move up" onclick="event.stopPropagation();moveImage(${i},-1)"><i class="ti ti-chevron-up"></i></button>
      <button class="lr-btn" title="Move down" onclick="event.stopPropagation();moveImage(${i},1)"><i class="ti ti-chevron-down"></i></button>
      <button class="lr-btn" title="Remove" onclick="event.stopPropagation();removeImage(${i})"><i class="ti ti-trash"></i></button>
    </div>`).join('') || '<div class="status">No photos yet — hit + to add some. Each one gets its own panel around the bauble.</div>';
}

// ── Image editor (right panel) ─────────────────────────────────
function buildImageEditor(){
  const box=document.getElementById('imageEditor');
  if(!box) return;
  const im=images[selected];
  if(!im){ box.style.display='none'; return; }
  box.style.display='flex';
  const row=(label,inner)=>`<div class="adv-row"><label>${label}</label>${inner}</div>`;
  box.innerHTML=
     `<div class="panel-head"><span class="panel-title">${esc(im.name)}</span></div>`
    +row('Brightness',`<input type="range" min="-0.4" max="0.4" step="0.01" value="${im.bright}" oninput="onImgChange('bright',+this.value)">`)
    +row('Contrast',`<input type="range" min="0.4" max="2.2" step="0.02" value="${im.contrast}" oninput="onImgChange('contrast',+this.value)">`)
    +row('Invert',`<input type="checkbox" ${im.invert?'checked':''} onchange="onImgChange('invert',this.checked)">`)
    +`<div class="panel-head" style="margin-top:10px"><span class="panel-title">Framing</span></div>`
    +row('Zoom',`<input type="range" min="0.4" max="4" step="0.01" value="${im.zoom}" oninput="onImgChange('zoom',+this.value)">`)
    +row('Rotate (°)',`<input type="range" min="-180" max="180" step="1" value="${im.rot}" oninput="onImgChange('rot',+this.value)">`)
    +row('Across',`<input type="range" min="-0.5" max="0.5" step="0.005" value="${im.offX}" oninput="onImgChange('offX',+this.value)">`)
    +row('Up / down',`<input type="range" min="-0.5" max="0.5" step="0.005" value="${im.offY}" oninput="onImgChange('offY',+this.value)">`)
    +`<div class="panel-hint">Zoom past 1 to crop in; the Backlit view shows exactly what ends up on the panel. Dark areas print thick and read as shadow — invert if you're printing in a dark filament lit from inside.</div>`
    +`<div class="btn-group"><button class="btn" style="flex:1" onclick="resetImage()"><i class="ti ti-restore"></i> Reset</button></div>`;
}
function resetImage(){
  const im=images[selected];
  if(!im) return;
  im.bright=0; im.contrast=1; im.invert=false;
  im.zoom=1; im.rot=0; im.offX=0; im.offY=0;
  bake(im); markDirty(); buildImageEditor(); buildFlatView(); scheduleRender();
}

// ── Bauble parameters ──────────────────────────────────────────
function applyPreset(key){
  const p=PRESETS[key];
  if(!p) return;
  Object.assign(model,{dia:p.dia,topHole:p.topHole,botHole:p.botHole});
  markDirty(); buildParamsUI(); scheduleRender();
}
function onChange(field,value){
  model[field]=value;
  markDirty();
  if(field==='detail'||field==='hanger') buildParamsUI();
  if(field==='reliefSide') syncShellMaterial();
  scheduleRender();
}
function buildParamsUI(){
  const box=document.getElementById('paramsBox');
  if(!box) return;
  const m=model;
  const num=(f,min,max,step,title='')=>`<input type="number" class="adv-input"${title?` title="${esc(title)}"`:''} min="${min}" max="${max}" step="${step}" value="${m[f]}" onchange="onChange('${f}',+this.value)">`;
  const row=(label,inner,title='')=>`<div class="adv-row"><label${title?` title="${esc(title)}"`:''}>${label}</label>${inner}</div>`;
  box.innerHTML=
     row('Preset',`<select class="adv-text-input" style="width:150px" onchange="applyPreset(this.value);this.value=''"><option value="">Choose…</option>`
       +Object.entries(PRESETS).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('')+'</select>')
    +row('Diameter (mm)',num('dia',25,200,1))
    +row('Thin wall (mm)',num('thinMM',0.3,2,0.1),'Where the image is brightest. Below ~0.6 mm it gets fragile')
    +row('Thick wall (mm)',num('thickMM',1,8,0.1),'Where the image is darkest. The bigger the gap from thin, the more contrast')
    +row('Top hole (°)',num('topHole',6,45,1),'Half-angle from the pole — the opening the hanger arches over')
    +row('Bottom hole (°)',num('botHole',6,50,1),'The flat rim it prints on, and where the light goes in')
    +row('Panel centre (°)',num('centreDeg',30,150,1),'Latitude the photos sit on. 90 is the equator')
    +row('Band height (°)',num('bandDeg',0,170,1),'How much latitude the photos cover — 0 fits the band to the photo. Set it smaller to wrap the photos round a band and leave the top and bottom plain')
    +row('Repeat around',num('repeat',1,8,1),'Tile the photos this many times around — one photo stretched over 360° distorts badly')
    +row('Relief',`<select class="adv-text-input" title="Inside leaves the outside a clean sphere — the usual choice. Outside makes it a textured ball you can read unlit." onchange="onChange('reliefSide',this.value)">`
       +`<option value="inside"${m.reliefSide==='inside'?' selected':''}>Inside</option>`
       +`<option value="outside"${m.reliefSide==='outside'?' selected':''}>Outside</option></select>`)
    +row('Detail',`<select class="adv-text-input" onchange="onChange('detail',this.value)">`
       +Object.entries(LITHO_DETAIL).map(([k,v])=>`<option value="${k}"${m.detail===k?' selected':''}>${esc(v.label)}</option>`).join('')+'</select>')
    +row('Hanger arch',`<input type="checkbox" ${m.hanger?'checked':''} onchange="onChange('hanger',this.checked)">`)
    +(m.hanger?row('Arch bar (mm)',num('hangerMM',2,8,0.2),'How thick the arch over the top hole is'):'')
    +`<div class="panel-hint" id="derivedHint"></div>`;
  wrapSpinners(box);
  updateSizeLabel();
}

function rebuildAll(){
  buildImageList();
  buildImageEditor();
  buildFlatView();
  updateSizeLabel();
  scheduleRender();
}

// ── Design CRUD ─────────────────────────────────────────────
function rowFromModel(m){
  const row={ name:m.name, updated_at:new Date().toISOString() };
  for(const [js,db] of Object.entries(MODEL_FIELDS)) row[db]=m[js];
  return row;
}
function modelFromRow(r){
  const m={ id:r.id, name:r.name };
  for(const [js,db] of Object.entries(MODEL_FIELDS)) m[js]=NUM_FIELDS.has(js)?+r[db]:r[db];
  return m;
}
// The image bytes never change once a photo is in — only its name, order and
// the three sliders do — so an update leaves data_url out rather than pushing
// another 100 KB over the wire on every save.
function rowFromPhoto(im, modelId, order, withSrc){
  const row={ model_id:modelId, photo_order:order };
  for(const [js,db] of Object.entries(PHOTO_FIELDS)) if(withSrc||js!=='src') row[db]=im[js];
  return row;
}

async function loadModels(){
  try{ models=await sbGet('litho_models','?archived=eq.false&order=name'); }catch(e){ models=[]; }
  if(!Array.isArray(models)) models=[];
  refreshModelDropdown();
}
function refreshModelDropdown(){
  const sel=document.getElementById('modelSelect');
  if(!sel) return;
  sel.innerHTML=models.map(m=>`<option value="${m.id}"${String(model.id)===String(m.id)?' selected':''}>${esc(m.name)}</option>`).join('')
    || '<option value="">No designs yet</option>';
}
async function onModelSelect(){
  const id=document.getElementById('modelSelect').value;
  if(!id) return;
  if(isDirty && !await askConfirm('Discard unsaved changes?','Discard')){ refreshModelDropdown(); return; }
  await openModel(+id);
}
async function openModel(id){
  const row=models.find(m=>String(m.id)===String(id));
  if(!row){ setStatus('Design not found','err'); return; }
  setStatus('Loading…');
  model=modelFromRow(row);
  let rows=[];
  try{ rows=await sbGet('litho_photos',`?model_id=eq.${id}&order=photo_order`); }catch(e){ rows=[]; }
  images=[];
  for(const r of (Array.isArray(rows)?rows:[])){
    try{
      const img=await dataUrlToImage(r.data_url);
      const over={id:r.id};
      for(const [js,db] of Object.entries(PHOTO_FIELDS)) over[js]=NUM_FIELDS.has(js)?+r[db]:r[db];
      images.push(makeImage(r.name, img, over));
    }catch(e){ console.error('Could not decode photo',r.id,e); }
  }
  deletedPhotoIds=[]; selected=images.length?0:-1;
  clearDirty(); refreshModelDropdown(); syncShellMaterial();
  buildParamsUI(); rebuildAll();
  setStatus('');
}
async function newModel(){
  if(isDirty && !await askConfirm('Discard unsaved changes?','Discard')) return;
  const name=await askText('Name this bauble','Bauble '+(models.length+1));
  if(!name) return;
  setStatus('Creating…');
  const res=await sbInsert('litho_models', rowFromModel(defaultModel(name)));
  if(!Array.isArray(res)||!res[0]){ setStatus('Could not create: '+(res&&res.message||'unknown error'),'err'); return; }
  models.push(res[0]);
  model=modelFromRow(res[0]);
  images=[]; deletedPhotoIds=[]; selected=-1;
  clearDirty(); refreshModelDropdown(); syncShellMaterial();
  buildParamsUI(); rebuildAll();
  setStatus('Add some photos.');
}
async function saveModel(){
  if(!model.id){ setStatus('Nothing to save — make a design first','err'); return; }
  setStatus('Saving…');
  const err=await sbPatch('litho_models',`?id=eq.${model.id}`, rowFromModel(model));
  if(err){ setStatus('Save failed: '+(err.message||'unknown error'),'err'); return; }
  for(const id of deletedPhotoIds) await sbDelete('litho_photos',`?id=eq.${id}`);
  deletedPhotoIds=[];
  for(let i=0;i<images.length;i++){
    const row=rowFromPhoto(images[i], model.id, i, !images[i].id);
    if(images[i].id){
      const e=await sbPatch('litho_photos',`?id=eq.${images[i].id}`,row);
      if(e){ setStatus('Save failed: '+(e.message||'unknown error'),'err'); return; }
    }else{
      const res=await sbInsert('litho_photos',row);
      if(!Array.isArray(res)||!res[0]){ setStatus('Save failed: '+(res&&res.message||'unknown error'),'err'); return; }
      images[i].id=res[0].id;
    }
  }
  const idx=models.findIndex(m=>String(m.id)===String(model.id));
  if(idx>=0) models[idx]={...models[idx], ...rowFromModel(model)};
  clearDirty(); refreshModelDropdown();
  setStatus('Saved','ok');
}
async function renameModel(){
  if(!model.id) return;
  const n=await askText('Rename bauble', model.name);
  if(!n) return;
  model.name=n;
  markDirty(); refreshModelDropdown();
}
async function duplicateModel(){
  if(!model.id) return;
  const name=await askText('Name the copy', model.name+' copy');
  if(!name) return;
  setStatus('Duplicating…');
  const res=await sbInsert('litho_models', rowFromModel({...model, name}));
  if(!Array.isArray(res)||!res[0]){ setStatus('Could not duplicate','err'); return; }
  models.push(res[0]);
  model={...model, id:res[0].id, name};
  // The copy needs its own photo rows, not the originals'.
  for(const im of images) im.id=null;
  deletedPhotoIds=[];
  refreshModelDropdown(); markDirty();
  await saveModel();
}
async function deleteModel(){
  if(!model.id) return;
  if(!await askConfirm(`Delete "${model.name}"?`)) return;
  // Soft delete, same as everywhere else in PrintDesk.
  const err=await sbPatch('litho_models',`?id=eq.${model.id}`,{archived:true});
  if(err){ setStatus('Delete failed','err'); return; }
  models=models.filter(m=>String(m.id)!==String(model.id));
  if(models.length){ await openModel(models[0].id); return; }
  model=defaultModel('Bauble'); images=[]; deletedPhotoIds=[]; selected=-1;
  clearDirty(); clearPreview(); refreshModelDropdown();
  buildParamsUI(); rebuildAll();
  setStatus('Hit + in the header to make a design.');
}

// ── Export ─────────────────────────────────────────────────────
function exportModel(){
  setStatus('Building 3MF…');
  // Yield so the status paints — fine detail takes a second or two.
  setTimeout(()=>{
    try{
      const p=params();
      const parts=lBuildParts(p,images);
      const objects=parts.map((part,i)=>({
        geo:part.geo, name:part.name, colour:'#f0ead8',
        extruder:1, negative:false, skipFilamentSlot:i>0, id:i+1,
      }));
      const name=(model.name||'bauble').replace(/[^\w\-. ]+/g,'_');
      const zip=_badgeBuildZip(_badgeBuild3MF(objects,name,null));
      const blob=new Blob([zip],{type:'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'});
      const url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download=name+'.3mf'; a.click(); URL.revokeObjectURL(url);
      setStatus(`Exported ${name}.3mf — print it bottom-hole down`,'ok');
    }catch(e){
      console.error(e);
      setStatus('Export failed: '+e.message,'err');
    }
  },0);
}

// ── Header menus ───────────────────────────────────────────────
let modelMenuOpen=false, userMenuOpen=false;
function toggleModelMenu(){ modelMenuOpen=!modelMenuOpen; document.getElementById('modelMenu').style.display=modelMenuOpen?'flex':'none'; }
function closeModelMenu(){ modelMenuOpen=false; document.getElementById('modelMenu').style.display='none'; }
function toggleUserMenu(){ userMenuOpen=!userMenuOpen; document.getElementById('userMenu').style.display=userMenuOpen?'flex':'none'; }
document.addEventListener('click',()=>{ closeModelMenu(); if(userMenuOpen) toggleUserMenu(); });

// ── Boot ───────────────────────────────────────────────────────

// Drop photos straight onto the preview.
pane.addEventListener('dragover',e=>{ e.preventDefault(); pane.classList.add('lm-dropping'); });
pane.addEventListener('dragleave',()=>pane.classList.remove('lm-dropping'));
pane.addEventListener('drop',e=>{
  e.preventDefault();
  pane.classList.remove('lm-dropping');
  addFiles([...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')));
});

async function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='flex';
  document.getElementById('userChip').textContent=currentUser?.user_metadata?.display_name||currentUser?.email||'';
  resize();
  setStatus('Loading…');
  await loadModels();
  if(models.length) await openModel(models[0].id);
  else setStatus('No designs yet — hit + in the header to make one.');
}

syncGridBtn();
syncLockXBtn();
syncShellMaterial();
syncSlidersFromView();
buildParamsUI();
rebuildAll();
setView('3d');
if(location.search.includes('selfcheck')) lSelfCheck();

// A design only exists in the tab until Save, and the photos are the
// expensive part to redo.
window.addEventListener('beforeunload',e=>{ if(isDirty){ e.preventDefault(); e.returnValue=''; } });

(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
