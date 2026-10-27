// LithoMak3r — drop photos in, get a lithophane bauble out.
//
// Nothing here talks to Supabase: a lithophane is its own source of truth, so
// the images live in the tab until you export. Shell geometry is geometry.js;
// this file is the UI, the image processing and the 3MF.

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

const model={
  name:'Bauble', dia:60, topHole:14, botHole:16,
  thinMM:0.7, thickMM:2.6, centreDeg:90, repeat:1,
  reliefSide:'inside', detail:'normal', hanger:true, hangerMM:3.6,
};
let images=[], selected=-1;

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

function makeImage(name, img){
  const scale=Math.min(1, MAX_PX/Math.max(img.width,img.height));
  const w=Math.max(2,Math.round(img.width*scale)), h=Math.max(2,Math.round(img.height*scale));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d');
  ctx.drawImage(img,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data;
  const gray=new Float32Array(w*h);
  for(let i=0;i<gray.length;i++){
    // Rec. 709 — matches how the eye weights the channels, so colour photos
    // keep their contrast where it matters.
    const a=d[i*4+3]/255;
    const l=(0.2126*d[i*4]+0.7152*d[i*4+1]+0.0722*d[i*4+2])/255;
    gray[i]=l*a+(1-a); // transparent reads as white, i.e. thin wall
  }
  const rec={ name, w, h, gray, lum:new Float32Array(w*h), invert:false, bright:0, contrast:1 };
  bake(rec);
  return rec;
}

function bake(im){
  const {gray,lum,bright,contrast,invert}=im;
  for(let i=0;i<gray.length;i++){
    let v=(gray[i]-0.5)*contrast+0.5+bright;
    v=v<0?0:v>1?1:v;
    lum[i]=invert?1-v:v;
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
    rebuildAll();
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
  images.splice(i,1);
  if(selected>=images.length) selected=images.length-1;
  rebuildAll();
}
function moveImage(i,dir){
  const j=i+dir;
  if(j<0||j>=images.length) return;
  [images[i],images[j]]=[images[j],images[i]];
  selected=j;
  rebuildAll();
}
function selectImage(i){ selected=i; buildImageList(); buildImageEditor(); }
function onImgChange(field,value){
  const im=images[selected];
  if(!im) return;
  im[field]=value;
  bake(im);
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

const LS_BG='litho_bgColour', LS_GRID='litho_gridVisible';
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
canvas.addEventListener('mousedown',e=>{ isDragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup',()=>{ isDragging=false; });
window.addEventListener('mousemove',e=>{
  if(!isDragging) return;
  rotY+=(e.clientX-lastX)*0.01;
  rotX+=(e.clientY-lastY)*0.01;
  rotX=Math.max(-Math.PI/2,Math.min(Math.PI/2,rotX));
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
    ? `Each panel is <b>${d.panel.w.toFixed(0)} × ${d.panel.h.toFixed(0)} mm</b> on the surface. `
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
    +`<div class="panel-hint">Dark areas print thick and read as shadow. Invert if you're printing in a dark filament lit from inside.</div>`
    +`<div class="btn-group"><button class="btn" style="flex:1" onclick="resetImage()"><i class="ti ti-restore"></i> Reset</button></div>`;
}
function resetImage(){
  const im=images[selected];
  if(!im) return;
  im.bright=0; im.contrast=1; im.invert=false;
  bake(im); buildImageEditor(); buildFlatView(); scheduleRender();
}

// ── Bauble parameters ──────────────────────────────────────────
function applyPreset(key){
  const p=PRESETS[key];
  if(!p) return;
  Object.assign(model,{dia:p.dia,topHole:p.topHole,botHole:p.botHole});
  buildParamsUI(); scheduleRender();
}
function onChange(field,value){
  model[field]=value;
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

// ── Boot ───────────────────────────────────────────────────────
document.getElementById('nameInput').value=model.name;
document.getElementById('nameInput').oninput=e=>{ model.name=e.target.value; };

// Drop photos straight onto the preview.
pane.addEventListener('dragover',e=>{ e.preventDefault(); pane.classList.add('lm-dropping'); });
pane.addEventListener('dragleave',()=>pane.classList.remove('lm-dropping'));
pane.addEventListener('drop',e=>{
  e.preventDefault();
  pane.classList.remove('lm-dropping');
  addFiles([...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')));
});

syncGridBtn();
syncShellMaterial();
syncSlidersFromView();
buildParamsUI();
rebuildAll();
setView('3d');
if(location.search.includes('selfcheck')) lSelfCheck();
