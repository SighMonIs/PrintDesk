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
      const bc = getBackingConfig();
      const slotD = bc?.type === 'keychain' ? 0 : (bc?.d ?? bc?.depth ?? 2);
      if (slotD > 0) addLayer(unioned, layer.border, offX, offY, colour, slotD, z, true);
      addLayer(unioned, layer.border, offX, offY, colour, layer.depth, z + slotD, false);
      z += slotD + layer.depth;
    } else {
      addLayer(unioned, layer.border, offX, offY, colour, layer.depth, z, false);
      z += layer.depth;
    }
  }

  // Keychain: red outline base spanning full z-height + torus loop on right side
  const _kbc = getBackingConfig();
  if (_kbc?.type === 'keychain' && layerConfig.length > 0) {
    const redLayer = layerConfig[0];
    const colour = parseInt(redLayer.hex.replace('#', ''), 16);
    const redPoly = clipperOffset(unioned, redLayer.border);
    const outers = redPoly.filter(p => ClipperLib.Clipper.Orientation(p));
    const shapes = outers.map(o => new THREE.Shape(o.map(p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY)))));
    const baseGeo = new THREE.ExtrudeGeometry(shapes, { depth: z, bevelEnabled: false });
    const mat = new THREE.MeshPhongMaterial({ color: colour, shininess: 40 });
    badgeGroup.add(new THREE.Mesh(baseGeo, mat));

    const { width: redW } = bboxCentre(redPoly);
    const rightEdge = redW / 2;
    const majorR = 9, tubeR = 1;
    const torusGeo = new THREE.TorusGeometry(majorR, tubeR, 16, 32);
    torusGeo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    torusGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(rightEdge + 1 + majorR, 0, z / 2));
    badgeGroup.add(new THREE.Mesh(torusGeo, new THREE.MeshPhongMaterial({ color: colour, shininess: 40 })));
  }
}

// ── Backing ────────────────────────────────────────────────────
function getBackingConfig() {
  const val = document.getElementById('backingSelect')?.value || 'Magnet';
  if (val === 'Pin')    return { w: 32, h: 7,  d: 2, name: 'pin' };
  if (val === 'Magnet') return { w: 46, h: 14, d: 2, name: 'magnet' };
  if (val === 'Keychain') return { type: 'keychain' };
  if (val === 'Round Magnet') {
    const diam      = parseFloat(document.getElementById('rndMagDiam')?.value      || localStorage.getItem('badge2_rndDiam')      || '17.15');
    const depth     = parseFloat(document.getElementById('rndMagDepth')?.value     || localStorage.getItem('badge2_rndDepth')     || '2');
    const threshold = parseFloat(document.getElementById('rndMagThreshold')?.value || localStorage.getItem('badge2_rndThreshold') || '60');
    return { type: 'round', diameter: diam, depth, threshold, name: 'round_magnet' };
  }
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
    if (includeSlot && backing?.type !== 'keychain') {
      if (backing?.type === 'round') {
        const r = (backing.diameter || 17.15) / 2;
        const bw = _badgeBboxCentre(filledBase).width || 0;
        const n = Math.max(1, Math.ceil(bw / (backing.threshold || 60)));
        for (let k = 1; k <= n; k++) {
          const cx = bw * (2*k - 1 - n) / (2*n);
          const hole = new THREE.Path();
          hole.absarc(cx, 0, r, 0, Math.PI * 2, false);
          shape.holes.push(hole);
        }
      } else {
        const slot = new THREE.Path();
        slot.moveTo(-hw, -hh); slot.lineTo(hw, -hh);
        slot.lineTo(hw,   hh); slot.lineTo(-hw, hh);
        slot.closePath();
        shape.holes.push(slot);
      }
    }
    return shape;
  });
  const geo  = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
  const mat  = new THREE.MeshPhongMaterial({ color: colour, shininess: 40 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = zPos;
  badgeGroup.add(mesh);
}

// ── Clipper helpers (thin wrappers — pure logic lives in 3mf.js) ─
const clipperOffset  = (paths, deltaMM) => _badgeClipperOffset(paths, deltaMM);
const clipperUnion   = (polys)          => _badgeClipperUnion(polys);
const bboxCentre     = (paths)          => _badgeBboxCentre(paths);
const commandsToClipper = (cmds)        => _badgeCommandsToClipper(cmds);

// ── 3MF Export ─────────────────────────────────────────────────
function buildBadgeExport() {
  if (!font || !layerConfig.length) return null;
  const name    = (document.getElementById('nameInput').value || 'NAME').toUpperCase();
  const fsize   = parseFloat(document.getElementById('fontSize')?.value) || FONT_SIZE_MM;
  const spacing = parseFloat(document.getElementById('letterSpacing')?.value) || 0;
  const backing = getBackingConfig();
  const keychain = backing?.type === 'keychain';
  setStatus('Generating 3MF…');
  return generate3MF({ name, layerConfig, backing: keychain ? null : backing, font, fsize, spacing, projectSettingsTemplate, keychain });
}

function exportTMF() {
  setStatus('Generating 3MF…');
  const result = buildBadgeExport();
  if (!result) return;
  const b = new Blob([result.zip], {type:'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'});
  const u = URL.createObjectURL(b); const a = document.createElement('a');
  a.href=u; a.download=result.filename; a.click(); URL.revokeObjectURL(u);
  setStatus(`Exported ${result.filename}`, 'ok');
}
