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

function otPathToShapes(otPath, filled){
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
  if(filled){ const s=sp.toShapes(false); s.forEach(sh=>{sh.holes=[];}); return s; }
  return sp.toShapes(false);
}

function getTextContours(text,fsize){
  if(!font) return [];
  const glyphs=font.stringToGlyphs(text); let x=0; const contours=[];
  for(let i=0;i<glyphs.length;i++){
    const path=glyphs[i].getPath(x,0,fsize); let cur=[];
    for(const cmd of path.commands){
      if(cmd.type==='M'){if(cur.length)contours.push(cur);cur=[{x:cmd.x,y:cmd.y}];}
      else if(cmd.type==='L')cur.push({x:cmd.x,y:cmd.y});
      else if(cmd.type==='C'){const p0=cur[cur.length-1];for(let t=0.1;t<=1;t+=0.1){const m=1-t;cur.push({x:m*m*m*p0.x+3*m*m*t*cmd.x1+3*m*t*t*cmd.x2+t*t*t*cmd.x,y:m*m*m*p0.y+3*m*m*t*cmd.y1+3*m*t*t*cmd.y2+t*t*t*cmd.y});}}
      else if(cmd.type==='Q'){const p0=cur[cur.length-1];for(let t=0.1;t<=1;t+=0.1){const m=1-t;cur.push({x:m*m*p0.x+2*m*t*cmd.x1+t*t*cmd.x,y:m*m*p0.y+2*m*t*cmd.y1+t*t*cmd.y});}}
      else if(cmd.type==='Z'){if(cur.length)contours.push(cur);cur=[];}
    }
    if(cur.length)contours.push(cur);
    x+=glyphs[i].advanceWidth*(fsize/font.unitsPerEm);
  }
  return contours;
}

function getBounds(contours){ let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; for(const c of contours)for(const p of c){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);} return{minX,maxX,minY,maxY,w:maxX-minX,h:maxY-minY}; }

// ── Clipper-based clean polygon offset ───────────────────────
// Uses integer coordinates (scale up then down) for precision
const CLIPPER_SCALE = 1000;

function pathToClipperPath(pts){
  return pts.map(p=>({X:Math.round(p.x*CLIPPER_SCALE), Y:Math.round(p.y*CLIPPER_SCALE)}));
}

function clipperPathToVec2(path){
  return path.map(p=>new THREE.Vector2(p.X/CLIPPER_SCALE, p.Y/CLIPPER_SCALE));
}

