// ── Project settings template ──────────────────────────────────
let projectSettingsTemplate = null;
fetch('../badge/project_settings_template.json').then(r=>r.json()).then(t=>{projectSettingsTemplate=t;}).catch(()=>{});

// ── Three.js setup ─────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const pane     = document.getElementById('previewPane');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(parseInt(localStorage.getItem('badge2_bgColour') || '0x18181b'));
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(50, -50, 100); scene.add(dl);
const fl = new THREE.DirectionalLight(0xffffff, 0.3); fl.position.set(-50, 50, 50);  scene.add(fl);

const grid = new THREE.GridHelper(300, 30, 0x333337, 0x222225);
const badgeGroup = new THREE.Group();
scene.add(badgeGroup);
badgeGroup.add(grid);

function resize() {
  const w = pane.clientWidth, h = pane.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

// ── Camera controls ────────────────────────────────────────────
let defRotX = parseFloat(localStorage.getItem('badge2_defRotX') ?? '-0.4');
let defRotY = parseFloat(localStorage.getItem('badge2_defRotY') ?? '0.2');
let defZoom = parseFloat(localStorage.getItem('badge2_defZoom') ?? '1');
let rotX = defRotX, rotY = defRotY, zoom = defZoom;
let scrollZoomSpeed = 0.01;

let isDragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  rotY += (e.clientX - lastX) * 0.01;
  rotX += (e.clientY - lastY) * 0.01;
  rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
  lastX = e.clientX; lastY = e.clientY;
  syncSlidersFromView();
});
canvas.addEventListener('wheel', e => {
  const f = 1 + scrollZoomSpeed;
  zoom *= e.deltaY > 0 ? f : 1 / f;
  zoom = Math.max(0.3, Math.min(4, zoom));
  syncSlidersFromView();
  e.preventDefault();
}, { passive: false });
let ltX = 0, ltY = 0;
canvas.addEventListener('touchstart', e => { ltX = e.touches[0].clientX; ltY = e.touches[0].clientY; });
canvas.addEventListener('touchmove', e => {
  rotY += (e.touches[0].clientX - ltX) * 0.01;
  rotX += (e.touches[0].clientY - ltY) * 0.01;
  ltX = e.touches[0].clientX; ltY = e.touches[0].clientY;
  e.preventDefault();
}, { passive: false });

function animate() {
  requestAnimationFrame(animate);
  badgeGroup.rotation.x = rotX;
  badgeGroup.rotation.y = rotY;
  camera.position.set(0, -80 * zoom, 160 * zoom);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}
animate();

