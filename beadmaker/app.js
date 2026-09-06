// BeadMak3r — letter-bead bracelet generator.
// Same shell/behaviour as BadgeMak3r; reuses ../shared/3mf.js for all the
// clipper/3MF plumbing and the same Supabase `colours` + `badgemaker_fonts`
// tables (read-only), so uploaded fonts and filament colours are shared.
//
// ponytail: bracelets live in localStorage, not Supabase — no new tables, no
// migration. Move to a beadmaker_models table when they need to be shared
// between machines or referenced from an order.

// ── Small helpers (same shapes as badgemaker/data.js) ──────────
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escJsAttr(s){ return esc(String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }
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

// ── Supabase (read-only: colours + fonts) ──────────────────────
// ponytail: copied from badgemaker/data.js rather than extracted into a
// shared module — extracting would mean editing the live BadgeMak3r. Pull
// both onto a shared/sb.js the next time either one changes.
const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';
let sbToken=null, sbRefreshToken=null, currentUser=null;

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(sbToken||SB_KEY),'Content-Type':'application/json'}; }

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
  // Same keys as BadgeMak3r — one sign-in covers both tools.
  localStorage.setItem('badgemaker_token', sbToken);
  if(sbRefreshToken) localStorage.setItem('badgemaker_refresh', sbRefreshToken);
}
async function sbFetch(path, opts={}){
  const send=()=>fetch(`${SB_URL}/rest/v1/${path}`,{...opts, headers:sbHeaders()});
  let r=await send();
  if(r.status===401 && await refreshSession()) r=await send();
  return r;
}
async function sbGet(table,q=''){ const r=await sbFetch(`${table}${q}`); return r.json(); }

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

// ── Fonts ──────────────────────────────────────────────────────
const fontCache=new Map();   // 'builtin' | String(id) -> opentype Font
let fonts=[], colours=[];
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
  const sel=document.getElementById('designFont');
  sel.innerHTML='<option value="">LEGO (built-in)</option>'+fonts.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');
  sel.value=design.fontId||'';
}
async function loadColours(){
  try{ colours=await sbGet('colours','?available=eq.true&order=id'); }catch(e){ colours=[]; }
  if(!Array.isArray(colours)) colours=[];
}
function colourName(hex){ const c=colours.find(c=>c.code?.toLowerCase()===(hex||'').toLowerCase()); return c?c.name:(hex||'—'); }

// ── Number field +/- spinners (ported from BadgeMak3r) ─────────
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

const LS_BG='beadmaker_bgColour', LS_GRID='beadmaker_gridVisible';
const savedBg=parseInt(localStorage.getItem(LS_BG) ?? '0x18181b');
const scene=new THREE.Scene();
scene.background=new THREE.Color(isNaN(savedBg)?0x18181b:savedBg);
const camera=new THREE.PerspectiveCamera(45,1,0.1,2000);
scene.add(new THREE.AmbientLight(0xffffff,0.5));
const dl=new THREE.DirectionalLight(0xffffff,0.9); dl.position.set(50,-50,100); scene.add(dl);
const fl=new THREE.DirectionalLight(0xffffff,0.3); fl.position.set(-50,50,50); scene.add(fl);

const grid=new THREE.GridHelper(300,30,0x333337,0x222225);
grid.visible=localStorage.getItem(LS_GRID)!=='0';
const braceletGroup=new THREE.Group();
scene.add(braceletGroup);
braceletGroup.add(grid);

function resize(){
  if(!renderer) return;
  const w=pane.clientWidth,h=pane.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

let rotX=0, rotY=0, zoom=1;
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
  zoom*= e.deltaY>0 ? 1.01 : 1/1.01;
  zoom=Math.max(0.3,Math.min(4,zoom));
  syncSlidersFromView(); e.preventDefault();
},{passive:false});
let ltX=0,ltY=0;
canvas.addEventListener('touchstart',e=>{ ltX=e.touches[0].clientX; ltY=e.touches[0].clientY; });
canvas.addEventListener('touchmove',e=>{
  rotY+=(e.touches[0].clientX-ltX)*0.01;
  rotX+=(e.touches[0].clientY-ltY)*0.01;
  ltX=e.touches[0].clientX; ltY=e.touches[0].clientY; e.preventDefault();
},{passive:false});

// Frame the whole strip: distance follows the bracelet's own length.
let fitDistance=120;
function animate(){
  requestAnimationFrame(animate);
  if(!renderer) return;
  braceletGroup.rotation.x=rotX;
  braceletGroup.rotation.y=rotY;
  camera.position.set(0,-fitDistance*0.5*zoom,fitDistance*zoom);
  camera.lookAt(0,0,0);
  renderer.render(scene,camera);
}
animate();

