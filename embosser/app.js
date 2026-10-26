// EmbossMak3r — parametric business-card embosser.
//
// Design flat, print round: you lay artwork out on the roller's unrolled
// surface, and the export is a matched pair of rollers (one raised, one
// recessed) plus a body sized to whatever roller you just specified. All the
// geometry lives in geometry.js; this file is UI, Supabase and the preview.
//
// ponytail: auth, the modals and the three.js scene are copied from
// beadmaker/app.js rather than extracted into a shared module — three copies
// now, so the next tool to need them should pull them onto a shared/sb.js
// instead of making a fourth.

// ── Small helpers ──────────────────────────────────────────────
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setStatus(msg,cls=''){ const el=document.getElementById('status'); if(el){ el.textContent=msg; el.className='status'+(cls?' '+cls:''); } }

function askText(message, defaultValue){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML='<div class="bm-modal"><div class="bm-modal-msg"></div><input type="text" class="adv-text-input" id="bmModalInput"><div class="bm-modal-btns"><button class="btn sm" id="bmModalCancel">Cancel</button><button class="btn sm primary" id="bmModalOk">OK</button></div></div>';
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const input=overlay.querySelector('#bmModalInput');
    input.value=defaultValue||''; input.focus(); input.select();
    const close=val=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#bmModalOk').onclick=()=>close(input.value.trim()||null);
    overlay.querySelector('#bmModalCancel').onclick=()=>close(null);
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close(null); });
    input.onkeydown=e=>{ if(e.key==='Enter') close(input.value.trim()||null); if(e.key==='Escape') close(null); };
  });
}
function askConfirm(message, confirmLabel='Delete'){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML='<div class="bm-modal"><div class="bm-modal-msg"></div><div class="bm-modal-btns"><button class="btn sm" id="bmModalCancel">Cancel</button><button class="btn sm primary" id="bmModalOk">'+esc(confirmLabel)+'</button></div></div>';
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const close=val=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#bmModalOk').onclick=()=>close(true);
    overlay.querySelector('#bmModalCancel').onclick=()=>close(false);
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close(false); });
  });
}

// ── Supabase ───────────────────────────────────────────────────
const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';
let sbToken=null, sbRefreshToken=null, currentUser=null;

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(sbToken||SB_KEY),'Content-Type':'application/json','Prefer':'return=representation'}; }