// ── Camera helpers ─────────────────────────────────────────────
function resetView() { rotX = defRotX; rotY = defRotY; zoom = defZoom; syncSlidersFromView(); }
function toggleGrid() { grid.visible = !grid.visible; document.getElementById('toggleGridBtn').style.opacity = grid.visible ? '1' : '0.4'; }
function setBg(colour, el) { scene.background = new THREE.Color(colour); document.querySelectorAll('#viewportPanel [onclick^="setBg"]').forEach(e => e.style.border = '1px solid var(--border2)'); el.style.border = '2px solid var(--accent)'; localStorage.setItem('badge2_bgColour', colour); }
function toggleCamPanel(id) { const panels = ['camAnglePanel','camZoomPanel','viewportPanel']; panels.forEach(p => { if (p !== id) document.getElementById(p).style.display = 'none'; }); const el = document.getElementById(id); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
function applyCam() { rotX = parseFloat(document.getElementById('camRotX').value); rotY = parseFloat(document.getElementById('camRotY').value); zoom = parseFloat(document.getElementById('camZoom').value); }
function syncNum(sId, nId) { const v = parseFloat(document.getElementById(sId).value); const step = parseFloat(document.getElementById(sId).step || '0.01'); const dec = step.toString().includes('.') ? step.toString().split('.')[1].length : 2; document.getElementById(nId).value = v.toFixed(dec); }
function syncSlider(sId, nId) { const v = parseFloat(document.getElementById(nId).value); if (!isNaN(v)) document.getElementById(sId).value = v; }
function syncSlidersFromView() {
  const pairs = [['camRotX','camRotXN',rotX],['camRotY','camRotYN',rotY],['camZoom','camZoomN',zoom]];
  pairs.forEach(([sid,nid,val]) => { const s = document.getElementById(sid), n = document.getElementById(nid); if (s) s.value = val; if (n) n.value = val.toFixed(2); });
}
async function saveDefaultAngle() {
  defRotX = rotX; defRotY = rotY; defZoom = zoom;
  localStorage.setItem('badge2_defRotX', rotX); localStorage.setItem('badge2_defRotY', rotY); localStorage.setItem('badge2_defZoom', zoom);
  if (currentUser && currentModel) await sbUpsert('badge_user_preferences', { user_id: currentUser.id, model_id: currentModel.id, def_rot_x: rotX, def_rot_y: rotY, def_zoom: zoom, zoom_speed: scrollZoomSpeed, updated_at: new Date().toISOString() });
  const btn = event.currentTarget; const orig = btn.innerHTML; btn.innerHTML = '✓ Saved!'; setTimeout(() => btn.innerHTML = orig, 1500);
}
function saveZoomSpeed() {
  scrollZoomSpeed = parseFloat(document.getElementById('zoomSpd').value) || 0.01;
  syncNum('zoomSpd', 'zoomSpdN');
  if (currentUser && currentModel) sbUpsert('badge_user_preferences', { user_id: currentUser.id, model_id: currentModel.id, def_rot_x: defRotX, def_rot_y: defRotY, def_zoom: defZoom, zoom_speed: scrollZoomSpeed, updated_at: new Date().toISOString() });
}

document.addEventListener('click', e => {
  ['camAnglePanel','camZoomPanel','viewportPanel'].forEach(id => {
    const p = document.getElementById(id);
    if (p && p.style.display !== 'none' && !e.target.closest('#'+id) && !e.target.closest('.preview-controls')) p.style.display = 'none';
  });
  if (typeof openPickerId !== 'undefined' && openPickerId !== null && !e.target.closest('.colour-picker-wrap')) {
    const el = document.getElementById('cplist-' + openPickerId); if (el) el.style.display = 'none'; openPickerId = null;
  }
  if (typeof openCombo !== 'undefined' && openCombo && !e.target.closest('#cpwCombo')) {
    const el = document.getElementById('comboList'); if (el) el.style.display = 'none'; openCombo = false;
  }
});

// ── Constants ──────────────────────────────────────────────────
const FONT_SIZE_MM = 49;
const HOLE_W       = 46;
const HOLE_H       = 14;
const SCALE        = 1000;
const FONT_PATH    = 'LEGO.TTF';

let font = null, timer = null;

function scheduleRender() { clearTimeout(timer); timer = setTimeout(buildBadge, 300); }

// ── Build badge ────────────────────────────────────────────────
function buildBadge() {
  if (!font || !layerConfig.length) return;
  const text = (document.getElementById('nameInput').value || 'NAME').toUpperCase();
  const fsize = parseFloat(document.getElementById('fontSize')?.value) || FONT_SIZE_MM;
  const spacing = parseFloat(document.getElementById('letterSpacing')?.value) || 0;
  const opts = spacing ? { letterSpacing: spacing / fsize } : {};

  badgeGroup.children.filter(c => c !== grid).forEach(c => badgeGroup.remove(c));

  const polys = commandsToClipper(font.getPath(text, 0, 0, fsize, opts).commands);
  if (!polys.length) return;

  const unioned = clipperUnion(polys);
  const { offX, offY } = bboxCentre(unioned);

  let z = 0;
  for (let i = 0; i < layerConfig.length; i++) {
    const layer  = layerConfig[i];
    const colour = parseInt(layer.hex.replace('#', ''), 16);

    if (layer.isText) {
      addTextLayer(font.getPath(text, 0, 0, fsize, opts).commands, offX, offY, colour, layer.depth, z);
      z += layer.depth;
    } else if (layer.hasSlot) {
      const slotD = getBackingConfig()?.d ?? 2;
      addLayer(unioned, layer.border, offX, offY, colour, slotD, z, true);
      addLayer(unioned, layer.border, offX, offY, colour, layer.depth, z + slotD, false);
      z += slotD + layer.depth;
    } else {
      addLayer(unioned, layer.border, offX, offY, colour, layer.depth, z, false);
      z += layer.depth;
    }
  }
}

// ── Backing ────────────────────────────────────────────────────
function getBackingConfig() {
  const val = document.getElementById('backingSelect')?.value || 'Magnet';
  if (val === 'Pin')    return { w: 32, h: 7,  d: 2, name: 'pin' };
  if (val === 'Magnet') return { w: 46, h: 14, d: 2, name: 'magnet' };
  return null;
}
function makeCutoutGeo(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -d / 2));
  return geo;
}