function toggleGrid(){ grid.visible=!grid.visible; localStorage.setItem(LS_GRID,grid.visible?'1':'0'); syncGridBtn(); }
function syncGridBtn(){ const b=document.getElementById('toggleGridBtn'); if(b) b.classList.toggle('primary',grid.visible); }
function setBg(colour,el){
  scene.background=new THREE.Color(colour);
  localStorage.setItem(LS_BG,String(colour));
  if(el) syncBgSwatches(el);
}
function syncBgSwatches(active){
  active.parentElement.querySelectorAll('div').forEach(d=>{ d.style.border='1px solid var(--border2)'; });
  active.style.border='2px solid var(--accent)';
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
  const step=parseFloat(document.getElementById(sId).step||'0.01');
  const dec=step.toString().includes('.')?step.toString().split('.')[1].length:2;
  document.getElementById(nId).value=v.toFixed(dec);
}
function syncSlider(sId,nId){ const v=parseFloat(document.getElementById(nId).value); if(!isNaN(v)) document.getElementById(sId).value=v; }
function syncSlidersFromView(){
  const set=(s,n,v,d)=>{ document.getElementById(s).value=v; document.getElementById(n).value=v.toFixed(d); };
  set('camRotX','camRotXN',rotX,2); set('camRotY','camRotYN',rotY,2); set('camZoom','camZoomN',zoom,2);
}

// ── Glyph geometry (same pipeline as BadgeMak3r's text layers) ──
const TAU=Math.PI*2;