function getFilledShapes(text, fsize, border, spacing){
  if(!font||!ClipperLib) return [];
  const glyphs = font.stringToGlyphs(text);
  let x = 0;

  // Collect all glyph contours as clipper paths
  const clipPaths = [];
  for(let i=0;i<glyphs.length;i++){
    const g = glyphs[i];
    const path = g.getPath(x, 0, fsize);
    // Convert to Three ShapePath first to get clean contours
    const sp = new THREE.ShapePath();
    for(const cmd of path.commands){
      switch(cmd.type){
        case 'M':sp.moveTo(cmd.x,-cmd.y);break;
        case 'L':sp.lineTo(cmd.x,-cmd.y);break;
        case 'C':sp.bezierCurveTo(cmd.x1,-cmd.y1,cmd.x2,-cmd.y2,cmd.x,-cmd.y);break;
        case 'Q':sp.quadraticCurveTo(cmd.x1,-cmd.y1,cmd.x,-cmd.y);break;
        case 'Z':sp.currentPath.closePath();break;
      }
    }
    // Get shapes and convert to clipper paths
    const shapes = sp.toShapes(false);
    shapes.forEach(s=>{
      const pts = s.getPoints(32);
      if(pts.length>2) clipPaths.push(pathToClipperPath(pts));
    });
    x += g.advanceWidth*(fsize/font.unitsPerEm)
       + (i<glyphs.length-1?font.getKerningValue(g,glyphs[i+1])*(fsize/font.unitsPerEm):0)
       + (spacing||0);
  }

  if(!clipPaths.length) return [];

  // Union all paths first to merge overlapping letters
  const cpr = new ClipperLib.Clipper();
  clipPaths.forEach(p => cpr.AddPath(p, ClipperLib.PolyType.ptSubject, true));
  const unionResult = new ClipperLib.Paths();
  cpr.Execute(ClipperLib.ClipType.ctUnion, unionResult,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  if(!unionResult.length) return [];

  // Offset outward by border amount
  if(border > 0){
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPaths(unionResult, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const offsetResult = new ClipperLib.Paths();
    co.Execute(offsetResult, border * CLIPPER_SCALE);

    // Keep only outer paths (positive area = CCW in clipper coords)
    const outerPaths = offsetResult.filter(p => ClipperLib.Clipper.Area(p) > 0);
    if(!outerPaths.length) return [];
    return outerPaths.map(p => new THREE.Shape(clipperPathToVec2(p)));
  }

  // No border — return union shapes
  const outerPaths = unionResult.filter(p => ClipperLib.Clipper.Area(p) > 0);
  return outerPaths.map(p => new THREE.Shape(clipperPathToVec2(p)));
}


function getTextShapes(text,fsize,filled,spacing){
  if(!font) return [];
  const glyphs=font.stringToGlyphs(text); let x=0; const all=[];
  for(let i=0;i<glyphs.length;i++){
    const g=glyphs[i];
    const path=g.getPath(x,0,fsize);
    all.push(...otPathToShapes(path,false));
    x+=g.advanceWidth*(fsize/font.unitsPerEm)+(i<glyphs.length-1?font.getKerningValue(g,glyphs[i+1])*(fsize/font.unitsPerEm):0)+(spacing||0);
  }
  return all;
}

// ── Build badge ───────────────────────────────────────────────
function buildBadge(){
  if(!font||!layerConfig.length) return;
  const name=document.getElementById('nameInput').value.toUpperCase()||'NAME';
  const fsize=parseFloat(document.getElementById('fontSize').value)||49;
  const spacing=parseFloat(document.getElementById('letterSpacing')?.value||0);

  badgeGroup.children.filter(c=>c!==grid).forEach(c=>badgeGroup.remove(c));

  const contours=getTextContours(name,fsize);
  if(!contours.length) return;
  const bounds=getBounds(contours);
  const cx=bounds.minX+bounds.w/2;
  const cy=-(bounds.minY+bounds.h/2);
  const totalThick=layerConfig.reduce((s,l)=>s+l.thick,0);

  let zOff=0; let layerIdx=0;
  for(const l of layerConfig){
    if(debugBlackOnly&&layerIdx!==2){zOff+=l.thick;layerIdx++;continue;}

    let finalShapes;
    if(l.filled){
      finalShapes=getFilledShapes(name,fsize,l.border,spacing);
    } else {
      finalShapes=getTextShapes(name,fsize,false,spacing);
      if(l.border>0) finalShapes=finalShapes.map(s=>{const pts=s.getPoints(12);const op=offsetContour(pts.map(p=>({x:p.x,y:p.y})),l.border);return new THREE.Shape(op.map(p=>new THREE.Vector2(p.x,p.y)));});
    }
    if(!finalShapes.length){zOff+=l.thick;layerIdx++;continue;}

    const geo=new THREE.ExtrudeGeometry(finalShapes,{depth:l.thick,bevelEnabled:false,curveSegments:24});
    const mat=new THREE.MeshPhongMaterial({color:parseInt(l.colourHex.replace('#',''),16),shininess:20});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.set(-cx,cy,zOff+layerIdx*0.01);
    badgeGroup.add(mesh);
    zOff+=l.thick; layerIdx++;
  }

  // Add cutout visualisation (shown as dark inset on back face)
  const backing = getBackingConfig();
  if(backing){
    const geo = makeCutoutGeo(backing.w, backing.h, backing.d);
    const mat = new THREE.MeshPhongMaterial({color:0x111111, shininess:0});
    const mesh = new THREE.Mesh(geo, mat);
    // Same centre offset as other layers, z=0 is the back face
    mesh.position.set(-cx, cy, 0);
    badgeGroup.add(mesh);
  }

  setStatus(`${name} — ${bounds.w.toFixed(1)}×${bounds.h.toFixed(1)}mm`,'ok');
}

// ── Backing cutout ────────────────────────────────────────────
function getBackingConfig(){
  const val = document.getElementById('backingSelect')?.value||'Magnet';
  if(val==='Pin')   return {w:32, h:7,  d:2, name:'pin'};
  if(val==='Magnet') return {w:46, h:14, d:2, name:'magnet'};
  return null;
}

// Create a rectangular cutout box geometry centred at origin
// Sits from z=0 going into negative Z (into the back face)
function makeCutoutGeo(w, h, d){
  const geo = new THREE.BoxGeometry(w, h, d);
  // Shift so top face is at z=0, box extends to z=-d
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -d/2));
  return geo;
}