// ── Layer builders ─────────────────────────────────────────────
function addTextLayer(cmds, offX, offY, colour, depth, zPos) {
  const shapePath = new THREE.ShapePath();
  for (const c of cmds) {
    if      (c.type === 'M') { shapePath.moveTo(c.x - offX, offY - c.y); }
    else if (c.type === 'L') { shapePath.lineTo(c.x - offX, offY - c.y); }
    else if (c.type === 'C') { shapePath.bezierCurveTo(c.x1-offX, offY-c.y1, c.x2-offX, offY-c.y2, c.x-offX, offY-c.y); }
    else if (c.type === 'Q') { shapePath.quadraticCurveTo(c.x1-offX, offY-c.y1, c.x-offX, offY-c.y); }
    else if (c.type === 'Z') { shapePath.currentPath.closePath(); }
  }
  const shapes = shapePath.toShapes(false);
  const geo  = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
  const mat  = new THREE.MeshPhongMaterial({ color: colour, shininess: 40 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = zPos;
  badgeGroup.add(mesh);
}

function addStrokeLayer(polys, strokeMM, offX, offY, colour, zPos) {
  const unioned  = clipperUnion(polys);
  const expanded = clipperOffset(unioned, strokeMM);
  const expOuters = [], expHoles = [];
  for (const p of expanded) {
    (ClipperLib.Clipper.Orientation(p) ? expOuters : expHoles).push(p);
  }
  const letterOuters = unioned.filter(p => ClipperLib.Clipper.Orientation(p));
  const toVec2 = p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY));
  const shapes = expOuters.map(outer => {
    const shape = new THREE.Shape(outer.map(toVec2));
    for (const h of expHoles)     shape.holes.push(new THREE.Path(h.map(toVec2)));
    for (const h of letterOuters) shape.holes.push(new THREE.Path([...h].reverse().map(toVec2)));
    return shape;
  });
  const geo  = new THREE.ShapeGeometry(shapes);
  const mat  = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = zPos;
  badgeGroup.add(mesh);
}

function addLayer(filledBase, borderMM, offX, offY, colour, depth, zPos, includeSlot) {
  const working = borderMM > 0 ? clipperOffset(filledBase, borderMM) : filledBase;
  const outers = [];
  for (const path of working) {
    if (ClipperLib.Clipper.Orientation(path)) outers.push(path);
  }
  const backing = getBackingConfig();
  const hw = (backing?.w ?? HOLE_W) / 2, hh = (backing?.h ?? HOLE_H) / 2;
  const shapes = outers.map(outer => {
    const shape = new THREE.Shape(
      outer.map(p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY)))
    );
    if (includeSlot) {
      const slot = new THREE.Path();
      slot.moveTo(-hw, -hh); slot.lineTo(hw, -hh);
      slot.lineTo(hw,   hh); slot.lineTo(-hw, hh);
      slot.closePath();
      shape.holes.push(slot);
    }
    return shape;
  });
  const geo  = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
  const mat  = new THREE.MeshPhongMaterial({ color: colour, shininess: 40 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = zPos;
  badgeGroup.add(mesh);
}

// ── Clipper helpers ────────────────────────────────────────────
function clipperOffset(paths, deltaMM) {
  const co = new ClipperLib.ClipperOffset();
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const result = new ClipperLib.Paths();
  co.Execute(result, deltaMM * SCALE);
  return result;
}
function clipperUnion(polys) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(polys, ClipperLib.PolyType.ptSubject, true);
  const result = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, result,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return result;
}
function bboxCentre(paths) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const pt of path) {
      if (pt.X < minX) minX = pt.X; if (pt.X > maxX) maxX = pt.X;
      if (pt.Y < minY) minY = pt.Y; if (pt.Y > maxY) maxY = pt.Y;
    }
  }
  return { offX: (minX + maxX) / 2 / SCALE, offY: (minY + maxY) / 2 / SCALE };
}
function commandsToClipper(cmds) {
  const polys = [];
  let cur = null, lx = 0, ly = 0;
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur?.length > 2) polys.push(cur);
      cur = [{ X: Math.round(c.x * SCALE), Y: Math.round(c.y * SCALE) }];
      lx = c.x; ly = c.y;
    } else if (c.type === 'L') {
      cur?.push({ X: Math.round(c.x * SCALE), Y: Math.round(c.y * SCALE) });
      lx = c.x; ly = c.y;
    } else if (c.type === 'C') {
      for (let t = 0.1; t <= 1.001; t += 0.1) {
        const u = 1 - t;
        cur?.push({
          X: Math.round((u*u*u*lx + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x) * SCALE),
          Y: Math.round((u*u*u*ly + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y) * SCALE),
        });
      }
      lx = c.x; ly = c.y;
    } else if (c.type === 'Q') {
      for (let t = 0.1; t <= 1.001; t += 0.1) {
        const u = 1 - t;
        cur?.push({
          X: Math.round((u*u*lx + 2*u*t*c.x1 + t*t*c.x) * SCALE),
          Y: Math.round((u*u*ly + 2*u*t*c.y1 + t*t*c.y) * SCALE),
        });
      }
      lx = c.x; ly = c.y;
    } else if (c.type === 'Z') {
      if (cur?.length > 2) polys.push(cur);
      cur = null;
    }
  }
  if (cur?.length > 2) polys.push(cur);
  return polys;
}