function pointInPolygon(pt,path){
  let inside=false;
  for(let i=0,j=path.length-1;i<path.length;j=i++){
    const xi=path[i].X,yi=path[i].Y,xj=path[j].X,yj=path[j].Y;
    if(((yi>pt.Y)!==(yj>pt.Y)) && (pt.X<(xj-xi)*(pt.Y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function cmdsToCenteredShapes(cmds,fillGaps){
  const unioned=_badgeClipperUnion(_badgeCommandsToClipper(cmds));
  if(!unioned.length) return null;
  const {offX,offY,width,height}=_badgeBboxCentre(unioned);
  let shapes;
  if(fillGaps){
    const outers=unioned.filter(p=>ClipperLib.Clipper.Orientation(p));
    const toVec2=p=>new THREE.Vector2(p.X/_BADGE_SCALE-offX, offY-p.Y/_BADGE_SCALE);
    shapes=outers.map(o=>new THREE.Shape(o.map(toVec2)));
  }else{
    const sp=new THREE.ShapePath();
    for(const c of cmds){
      if(c.type==='M') sp.moveTo(c.x-offX, offY-c.y);
      else if(c.type==='L') sp.lineTo(c.x-offX, offY-c.y);
      else if(c.type==='C') sp.bezierCurveTo(c.x1-offX,offY-c.y1,c.x2-offX,offY-c.y2,c.x-offX,offY-c.y);
      else if(c.type==='Q') sp.quadraticCurveTo(c.x1-offX,offY-c.y1,c.x-offX,offY-c.y);
      else if(c.type==='Z') sp.currentPath.closePath();
    }
    shapes=sp.toShapes(false);
  }
  return {shapes,unioned,offX,offY,width,height};
}
function offsetPolysToShapes(unioned,borderMM,offX,offY,fillGaps){
  const expanded=_badgeClipperOffset(unioned,borderMM);
  const outers=expanded.filter(p=>ClipperLib.Clipper.Orientation(p));
  const holes=fillGaps?[]:expanded.filter(p=>!ClipperLib.Clipper.Orientation(p));
  const toVec2=p=>new THREE.Vector2(p.X/_BADGE_SCALE-offX, offY-p.Y/_BADGE_SCALE);
  return outers.map(outer=>{
    const shape=new THREE.Shape(outer.map(toVec2));
    for(const h of holes) if(h.length && pointInPolygon(h[0],outer)) shape.holes.push(new THREE.Path(h.map(toVec2)));
    return shape;
  });
}
// Glyph shapes, centred on their own ink, lying flat in XY (reads from +Z).
function glyphShapes(ch,font,size,border,fillGaps){
  if(!font||!ch) return null;
  const cmds=_badgeGetTextCommands(font,ch,size,0,0);
  if(!cmds.length) return null;
  const c=cmdsToCenteredShapes(cmds,fillGaps);
  if(!c) return null;
  if(!border) return {shapes:c.shapes,width:c.width,height:c.height};
  const shapes=offsetPolysToShapes(c.unioned,border,c.offX,c.offY,fillGaps);
  return shapes.length ? {shapes,width:c.width+border*2,height:c.height+border*2} : null;
}

function shapeToClipperPaths(shape){
  const xf=v=>({X:Math.round(v.x*_BADGE_SCALE), Y:Math.round(-v.y*_BADGE_SCALE)});
  const wound=(pts,wantOuter)=>{ const p=pts.map(xf); return ClipperLib.Clipper.Orientation(p)===wantOuter?p:p.reverse(); };
  const paths=[wound(shape.getPoints(24),true)];
  for(const h of shape.holes) paths.push(wound(h.getPoints(24),false));
  return paths;
}
function clipperDifference(subject,clip){
  const c=new ClipperLib.Clipper();
  c.AddPaths(subject,ClipperLib.PolyType.ptSubject,true);
  c.AddPaths(clip,ClipperLib.PolyType.ptClip,true);
  const out=new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctDifference,out,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
  return out;
}
function clipperPathsToShapes(paths){
  const outers=paths.filter(p=>ClipperLib.Clipper.Orientation(p));
  const holes=paths.filter(p=>!ClipperLib.Clipper.Orientation(p));
  const toVec2=p=>new THREE.Vector2(p.X/_BADGE_SCALE, -p.Y/_BADGE_SCALE);
  return outers.map(outer=>{
    const shape=new THREE.Shape(outer.map(toVec2));
    for(const h of holes) if(h.length && pointInPolygon(h[0],outer)) shape.holes.push(new THREE.Path(h.map(toVec2)));
    return shape;
  });
}

// ── Bead geometry ──────────────────────────────────────────────
// The cord runs along +X. A square bead is its cross-section
// extruded along the cord with a round hole down the middle; round and
// outline beads are flat tiles lying face-up. Letters always sit on the
// +Z face, so everything prints letter-up with no supports.
function addHole(shape,d){
  if(!(d>0)) return;
  const h=new THREE.Path();
  h.absarc(0,0,d/2,0,TAU,true);
  shape.holes.push(h);
}
function squareProfile(size,holeD,radius){
  const hw=size/2, s=new THREE.Shape();
  const r=Math.max(0,Math.min(radius||0,hw));
  if(r>0){
    s.moveTo(-hw+r,-hw); s.lineTo(hw-r,-hw); s.absarc(hw-r,-hw+r,r,-Math.PI/2,0,false);
    s.lineTo(hw,hw-r);   s.absarc(hw-r,hw-r,r,0,Math.PI/2,false);
    s.lineTo(-hw+r,hw);  s.absarc(-hw+r,hw-r,r,Math.PI/2,Math.PI,false);
    s.lineTo(-hw,-hw+r); s.absarc(-hw+r,-hw+r,r,Math.PI,Math.PI*1.5,false);
    s.closePath();
  }else{
    s.moveTo(-hw,-hw); s.lineTo(hw,-hw); s.lineTo(hw,hw); s.lineTo(-hw,hw); s.closePath();
  }
  addHole(s,holeD);
  return s;
}
// How far a square bead can round off before it eats itself. The end-face
// bevel flares the cord hole outward by r as well, so it also has to stay
// clear of the hole.
function edgeRadius(b){
  const limits=[b.radius||0, b.size/2-0.05];
  if(b.hole>0) limits.push((b.size-b.hole)/4);
  return Math.max(0, Math.min(...limits));
}
// Explicit polygon rather than absarc: flat beads get their middle Z band
// re-derived through Clipper, and a curve would be resampled at a different
// resolution there, leaving a visible step against the plain slabs.
function discProfile(size,n=64){
  const s=new THREE.Shape(), r=size/2;
  for(let i=0;i<n;i++){
    const a=i/n*TAU, x=r*Math.cos(a), y=r*Math.sin(a);
    if(i) s.lineTo(x,y); else s.moveTo(x,y);
  }
  s.closePath();
  return s;
}

// A flat bead lies face-up, so its cord hole can't be part of the profile —
// cut it as a slot through the middle Z band instead (2D boolean per band,
// the same trick BadgeMak3r uses for shallow cutters).
// The bore is round, matching the square bead's: it's stepped into BORE_BANDS
// layers whose width follows the circle, since a 2D boolean per band is all
// this construction can do. The slicer quantises a horizontal hole into
// layers anyway, so the steps cost nothing in the print.
const BORE_BANDS=8;
function flatBeadSlabs(shapes,thickness,holeD){
  if(!(holeD>0) || holeD>=thickness) return [{z:0,depth:thickness,shapes}];
  const r=holeD/2, wall=(thickness-holeD)/2, step=holeD/BORE_BANDS;
  const subject=shapes.flatMap(shapeToClipperPaths);
  const far=1e8;
  const slabs=[{z:0,depth:wall,shapes}];
  for(let i=0;i<BORE_BANDS;i++){
    const zMid=-r+(i+0.5)*step;                             // height within the bore
    const hw=Math.sqrt(Math.max(0,r*r-zMid*zMid));          // half-width of the bore there
    let banded=shapes;
    if(hw>0.01){
      const y=Math.round(hw*_BADGE_SCALE);
      const cut=clipperDifference(subject,[[{X:-far,Y:-y},{X:far,Y:-y},{X:far,Y:y},{X:-far,Y:y}]]);
      banded=cut.length?clipperPathsToShapes(cut):[];
    }
    if(banded.length) slabs.push({z:wall+i*step,depth:step,shapes:banded});
  }
  slabs.push({z:wall+holeD,depth:wall,shapes});
  return slabs;
}

// Where the letter sits relative to the bead surface at `topZ`:
//   raise > 0  raised, its own colour, sunk 0.2mm so it fuses to the bead
//   raise = 0  flush inlay — a thin slab whose top face is the surface
//   raise < 0  indented — the same slab becomes a 3MF negative part, so the
//              slicer carves the recess.
// ponytail: the indent is a negative part, not a hole cut into the body —
// three.js has no CSG and the square bead extrudes along the cord, so its
// top face can't be pocketed by the 2D booleans everything else here uses.
// The preview draws the recess in a darkened bead colour, which reads as an
// engraving; make it a real cut only if the preview has to be exact.
const INLAY_T=0.6;
function letterSlab(topZ,raise,thickness,beadHex,letterHex){
  const r=Math.max(raise, -(thickness/2 - 0.4));   // can't cut deeper than the bead
  if(r>0)   return {z0:topZ-0.2, z1:topZ+r, hex:letterHex};
  if(r===0) return {z0:topZ-INLAY_T, z1:topZ, hex:letterHex, offset:true};
  return {z0:topZ+r, z1:topZ+0.1, hex:darken(beadHex), offset:true, negative:true};
}
function darken(hex){
  const n=parseInt((hex||'#888888').replace('#',''),16);
  const c=v=>Math.round(v*0.5).toString(16).padStart(2,'0');
  return '#'+c((n>>16)&255)+c((n>>8)&255)+c(n&255);
}
function letterPart(shapes,slab){
  const geo=new THREE.ExtrudeGeometry(shapes,{depth:slab.z1-slab.z0,bevelEnabled:false});
  geo.translate(0,0,slab.z0);
  return {geo,hex:slab.hex,offset:slab.offset,negative:slab.negative};
}

// Builds one bead centred on the origin. Returns its parts (each already a
// finished geometry) and how much cord length it takes up.
function buildBead(b){
  const parts=[], font=getFont(b.fontId ?? design.fontId);
  const roll=(b.rotation||0)*Math.PI/180;
  const ch=(b.char||'').trim().toUpperCase();
  const place=geo=>{ geo.rotateX(roll); return geo; };

  // Round and outline beads are flat tiles lying face-up — a disc shows its
  // circle to the wearer, an outline bead is the glyph grown outward into a
  // backing plate. Both take the cord as a slot through their middle band,
  // and both carry the letter raised on the face.
  if(b.shape!=='square'){
    const body = b.shape==='round'
      ? {shapes:[discProfile(b.size)], width:b.size}
      : glyphShapes(ch,font,b.size,b.border||0,b.fillGaps!==false);
    if(!body) return {parts,advance:b.size};
    for(const slab of flatBeadSlabs(body.shapes,b.size,b.hole)){
      const geo=new THREE.ExtrudeGeometry(slab.shapes,{depth:slab.depth,bevelEnabled:false});
      geo.translate(0,0,slab.z-b.size/2);
      parts.push({geo:place(geo),hex:b.hex});
    }
    // An outline bead's letter has to be the same glyph at the same size as
    // the plate it sits on, or it won't line up inside its own outline.
    const lg = ch ? glyphShapes(ch,font, b.shape==='round'?b.letterSize:b.size, 0, b.fillGaps!==false) : null;
    if(lg){
      const p=letterPart(lg.shapes, letterSlab(b.size/2,b.raise,b.size,b.hex,b.letterHex));
      place(p.geo); parts.push(p);
    }
    return {parts,advance:body.width};
  }

  // A square bead rounds in both directions: `r` rounds the four edges
  // running along the cord (in the profile) and, as an extrude bevel, the
  // two end faces as well — a rounded cube, not a rounded rectangle on a
  // stick. The bevel eats `r` off each end, so the extrusion is that much
  // shorter and re-centred.
  const r = edgeRadius(b);
  const prof = squareProfile(b.size,b.hole,r);
  const body = r > 0
    // bevelOffset:-r matters — at the default 0 the bevel bulges the middle
    // outward by r instead of rounding the ends inward, so an 8mm bead came
    // out 10.75mm wide.
    ? new THREE.ExtrudeGeometry(prof,{depth:b.size-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelOffset:-r,bevelSegments:6})
    : new THREE.ExtrudeGeometry(prof,{depth:b.size,bevelEnabled:false});
  body.translate(0,0, r>0 ? r-b.size/2 : -b.size/2);
  body.rotateY(Math.PI/2);                 // extrusion axis -> the cord (+X)
  parts.push({geo:place(body),hex:b.hex});

  const g=ch ? glyphShapes(ch,font,b.letterSize,0,b.fillGaps!==false) : null;
  if(g){
    const p=letterPart(g.shapes, letterSlab(b.size/2,b.raise,b.size,b.hex,b.letterHex));
    place(p.geo); parts.push(p);
  }
  return {parts,advance:b.size};
}

// Lays every bead out along the cord, centred on the origin.
function buildBracelet(){
  const built=design.beads.map(buildBead);
  const gaps=design.beads.map((b,i)=> i<design.beads.length-1 ? (b.gap ?? design.gap) : 0);
  const total=built.reduce((s,x,i)=>s+x.advance+gaps[i],0);
  let x=-total/2;
  built.forEach((bt,i)=>{
    const cx=x+bt.advance/2;
    bt.parts.forEach(p=>p.geo.translate(cx,0,0));
    x+=bt.advance+gaps[i];
  });
  return {parts:built.flatMap(b=>b.parts), length:total};
}

let renderTimer=null;
function scheduleRender(){ clearTimeout(renderTimer); renderTimer=setTimeout(render3D,120); }

function render3D(){
  braceletGroup.children.filter(c=>c!==grid).forEach(c=>braceletGroup.remove(c));
  const {parts,length}=buildBracelet();
  const box=new THREE.Box3();
  for(const p of parts){
    // Flush and indented letters share their top face with the bead surface,
    // so they need to win the depth test against it.
    const mat=new THREE.MeshPhongMaterial({
      color:parseInt((p.hex||'#888888').replace('#',''),16), shininess:40,
      polygonOffset:!!p.offset, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
    });
    const mesh=new THREE.Mesh(p.geo,mat);
    braceletGroup.add(mesh);
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox);
  }
  fitDistance=Math.max(60,(length||40)*1.6);
  const label=document.getElementById('braceletSizeLabel');
  if(label){
    const s=box.isEmpty()?null:box.getSize(new THREE.Vector3());
    label.textContent=s ? `${design.beads.length} beads · L ${s.x.toFixed(1)} × W ${s.y.toFixed(1)} × H ${s.z.toFixed(1)} mm` : '';
  }
  buildBeadStripUI();   // every settings change schedules a render, so hang the strip off it
}

// ── 3MF export ─────────────────────────────────────────────────
let projectSettingsTemplate=null;
fetch('../badge/project_settings_template.json').then(r=>r.json()).then(t=>{projectSettingsTemplate=t;}).catch(()=>{});

function exportBracelet(){
  const {parts}=buildBracelet();
  if(!parts.length){ setStatus('Nothing to export — type some text first','err'); return; }
  // One extruder slot per distinct colour, not per part — a 20-bead bracelet
  // is still a 2- or 3-filament print. Negative parts (indented letters) are
  // voids, so they claim no slot.
  const slots=[...new Set(parts.filter(p=>!p.negative).map(p=>p.hex||'#888888'))];
  // _badgeBuild3MF fills filament_colour from one object per slot, so every
  // part after the first of a given colour has to opt out — otherwise the
  // palette gets one entry per part and extruder 2 lands on the wrong
  // filament (letters printing in the bead's colour).
  const claimed=new Set();
  const objects=parts.map((p,i)=>{
    const hex=p.hex||'#888888';
    const claimsSlot=!p.negative && !claimed.has(hex);
    if(claimsSlot) claimed.add(hex);
    return {
      geo:_badgeMergeVerticesForExport(p.geo),
      name:`part${i+1}`,
      colour:hex,
      extruder:p.negative ? 1 : slots.indexOf(hex)+1,
      negative:!!p.negative,
      skipFilamentSlot:!claimsSlot,
      id:i+1,
    };
  });
  const name=(design.name||'bracelet').replace(/[^a-z0-9_\- ]/gi,'').trim()||'bracelet';
  const zip=_badgeBuildZip(_badgeBuild3MF(objects,name,projectSettingsTemplate));
  const b=new Blob([zip],{type:'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'});
  const u=URL.createObjectURL(b), a=document.createElement('a');
  a.href=u; a.download=name+'.3mf'; a.click(); URL.revokeObjectURL(u);
  setStatus(`Exported ${name}.3mf`,'ok');
}

// ── State ──────────────────────────────────────────────────────
const LS_DESIGNS='beadmaker_designs', LS_LAST='beadmaker_lastId';
let design=newDesignObject('Bracelet');
let selectedBead=-1, _keySeq=1;

// Bracelets start white bead, black letter. Matched against the filament
// list by name so the bead carries a real colour id, with plain hex as the
// fallback for when colours haven't loaded (or don't include those two).
// (Literals, not consts — the boot design is built a few lines below, before
// a const declared here would be out of its temporal dead zone.)
function applyDefaultPalette(d){
  const pick=(re,fallback)=>colours.find(c=>re.test(c.name||'')) || {code:fallback,id:null};
  const bead=pick(/white/i,'#ffffff'), letter=pick(/black/i,'#000000');
  d.hex=bead.code; d.colourId=bead.id;
  d.letterHex=letter.code; d.letterColourId=letter.id;
  return d;
}

function newDesignObject(name){
  return applyDefaultPalette({
    id:String(Date.now()), name, fontId:'',
    shape:'square', size:8, hole:2.5, gap:0.5,
    letterSize:5, raise:0.8, radius:1, border:1.5,
    beads:[],
  });
}
function makeBead(char){
  return {
    _key:_keySeq++, char:char||'',
    shape:design.shape, size:design.size, hole:design.hole,
    gap:design.gap, radius:design.radius, border:design.border,
    letterSize:design.letterSize, raise:design.raise, fillGaps:false,
    hex:design.hex, colourId:design.colourId,
    letterHex:design.letterHex, letterColourId:design.letterColourId,
    rotation:0,
  };
}

function loadDesigns(){ try{ return JSON.parse(localStorage.getItem(LS_DESIGNS)||'{}'); }catch(e){ return {}; } }
function storeDesigns(all){ localStorage.setItem(LS_DESIGNS,JSON.stringify(all)); }

function refreshDesignDropdown(){
  const all=loadDesigns();
  const sel=document.getElementById('modelSelect');
  const entries=Object.values(all).sort((a,b)=>a.name.localeCompare(b.name));
  sel.innerHTML=entries.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')
    || `<option value="${esc(design.id)}">${esc(design.name)}</option>`;
  sel.value=design.id;
}
function saveDesign(){
  const all=loadDesigns();
  all[design.id]=design;
  storeDesigns(all);
  localStorage.setItem(LS_LAST,design.id);
  refreshDesignDropdown();
  setStatus('Saved','ok');
  setTimeout(()=>setStatus(''),1500);
}
function openDesign(d){
  design=d;
  design.beads.forEach(b=>{
    b._key=_keySeq++;
    if(b.shape==='text') b.shape='outline';   // renamed; saved bracelets predate it
  });
  selectedBead=design.beads.length?0:-1;
  localStorage.setItem(LS_LAST,design.id);
  document.getElementById('designFont').value=design.fontId||'';
  refreshAll();
}
function onDesignSelect(){
  const all=loadDesigns();
  const d=all[document.getElementById('modelSelect').value];
  if(d) openDesign(d);
}
async function newDesign(){
  const name=await askText('Bracelet name:','Bracelet');
  if(!name) return;
  design=newDesignObject(name);
  selectedBead=-1;
  saveDesign();
  refreshAll();
}
async function renameDesign(){
  const name=await askText('Bracelet name:',design.name);
  if(!name) return;
  design.name=name; saveDesign();
}
function duplicateDesign(){
  design={...JSON.parse(JSON.stringify(design)), id:String(Date.now()), name:design.name+' copy'};
  saveDesign(); refreshAll();
}
async function deleteDesign(){
  if(!await askConfirm(`Delete "${design.name}"?`)) return;
  const all=loadDesigns();
  delete all[design.id];
  storeDesigns(all);
  const rest=Object.values(all);
  if(rest.length) openDesign(rest[0]);
  else { design=newDesignObject('Bracelet'); selectedBead=-1; refreshAll(); }
  refreshDesignDropdown();
}

// ── Text <-> beads ─────────────────────────────────────────────
// The bead list is the source of truth; the text box is a two-way view of it,
// so manually added beads survive further typing (they show as their char,
// a bead with no letter shows as a space).
function beadsToText(){ return design.beads.map(b=>b.char||' ').join(''); }
function syncTextBox(){ document.getElementById('braceletText').value=beadsToText(); }

function onTextInput(v){
  const chars=[...v];
  design.beads=chars.map((ch,i)=>{
    const old=design.beads[i];
    const char = ch===' ' ? '' : ch;
    return old ? {...old,char} : makeBead(char);
  });
  if(selectedBead>=design.beads.length) selectedBead=design.beads.length-1;
  buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
}
function onDesignFieldChange(field,value){
  design[field]=value;
  scheduleRender();
}

// ── Defaults ───────────────────────────────────────────────────
const DEFAULT_FIELDS=['shape','size','hole','gap','letterSize','raise'];
function onDefaultChange(field,value){ design[field]=value; }
function applyDefaultsToAll(){
  for(const b of design.beads){
    for(const f of DEFAULT_FIELDS) b[f]=design[f];
    b.radius=design.radius; b.border=design.border;
    b.hex=design.hex; b.colourId=design.colourId;
    b.letterHex=design.letterHex; b.letterColourId=design.letterColourId;
  }
  buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
  setStatus('Defaults applied to all beads','ok');
  setTimeout(()=>setStatus(''),1500);
}
function buildDefaultsUI(){
  document.getElementById('defShape').value=design.shape;
  document.getElementById('defSize').value=design.size;
  document.getElementById('defHole').value=design.hole;
  document.getElementById('defGap').value=design.gap;
  document.getElementById('defLetterSize').value=design.letterSize;
  document.getElementById('defRaise').value=design.raise;
  document.getElementById('defBeadColourSwatch').style.background=design.hex;
  document.getElementById('defBeadColourLabel').textContent=colourName(design.hex);
  document.getElementById('defLetterColourSwatch').style.background=design.letterHex;
  document.getElementById('defLetterColourLabel').textContent=colourName(design.letterHex);
}

// ── Bead list ──────────────────────────────────────────────────
const SHAPE_ICON={square:'ti-square',round:'ti-circle',outline:'ti-letter-case'};
function beadLabel(b,i){ return b.char ? b.char.toUpperCase() : `Bead ${i+1} (plain)`; }

let openBeadMenu=null;
function toggleBeadMenu(i){ openBeadMenu = openBeadMenu===i ? null : i; buildBeadListUI(); }
function closeBeadMenu(){ openBeadMenu=null; buildBeadListUI(); }
document.addEventListener('click',e=>{
  if(openBeadMenu!==null && !e.target.closest('.layer-row-menu-wrap')) closeBeadMenu();
  if(modelMenuOpen && !e.target.closest('.model-menu-wrap')) closeModelMenu();
  if(userMenuOpen && !e.target.closest('.user-menu-wrap')) closeUserMenu();
  if(openPicker && !e.target.closest('.colour-picker-wrap')) closeColourPickers();
});

let dragSrc=null;
function onBeadDragStart(e,i){
  dragSrc=i;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',String(i));
  const img=new Image();
  img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  e.dataTransfer.setDragImage(img,0,0);
}
function onBeadDragOver(e,i){
  e.preventDefault(); e.dataTransfer.dropEffect='move';
  if(dragSrc===null||dragSrc===i) return;
  const [moved]=design.beads.splice(dragSrc,1);
  design.beads.splice(i,0,moved);
  if(selectedBead===dragSrc) selectedBead=i;
  else if(dragSrc<selectedBead && i>=selectedBead) selectedBead--;
  else if(dragSrc>selectedBead && i<=selectedBead) selectedBead++;
  dragSrc=i;
  buildBeadListUI(); buildBeadStripUI();
}
function onBeadDragEnd(){
  if(dragSrc===null) return;
  dragSrc=null;
  syncTextBox(); buildBeadEditorUI(); scheduleRender();
}

function buildBeadListUI(){
  const el=document.getElementById('beadList');
  el.innerHTML=design.beads.map((b,i)=>`
    <div class="layer-row${i===selectedBead?' selected':''}" onclick="selectBead(${i})" draggable="true"
      ondragstart="onBeadDragStart(event,${i})" ondragover="onBeadDragOver(event,${i})"
      ondrop="event.preventDefault()" ondragend="onBeadDragEnd()">
      <i class="ti ${SHAPE_ICON[b.shape]||'ti-square'}" style="font-size:14px;color:var(--muted);flex-shrink:0"></i>
      <div class="lr-swatch" style="background:${esc(b.hex)}"></div>
      <span class="lr-label">${esc(beadLabel(b,i))}</span>
      <div class="layer-row-menu-wrap">
        <button class="lr-btn" title="Bead options" onclick="event.stopPropagation();toggleBeadMenu(${i})"><i class="ti ti-dots-vertical"></i></button>
        <div class="layer-row-menu" style="display:${openBeadMenu===i?'flex':'none'}" onclick="event.stopPropagation()">
          <div class="lrm-item" onclick="duplicateBead(${i});closeBeadMenu()"><i class="ti ti-copy"></i> Duplicate</div>
          <div class="lrm-item danger" onclick="removeBead(${i});closeBeadMenu()"><i class="ti ti-trash"></i> Delete</div>
        </div>
      </div>
    </div>`).join('') || '<div class="status">Type some text to make beads.</div>';
}
function selectBead(i){ selectedBead=i; buildBeadListUI(); buildBeadStripUI(); buildBeadEditorUI(); }

// ── Bead strip: flat top-down view of the bracelet over the 3D scene ──
// Same faces the 3D view shows from above, drawn as SVG straight from the
// bead shapes, so it stays true to shape, size, colour and letter without a
// second source of truth. Chips share the list's click and drag handlers —
// selecting or reordering from either one is the same action.
const CHIP=54, CHIP_PAD=7;

function shapesToPathData(shapes,scale,cx,cy){
  let d='';
  const add=pts=>{
    pts.forEach((p,i)=>{ d+=(i?'L':'M')+(cx+p.x*scale).toFixed(2)+' '+(cy-p.y*scale).toFixed(2)+' '; });
    d+='Z ';
  };
  for(const s of shapes){ add(s.getPoints(24)); for(const h of s.holes) add(h.getPoints(24)); }
  return d;
}

// The bead as seen from +Z — the same face the letter reads from. The cord
// hole runs along the strip, so it never shows in this view.
function beadFaceShapes(b){
  const font=getFont(b.fontId ?? design.fontId);
  const ch=(b.char||'').trim().toUpperCase();
  let body;
  if(b.shape==='round')        body={shapes:[discProfile(b.size)],width:b.size,height:b.size};
  else if(b.shape==='outline') body=glyphShapes(ch,font,b.size,b.border||0,b.fillGaps!==false);
  else                         body={shapes:[squareProfile(b.size,0,edgeRadius(b))],width:b.size,height:b.size};
  if(!body) return null;
  const letter = ch ? glyphShapes(ch,font, b.shape==='outline'?b.size:b.letterSize, 0, b.fillGaps!==false) : null;
  return {body, letter, letterHex: letterSlab(0,b.raise,b.size,b.hex,b.letterHex).hex};
}

function buildBeadStripUI(){
  const el=document.getElementById('beadStrip');
  if(!el) return;
  el.style.display=design.beads.length?'':'none';
  const faces=design.beads.map(beadFaceShapes);
  // One scale across the whole strip, so a bigger bead reads as bigger.
  const maxDim=Math.max(1,...faces.map(f=>f?Math.max(f.body.width,f.body.height):1));
  const scale=(CHIP-2*CHIP_PAD)/maxDim, c=CHIP/2;
  el.innerHTML=design.beads.map((b,i)=>{
    const f=faces[i];
    const svg=f ? `<svg width="${CHIP}" height="${CHIP}" viewBox="0 0 ${CHIP} ${CHIP}">`
        +`<path d="${shapesToPathData(f.body.shapes,scale,c,c)}" fill="${esc(b.hex)}" fill-rule="evenodd"/>`
        +(f.letter?`<path d="${shapesToPathData(f.letter.shapes,scale,c,c)}" fill="${esc(f.letterHex)}" fill-rule="evenodd"/>`:'')
        +'</svg>' : '';
    return `<div class="bead-chip${i===selectedBead?' selected':''}" title="${esc(beadLabel(b,i))}"
      onclick="selectBead(${i})" draggable="true"
      ondragstart="onBeadDragStart(event,${i})" ondragover="onBeadDragOver(event,${i})"
      ondrop="event.preventDefault()" ondragend="onBeadDragEnd()">${svg}</div>`;
  }).join('');
}
function addBead(){
  design.beads.splice(selectedBead>=0?selectedBead+1:design.beads.length,0,makeBead(''));
  selectedBead=selectedBead>=0?selectedBead+1:design.beads.length-1;
  syncTextBox(); buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
}
function duplicateBead(i){
  design.beads.splice(i+1,0,{...design.beads[i],_key:_keySeq++});
  selectedBead=i+1;
  syncTextBox(); buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
}
function removeBead(i){
  design.beads.splice(i,1);
  if(selectedBead>=design.beads.length) selectedBead=design.beads.length-1;
  syncTextBox(); buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
}

// ── Bead editor ────────────────────────────────────────────────
function buildBeadEditorUI(){
  const editor=document.getElementById('beadEditor');
  const b=design.beads[selectedBead];
  if(!b){ editor.style.display='none'; return; }
  editor.style.display='flex';
  const isOutline=b.shape==='outline';
  const set=(id,v)=>{ document.getElementById(id).value=v; };
  set('beadShape',b.shape);
  set('beadChar',b.char||'');
  set('beadSize',b.size);
  set('beadHole',b.hole);
  set('beadRadius',b.radius??0);
  set('beadBorder',b.border??0);
  set('beadGap',b.gap??design.gap);
  set('beadRotation',b.rotation||0);
  set('beadLetterSize',b.letterSize);
  set('beadRaise',b.raise);
  document.getElementById('beadFillGaps').checked=b.fillGaps!==false;

  document.getElementById('beadSizeLabel').textContent =
    b.shape==='round' ? 'Diameter (mm)' : isOutline ? 'Letter size (mm)' : 'Bead size (mm)';
  document.getElementById('beadRadiusRow').style.display = b.shape==='square' ? '' : 'none';
  document.getElementById('beadBorderRow').style.display = isOutline ? '' : 'none';
  // An outline bead's letter is fixed to the plate's own glyph size.
  document.getElementById('letterSizeRow').style.display = isOutline ? 'none' : '';

  document.getElementById('beadColourSwatch').style.background=b.hex;
  document.getElementById('beadColourLabel').textContent=colourName(b.hex);
  document.getElementById('letterColourSwatch').style.background=b.letterHex;
  document.getElementById('letterColourLabel').textContent=colourName(b.letterHex);
  wrapSpinners(editor);
}
function onBeadFieldChange(field,value){
  const b=design.beads[selectedBead];
  if(!b) return;
  if(field==='char') value=String(value||'').slice(0,3);
  b[field]=value;
  if(field==='char'||field==='shape'){ syncTextBox(); buildBeadListUI(); }
  if(field==='shape') buildBeadEditorUI();
  scheduleRender();
}

// ── Colour pickers ─────────────────────────────────────────────
// Four pickers, same widget: the selected bead's two colours and the two
// defaults. `.colour-picker-list` is position:fixed (it has to be — both
// panels scroll and clip their overflow), so each one is anchored to its own
// button here.
const PICKERS=['bead','letter','defBead','defLetter'];
let openPicker=null;
function toggleColourPicker(which){
  if(openPicker===which){ closeColourPickers(); return; }
  closeColourPickers();
  const list=document.getElementById(which+'ColourList');
  const rect=document.getElementById(which+'ColourWrap').getBoundingClientRect();
  list.innerHTML=colours.map(c=>`<div class="cp-option" onclick="selectColour('${which}','${escJsAttr(c.code)}','${escJsAttr(c.id)}')"><div class="cp-swatch" style="background:${esc(c.code)}"></div><span>${esc(c.name)}</span></div>`).join('')
    || '<div class="cp-option"><span>No colours loaded</span></div>';
  list.style.display='';
  list.style.width=rect.width+'px';
  list.style.left=rect.left+'px';
  // Flip above the button when there isn't room below it.
  const below=window.innerHeight-rect.bottom;
  if(below<list.offsetHeight+8 && rect.top>below){
    list.style.top=''; list.style.bottom=(window.innerHeight-rect.top+4)+'px';
  }else{
    list.style.bottom=''; list.style.top=(rect.bottom+4)+'px';
  }
  openPicker=which;
}
function closeColourPickers(){
  PICKERS.forEach(p=>{ document.getElementById(p+'ColourList').style.display='none'; });
  openPicker=null;
}
function selectColour(which,hex,colId){
  const b=design.beads[selectedBead];
  // The bead pickers also move the default, so the next bead you add matches.
  if(which==='bead'||which==='defBead'){
    design.hex=hex; design.colourId=colId;
    if(which==='bead'&&b){ b.hex=hex; b.colourId=colId; }
  }else{
    design.letterHex=hex; design.letterColourId=colId;
    if(which==='letter'&&b){ b.letterHex=hex; b.letterColourId=colId; }
  }
  closeColourPickers();
  buildDefaultsUI(); buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
}

// ── Header menus ───────────────────────────────────────────────
let modelMenuOpen=false, userMenuOpen=false;
function toggleModelMenu(){ modelMenuOpen=!modelMenuOpen; document.getElementById('modelMenu').style.display=modelMenuOpen?'flex':'none'; }
function closeModelMenu(){ modelMenuOpen=false; document.getElementById('modelMenu').style.display='none'; }
function toggleUserMenu(){ userMenuOpen=!userMenuOpen; document.getElementById('userMenu').style.display=userMenuOpen?'flex':'none'; }
function closeUserMenu(){ userMenuOpen=false; document.getElementById('userMenu').style.display='none'; }

// ── Boot ───────────────────────────────────────────────────────
function refreshAll(){
  syncTextBox();
  buildDefaultsUI();
  buildBeadListUI();
  buildBeadEditorUI();
  refreshDesignDropdown();
  scheduleRender();
}

async function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='flex';
  document.getElementById('userChip').textContent=currentUser?.user_metadata?.display_name||currentUser?.email||'';
  setStatus('Loading…');
  syncGridBtn();
  wrapSpinners(document.querySelector('.panel'));
  try{ await loadBuiltinFont(); }catch(e){ setStatus('Could not load built-in font','err'); }
  await loadColours();
  await loadFonts();
  // The boot design was built before the filament list arrived — redo its
  // palette now that names can be matched.
  if(!loadDesigns()[design.id]) applyDefaultPalette(design);
  const all=loadDesigns();
  const last=all[localStorage.getItem(LS_LAST)]||Object.values(all)[0];
  if(last) openDesign(last);
  else { design.beads=[...'BEADS'].map(makeBead); refreshAll(); }
  setStatus('');
}

(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