function offsetContour(pts,dist){
  const n=pts.length,r=[];
  for(let i=0;i<n;i++){
    const prev=pts[(i-1+n)%n],curr=pts[i],next=pts[(i+1)%n];
    const e1x=curr.x-prev.x,e1y=curr.y-prev.y;
    const e2x=next.x-curr.x,e2y=next.y-curr.y;
    const l1=Math.sqrt(e1x*e1x+e1y*e1y)||1,l2=Math.sqrt(e2x*e2x+e2y*e2y)||1;
    const n1=[-e1y/l1,e1x/l1],n2=[-e2y/l2,e2x/l2];
    const mx=n1[0]+n2[0],my=n1[1]+n2[1],mlen=Math.sqrt(mx*mx+my*my)||1;
    r.push({x:curr.x+mx/mlen*dist,y:curr.y+my/mlen*dist});
  }
  return r;
}

// ── 3MF Export ────────────────────────────────────────────────
function exportTMF(){
  if(!font) return;
  const name=document.getElementById('nameInput').value.toUpperCase()||'NAME';
  const fsize=parseFloat(document.getElementById('fontSize').value)||49;
  const spacing=parseFloat(document.getElementById('letterSpacing')?.value||0);
  setStatus('Generating 3MF…');

  let zOff=0;
  const objects=layerConfig.map((l,idx)=>{
    let finalShapes;
    if(l.filled){ finalShapes=getFilledShapes(name,fsize,l.border,spacing); }
    else { finalShapes=getTextShapes(name,fsize,false,spacing); }
    if(!finalShapes.length){zOff+=l.thick;return null;}
    const geo=new THREE.ExtrudeGeometry(finalShapes,{depth:l.thick,bevelEnabled:false,curveSegments:24});
    geo.computeVertexNormals();
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0,0,zOff));
    zOff+=l.thick;
    return{geo,name:`layer${idx+1}`,colour:l.colourHex,extruder:idx+1,id:idx+1};
  }).filter(Boolean);

  // Add backing cutout as negative part on layer 1
  const backing=getBackingConfig();
  if(backing && objects.length>0){
    const cutGeo=makeCutoutGeo(backing.w, backing.h, backing.d);
    cutGeo.computeVertexNormals();
    objects.push({geo:cutGeo, name:`${backing.name}_cutout`, colour:'#000000', extruder:1, id:objects.length+1, negative:true});
  }

  const tmfData=build3MF(objects,name);
  const zip=buildZip(tmfData);
  const prefix=(document.getElementById('filePrefix')?.value||'').trim();
  const suffix=(document.getElementById('fileSuffix')?.value||'').trim();
  const filename=[prefix,name,suffix].filter(Boolean).join(' ')+'.3mf';
  downloadBlob(zip,filename,'application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
  setStatus(`Exported ${filename}`,'ok');
}