// ── Geometry helpers ───────────────────────────────────────────
// Weld coincident vertices — used for text layer (Three.js ExtrudeGeometry)
function mergeVerticesForExport(geo) {
  const nonIdx = geo.toNonIndexed();
  const pos = nonIdx.attributes.position;
  const map = new Map();
  const newPos = [], newIdx = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x*1e4)},${Math.round(y*1e4)},${Math.round(z*1e4)}`;
    if (!map.has(key)) { map.set(key, newPos.length / 3); newPos.push(x, y, z); }
    newIdx.push(map.get(key));
  }
  const filteredIdx = [];
  for (let i = 0; i < newIdx.length; i += 3) {
    if (newIdx[i] !== newIdx[i+1] && newIdx[i+1] !== newIdx[i+2] && newIdx[i] !== newIdx[i+2])
      filteredIdx.push(newIdx[i], newIdx[i+1], newIdx[i+2]);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(filteredIdx), 1));
  return result;
}

// Build a guaranteed-manifold extrusion directly from Clipper outer polygons.
// Outer polygon orientation from Clipper (Orientation===true) maps to CCW in
// Three.js space after the y-flip, so winding here matches Three.js front-face rules.
function buildSolidExtrusionMesh(clipperOuters, depth, offX, offY) {
  const positions = [], indices = [];
  for (const outer of clipperOuters) {
    if (!ClipperLib.Clipper.Orientation(outer)) continue;
    const n = outer.length;
    if (n < 3) continue;
    const base = positions.length / 3;
    const pts = outer.map(p => [p.X / SCALE - offX, offY - p.Y / SCALE]);
    for (const [x, y] of pts) positions.push(x, y, 0);       // bottom ring
    for (const [x, y] of pts) positions.push(x, y, depth);   // top ring
    // Side faces — each edge produces 2 triangles with outward normals
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const b0 = base+i, b1 = base+j, t0 = base+n+i, t1 = base+n+j;
      indices.push(b0, b1, t0,  b1, t1, t0);
    }
    // Caps via earcut
    const v2 = pts.map(([x, y]) => new THREE.Vector2(x, y));
    const cap = THREE.ShapeUtils.triangulateShape(v2, []);
    for (const [a, b, c] of cap) {
      indices.push(base+n+a, base+n+b, base+n+c);  // top cap (CCW from +z)
      indices.push(base+a,   base+c,   base+b);    // bottom cap (reversed)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  return geo;
}

// ── 3MF Export ─────────────────────────────────────────────────
function exportTMF() {
  if (!font || !layerConfig.length) return;
  const name = (document.getElementById('nameInput').value || 'NAME').toUpperCase();
  const fsize = parseFloat(document.getElementById('fontSize')?.value) || FONT_SIZE_MM;
  const spacing = parseFloat(document.getElementById('letterSpacing')?.value) || 0;
  const opts = spacing ? { letterSpacing: spacing / fsize } : {};
  setStatus('Generating 3MF…');

  const polys = commandsToClipper(font.getPath(name, 0, 0, fsize, opts).commands);
  const unioned = clipperUnion(polys);
  const { offX, offY } = bboxCentre(unioned);

  let zOff = 0;
  const objects = [];
  const backing = getBackingConfig();

  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    let geo;
    const slotD = layer.hasSlot ? (backing?.d ?? 2) : 0;

    if (layer.isText) {
      const shapePath = new THREE.ShapePath();
      const cmds = font.getPath(name, 0, 0, fsize, opts).commands;
      for (const c of cmds) {
        if      (c.type === 'M') shapePath.moveTo(c.x - offX, offY - c.y);
        else if (c.type === 'L') shapePath.lineTo(c.x - offX, offY - c.y);
        else if (c.type === 'C') shapePath.bezierCurveTo(c.x1-offX, offY-c.y1, c.x2-offX, offY-c.y2, c.x-offX, offY-c.y);
        else if (c.type === 'Q') shapePath.quadraticCurveTo(c.x1-offX, offY-c.y1, c.x-offX, offY-c.y);
        else if (c.type === 'Z') shapePath.currentPath.closePath();
      }
      geo = new THREE.ExtrudeGeometry(shapePath.toShapes(false), { depth: layer.depth, bevelEnabled: false });
      geo = mergeVerticesForExport(geo);
    } else {
      const working = layer.border > 0 ? clipperOffset(unioned, layer.border) : unioned;
      const outers  = working.filter(p => ClipperLib.Clipper.Orientation(p));
      geo = buildSolidExtrusionMesh(outers, slotD + layer.depth, offX, offY);
    }

    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, zOff));
    objects.push({ geo, name: LAYER_NAMES[i] || `layer${i+1}`, colour: layer.hex, extruder: i+1, id: objects.length+1 });
    zOff += slotD + layer.depth;
  }

  if (backing && objects.length > 0) {
    let cutGeo = makeCutoutGeo(backing.w, backing.h, backing.d);
    cutGeo = mergeVerticesForExport(cutGeo);
    cutGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, backing.d));
    objects.push({ geo: cutGeo, name: `${backing.name}_cutout`, colour: '#000000', extruder: 1, id: objects.length+1, negative: true });
  }

  const tmfData = build3MF(objects, name);
  const zip = buildZip(tmfData);
  const prefix = (document.getElementById('filePrefix')?.value || '').trim();
  const suffix = (document.getElementById('fileSuffix')?.value || '').trim();
  const filename = [prefix, name, suffix].filter(Boolean).join(' ') + '.3mf';
  downloadBlob(zip, filename, 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
  setStatus(`Exported ${filename}`, 'ok');
}

function build3MF(objects, name) {
  let objXml = '', comps = '';
  objects.forEach(obj => {
    const pos = obj.geo.attributes.position, idx = obj.geo.index;
    let verts = '', tris = '';
    for (let i = 0; i < pos.count; i++) verts += `   <vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}"/>\n`;
    if (idx) { for (let i = 0; i < idx.count; i += 3) tris += `   <triangle v1="${idx.getX(i)}" v2="${idx.getX(i+1)}" v3="${idx.getX(i+2)}"/>\n`; }
    else     { for (let i = 0; i < pos.count; i += 3) tris += `   <triangle v1="${i}" v2="${i+1}" v3="${i+2}"/>\n`; }
    objXml += `  <object id="${obj.id}" type="${obj.negative ? 'other' : 'model'}" name="${obj.name}">\n   <mesh>\n    <vertices>\n${verts}    </vertices>\n    <triangles>\n${tris}    </triangles>\n   </mesh>\n  </object>\n`;
    comps  += `    <component objectid="${obj.id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n`;
  });
  const wId = objects.length + 1;
  objXml += `  <object id="${wId}" type="model" name="${name}">\n   <components>\n${comps}   </components>\n  </object>\n`;
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <resources>\n${objXml} </resources>\n <build>\n  <item objectid="${wId}"/>\n </build>\n</model>`;

  let parts = '';
  objects.forEach(obj => {
    parts += `    <part id="${obj.id}" subtype="${obj.negative ? 'negative_part' : 'normal_part'}">\n      <metadata key="name" value="${obj.name}"/>\n      <metadata key="extruder" value="${obj.extruder}"/>\n    </part>\n`;
  });
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="${wId}">\n    <metadata key="name" value="${name}"/>\n    <metadata key="extruder" value="1"/>\n${parts}  </object>\n</config>`;

  const filamentColours = objects.filter(o => !o.negative).map(o => o.colour);
  let projectSettings;
  if (projectSettingsTemplate) {
    const tmpl = JSON.parse(JSON.stringify(projectSettingsTemplate));
    tmpl.filament_colour = filamentColours;
    tmpl.filament_multi_colour = filamentColours;
    projectSettings = JSON.stringify(tmpl);
  } else {
    const n = filamentColours.length;
    projectSettings = JSON.stringify({ from:'project', name:'project_settings', version:'02.04.00.70', printer_model:'Bambu Lab H2C', printer_settings_id:'Bambu Lab H2C 0.4 nozzle', filament_colour:filamentColours, filament_multi_colour:filamentColours, filament_type:Array(n).fill('PLA'), filament_settings_id:Array(n).fill('Bambu PLA Basic @BBL H2C'), filament_vendor:Array(n).fill('Bambu Lab'), filament_is_support:Array(n).fill('0'), filament_ids:Array(n).fill('GFA00') });
  }
  return { modelXml, modelSettings, projectSettings };
}

