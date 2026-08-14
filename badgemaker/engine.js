// BadgeMak3r rendering + export engine.
// Reuses the pure-computation helpers from ../shared/3mf.js (_badge* functions) —
// does not touch shared/render.js, so the live badge/shop pages are unaffected.

let projectSettingsTemplate = null;
fetch('../badge/project_settings_template.json').then(r=>r.json()).then(t=>{projectSettingsTemplate=t;}).catch(()=>{});

// ── Three.js setup ─────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const pane   = document.getElementById('previewPane');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
} catch (e) {
  console.error('WebGL context creation failed:', e);
  pane.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:var(--muted,#999)">3D preview unavailable — your browser/GPU couldn\'t create a WebGL context.</div>');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x18181b);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(50, -50, 100); scene.add(dl);
const fl = new THREE.DirectionalLight(0xffffff, 0.3); fl.position.set(-50, 50, 50);  scene.add(fl);

const grid = new THREE.GridHelper(300, 30, 0x333337, 0x222225);
const badgeGroup = new THREE.Group();
scene.add(badgeGroup);
badgeGroup.add(grid);

function resize() {
  if (!renderer) return;
  const w = pane.clientWidth, h = pane.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

// ── Camera controls ────────────────────────────────────────────
let rotX = -0.4, rotY = 0.2, zoom = 1;
const scrollZoomSpeed = 0.01;

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
  if (!renderer) return;
  badgeGroup.rotation.x = rotX;
  badgeGroup.rotation.y = rotY;
  camera.position.set(0, -80 * zoom, 160 * zoom);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}
animate();

function resetView() { rotX = -0.4; rotY = 0.2; zoom = 1; syncSlidersFromView(); }
function toggleGrid() { grid.visible = !grid.visible; document.getElementById('toggleGridBtn').style.opacity = grid.visible ? '1' : '0.4'; }
function setBg(colour, el) { scene.background = new THREE.Color(colour); document.querySelectorAll('#viewportPanel [onclick^="setBg"]').forEach(e => e.style.border = '1px solid var(--border2)'); el.style.border = '2px solid var(--accent)'; }
function toggleCamPanel(id) { const panels = ['camAnglePanel','viewportPanel']; panels.forEach(p => { if (p !== id) document.getElementById(p).style.display = 'none'; }); const el = document.getElementById(id); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
function applyCam() { rotX = parseFloat(document.getElementById('camRotX').value); rotY = parseFloat(document.getElementById('camRotY').value); zoom = parseFloat(document.getElementById('camZoom').value); }
function syncNum(sId, nId) { const v = parseFloat(document.getElementById(sId).value); const step = parseFloat(document.getElementById(sId).step || '0.01'); const dec = step.toString().includes('.') ? step.toString().split('.')[1].length : 2; document.getElementById(nId).value = v.toFixed(dec); }
function syncSlider(sId, nId) { const v = parseFloat(document.getElementById(nId).value); if (!isNaN(v)) document.getElementById(sId).value = v; }
function syncSlidersFromView() {
  const pairs = [['camRotX','camRotXN',rotX],['camRotY','camRotYN',rotY],['camZoom','camZoomN',zoom]];
  pairs.forEach(([sid,nid,val]) => { const s = document.getElementById(sid), n = document.getElementById(nid); if (s) s.value = val; if (n) n.value = val.toFixed(2); });
}

document.addEventListener('click', e => {
  ['camAnglePanel','viewportPanel'].forEach(id => {
    const p = document.getElementById(id);
    if (p && p.style.display !== 'none' && !e.target.closest('#'+id) && !e.target.closest('.preview-controls')) p.style.display = 'none';
  });
  if (typeof onGlobalClickCloseColourPicker === 'function') onGlobalClickCloseColourPicker(e);
});

// ── Font loading/caching ───────────────────────────────────────
const fontCache = new Map(); // key ('builtin' or font.id) -> opentype Font
let builtinFontPromise = null;

function loadBuiltinFont() {
  if (fontCache.has('builtin')) return Promise.resolve(fontCache.get('builtin'));
  if (builtinFontPromise) return builtinFontPromise;
  builtinFontPromise = new Promise((resolve, reject) => {
    opentype.load('../badge/LEGO.TTF', (err, f) => {
      if (err) { reject(err); return; }
      fontCache.set('builtin', f);
      resolve(f);
    });
  });
  return builtinFontPromise;
}

function getCachedFont(fontId) { return fontCache.get(fontId || 'builtin') || null; }

function parseAndCacheFont(fontId, base64) {
  const font = opentype.parse(base64ToArrayBuffer(base64));
  fontCache.set(fontId, font);
  return font;
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function arrayBufferToBase64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ── Layer geometry ──────────────────────────────────────────────
// Text commands -> THREE shapes centred on the glyph bbox (so a layer with
// offsetX/Y/Z all at 0 sits centred at the badge origin, per-layer).
function cmdsToCenteredShapes(cmds) {
  const polys = _badgeCommandsToClipper(cmds);
  const unioned = _badgeClipperUnion(polys);
  if (!unioned.length) return null;
  const { offX, offY, width, height } = _badgeBboxCentre(unioned);
  const shapePath = new THREE.ShapePath();
  for (const c of cmds) {
    if      (c.type === 'M') shapePath.moveTo(c.x - offX, offY - c.y);
    else if (c.type === 'L') shapePath.lineTo(c.x - offX, offY - c.y);
    else if (c.type === 'C') shapePath.bezierCurveTo(c.x1-offX, offY-c.y1, c.x2-offX, offY-c.y2, c.x-offX, offY-c.y);
    else if (c.type === 'Q') shapePath.quadraticCurveTo(c.x1-offX, offY-c.y1, c.x-offX, offY-c.y);
    else if (c.type === 'Z') shapePath.currentPath.closePath();
  }
  return { shapes: shapePath.toShapes(false), unioned, offX, offY, width, height };
}

// Standard ray-casting point-in-polygon test (clipper coordinate space).
function pointInPolygon(pt, path) {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const xi = path[i].X, yi = path[i].Y, xj = path[j].X, yj = path[j].Y;
    const intersect = ((yi > pt.Y) !== (yj > pt.Y)) && (pt.X < (xj - xi) * (pt.Y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Stroke/border: offset the unioned glyph polygons outward and rebuild shapes,
// re-assigning each hole to whichever outer contour actually contains it so
// letter counters (O, A, B…) survive the offset.
function offsetPolysToShapes(unioned, borderMM, offX, offY) {
  const expanded = _badgeClipperOffset(unioned, borderMM);
  const outers = expanded.filter(p => ClipperLib.Clipper.Orientation(p));
  const holes  = expanded.filter(p => !ClipperLib.Clipper.Orientation(p));
  const toVec2 = p => new THREE.Vector2(p.X / _BADGE_SCALE - offX, offY - p.Y / _BADGE_SCALE);
  return outers.map(outer => {
    const shape = new THREE.Shape(outer.map(toVec2));
    for (const h of holes) {
      if (h.length && pointInPolygon(h[0], outer)) shape.holes.push(new THREE.Path(h.map(toVec2)));
    }
    return shape;
  });
}

function getLayerShapes(layer) {
  const font = layer.fontObj;
  const text = (layer.content || '').toUpperCase();
  if (!font || !text) return null;
  const cmds = _badgeGetTextCommands(font, text, layer.fontSize || 20, 0, 0);
  if (!cmds.length) return null;
  const centered = cmdsToCenteredShapes(cmds);
  if (!centered) return null;
  if (!layer.border) return { shapes: centered.shapes, width: centered.width, height: centered.height };
  const shapes = offsetPolysToShapes(centered.unioned, layer.border, centered.offX, centered.offY);
  if (!shapes.length) return null;
  return { shapes, width: centered.width + layer.border * 2, height: centered.height + layer.border * 2 };
}

// ── Preview rebuild ─────────────────────────────────────────────
let renderTimer = null;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(buildBadge, 150); }

function buildBadge() {
  badgeGroup.children.filter(c => c !== grid).forEach(c => badgeGroup.remove(c));
  let z = 0, maxW = 0, maxH = 0;
  for (const layer of layerConfig) {
    const depth = layer.depth || 1;
    const result = getLayerShapes(layer);
    if (result) {
      const geo = new THREE.ExtrudeGeometry(result.shapes, { depth, bevelEnabled: false });
      const mat = new THREE.MeshPhongMaterial({ color: parseInt((layer.hex || '#888888').replace('#',''), 16), shininess: 40 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(layer.offsetX || 0, layer.offsetY || 0, z + (layer.offsetZ || 0));
      mesh.rotation.z = (layer.rotation || 0) * Math.PI / 180;
      badgeGroup.add(mesh);
      maxW = Math.max(maxW, result.width); maxH = Math.max(maxH, result.height);
    }
    z += depth;
  }
  const sizeLabel = document.getElementById('badgeSizeLabel');
  if (sizeLabel) sizeLabel.textContent = maxW ? `${maxW.toFixed(1)} × ${maxH.toFixed(1)} mm` : '';
}

// ── 3MF export ───────────────────────────────────────────────────
function buildExportObjects() {
  const objects = [];
  let z = 0;
  layerConfig.forEach((layer, i) => {
    const depth = layer.depth || 1;
    const result = getLayerShapes(layer);
    if (result) {
      let geo = new THREE.ExtrudeGeometry(result.shapes, { depth, bevelEnabled: false });
      geo.applyMatrix4(new THREE.Matrix4().makeRotationZ((layer.rotation || 0) * Math.PI / 180));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(layer.offsetX || 0, layer.offsetY || 0, z + (layer.offsetZ || 0)));
      geo = _badgeMergeVerticesForExport(geo);
      objects.push({ geo, name: (layer.content || `layer${i+1}`).slice(0, 30) || `layer${i+1}`, colour: layer.hex, extruder: i + 1, id: objects.length + 1 });
    }
    z += depth;
  });
  return objects;
}

function exportBadge() {
  if (!layerConfig.length) { setStatus('No layers to export', 'err'); return; }
  const objects = buildExportObjects();
  if (!objects.length) { setStatus('Nothing to export — check text/fonts', 'err'); return; }
  const name = (currentModel?.name || 'badge').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'badge';
  const data = _badgeBuild3MF(objects, name, projectSettingsTemplate);
  const zip = _badgeBuildZip(data);
  const b = new Blob([zip], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
  const u = URL.createObjectURL(b); const a = document.createElement('a');
  a.href = u; a.download = name + '.3mf'; a.click(); URL.revokeObjectURL(u);
  setStatus(`Exported ${name}.3mf`, 'ok');
}
