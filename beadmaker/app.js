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
// The cord runs along +X. Square/round beads are their cross-section
// extruded along the cord with a round hole down the middle, letter raised
// on the top (+Z) face so it prints letter-up with no supports.
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
  const limits=[b.radius||0, b.width/2-0.05, b.size/2-0.05];
  if(b.hole>0) limits.push((b.size-b.hole)/4);
  return Math.max(0, Math.min(...limits));
}
function roundProfile(size,holeD){
  const s=new THREE.Shape();
  s.absarc(0,0,size/2,0,TAU,false);
  addHole(s,holeD);
  return s;
}

// A letter bead is the glyph itself lying flat, so its cord hole can't be
// part of the profile — cut it as a slot through the middle Z band instead
// (2D boolean per band, the same trick BadgeMak3r uses for shallow cutters).
function letterBeadSlabs(shapes,thickness,holeD){
  if(!(holeD>0) || holeD>=thickness) return [{z:0,depth:thickness,shapes}];
  const band=(thickness-holeD)/2;
  const S=_BADGE_SCALE, far=1e8, y=Math.round(holeD/2*S);
  const cut=clipperDifference(
    shapes.flatMap(shapeToClipperPaths),
    [[{X:-far,Y:-y},{X:far,Y:-y},{X:far,Y:y},{X:-far,Y:y}]],
  );
  const mid=cut.length?clipperPathsToShapes(cut):[];
  return [
    {z:0,depth:band,shapes},
    ...(mid.length?[{z:band,depth:holeD,shapes:mid}]:[]),
    {z:band+holeD,depth:band,shapes},
  ];
}

// Builds one bead centred on the origin. Returns its parts (each already a
// finished geometry) and how much cord length it takes up.
function buildBead(b){
  const parts=[], font=getFont(b.fontId ?? design.fontId);
  const roll=(b.rotation||0)*Math.PI/180;
  const ch=(b.char||'').trim().toUpperCase();
  const place=geo=>{ geo.rotateX(roll); return geo; };

  if(b.shape==='text'){
    const g=glyphShapes(ch,font,b.size,b.border||0,b.fillGaps!==false);
    if(!g) return {parts,advance:b.width||1};
    for(const slab of letterBeadSlabs(g.shapes,b.width,b.hole)){
      const geo=new THREE.ExtrudeGeometry(slab.shapes,{depth:slab.depth,bevelEnabled:false});
      geo.translate(0,0,slab.z-b.width/2);
      parts.push({geo:place(geo),hex:b.hex});
    }
    return {parts,advance:g.width};
  }

  // A square bead rounds in both directions: `r` rounds the four edges
  // running along the cord (in the profile) and, as an extrude bevel, the
  // two end faces as well — a rounded cube, not a rounded rectangle on a
  // stick. The bevel eats `r` off each end, so the extrusion is that much
  // shorter and re-centred.
  const r = b.shape==='square' ? edgeRadius(b) : 0;
  const prof = b.shape==='round' ? roundProfile(b.size,b.hole) : squareProfile(b.size,b.hole,r);
  const body = r > 0
    // bevelOffset:-r matters — at the default 0 the bevel bulges the middle
    // outward by r instead of rounding the ends inward, so an 8mm bead came
    // out 10.75mm wide.
    ? new THREE.ExtrudeGeometry(prof,{depth:b.width-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelOffset:-r,bevelSegments:6})
    : new THREE.ExtrudeGeometry(prof,{depth:b.width,bevelEnabled:false});
  body.translate(0,0, r>0 ? r-b.width/2 : -b.width/2);
  body.rotateY(Math.PI/2);                 // extrusion axis -> the cord (+X)
  parts.push({geo:place(body),hex:b.hex});

  const g=ch ? glyphShapes(ch,font,b.letterSize,0,b.fillGaps!==false) : null;
  if(g){
    // Sit the letter on the bead's top surface; on a round bead that's the
    // chord height at the letter's own half-height, then sunk 0.2mm to fuse.
    const r=b.size/2;
    const top = b.shape==='round' ? Math.sqrt(Math.max(0.01, r*r - Math.min(r,g.height/2)**2)) : r;
    const geo=new THREE.ExtrudeGeometry(g.shapes,{depth:b.raise,bevelEnabled:false});
    geo.translate(0,0,top-0.2);
    parts.push({geo:place(geo),hex:b.letterHex});
  }
  return {parts,advance:b.width};
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
    const mat=new THREE.MeshPhongMaterial({color:parseInt((p.hex||'#888888').replace('#',''),16),shininess:40});
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
}

// ── 3MF export ─────────────────────────────────────────────────
let projectSettingsTemplate=null;
fetch('../badge/project_settings_template.json').then(r=>r.json()).then(t=>{projectSettingsTemplate=t;}).catch(()=>{});