function buildZip(data) {
  const { modelXml, modelSettings, projectSettings } = data;
  const enc = new TextEncoder();
  const files = [
    { name:'[Content_Types].xml', data:enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/></Types>`) },
    { name:'_rels/.rels', data:enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/model_settings.config" Id="rel1" Type="http://schemas.bambulab.com/package/2021/model-settings"/><Relationship Target="/Metadata/project_settings.config" Id="rel2" Type="http://schemas.bambulab.com/package/2021/project-settings"/></Relationships>`) },
    { name:'3D/3dmodel.model', data:enc.encode(modelXml) },
    { name:'Metadata/model_settings.config', data:enc.encode(modelSettings) },
    { name:'Metadata/project_settings.config', data:enc.encode(projectSettings) },
  ];
  const parts = [], cd = []; let off = 0;
  for (const f of files) {
    const nb = enc.encode(f.name), d = f.data, crc = crc32(d);
    const loc = new Uint8Array(30 + nb.length + d.length), dv = new DataView(loc.buffer);
    dv.setUint32(0,0x04034b50,true); dv.setUint16(4,20,true); dv.setUint16(6,0,true); dv.setUint16(8,0,true); dv.setUint16(10,0,true); dv.setUint16(12,0,true); dv.setUint32(14,crc,true); dv.setUint32(18,d.length,true); dv.setUint32(22,d.length,true); dv.setUint16(26,nb.length,true); dv.setUint16(28,0,true);
    loc.set(nb,30); loc.set(d,30+nb.length); parts.push(loc);
    const ce = new Uint8Array(46 + nb.length), cv = new DataView(ce.buffer);
    cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0,true); cv.setUint16(10,0,true); cv.setUint16(12,0,true); cv.setUint16(14,0,true); cv.setUint32(16,crc,true); cv.setUint32(20,d.length,true); cv.setUint32(24,d.length,true); cv.setUint16(28,nb.length,true); cv.setUint16(30,0,true); cv.setUint16(32,0,true); cv.setUint16(34,0,true); cv.setUint16(36,0,true); cv.setUint32(38,0,true); cv.setUint32(42,off,true);
    ce.set(nb,46); cd.push(ce); off += loc.length;
  }
  const cdSize = cd.reduce((s,c) => s+c.length, 0);
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true); ev.setUint16(4,0,true); ev.setUint16(6,0,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,cdSize,true); ev.setUint32(16,off,true); ev.setUint16(20,0,true);
  const all = [...parts,...cd,eocd]; const res = new Uint8Array(all.reduce((s,p) => s+p.length, 0)); let p = 0; for (const a of all) { res.set(a,p); p+=a.length; } return res;
}
function crc32(data) { let c=0xFFFFFFFF; for(let i=0;i<data.length;i++){c^=data[i];for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xEDB88320:0);} return(c^0xFFFFFFFF)>>>0; }
function downloadBlob(data,filename,type) { const b=new Blob([data],{type}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=filename; a.click(); URL.revokeObjectURL(u); }