let _refreshInFlight=null;
async function refreshSession(){
  if(!sbRefreshToken) return false;
  if(_refreshInFlight) return _refreshInFlight;
  _refreshInFlight=(async()=>{
    try{
      const res=await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`,{
        method:'POST', headers:{'apikey':SB_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:sbRefreshToken}),
      });
      const data=await res.json();
      if(!res.ok || !data.access_token) return false;
      storeSession(data); return true;
    }catch(e){ return false; }
    finally{ _refreshInFlight=null; }
  })();
  return _refreshInFlight;
}
function storeSession(data){
  sbToken=data.access_token;
  if(data.refresh_token) sbRefreshToken=data.refresh_token;
  if(data.user) currentUser=data.user;
  // Same keys as BadgeMak3r — one sign-in covers every tool.
  localStorage.setItem('badgemaker_token', sbToken);
  if(sbRefreshToken) localStorage.setItem('badgemaker_refresh', sbRefreshToken);
}
async function sbFetch(path, opts={}, extra={}){
  const send=()=>fetch(`${SB_URL}/rest/v1/${path}`,{...opts, headers:{...sbHeaders(), ...extra}});
  let r=await send();
  if(r.status===401 && await refreshSession()) r=await send();
  return r;
}
async function sbGet(table,q=''){ const r=await sbFetch(`${table}${q}`); return r.json(); }
async function sbInsert(table,row){ const r=await sbFetch(table,{method:'POST',body:JSON.stringify(row)}); return r.json(); }
async function sbPatch(table,q,row){ const r=await sbFetch(`${table}${q}`,{method:'PATCH',body:JSON.stringify(row)}); return r.ok?null:await r.json(); }
async function sbDelete(table,q){ const r=await sbFetch(`${table}${q}`,{method:'DELETE'}); return r.ok?null:await r.json(); }

async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value;
  const errEl=document.getElementById('loginError');
  const btn=document.getElementById('loginBtn');
  errEl.style.display='none';
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Signing in…';
  try{
    const res=await fetch(`${SB_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'apikey':SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const data=await res.json();
    if(data.error) throw new Error(data.error_description||data.error);
    storeSession(data);
    showApp();
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='block';
    btn.disabled=false; btn.innerHTML='<i class="ti ti-login"></i> Sign in';
  }
}
async function restoreSession(){
  const t=localStorage.getItem('badgemaker_token')||localStorage.getItem('pd_access_token')||localStorage.getItem('pd_token');
  sbRefreshToken=localStorage.getItem('badgemaker_refresh')||null;
  if(!t && !sbRefreshToken) return false;
  const fetchUser=async tok=>{
    const res=await fetch(`${SB_URL}/auth/v1/user`,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}});
    return res.ok ? res.json() : null;
  };
  try{
    if(t){ const user=await fetchUser(t); if(user){ sbToken=t; currentUser=user; return true; } }
    if(await refreshSession()){ currentUser=await fetchUser(sbToken); return !!currentUser; }
    return false;
  }catch(e){ return false; }
}
function doLogout(){
  localStorage.removeItem('badgemaker_token');
  localStorage.removeItem('badgemaker_refresh');
  sbToken=null; sbRefreshToken=null; currentUser=null;
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}

// ── Fonts (shared with BadgeMak3r) ─────────────────────────────
const fontCache=new Map();
let fonts=[];
let builtinFontPromise=null;

function loadBuiltinFont(){
  if(fontCache.has('builtin')) return Promise.resolve(fontCache.get('builtin'));
  if(builtinFontPromise) return builtinFontPromise;
  builtinFontPromise=new Promise((resolve,reject)=>{
    opentype.load('../badge/LEGO.TTF',(err,f)=>{ if(err){ reject(err); return; } fontCache.set('builtin',f); resolve(f); });
  });
  return builtinFontPromise;
}
function fontKey(id){ return id==null||id===''?'builtin':String(id); }
function getFont(id){ return fontCache.get(fontKey(id))||fontCache.get('builtin')||null; }
function base64ToArrayBuffer(b64){
  const bin=atob(b64), bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes.buffer;
}
async function loadFonts(){
  try{ fonts=await sbGet('badgemaker_fonts','?order=name'); }catch(e){ fonts=[]; }
  if(!Array.isArray(fonts)) fonts=[];
  for(const f of fonts){
    try{ fontCache.set(fontKey(f.id), opentype.parse(base64ToArrayBuffer(f.data_base64))); }
    catch(e){ console.warn('Bad font in DB:',f.name,e); }
  }
}
function fontOptions(sel){
  return '<option value="">LEGO (built-in)</option>'+fonts.map(f=>`<option value="${f.id}"${String(sel)===String(f.id)?' selected':''}>${esc(f.name)}</option>`).join('');
}

// ── Images ─────────────────────────────────────────────────────
// Decoded images, keyed by their data URL. The trace needs a drawable image
// and the same one gets re-traced on every threshold nudge.
const imageCache=new Map();
function getImage(src){ return imageCache.get(src)||null; }
function loadImage(src){
  if(imageCache.has(src)) return Promise.resolve(imageCache.get(src));
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{ imageCache.set(src,img); resolve(img); };
    img.onerror=()=>resolve(null);
    img.src=src;
  });
}
// Keep what lands in the text column sane — a logo only needs enough pixels
// for an 8 px/mm trace.
function shrinkImage(img, maxPx=800){
  const s=Math.min(1, maxPx/Math.max(img.width,img.height));
  if(s>=1) return null;
  const cv=document.createElement('canvas');
  cv.width=Math.round(img.width*s); cv.height=Math.round(img.height*s);
  cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
  return cv.toDataURL('image/png');
}

// ── Number spinners (ported from BadgeMak3r) ───────────────────
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
const MODEL_FIELDS={
  wrapMM:'wrap_mm', widthMM:'width_mm', repeatCount:'repeat_count',
  embossMM:'emboss_mm', paperMM:'paper_mm', clearanceMM:'clearance_mm',
  axleMM:'axle_mm', gearTeeth:'gear_teeth', gearMM:'gear_mm',
  plateMM:'plate_mm', postMM:'post_mm', knobMM:'knob_mm',
  nipMM:'nip_mm', marginMM:'margin_mm',
};
const EL_FIELDS={
  kind:'kind', name:'name', content:'content', fontId:'font_id', fontSize:'font_size',
  posU:'pos_u', posV:'pos_v', sizeW:'size_w', sizeH:'size_h', rotation:'rotation',
  outlineMM:'outline_mm', threshold:'threshold', invert:'invert', visible:'visible',
};

let models=[], currentModel=null, elements=[], selected=-1, deletedIds=[];
let isDirty=false, _keySeq=1;

function defaultModel(name){
  return {
    id:null, name,
    wrapMM:85.6, widthMM:54, repeatCount:1,
    embossMM:0.6, paperMM:0.3, clearanceMM:0.15,
    axleMM:5, gearTeeth:18, gearMM:4,
    plateMM:4, postMM:6, knobMM:26, nipMM:0.4, marginMM:7,
  };
}
function makeElement(kind, over={}){
  const p=eParams(currentModel||defaultModel(''));
  return {
    _key:_keySeq++, id:null, order:elements.length, kind,
    name: kind.charAt(0).toUpperCase()+kind.slice(1),
    content: kind==='text' ? 'HELLO' : '',
    fontId:null, fontSize:10,
    posU:p.tileU/2, posV:p.width/2,
    sizeW:20, sizeH:20, rotation:0,
    outlineMM:0, threshold:128, invert:false, visible:true,
    ...over,
  };
}
function markDirty(){ isDirty=true; const b=document.getElementById('saveBtn'); if(b) b.classList.add('dirty'); }
function clearDirty(){ isDirty=false; const b=document.getElementById('saveBtn'); if(b) b.classList.remove('dirty'); }