function build3MF(objects,name){
  let objXml='',comps='';
  objects.forEach(obj=>{
    const pos=obj.geo.attributes.position,idx=obj.geo.index;
    let verts='',tris='';
    for(let i=0;i<pos.count;i++) verts+=`   <vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}"/>\n`;
    if(idx){for(let i=0;i<idx.count;i+=3)tris+=`   <triangle v1="${idx.getX(i)}" v2="${idx.getX(i+1)}" v3="${idx.getX(i+2)}"/>\n`;}
    else{for(let i=0;i<pos.count;i+=3)tris+=`   <triangle v1="${i}" v2="${i+1}" v3="${i+2}"/>\n`;}
    objXml+=`  <object id="${obj.id}" type="model" name="${obj.name}">\n   <mesh>\n    <vertices>\n${verts}    </vertices>\n    <triangles>\n${tris}    </triangles>\n   </mesh>\n  </object>\n`;
    comps+=`    <component objectid="${obj.id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n`;
  });
  const wId=objects.length+1;
  objXml+=`  <object id="${wId}" type="model" name="${name}">\n   <components>\n${comps}   </components>\n  </object>\n`;
  const modelXml=`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <resources>\n${objXml} </resources>\n <build>\n  <item objectid="${wId}"/>\n </build>\n</model>`;

  // Build model_settings.config with extruder assignments
  let parts='';
  objects.forEach((obj,i)=>{
    const subtype = obj.negative ? 'negative_part' : 'normal_part';
    parts+=`    <part id="${obj.id}" subtype="${subtype}">\n`;
    parts+=`      <metadata key="name" value="${obj.name}"/>\n`;
    parts+=`      <metadata key="extruder" value="${obj.extruder}"/>\n`;
    parts+=`    </part>\n`;
  });
  const modelSettings=`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="${wId}">\n    <metadata key="name" value="${name}"/>\n    <metadata key="extruder" value="1"/>\n${parts}  </object>\n</config>`;

  // Build project_settings.config with filament colours
  const filamentColours=objects.filter(o=>!o.negative).map(o=>o.colour);
  const n=filamentColours.length;
  const projectSettings=JSON.stringify({
    filament_colour: filamentColours,
    filament_type: Array(n).fill('PLA'),
    filament_settings_id: Array(n).fill('Bambu PLA Basic @BBL A1M'),
    filament_vendor: Array(n).fill('Bambu Lab'),
    default_filament_colour: Array(n).fill(''),
    filament_is_support: Array(n).fill('0'),
    filament_ids: Array(n).fill('GFB00'),
  }, null, 2);

  return {modelXml, modelSettings, projectSettings};
}

function buildZip(data){
  const {modelXml, modelSettings, projectSettings} = data;
  const enc=new TextEncoder();
  const files=[
    {name:'[Content_Types].xml',data:enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/></Types>`)},
    {name:'_rels/.rels',data:enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`)},
    {name:'3D/3dmodel.model',data:enc.encode(modelXml)},
    {name:'Metadata/model_settings.config',data:enc.encode(modelSettings)},
    {name:'Metadata/project_settings.config',data:enc.encode(projectSettings)},
  ];
  const parts=[],cd=[];let off=0;
  for(const f of files){
    const nb=enc.encode(f.name),d=f.data,crc=crc32(d);
    const loc=new Uint8Array(30+nb.length+d.length),dv=new DataView(loc.buffer);
    dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0,true);dv.setUint16(8,0,true);dv.setUint16(10,0,true);dv.setUint16(12,0,true);dv.setUint32(14,crc,true);dv.setUint32(18,d.length,true);dv.setUint32(22,d.length,true);dv.setUint16(26,nb.length,true);dv.setUint16(28,0,true);
    loc.set(nb,30);loc.set(d,30+nb.length);parts.push(loc);
    const ce=new Uint8Array(46+nb.length),cv=new DataView(ce.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0,true);cv.setUint16(10,0,true);cv.setUint16(12,0,true);cv.setUint16(14,0,true);cv.setUint32(16,crc,true);cv.setUint32(20,d.length,true);cv.setUint32(24,d.length,true);cv.setUint16(28,nb.length,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);cv.setUint32(42,off,true);
    ce.set(nb,46);cd.push(ce);off+=loc.length;
  }
  const cdSize=cd.reduce((s,c)=>s+c.length,0);
  const eocd=new Uint8Array(22),ev=new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,cdSize,true);ev.setUint32(16,off,true);ev.setUint16(20,0,true);
  const all=[...parts,...cd,eocd];const res=new Uint8Array(all.reduce((s,p)=>s+p.length,0));let p=0;for(const a of all){res.set(a,p);p+=a.length;}return res;
}
function crc32(data){let c=0xFFFFFFFF;for(let i=0;i<data.length;i++){c^=data[i];for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xEDB88320:0);}return(c^0xFFFFFFFF)>>>0;}
function downloadBlob(data,filename,type){const b=new Blob([data],{type});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=filename;a.click();URL.revokeObjectURL(u);}
