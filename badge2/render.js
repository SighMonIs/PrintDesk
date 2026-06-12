// ── Three.js setup ────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const pane     = document.getElementById('previewPane');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(window.devicePixelRatio);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(parseInt(localStorage.getItem('badge_bgColour')||'0x18181b'));
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(0, -100, 200);
camera.lookAt(0,0,0);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(50,-50,100); scene.add(dl);
const fl = new THREE.DirectionalLight(0xffffff, 0.3); fl.position.set(-50,50,50); scene.add(fl);

const grid = new THREE.GridHelper(300, 30, 0x333337, 0x222225);
const badgeGroup = new THREE.Group();
scene.add(badgeGroup);
badgeGroup.add(grid);

function resize(){
  const w=pane.clientWidth, h=pane.clientHeight;
  renderer.setSize(w,h);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

// ── Camera controls ───────────────────────────────────────────
let defRotX = parseFloat(localStorage.getItem('badge_defRotX')??'-0.5');
let defRotY = parseFloat(localStorage.getItem('badge_defRotY')??'0.2');
let defZoom = parseFloat(localStorage.getItem('badge_defZoom')??'1');
let rotX = defRotX, rotY = defRotY, zoom = defZoom;
let scrollZoomSpeed = 0.01;

let isDragging=false, lastX=0, lastY=0;
canvas.addEventListener('mousedown', e=>{isDragging=true;lastX=e.clientX;lastY=e.clientY;});
window.addEventListener('mouseup', ()=>isDragging=false);
window.addEventListener('mousemove', e=>{
  if(!isDragging) return;
  rotY+=(e.clientX-lastX)*0.01;
  rotX+=(e.clientY-lastY)*0.01;
  rotX=Math.max(-Math.PI/2,Math.min(Math.PI/2,rotX));
  lastX=e.clientX; lastY=e.clientY;
  syncSlidersFromView();
});
canvas.addEventListener('wheel', e=>{
  const f=1+scrollZoomSpeed;
  zoom*=e.deltaY>0?f:1/f;
  zoom=Math.max(0.3,Math.min(4,zoom));
  syncSlidersFromView();
  e.preventDefault();
},{passive:false});
let ltX=0,ltY=0;
canvas.addEventListener('touchstart',e=>{ltX=e.touches[0].clientX;ltY=e.touches[0].clientY;});
canvas.addEventListener('touchmove',e=>{
  rotY+=(e.touches[0].clientX-ltX)*0.01;
  rotX+=(e.touches[0].clientY-ltY)*0.01;
  ltX=e.touches[0].clientX;ltY=e.touches[0].clientY;
  e.preventDefault();
},{passive:false});

function animate(){
  requestAnimationFrame(animate);
  badgeGroup.rotation.x=rotX;
  badgeGroup.rotation.y=rotY;
  camera.position.set(0,-100*zoom,200*zoom);
  camera.lookAt(0,0,0);
  renderer.render(scene,camera);
}
animate();

function resetView(){ rotX=defRotX; rotY=defRotY; zoom=defZoom; syncSlidersFromView(); }
function toggleGrid(){ grid.visible=!grid.visible; document.getElementById('toggleGridBtn').style.opacity=grid.visible?'1':'0.4'; }
function setBg(colour,el){ scene.background=new THREE.Color(colour); document.querySelectorAll('#viewportPanel [onclick^="setBg"]').forEach(e=>e.style.border='1px solid var(--border2)'); el.style.border='2px solid var(--accent)'; localStorage.setItem('badge_bgColour',colour); }
function toggleCamPanel(id){ const panels=['camAnglePanel','camZoomPanel','viewportPanel']; panels.forEach(p=>{ if(p!==id) document.getElementById(p).style.display='none'; }); const el=document.getElementById(id); el.style.display=el.style.display==='none'?'block':'none'; }
function applyCam(){ rotX=parseFloat(document.getElementById('camRotX').value); rotY=parseFloat(document.getElementById('camRotY').value); zoom=parseFloat(document.getElementById('camZoom').value); }
function syncNum(sId,nId){ const v=parseFloat(document.getElementById(sId).value); const step=parseFloat(document.getElementById(sId).step||'0.01'); const dec=step.toString().includes('.')?step.toString().split('.')[1].length:2; document.getElementById(nId).value=v.toFixed(dec); }
function syncSlider(sId,nId){ const v=parseFloat(document.getElementById(nId).value); if(!isNaN(v)) document.getElementById(sId).value=v; }
function syncSlidersFromView(){
  const pairs=[['camRotX','camRotXN',rotX],['camRotY','camRotYN',rotY],['camZoom','camZoomN',zoom]];
  pairs.forEach(([sid,nid,val])=>{ const s=document.getElementById(sid),n=document.getElementById(nid); if(s){s.value=val;} if(n){n.value=val.toFixed(2);} });
}
async function saveDefaultAngle(){
  defRotX=rotX; defRotY=rotY; defZoom=zoom;
  localStorage.setItem('badge_defRotX',rotX); localStorage.setItem('badge_defRotY',rotY); localStorage.setItem('badge_defZoom',zoom);
  if(currentUser&&currentModel) await sbUpsert('badge_user_preferences',{user_id:currentUser.id,model_id:currentModel.id,def_rot_x:rotX,def_rot_y:rotY,def_zoom:zoom,zoom_speed:scrollZoomSpeed,updated_at:new Date().toISOString()});
  const btn=event.currentTarget; const orig=btn.innerHTML; btn.innerHTML='✓ Saved!'; setTimeout(()=>btn.innerHTML=orig,1500);
}
function saveZoomSpeed(){ scrollZoomSpeed=parseFloat(document.getElementById('zoomSpd').value)||0.01; syncNum('zoomSpd','zoomSpdN'); if(currentUser&&currentModel) sbUpsert('badge_user_preferences',{user_id:currentUser.id,model_id:currentModel.id,def_rot_x:defRotX,def_rot_y:defRotY,def_zoom:defZoom,zoom_speed:scrollZoomSpeed,updated_at:new Date().toISOString()}); }

document.addEventListener('click',e=>{
  ['camAnglePanel','camZoomPanel','viewportPanel'].forEach(id=>{
    const p=document.getElementById(id);
    if(p&&p.style.display!=='none'&&!e.target.closest('#'+id)&&!e.target.closest('.preview-controls')) p.style.display='none';
  });
  if(openPickerId!==null&&!e.target.closest('.colour-picker-wrap')){ document.getElementById('cplist-'+openPickerId).style.display='none'; openPickerId=null; }
  if(openCombo&&!e.target.closest('#cpwCombo')){ document.getElementById('comboList').style.display='none'; openCombo=false; }
});

// ── Font / rendering ──────────────────────────────────────────
let font = null;
let renderTimer = null;
const FONT_PATH = 'LEGO.TTF';

function scheduleRender(){ clearTimeout(renderTimer); renderTimer=setTimeout(buildBadge,300); }

function otPathToShapes(otPath){
  const sp=new THREE.ShapePath();
  for(const cmd of otPath.commands){
    switch(cmd.type){
      case 'M':sp.moveTo(cmd.x,-cmd.y);break;
      case 'L':sp.lineTo(cmd.x,-cmd.y);break;
      case 'C':sp.bezierCurveTo(cmd.x1,-cmd.y1,cmd.x2,-cmd.y2,cmd.x,-cmd.y);break;
      case 'Q':sp.quadraticCurveTo(cmd.x1,-cmd.y1,cmd.x,-cmd.y);break;
      case 'Z':sp.currentPath.closePath();break;
    }
  }
  return sp.toShapes(false);
}

function getTextShapes(text, fsize){
  if(!font) return [];
  const glyphs=font.stringToGlyphs(text);
  let x=0; const all=[];
  for(let i=0;i<glyphs.length;i++){
    const g=glyphs[i];
    all.push(...otPathToShapes(g.getPath(x,0,fsize)));
    x+=g.advanceWidth*(fsize/font.unitsPerEm);
  }
  return all;
}

// ── Build badge ───────────────────────────────────────────────
function buildBadge(){
  if(!font) return;

  const name=(document.getElementById('nameInput')?.value||'NAME').toUpperCase();
  const fsize=parseFloat(document.getElementById('fontSize')?.value)||49;

  // Clear existing meshes
  badgeGroup.children.filter(c=>c!==grid).forEach(c=>badgeGroup.remove(c));

  // Get text shapes and extrude
  const shapes=getTextShapes(name, fsize);
  if(!shapes.length) return;

  const geo=new THREE.ExtrudeGeometry(shapes,{depth:3, bevelEnabled:false, curveSegments:24});

  // Centre using bounding box
  geo.computeBoundingBox();
  const box=geo.boundingBox;
  const cx=(box.max.x+box.min.x)/2;
  const cy=(box.max.y+box.min.y)/2;

  const mat=new THREE.MeshPhongMaterial({color:0xff0000, shininess:20});
  const mesh=new THREE.Mesh(geo,mat);
  mesh.position.set(-cx,-cy,0);
  badgeGroup.add(mesh);

  if(typeof setStatus==='function') setStatus(name,'ok');
}