// ── Artwork cache ──────────────────────────────────────────────
// Tracing and SVG sampling are the slow part, so each element's paths are
// cached against a signature of the fields that change its outline.
const artCache=new Map();
function elSig(el){
  return [el.kind,el.content,el.fontId,el.fontSize,el.sizeW,el.sizeH,el.rotation,
          el.posU,el.posV,el.outlineMM,el.threshold,el.invert].join('|');
}
const artCtx={ font:getFont, image:getImage };
function elPaths(el){
  const sig=elSig(el);
  const hit=artCache.get(el._key);
  if(hit && hit.sig===sig) return hit.paths;
  let paths=[];
  try{ paths=eElementPaths(el, artCtx); }
  catch(e){ console.warn('Artwork failed for',el.name,e); }
  artCache.set(el._key,{ sig, paths });
  return paths;
}
function allPaths(){
  const all=[];
  for(const el of elements){
    if(el.visible===false) continue;
    for(const p of elPaths(el)) all.push(p);
  }
  return all.length ? _badgeClipperUnion(all) : [];
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

const LS_BG='embosser_bgColour', LS_GRID='embosser_gridVisible';
const savedBg=parseInt(localStorage.getItem(LS_BG) ?? '0x18181b');
const scene=new THREE.Scene();
scene.background=new THREE.Color(isNaN(savedBg)?0x18181b:savedBg);
const camera=new THREE.PerspectiveCamera(45,1,0.1,3000);
scene.add(new THREE.AmbientLight(0xffffff,0.55));
const dl=new THREE.DirectionalLight(0xffffff,0.85); dl.position.set(80,-60,120); scene.add(dl);
const fl=new THREE.DirectionalLight(0xffffff,0.3); fl.position.set(-80,60,40); scene.add(fl);

const grid=new THREE.GridHelper(400,40,0x333337,0x222225);
grid.visible=localStorage.getItem(LS_GRID)!=='0';
const partGroup=new THREE.Group();
scene.add(partGroup);
partGroup.add(grid);

const MAT_SOLID=new THREE.MeshStandardMaterial({color:0xb9bec6,roughness:0.55,metalness:0.05});
// The body wraps the rollers, and the rollers are what you're checking — so
// the frame is see-through by default, and the Body button takes it away.
const MAT_BODY =new THREE.MeshStandardMaterial({color:0x7d8794,roughness:0.6,transparent:true,opacity:0.3,depthWrite:false});
const MAT_CUT  =new THREE.MeshStandardMaterial({color:0xff5a5a,roughness:0.5,transparent:true,opacity:0.45});

function resize(){
  if(!renderer) return;
  const w=pane.clientWidth,h=pane.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

let rotX=-0.5, rotY=0.75, zoom=1;
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

let fitDistance=200;
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
function syncNum(sId,nId){
  const v=parseFloat(document.getElementById(sId).value);
  document.getElementById(nId).value=v.toFixed(2);
}
function syncSlider(sId,nId){ const v=parseFloat(document.getElementById(nId).value); if(!isNaN(v)) document.getElementById(sId).value=v; }
function syncSlidersFromView(){
  const set=(s,n,v)=>{ document.getElementById(s).value=v; document.getElementById(n).value=v.toFixed(2); };
  set('camRotX','camRotXN',rotX); set('camRotY','camRotYN',rotY); set('camZoom','camZoomN',zoom);
}

// ── 3D preview ─────────────────────────────────────────────────
let previewMeshes=[], bodyMeshes=[], bodyVisible=true;
let _renderTimer=null, _building=false;

function toggleBody(){
  bodyVisible=!bodyVisible;
  for(const m of bodyMeshes) m.visible=bodyVisible;
  const b=document.getElementById('toggleBodyBtn');
  if(b) b.classList.toggle('primary', bodyVisible);
}

function scheduleRender(){
  buildFlatView();
  updateSizeLabel();
  clearTimeout(_renderTimer);
  _renderTimer=setTimeout(buildPreview, 220);
}

function clearPreview(){
  for(const m of previewMeshes){ partGroup.remove(m); m.geometry.dispose(); }
  previewMeshes=[]; bodyMeshes=[];
}

function buildPreview(){
  if(!renderer || !currentModel || _building) return;
  _building=true;
  const busy=document.getElementById('buildingLabel');
  if(busy) busy.style.display='';
  // Yield once so the "Building…" label actually paints before the geometry
  // work blocks the thread.
  setTimeout(()=>{
    try{
      const p=eParams(currentModel);
      clearPreview();
      const parts=eBuildAssembly(allPaths(), p);
      for(const part of parts){
        const isBody = part.name.startsWith('Body')||part.name==='Knob';
        const mesh=new THREE.Mesh(part.geo, part.negative ? MAT_CUT : isBody ? MAT_BODY : MAT_SOLID);
        partGroup.add(mesh);
        previewMeshes.push(mesh);
        if(isBody){ bodyMeshes.push(mesh); mesh.visible=bodyVisible; }
      }
      // Parts are built in assembly coordinates starting at z=0; recentre on
      // their own bounds so the thing spins about itself and frames whatever
      // size of roller you just asked for.
      const box=new THREE.Box3();
      for(const m of previewMeshes) box.expandByObject(m);
      if(!box.isEmpty()){
        const c=box.getCenter(new THREE.Vector3()), s=box.getSize(new THREE.Vector3());
        for(const m of previewMeshes) m.position.set(-c.x,-c.y,-c.z);
        fitDistance=Math.max(60, Math.max(s.x,s.y,s.z)*1.9);
      }
      setStatus('');
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
  if(!el||!currentModel) return;
  const p=eParams(currentModel);
  el.textContent=`roller ⌀${p.dia.toFixed(1)} × ${p.width.toFixed(0)} mm · wrap ${p.wrap.toFixed(1)} mm`
    +(p.repeat>1?` · ${p.repeat}× tile ${p.tileU.toFixed(1)} mm`:'')
    +` · body ${(p.dia+2*p.margin).toFixed(0)} × ${(eCentreDist(p)+p.dia+2*p.margin).toFixed(0)} mm`;
  const hint=document.getElementById('derivedHint');
  if(hint) hint.innerHTML=`Worked out: roller <b>⌀${p.dia.toFixed(1)} mm</b>, `
    +`<b>${p.teeth}</b>-tooth gears, <b>${p.nip.toFixed(2)} mm</b> gap, `
    +`<b>${p.emboss.toFixed(1)} mm</b> emboss. Body <b>${(p.dia+2*p.margin).toFixed(0)} × ${(eCentreDist(p)+p.dia+2*p.margin).toFixed(0)} mm</b>.`;
}

// ── Flat view (the design surface, unrolled) ────────────────────
// One SVG at 1 unit = 1 mm. v is drawn upwards, so the strip reads the way
// the card comes out.
function pathsToSvgD(paths, flipAt){
  let d='';
  for(const p of paths){
    if(p.length<3) continue;
    d+='M'+p.map((pt,i)=>`${(pt.X/1000).toFixed(3)},${(flipAt-pt.Y/1000).toFixed(3)}`).join('L')+'Z';
  }
  return d;
}

function buildFlatView(){
  const svg=document.getElementById('flatSvg');
  if(!svg||!currentModel) return;
  const p=eParams(currentModel);
  const pad=Math.max(4, p.tileU*0.06);
  svg.setAttribute('viewBox',`${-pad} ${-pad} ${p.tileU+2*pad} ${p.width+2*pad}`);
  let out=`<rect x="0" y="0" width="${p.tileU}" height="${p.width}" fill="#26262b" stroke="#4a4a52" stroke-width="0.25"/>`;
  // Midlines, so centring something by eye is possible.
  out+=`<line x1="${p.tileU/2}" y1="0" x2="${p.tileU/2}" y2="${p.width}" stroke="#3a3a42" stroke-width="0.15"/>`;
  out+=`<line x1="0" y1="${p.width/2}" x2="${p.tileU}" y2="${p.width/2}" stroke="#3a3a42" stroke-width="0.15"/>`;
  elements.forEach((el,i)=>{
    const paths=elPaths(el);
    if(!paths.length) return;
    const d=pathsToSvgD(paths, p.width);
    const sel=i===selected;
    out+=`<path d="${d}" fill="${el.visible===false?'#55555c':(sel?'#8ab4ff':'#e8e8e6')}" fill-rule="nonzero"`
      +` opacity="${el.visible===false?0.4:1}" style="cursor:move" data-el="${i}"/>`;
  });
  svg.innerHTML=out;
  svg.querySelectorAll('path[data-el]').forEach(node=>{
    node.addEventListener('mousedown', e=>startFlatDrag(e, +node.dataset.el));
  });
}

let _drag=null;
function svgPointMM(e){
  const svg=document.getElementById('flatSvg');
  const ctm=svg.getScreenCTM();
  if(!ctm) return null;
  const pt=svg.createSVGPoint();
  pt.x=e.clientX; pt.y=e.clientY;
  const loc=pt.matrixTransform(ctm.inverse());
  return { u:loc.x, v:eParams(currentModel).width-loc.y };
}
function startFlatDrag(e, i){
  const at=svgPointMM(e);
  if(!at) return;
  selectElement(i);
  _drag={ i, u0:at.u, v0:at.v, eu:elements[i].posU, ev:elements[i].posV };
  e.preventDefault();
}
window.addEventListener('mousemove', e=>{
  if(!_drag) return;
  const at=svgPointMM(e);
  if(!at) return;
  const el=elements[_drag.i];
  el.posU=+(_drag.eu+(at.u-_drag.u0)).toFixed(2);
  el.posV=+(_drag.ev+(at.v-_drag.v0)).toFixed(2);
  markDirty();
  buildFlatView();
  syncElementEditor();
});
window.addEventListener('mouseup', ()=>{ if(_drag){ _drag=null; scheduleRender(); } });

function setView(which){
  document.getElementById('flatWrap').style.display = which==='flat' ? '' : 'none';
  document.getElementById('canvas').style.display   = which==='flat' ? 'none' : '';
  document.getElementById('viewFlatBtn').classList.toggle('primary', which==='flat');
  document.getElementById('view3dBtn').classList.toggle('primary', which!=='flat');
  if(which==='flat') buildFlatView(); else resize();
}

// ── Element list ───────────────────────────────────────────────
const KIND_ICON={ text:'ti-text-size', svg:'ti-vector', image:'ti-photo', rect:'ti-square', circle:'ti-circle' };

function buildElementList(){
  const el=document.getElementById('elementList');
  if(!el) return;
  el.innerHTML=elements.map((e,i)=>`
    <div class="layer-row${i===selected?' selected':''}${e.visible===false?' hidden-layer':''}" onclick="selectElement(${i})">
      <button class="lr-btn" title="${e.visible===false?'Show':'Hide'}" onclick="event.stopPropagation();toggleVisible(${i})"><i class="ti ${e.visible===false?'ti-eye-off':'ti-eye'}"></i></button>
      <i class="ti ${KIND_ICON[e.kind]||'ti-shape'}" style="font-size:14px;color:var(--muted);flex-shrink:0"></i>
      <span class="lr-label">${esc(e.name||e.kind)}${e.kind==='text'&&e.content?' — '+esc(e.content.slice(0,14)):''}</span>
      <div class="layer-row-menu-wrap">
        <button class="lr-btn" title="Options" onclick="event.stopPropagation();toggleElMenu(${i})"><i class="ti ti-dots-vertical"></i></button>
        <div class="layer-row-menu" style="display:${openElMenu===i?'flex':'none'}" onclick="event.stopPropagation()">
          <div class="lrm-item" onclick="duplicateElement(${i});closeElMenu()"><i class="ti ti-copy"></i> Duplicate</div>
          <div class="lrm-item" onclick="renameElement(${i});closeElMenu()"><i class="ti ti-edit"></i> Rename</div>
          <div class="lrm-item danger" onclick="removeElement(${i});closeElMenu()"><i class="ti ti-trash"></i> Delete</div>
        </div>
      </div>
    </div>`).join('') || '<div class="status">Nothing on the roller yet — add some text or import a logo.</div>';
}
let openElMenu=-1;
function toggleElMenu(i){ openElMenu=openElMenu===i?-1:i; buildElementList(); }
function closeElMenu(){ openElMenu=-1; buildElementList(); }

function selectElement(i){ selected=i; buildElementList(); buildElementEditor(); buildFlatView(); }
function toggleVisible(i){ elements[i].visible=elements[i].visible===false; markDirty(); buildElementList(); scheduleRender(); }
async function renameElement(i){
  const n=await askText('Element name', elements[i].name);
  if(n){ elements[i].name=n; markDirty(); buildElementList(); }
}
function duplicateElement(i){
  const copy={...elements[i], _key:_keySeq++, id:null, posU:elements[i].posU+3, posV:elements[i].posV-3};
  elements.splice(i+1,0,copy);
  selected=i+1; markDirty(); buildElementList(); buildElementEditor(); scheduleRender();
}
function removeElement(i){
  if(elements[i].id) deletedIds.push(elements[i].id);
  artCache.delete(elements[i]._key);
  elements.splice(i,1);
  if(selected>=elements.length) selected=elements.length-1;
  markDirty(); buildElementList(); buildElementEditor(); scheduleRender();
}
function addElement(kind){
  closeAddMenu();
  if(kind==='svg'||kind==='image'){ pickFile(kind); return; }
  elements.push(makeElement(kind, kind==='text'?{sizeW:40,sizeH:12}:{}));
  selected=elements.length-1;
  markDirty(); buildElementList(); buildElementEditor(); scheduleRender();
}
let addMenuOpen=false;
function toggleAddMenu(){ addMenuOpen=!addMenuOpen; document.getElementById('addMenu').style.display=addMenuOpen?'flex':'none'; }
function closeAddMenu(){ addMenuOpen=false; document.getElementById('addMenu').style.display='none'; }

// ── File import ────────────────────────────────────────────────
function pickFile(kind){
  const input=document.getElementById('fileInput');
  input.accept = kind==='svg' ? '.svg,image/svg+xml' : 'image/png,image/jpeg,image/webp';
  input.onchange=async()=>{
    const f=input.files&&input.files[0];
    input.value='';
    if(!f) return;
    setStatus('Reading '+f.name+'…');
    try{
      if(kind==='svg'){
        const src=await f.text();
        elements.push(makeElement('svg',{ name:f.name.replace(/\.svg$/i,''), content:src, sizeW:40, sizeH:20 }));
      }else{
        let url=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f); });
        let img=await loadImage(url);
        if(!img) throw new Error('could not decode that image');
        const small=shrinkImage(img);
        if(small){ url=small; img=await loadImage(url); }
        elements.push(makeElement('image',{ name:f.name.replace(/\.[^.]+$/,''), content:url, sizeW:30, sizeH:30 }));
      }
      selected=elements.length-1;
      markDirty(); buildElementList(); buildElementEditor(); scheduleRender();
      setStatus('');
    }catch(e){ setStatus('Import failed: '+e.message,'err'); }
  };
  input.click();
}

// ── Element editor ─────────────────────────────────────────────
function buildElementEditor(){
  const box=document.getElementById('elementEditor');
  const el=elements[selected];
  if(!el){ box.style.display='none'; return; }
  box.style.display='flex';
  const row=(label,inner,title='')=>`<div class="adv-row"><label${title?` title="${esc(title)}"`:''}>${label}</label>${inner}</div>`;
  const num=(f,min,max,step)=>`<input type="number" class="adv-input" min="${min}" max="${max}" step="${step}" value="${el[f]}" onchange="onElChange('${f}',+this.value)">`;

  let html=`<div class="layer-setting-block"><div class="section-title" style="margin:0 0 6px">${esc(el.name||el.kind)}</div>`;
  if(el.kind==='text'){
    html+=row('Text',`<input type="text" class="adv-text-input" style="width:150px" value="${esc(el.content)}" oninput="onElChange('content',this.value)">`);
    html+=row('Font',`<select class="adv-text-input" style="width:150px" onchange="onElChange('fontId',this.value||null)">${fontOptions(el.fontId)}</select>`);
    html+=row('Size (mm)',num('fontSize',2,120,0.5));
  }
  if(el.kind==='rect'||el.kind==='circle'){
    html+=row('Width (mm)',num('sizeW',0.5,400,0.5));
    html+=row('Height (mm)',num('sizeH',0.5,400,0.5));
  }
  if(el.kind==='svg'||el.kind==='image'){
    html+=row('Fit width (mm)',num('sizeW',1,400,0.5),'The artwork is scaled to fit this box, keeping its aspect');
    html+=row('Fit height (mm)',num('sizeH',1,400,0.5));
  }
  if(el.kind==='image'){
    html+=row('Threshold',`<input type="range" min="8" max="248" step="4" value="${el.threshold}" style="width:150px" oninput="onElChange('threshold',+this.value)">`,'Pixels darker than this become raised');
    html+=row('Invert',`<input type="checkbox" ${el.invert?'checked':''} onchange="onElChange('invert',this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">`);
  }
  html+=row('Around (mm)',num('posU',-400,400,0.5),'Position around the roller');
  html+=row('Along (mm)',num('posV',-400,400,0.5),'Position along the roller');
  html+=row('Rotate (°)',num('rotation',-180,180,5));
  html+=row('Grow / shrink (mm)',num('outlineMM',-5,5,0.05),'Fattens thin strokes so they survive embossing, or thins a heavy logo');
  html+='</div>';
  box.innerHTML=html;
  wrapSpinners(box);
}
function syncElementEditor(){
  const el=elements[selected];
  if(!el) return;
  const box=document.getElementById('elementEditor');
  const inputs=box.querySelectorAll('input[type="number"]');
  inputs.forEach(i=>{
    const m=/onElChange\('(\w+)'/.exec(i.getAttribute('onchange')||'');
    if(m && (m[1]==='posU'||m[1]==='posV')) i.value=el[m[1]];
  });
}
function onElChange(field,value){
  const el=elements[selected];
  if(!el) return;
  el[field]=value;
  markDirty();
  if(field==='content'||field==='invert') buildElementList();
  scheduleRender();
}

// ── Roller / body parameters ───────────────────────────────────
const PRESETS={
  card:   { label:'Business card — 85.6 × 54', wrapMM:85.6, widthMM:54,  repeatCount:1 },
  half:   { label:'Half card — two per turn',          wrapMM:42.8, widthMM:54,  repeatCount:2 },
  pattern:{ label:'Pattern roller — ⌀20, 6 repeats',   wrapMM:62.83, widthMM:20, repeatCount:6 },
  strip:  { label:'Name strip — ⌀25, 12 mm wide',      wrapMM:78.54, widthMM:12, repeatCount:1 },
};
function applyPreset(key){
  const p=PRESETS[key];
  if(!p||!currentModel) return;
  Object.assign(currentModel,{ wrapMM:p.wrapMM, widthMM:p.widthMM, repeatCount:p.repeatCount });
  markDirty(); buildParamsUI(); scheduleRender();
}
function onModelChange(field,value){
  if(!currentModel) return;
  currentModel[field]=value;
  markDirty();
  updateSizeLabel();
  scheduleRender();
}
function buildParamsUI(){
  const box=document.getElementById('paramsBox');
  if(!box||!currentModel) return;
  const m=currentModel;
  const num=(f,min,max,step,title='')=>`<input type="number" class="adv-input"${title?` title="${esc(title)}"`:''} min="${min}" max="${max}" step="${step}" value="${m[f]}" onchange="onModelChange('${f}',+this.value)">`;
  const row=(label,inner,title='')=>`<div class="adv-row"><label${title?` title="${esc(title)}"`:''}>${label}</label>${inner}</div>`;
  box.innerHTML=
     row('Preset',`<select class="adv-text-input" style="width:150px" onchange="applyPreset(this.value);this.value=''"><option value="">Choose…</option>`
       +Object.entries(PRESETS).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('')+'</select>')
    +row('Card length (mm)',num('wrapMM',10,400,0.1),'The way it feeds through. One card per turn, so this is the roller circumference: ⌀ = length ÷ π')
    +row('Card width (mm)',num('widthMM',5,250,1),'Across the feed. The roller is made this wide, so the flat view is the card')
    +row('Card thickness (mm)',num('paperMM',0.05,2,0.05),'How deep the recess goes and how far apart the rollers sit')
    +row('Repeats around',num('repeatCount',1,24,1),'Tile the design this many times around the roller — for pattern rollers')
    +`<div class="panel-hint" id="derivedHint"></div>`;
  wrapSpinners(box);
  updateSizeLabel();
}

// ── Model CRUD ─────────────────────────────────────────────────
function rowFromModel(m){
  const row={ name:m.name };
  for(const [js,db] of Object.entries(MODEL_FIELDS)) row[db]=m[js];
  row.updated_at=new Date().toISOString();
  return row;
}
function modelFromRow(r){
  const m={ id:r.id, name:r.name };
  for(const [js,db] of Object.entries(MODEL_FIELDS)) m[js]=typeof r[db]==='string'?+r[db]:r[db];
  return m;
}
function rowFromElement(el, modelId, order){
  const row={ model_id:modelId, el_order:order };
  for(const [js,db] of Object.entries(EL_FIELDS)) row[db]=el[js];
  if(row.font_id==='') row.font_id=null;
  return row;
}
function elementFromRow(r){
  const el={ _key:_keySeq++, id:r.id, order:r.el_order };
  for(const [js,db] of Object.entries(EL_FIELDS)) el[js]=typeof r[db]==='string'&&db!=='kind'&&db!=='name'&&db!=='content'?+r[db]:r[db];
  return el;
}

async function loadModels(){
  try{ models=await sbGet('embosser_models','?archived=eq.false&order=name'); }catch(e){ models=[]; }
  if(!Array.isArray(models)) models=[];
  refreshModelDropdown();
}
function refreshModelDropdown(){
  const sel=document.getElementById('modelSelect');
  if(!sel) return;
  sel.innerHTML=models.map(m=>`<option value="${m.id}"${currentModel&&String(currentModel.id)===String(m.id)?' selected':''}>${esc(m.name)}</option>`).join('')
    || '<option value="">No designs yet</option>';
}
async function onModelSelect(){
  const id=document.getElementById('modelSelect').value;
  if(!id) return;
  if(isDirty && !await askConfirm('Discard unsaved changes?','Discard')){ refreshModelDropdown(); return; }
  await openModel(+id);
}
async function openModel(id){
  setStatus('Loading…');
  const row=models.find(m=>String(m.id)===String(id));
  if(!row){ setStatus('Design not found','err'); return; }
  currentModel=modelFromRow(row);
  let rows=[];
  try{ rows=await sbGet('embosser_elements',`?model_id=eq.${id}&order=el_order`); }catch(e){ rows=[]; }
  elements=Array.isArray(rows)?rows.map(elementFromRow):[];
  for(const el of elements) if(el.kind==='image'&&el.content) await loadImage(el.content);
  deletedIds=[]; artCache.clear(); selected=elements.length?0:-1;
  clearDirty(); refreshModelDropdown(); buildParamsUI(); buildElementList(); buildElementEditor(); scheduleRender();
  setStatus('');
}
async function newModel(){
  if(isDirty && !await askConfirm('Discard unsaved changes?','Discard')) return;
  const name=await askText('Name this design','Embosser '+(models.length+1));
  if(!name) return;
  setStatus('Creating…');
  const res=await sbInsert('embosser_models', rowFromModel(defaultModel(name)));
  if(!Array.isArray(res)||!res[0]){ setStatus('Could not create: '+(res&&res.message||'unknown error'),'err'); return; }
  models.push(res[0]);
  currentModel=modelFromRow(res[0]);
  elements=[makeElement('text',{ sizeW:40, sizeH:12 })];
  deletedIds=[]; artCache.clear(); selected=0;
  clearDirty(); refreshModelDropdown(); buildParamsUI(); buildElementList(); buildElementEditor(); scheduleRender();
  await saveModel();
}
async function saveModel(){
  if(!currentModel?.id){ setStatus('Nothing to save','err'); return; }
  setStatus('Saving…');
  const err=await sbPatch('embosser_models',`?id=eq.${currentModel.id}`, rowFromModel(currentModel));
  if(err){ setStatus('Save failed: '+(err.message||'unknown error'),'err'); return; }
  for(const id of deletedIds) await sbDelete('embosser_elements',`?id=eq.${id}`);
  deletedIds=[];
  for(let i=0;i<elements.length;i++){
    const el=elements[i];
    const row=rowFromElement(el, currentModel.id, i);
    if(el.id){
      const e=await sbPatch('embosser_elements',`?id=eq.${el.id}`,row);
      if(e){ setStatus('Save failed: '+(e.message||'unknown error'),'err'); return; }
    }else{
      const res=await sbInsert('embosser_elements',row);
      if(!Array.isArray(res)||!res[0]){ setStatus('Save failed: '+(res&&res.message||'unknown error'),'err'); return; }
      el.id=res[0].id;
    }
  }
  const idx=models.findIndex(m=>String(m.id)===String(currentModel.id));
  if(idx>=0) models[idx]={...models[idx], ...rowFromModel(currentModel)};
  clearDirty(); refreshModelDropdown();
  setStatus('Saved','ok');
}
async function renameModel(){
  if(!currentModel) return;
  const n=await askText('Rename design', currentModel.name);
  if(!n) return;
  currentModel.name=n; markDirty(); refreshModelDropdown();
}
async function duplicateModel(){
  if(!currentModel) return;
  const name=await askText('Name the copy', currentModel.name+' copy');
  if(!name) return;
  setStatus('Duplicating…');
  const res=await sbInsert('embosser_models', rowFromModel({...currentModel, name}));
  if(!Array.isArray(res)||!res[0]){ setStatus('Could not duplicate','err'); return; }
  models.push(res[0]);
  currentModel={...currentModel, id:res[0].id, name};
  for(const el of elements) el.id=null;
  refreshModelDropdown(); markDirty();
  await saveModel();
}
async function deleteModel(){
  if(!currentModel?.id) return;
  if(!await askConfirm(`Delete "${currentModel.name}"?`)) return;
  // Soft delete, same as everywhere else in PrintDesk.
  const err=await sbPatch('embosser_models',`?id=eq.${currentModel.id}`,{archived:true});
  if(err){ setStatus('Delete failed','err'); return; }
  models=models.filter(m=>String(m.id)!==String(currentModel.id));
  currentModel=null; elements=[]; selected=-1; clearDirty(); clearPreview();
  refreshModelDropdown();
  if(models.length) await openModel(models[0].id);
  else { document.getElementById('elementList').innerHTML='<div class="status">Create a design to start.</div>'; setStatus(''); }
}

// ── Export ─────────────────────────────────────────────────────
function exportModel(){
  if(!currentModel){ setStatus('Nothing to export','err'); return; }
  setStatus('Building 3MF…');
  try{
    const p=eParams(currentModel);
    const parts=eBuildAssembly(allPaths(), p);
    let claimed=false;
    const objects=parts.map((part,i)=>{
      const normal=!part.negative;
      const claims=normal&&!claimed;
      if(claims) claimed=true;
      return {
        geo: part.geo, name: part.name, colour:'#c8c8c8',
        extruder:1, negative:!!part.negative,
        skipFilamentSlot:!claims, id:i+1,
      };
    });
    const name=(currentModel.name||'embosser').replace(/[^\w\-. ]+/g,'_');
    const zip=_badgeBuildZip(_badgeBuild3MF(objects, name, null));
    const blob=new Blob([zip],{type:'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=name+'.3mf'; a.click(); URL.revokeObjectURL(url);
    setStatus(`Exported ${name}.3mf — arrange all before slicing`,'ok');
  }catch(e){
    console.error(e);
    setStatus('Export failed: '+e.message,'err');
  }
}

// ── Header menus ───────────────────────────────────────────────
let modelMenuOpen=false, userMenuOpen=false;
function toggleModelMenu(){ modelMenuOpen=!modelMenuOpen; document.getElementById('modelMenu').style.display=modelMenuOpen?'flex':'none'; }
function closeModelMenu(){ modelMenuOpen=false; document.getElementById('modelMenu').style.display='none'; }
function toggleUserMenu(){ userMenuOpen=!userMenuOpen; document.getElementById('userMenu').style.display=userMenuOpen?'flex':'none'; }
document.addEventListener('click',()=>{ closeModelMenu(); if(userMenuOpen) toggleUserMenu(); if(addMenuOpen) closeAddMenu(); if(openElMenu>=0) closeElMenu(); });

// ── Boot ───────────────────────────────────────────────────────
async function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='flex';
  document.getElementById('userChip').textContent=currentUser?.user_metadata?.display_name||currentUser?.email||'';
  setStatus('Loading…');
  syncGridBtn();
  syncSlidersFromView();
  try{ await loadBuiltinFont(); }catch(e){ setStatus('Could not load built-in font','err'); }
  await loadFonts();
  await loadModels();
  if(models.length) await openModel(models[0].id);
  else{
    document.getElementById('elementList').innerHTML='<div class="status">No designs yet — hit + in the header to make one.</div>';
    setStatus('');
  }
}

(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
