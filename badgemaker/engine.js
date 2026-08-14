// BadgeMak3r rendering + export engine.
// Reuses the pure-computation helpers from ../shared/3mf.js (_badge* functions) —
// does not touch shared/render.js, so the live badge/shop pages are unaffected.

let projectSettingsTemplate = null;
fetch('../badge/project_settings_template.json').then(r=>r.json()).then(t=>{projectSettingsTemplate=t;}).catch(()=>{});

// ── Number field +/- spinners (ported from shared/render.js) ────
function stepInput(input, dir) {
  const step = parseFloat(input.step) || 1;
  const min  = input.min !== '' ? parseFloat(input.min) : -Infinity;
  const max  = input.max !== '' ? parseFloat(input.max) :  Infinity;
  const dec  = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
  const newVal = Math.min(max, Math.max(min, (parseFloat(input.value) || 0) + dir * step));
  input.value = newVal.toFixed(dec);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function wrapSpinners(container) {
  if (!container) return;
  container.querySelectorAll('input[type="number"]').forEach(input => {
    if (input.closest('.spin-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'spin-wrap';
    input.parentNode.insertBefore(wrap, input);
    const minus = document.createElement('button');
    minus.className = 'spin-btn'; minus.type = 'button'; minus.textContent = '−';
    minus.onclick = () => stepInput(input, -1);
    const plus = document.createElement('button');
    plus.className = 'spin-btn'; plus.type = 'button'; plus.textContent = '+';
    plus.onclick = () => stepInput(input, 1);
    wrap.appendChild(minus); wrap.appendChild(input); wrap.appendChild(plus);
  });
}

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
canvas.addEventListener('mousedown', e => {
  const axis = getHandleAxisAtEvent(e);
  if (axis) { startAxisDrag(axis, e); return; }
  isDragging = true; lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mouseup', () => { isDragging = false; dragAxis = null; });
window.addEventListener('mousemove', e => {
  if (dragAxis) { updateAxisDrag(e); return; }
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

// ── Free Move gizmo: draggable X/Y/Z handles for the selected layer ──
let freeMoveLayer = null, freeMoveHandles = null;
let dragAxis = null, dragPlane = null, dragAxisDir = null, dragStartHit = null, dragStartOffset = null;
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const AXIS_COLOURS = { x: 0xff4444, y: 0x44dd66, z: 0x4488ff };

function makeAxisHandle(axis) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: AXIS_COLOURS[axis], depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 8), mat);
  const head  = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 10), mat);
  shaft.position.y = 7; head.position.y = 16.5;
  group.add(shaft, head);
  if (axis === 'x') group.rotation.z = -Math.PI / 2;
  else if (axis === 'z') group.rotation.x = Math.PI / 2;
  group.renderOrder = 999;
  group.traverse(o => { if (o.isMesh) o.userData.axis = axis; });
  return group;
}

// Z-stack height of `layer` — mirrors buildBadge's accumulation (negative
// layers don't occupy their own slot) so the handles sit at the right height.
function computeLayerZ(layer) {
  let z = 0;
  for (const l of layerConfig) {
    if (l === layer) return z;
    if (!l.negative) z += (l.depth || 1);
  }
  return z;
}

function updateHandlePosition() {
  if (!freeMoveHandles || !freeMoveLayer) return;
  const z = computeLayerZ(freeMoveLayer);
  freeMoveHandles.position.set(freeMoveLayer.offsetX || 0, freeMoveLayer.offsetY || 0, z + (freeMoveLayer.offsetZ || 0));
}

function setFreeMoveLayer(layer) {
  if (freeMoveHandles) { badgeGroup.remove(freeMoveHandles); freeMoveHandles = null; }
  freeMoveLayer = layer || null;
  if (!freeMoveLayer) return;
  freeMoveHandles = new THREE.Group();
  freeMoveHandles.add(makeAxisHandle('x'), makeAxisHandle('y'), makeAxisHandle('z'));
  updateHandlePosition();
  badgeGroup.add(freeMoveHandles);
}

function getHandleAxisAtEvent(e) {
  if (!freeMoveHandles) return null;
  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(freeMoveHandles.children, true);
  return hits.length ? hits[0].object.userData.axis : null;
}

function raycastToDragPlane(e) {
  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const pt = new THREE.Vector3();
  return raycaster.ray.intersectPlane(dragPlane, pt) ? pt : null;
}

function startAxisDrag(axis, e) {
  dragAxis = axis;
  const origin = freeMoveHandles.getWorldPosition(new THREE.Vector3());
  const local = axis === 'x' ? new THREE.Vector3(1,0,0) : axis === 'y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
  dragAxisDir = local.applyQuaternion(badgeGroup.quaternion).normalize();
  const toCam = new THREE.Vector3().subVectors(camera.position, origin);
  let normal = new THREE.Vector3().crossVectors(dragAxisDir, toCam).cross(dragAxisDir);
  if (normal.lengthSq() < 1e-6) normal = new THREE.Vector3().crossVectors(dragAxisDir, camera.up).cross(dragAxisDir);
  normal.normalize();
  dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  dragStartOffset = { offsetX: freeMoveLayer.offsetX || 0, offsetY: freeMoveLayer.offsetY || 0, offsetZ: freeMoveLayer.offsetZ || 0 };
  dragStartHit = raycastToDragPlane(e);
}

function updateAxisDrag(e) {
  if (!dragStartHit) return;
  const hit = raycastToDragPlane(e);
  if (!hit) return;
  const dist = new THREE.Vector3().subVectors(hit, dragStartHit).dot(dragAxisDir);
  const field = dragAxis === 'x' ? 'offsetX' : dragAxis === 'y' ? 'offsetY' : 'offsetZ';
  freeMoveLayer[field] = Math.round((dragStartOffset[field] + dist) * 10) / 10;
  if (typeof onFreeMoveDrag === 'function') onFreeMoveDrag(freeMoveLayer);
  updateHandlePosition();
  buildBadge();
}

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
  if (typeof onGlobalClickCloseLayerMenu === 'function') onGlobalClickCloseLayerMenu(e);
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
function cmdsToCenteredShapes(cmds, fillGaps) {
  const polys = _badgeCommandsToClipper(cmds);
  const unioned = _badgeClipperUnion(polys);
  if (!unioned.length) return null;
  const { offX, offY, width, height } = _badgeBboxCentre(unioned);
  let shapes;
  if (fillGaps) {
    // Solid silhouette — letter counters (O, A, B…) filled in, same as the
    // non-text outline layers in the original badge tool.
    const outers = unioned.filter(p => ClipperLib.Clipper.Orientation(p));
    const toVec2 = p => new THREE.Vector2(p.X / _BADGE_SCALE - offX, offY - p.Y / _BADGE_SCALE);
    shapes = outers.map(outer => new THREE.Shape(outer.map(toVec2)));
  } else {
    const shapePath = new THREE.ShapePath();
    for (const c of cmds) {
      if      (c.type === 'M') shapePath.moveTo(c.x - offX, offY - c.y);
      else if (c.type === 'L') shapePath.lineTo(c.x - offX, offY - c.y);
      else if (c.type === 'C') shapePath.bezierCurveTo(c.x1-offX, offY-c.y1, c.x2-offX, offY-c.y2, c.x-offX, offY-c.y);
      else if (c.type === 'Q') shapePath.quadraticCurveTo(c.x1-offX, offY-c.y1, c.x-offX, offY-c.y);
      else if (c.type === 'Z') shapePath.currentPath.closePath();
    }
    shapes = shapePath.toShapes(false);
  }
  return { shapes, unioned, offX, offY, width, height };
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
function offsetPolysToShapes(unioned, borderMM, offX, offY, fillGaps) {
  const expanded = _badgeClipperOffset(unioned, borderMM);
  const outers = expanded.filter(p => ClipperLib.Clipper.Orientation(p));
  const holes  = fillGaps ? [] : expanded.filter(p => !ClipperLib.Clipper.Orientation(p));
  const toVec2 = p => new THREE.Vector2(p.X / _BADGE_SCALE - offX, offY - p.Y / _BADGE_SCALE);
  return outers.map(outer => {
    const shape = new THREE.Shape(outer.map(toVec2));
    for (const h of holes) {
      if (h.length && pointInPolygon(h[0], outer)) shape.holes.push(new THREE.Path(h.map(toVec2)));
    }
    return shape;
  });
}

// Rectangle/circle primitives — no font/clipper/stroke, just a plain centred shape.
function getShapeLayerShapes(layer) {
  const shape = new THREE.Shape();
  if (layer.shapeType === 'circle') {
    const r = (layer.fontSize || 20) / 2;
    shape.absarc(0, 0, r, 0, Math.PI * 2, false);
    return { shapes: [shape], width: r * 2, height: r * 2 };
  }
  const w = layer.fontSize || 20, h = layer.height || 20;
  const hw = w / 2, hh = h / 2;
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  return { shapes: [shape], width: w, height: h };
}

// A text layer either types its own literal content, or binds to one of the
// model's named Inputs (so several layers can share one typed-once value).
function resolveLayerText(layer) {
  if (layer.inputId != null) {
    const inp = inputs.find(x => x._key === layer.inputId);
    return inp ? (inp.defaultValue || '') : '';
  }
  return layer.content || '';
}

function getLayerShapes(layer) {
  if (layer.type === 'shape') return getShapeLayerShapes(layer);
  const font = layer.fontObj;
  const text = resolveLayerText(layer).toUpperCase();
  if (!font || !text) return null;
  const cmds = _badgeGetTextCommands(font, text, layer.fontSize || 20, 0, 0);
  if (!cmds.length) return null;
  const centered = cmdsToCenteredShapes(cmds, layer.fillGaps);
  if (!centered) return null;
  if (!layer.border) return { shapes: centered.shapes, width: centered.width, height: centered.height };
  const shapes = offsetPolysToShapes(centered.unioned, layer.border, centered.offX, centered.offY, layer.fillGaps);
  if (!shapes.length) return null;
  return { shapes, width: centered.width + layer.border * 2, height: centered.height + layer.border * 2 };
}

// ── Negative layers: 2D boolean-subtract from the layer above ──────
// Converts a THREE.Shape (with holes) to clipper paths, shifting by the
// given offset/rotation so two layers' shapes can be combined in one space.
function shapeToClipperPaths(shape, offsetX, offsetY, rotationRad) {
  const cos = Math.cos(rotationRad), sin = Math.sin(rotationRad);
  const xf = v => {
    const rx = v.x * cos - v.y * sin, ry = v.x * sin + v.y * cos;
    return { X: Math.round((rx + offsetX) * _BADGE_SCALE), Y: Math.round(-(ry + offsetY) * _BADGE_SCALE) };
  };
  const paths = [shape.getPoints(24).map(xf)];
  for (const h of shape.holes) paths.push(h.getPoints(24).map(xf));
  return paths;
}

function clipperDifferencePaths(subjectPaths, clipPaths) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const result = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctDifference, result, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return result;
}

function clipperPathsToShapes(paths) {
  const outers = paths.filter(p => ClipperLib.Clipper.Orientation(p));
  const holes  = paths.filter(p => !ClipperLib.Clipper.Orientation(p));
  const toVec2 = p => new THREE.Vector2(p.X / _BADGE_SCALE, -p.Y / _BADGE_SCALE);
  return outers.map(outer => {
    const shape = new THREE.Shape(outer.map(toVec2));
    for (const h of holes) if (h.length && pointInPolygon(h[0], outer)) shape.holes.push(new THREE.Path(h.map(toVec2)));
    return shape;
  });
}

// Subtracts `neg`'s shape from `target`'s shape, in target's own local space
// (so the caller can keep positioning/rotating the result using target's
// own offsetX/offsetY/rotation exactly as it would have without the cut).
function applyNegative(target, targetResult, neg) {
  const negResult = getLayerShapes(neg);
  if (!negResult) return targetResult;
  const relX = (neg.offsetX || 0) - (target.offsetX || 0);
  const relY = (neg.offsetY || 0) - (target.offsetY || 0);
  const relRot = ((neg.rotation || 0) - (target.rotation || 0)) * Math.PI / 180;
  const subjectPaths = targetResult.shapes.flatMap(s => shapeToClipperPaths(s, 0, 0, 0));
  const clipPaths = negResult.shapes.flatMap(s => shapeToClipperPaths(s, relX, relY, relRot));
  const diff = clipperDifferencePaths(subjectPaths, clipPaths);
  return { shapes: diff.length ? clipperPathsToShapes(diff) : [], width: targetResult.width, height: targetResult.height };
}

// ── Preview rebuild ─────────────────────────────────────────────
let renderTimer = null;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(buildBadge, 150); }

function buildBadge() {
  badgeGroup.children.filter(c => c !== grid && c !== freeMoveHandles).forEach(c => badgeGroup.remove(c));
  let z = 0, maxW = 0, maxH = 0;
  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    if (layer.negative || layer.visible === false) continue; // consumed/hidden — no z-slot of its own
    const depth = layer.depth || 1;
    let result = getLayerShapes(layer);
    for (let j = i + 1; result && j < layerConfig.length && layerConfig[j].negative; j++) {
      if (layerConfig[j].visible !== false) result = applyNegative(layer, result, layerConfig[j]);
    }
    if (result && result.shapes.length) {
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
  updateHandlePosition();
}

// ── 3MF export ───────────────────────────────────────────────────
function buildExportObjects() {
  const objects = [];
  let z = 0;
  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    if (layer.negative || layer.visible === false) continue;
    const depth = layer.depth || 1;
    let result = getLayerShapes(layer);
    for (let j = i + 1; result && j < layerConfig.length && layerConfig[j].negative; j++) {
      if (layerConfig[j].visible !== false) result = applyNegative(layer, result, layerConfig[j]);
    }
    if (result && result.shapes.length) {
      let geo = new THREE.ExtrudeGeometry(result.shapes, { depth, bevelEnabled: false });
      geo.applyMatrix4(new THREE.Matrix4().makeRotationZ((layer.rotation || 0) * Math.PI / 180));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(layer.offsetX || 0, layer.offsetY || 0, z + (layer.offsetZ || 0)));
      geo = _badgeMergeVerticesForExport(geo);
      const label = layer.type === 'text' ? (resolveLayerText(layer) || `layer${i+1}`) : (layer.shapeType === 'circle' ? 'Circle' : 'Rectangle');
      objects.push({ geo, name: label.slice(0, 30) || `layer${i+1}`, colour: layer.hex, extruder: i + 1, id: objects.length + 1 });
    }
    z += depth;
  }
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