function exportBracelet(){
  const {parts}=buildBracelet();
  if(!parts.length){ setStatus('Nothing to export — type some text first','err'); return; }
  // One extruder slot per distinct colour, not per part — a 20-bead bracelet
  // is still a 2- or 3-filament print.
  const slots=[...new Set(parts.map(p=>p.hex||'#888888'))];
  const objects=parts.map((p,i)=>({
    geo:_badgeMergeVerticesForExport(p.geo),
    name:`part${i+1}`,
    colour:p.hex||'#888888',
    extruder:slots.indexOf(p.hex||'#888888')+1,
    id:i+1,
  }));
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

function newDesignObject(name){
  return {
    id:String(Date.now()), name, fontId:'',
    shape:'square', size:8, width:8, hole:2.5, gap:0.5,
    letterSize:5, raise:0.8, radius:1, border:0,
    hex:'#3b82f6', colourId:null, letterHex:'#ffffff', letterColourId:null,
    beads:[],
  };
}
function makeBead(char){
  return {
    _key:_keySeq++, char:char||'',
    shape:design.shape, size:design.size, width:design.width, hole:design.hole,
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
  design.beads.forEach(b=>{ b._key=_keySeq++; });
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
const DEFAULT_FIELDS=['shape','size','width','hole','gap','letterSize','raise'];
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
  document.getElementById('defWidth').value=design.width;
  document.getElementById('defHole').value=design.hole;
  document.getElementById('defGap').value=design.gap;
  document.getElementById('defLetterSize').value=design.letterSize;
  document.getElementById('defRaise').value=design.raise;
}

// ── Bead list ──────────────────────────────────────────────────
const SHAPE_ICON={square:'ti-square',round:'ti-circle',text:'ti-letter-case'};
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
  buildBeadListUI();
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
function selectBead(i){ selectedBead=i; buildBeadListUI(); buildBeadEditorUI(); }
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
  const isText=b.shape==='text';
  const set=(id,v)=>{ document.getElementById(id).value=v; };
  set('beadShape',b.shape);
  set('beadChar',b.char||'');
  set('beadSize',b.size);
  set('beadWidth',b.width);
  set('beadHole',b.hole);
  set('beadRadius',b.radius??0);
  set('beadBorder',b.border??0);
  set('beadGap',b.gap??design.gap);
  set('beadRotation',b.rotation||0);
  set('beadLetterSize',b.letterSize);
  set('beadRaise',b.raise);
  document.getElementById('beadFillGaps').checked=b.fillGaps!==false;

  document.getElementById('beadSizeLabel').textContent = isText ? 'Letter size (mm)' : 'Bead size (mm)';
  document.getElementById('beadWidthLabel').textContent = isText ? 'Thickness (mm)' : 'Bead width (mm)';
  document.getElementById('beadRadiusRow').style.display = b.shape==='square' ? '' : 'none';
  document.getElementById('beadBorderRow').style.display = isText ? '' : 'none';
  document.getElementById('letterBlock').style.display = isText ? 'none' : '';
  document.getElementById('letterColourRow').style.display = isText ? 'none' : '';

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
let openPicker=null;
function toggleColourPicker(which){
  const list=document.getElementById(which==='bead'?'beadColourList':'letterColourList');
  if(openPicker===which){ closeColourPickers(); return; }
  closeColourPickers();
  list.innerHTML=colours.map(c=>`<div class="cp-option" onclick="selectColour('${which}','${escJsAttr(c.code)}','${escJsAttr(c.id)}')"><div class="cp-swatch" style="background:${esc(c.code)}"></div><span>${esc(c.name)}</span></div>`).join('')
    || '<div class="cp-option"><span>No colours loaded</span></div>';
  list.style.display='';
  openPicker=which;
}
function closeColourPickers(){
  document.getElementById('beadColourList').style.display='none';
  document.getElementById('letterColourList').style.display='none';
  openPicker=null;
}
function selectColour(which,hex,colId){
  const b=design.beads[selectedBead];
  if(!b) return;
  if(which==='bead'){ b.hex=hex; b.colourId=colId; design.hex=hex; design.colourId=colId; }
  else { b.letterHex=hex; b.letterColourId=colId; design.letterHex=hex; design.letterColourId=colId; }
  closeColourPickers();
  buildBeadListUI(); buildBeadEditorUI(); scheduleRender();
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
  if(colours.length && !loadDesigns()[design.id]){
    design.hex=colours[0].code; design.colourId=colours[0].id;
    const light=colours.find(c=>/white/i.test(c.name));
    if(light){ design.letterHex=light.code; design.letterColourId=light.id; }
  }
  const all=loadDesigns();
  const last=all[localStorage.getItem(LS_LAST)]||Object.values(all)[0];
  if(last) openDesign(last);
  else { design.beads=[...'BEADS'].map(makeBead); refreshAll(); }
  setStatus('');
}

(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
