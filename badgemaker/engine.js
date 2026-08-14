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

// Viewport prefs (grid on/off, background colour) persist per browser.
const LS_BG = 'badgemaker_bgColour', LS_GRID = 'badgemaker_gridVisible';
const savedBg = parseInt(localStorage.getItem(LS_BG) ?? '0x18181b');

const scene = new THREE.Scene();
scene.background = new THREE.Color(isNaN(savedBg) ? 0x18181b : savedBg);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(50, -50, 100); scene.add(dl);
const fl = new THREE.DirectionalLight(0xffffff, 0.3); fl.position.set(-50, 50, 50);  scene.add(fl);

const grid = new THREE.GridHelper(300, 30, 0x333337, 0x222225);
grid.visible = localStorage.getItem(LS_GRID) !== '0';
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
  // View cube first — it sits over the canvas and shouldn't start an orbit.
  const cubeDir = cubeHitDirection(e);
  if (cubeDir) { orientTo(cubeDir); return; }
  const axis = getHandleAxisAtEvent(e);
  if (axis) { startAxisDrag(axis, e); return; }
  isDragging = true; lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('mousemove', e => {
  if (isDragging || dragAxis) return;
  canvas.style.cursor = cubeHitDirection(e) ? 'pointer' : '';
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

function updateHandlePosition() {
  if (!freeMoveHandles || !freeMoveLayer) return;
  freeMoveHandles.position.set(freeMoveLayer.offsetX || 0, freeMoveLayer.offsetY || 0, freeMoveLayer.offsetZ || 0);
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
  renderViewCube();
}
// animate() is started after the view-cube setup below, since it renders it.

// ── View cube (Bambu-style orientation gizmo) ──────────────────
// Drawn as a second viewport over the main render, bottom-left, above the
// "Drag to rotate" pill. Click a face, edge or corner to snap the view.
const CUBE_PX = 88, CUBE_MARGIN = 12, CUBE_BOTTOM = 42;
const cubeScene = new THREE.Scene();
const cubeCam = new THREE.OrthographicCamera(-1.9, 1.9, 1.9, -1.9, 0.1, 100);
const CUBE_FACES = ['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']; // +x,-x,+y,-y,+z,-z

function faceTexture(label) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#3ecf8e'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 124);
  g.fillStyle = '#ededed'; g.font = '600 20px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label.toUpperCase(), 64, 64);
  return new THREE.CanvasTexture(c);
}

const cubeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  CUBE_FACES.map(f => new THREE.MeshBasicMaterial({ map: faceTexture(f) }))
);
cubeScene.add(cubeMesh);
cubeScene.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 2.02, 2.02)),
  new THREE.LineBasicMaterial({ color: 0x3ecf8e })
));
cubeCam.position.copy(new THREE.Vector3(0, -80, 160).normalize().multiplyScalar(10));
cubeCam.lookAt(0, 0, 0);

function cubeViewportRect() {
  const w = pane.clientWidth, h = pane.clientHeight;
  return { x: CUBE_MARGIN, y: CUBE_BOTTOM, w: CUBE_PX, h: CUBE_PX, paneW: w, paneH: h };
}

function renderViewCube() {
  const r = cubeViewportRect();
  cubeMesh.rotation.set(rotX, rotY, 0);
  renderer.clearDepth();
  renderer.setViewport(r.x, r.y, r.w, r.h);
  renderer.setScissor(r.x, r.y, r.w, r.h);
  renderer.setScissorTest(true);
  renderer.render(cubeScene, cubeCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, r.paneW, r.paneH);
}

// Pointer → cube hit, returning the local direction of the clicked
// face/edge/corner (1, 2 or 3 axes at their extreme).
const cubeRaycaster = new THREE.Raycaster();
function cubeHitDirection(e) {
  const r = cubeViewportRect();
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const vx = px - r.x, vy = py - (r.paneH - r.y - r.h);
  if (vx < 0 || vy < 0 || vx > r.w || vy > r.h) return null;
  cubeRaycaster.setFromCamera(new THREE.Vector2((vx / r.w) * 2 - 1, -(vy / r.h) * 2 + 1), cubeCam);
  const hit = cubeRaycaster.intersectObject(cubeMesh, false)[0];
  if (!hit) return null;
  const p = cubeMesh.worldToLocal(hit.point.clone());
  // Half-size is 1, so this leaves the middle 75% of each face as a face
  // click and the outer band as edges/corners. Looser than this and edges
  // swallow the face.
  const EDGE_BAND = 0.75;
  const dir = new THREE.Vector3(
    Math.abs(p.x) > EDGE_BAND ? Math.sign(p.x) : 0,
    Math.abs(p.y) > EDGE_BAND ? Math.sign(p.y) : 0,
    Math.abs(p.z) > EDGE_BAND ? Math.sign(p.z) : 0,
  );
  return dir.lengthSq() ? dir.normalize() : null;
}

// Solve Rx(a)·Ry(b)·v = cameraDir. Ry zeroes v's x-component, then Rx
// rotates the remaining (y,z) pair onto the camera's.
function orientTo(v) {
  const c = new THREE.Vector3(0, -80, 160).normalize();
  const b = Math.atan2(-v.x, v.z);
  const q = -v.x * Math.sin(b) + v.z * Math.cos(b);
  const a = Math.atan2(c.z, c.y) - Math.atan2(q, v.y);
  rotX = Math.atan2(Math.sin(a), Math.cos(a));   // normalise to (-π, π]
  rotY = b;
  syncSlidersFromView();
}

animate();   // safe now that the view cube's constants exist

function resetView() { rotX = -0.4; rotY = 0.2; zoom = 1; syncSlidersFromView(); }
function toggleGrid() {
  grid.visible = !grid.visible;
  localStorage.setItem(LS_GRID, grid.visible ? '1' : '0');
  syncGridBtn();
}
function syncGridBtn() {
  const btn = document.getElementById('toggleGridBtn');
  if (btn) btn.style.opacity = grid.visible ? '1' : '0.4';
}
function setBg(colour, el) {
  scene.background = new THREE.Color(colour);
  localStorage.setItem(LS_BG, '0x' + colour.toString(16).padStart(6, '0'));
  syncBgSwatches();
}
// Highlight whichever swatch matches the current background (used on load too,
// since the saved colour may not be the first swatch).
function syncBgSwatches() {
  const current = scene.background.getHexString();
  document.querySelectorAll('#viewportPanel [onclick^="setBg"]').forEach(e => {
    const match = e.style.background && new THREE.Color(e.style.background).getHexString() === current;
    e.style.border = match ? '2px solid var(--accent)' : '1px solid var(--border2)';
  });
}
syncGridBtn();
syncBgSwatches();
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
  if (typeof onGlobalClickCloseModelMenu === 'function') onGlobalClickCloseModelMenu(e);
  if (typeof onGlobalClickCloseUserMenu === 'function') onGlobalClickCloseUserMenu(e);
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

// Keys are always strings: DB ids arrive as numbers from PostgREST but as
// strings from <select>.value, and a Map keyed by 3 won't match "3".
function fontKey(fontId) { return fontId == null || fontId === '' ? 'builtin' : String(fontId); }
function getCachedFont(fontId) { return fontCache.get(fontKey(fontId)) || null; }

function parseAndCacheFont(fontId, base64) {
  const font = opentype.parse(base64ToArrayBuffer(base64));
  fontCache.set(fontKey(fontId), font);
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
  // "Fit to shape": match the badge body's size, with Width/Height acting as
  // +/- adjustments rather than absolute values.
  let w, h;
  if (layer.fitToShape) {
    const b = modelBounds(layer);
    w = Math.max(0.1, b.width  + (layer.fontSize || 0));
    h = Math.max(0.1, b.height + (layer.height   || 0));
  } else {
    w = layer.fontSize || 20; h = layer.height || 20;
  }
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

// Backing presets carried over from the original badge generator
// (shared/render.js getBackingConfig): pin 32x7x2, magnet 46x14x2,
// round magnet ⌀17.15x2. Stored in shape_type; dimensions stay editable.
const BACKING_PRESETS = {
  magnet: { width: 46,    height: 14, depth: 2, round: false },
  pin:    { width: 32,    height: 7,  depth: 2, round: false },
  round:  { width: 17.15, height: 17.15, depth: 2, round: true  },
};

// Backings are cutouts, so they act exactly like negative layers.
function isCutter(layer) { return layer.negative || layer.type === 'backing'; }

// ── Keychain ring ──────────────────────────────────────────────
// The original generator auto-welded a D-ring to the badge's left/right
// edge. Here layers are freely positioned, so the ring is just a solid
// layer you place yourself; the "connector" is the flat tab that extends
// into the badge body so the slicer fuses them into one part.
// Field reuse (no extra columns): fontSize = hole ⌀, height = wall
// thickness, border = connector length, shapeType = connector direction.
const KEYCHAIN_SIDES = ['none', 'left', 'right', 'up', 'down'];

function circleToClipper(cx, cy, r, n = 64) {
  const path = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    path.push({ X: Math.round((cx + r * Math.cos(a)) * _BADGE_SCALE), Y: Math.round((cy + r * Math.sin(a)) * _BADGE_SCALE) });
  }
  return path;
}
function rectToClipper(x0, y0, x1, y1) {
  return [
    { X: Math.round(x0 * _BADGE_SCALE), Y: Math.round(y0 * _BADGE_SCALE) },
    { X: Math.round(x1 * _BADGE_SCALE), Y: Math.round(y0 * _BADGE_SCALE) },
    { X: Math.round(x1 * _BADGE_SCALE), Y: Math.round(y1 * _BADGE_SCALE) },
    { X: Math.round(x0 * _BADGE_SCALE), Y: Math.round(y1 * _BADGE_SCALE) },
  ];
}

function getKeychainShapes(layer) {
  const innerR = (layer.fontSize || 10) / 2;
  const wall   = layer.height || 2.5;
  const outerR = innerR + wall;
  const side   = KEYCHAIN_SIDES.includes(layer.shapeType) ? layer.shapeType : 'none';
  const conn   = Math.max(0, layer.border || 0);

  // Outer silhouette: ring disc, unioned with the connector tab if any.
  const outerPaths = [circleToClipper(0, 0, outerR)];
  if (side !== 'none' && conn > 0) {
    if (side === 'right')      outerPaths.push(rectToClipper(0, -outerR, outerR + conn, outerR));
    else if (side === 'left')  outerPaths.push(rectToClipper(-outerR - conn, -outerR, 0, outerR));
    else if (side === 'up')    outerPaths.push(rectToClipper(-outerR, 0, outerR, outerR + conn));
    else                       outerPaths.push(rectToClipper(-outerR, -outerR - conn, outerR, 0));
  }
  const unioned = _badgeClipperUnion(outerPaths);
  const outers = unioned.filter(p => ClipperLib.Clipper.Orientation(p));
  if (!outers.length) return null;

  const toVec2 = p => new THREE.Vector2(p.X / _BADGE_SCALE, p.Y / _BADGE_SCALE);
  const shapes = outers.map(o => new THREE.Shape(o.map(toVec2)));
  // Punch the ring hole into whichever outer contour contains it.
  const holePath = circleToClipper(0, 0, innerR);
  for (const s of shapes) {
    const outer = outers[shapes.indexOf(s)];
    if (pointInPolygon(holePath[0], outer)) s.holes.push(new THREE.Path(holePath.map(toVec2)));
  }
  const bb = _badgeBboxCentre(unioned);
  return { shapes, width: bb.width, height: bb.height };
}

function getLayerShapes(layer) {
  if (layer.type === 'keychain') return getKeychainShapes(layer);
  if (layer.type === 'backing') {
    const isRound = BACKING_PRESETS[layer.shapeType]?.round;
    return getShapeLayerShapes({ ...layer, shapeType: isRound ? 'circle' : 'rectangle' });
  }
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

// A negative layer cuts every solid layer it physically overlaps in Z.
function zRangesOverlap(a, b) {
  const az = a.offsetZ || 0, bz = b.offsetZ || 0;
  return az < bz + (b.depth || 1) && bz < az + (a.depth || 1);
}

// The cut is a 2D boolean, so a negative that's shallower than its target
// would otherwise punch straight through. Split the target into Z bands at
// each cutter's start/end and only subtract within the bands it actually
// spans — so a 2mm cutter leaves the bottom 1mm of a 3mm layer intact.
// Size of the badge body, used by "fit to shape" rectangles and by repeating
// backings. Keychain rings are excluded — they hang off the badge rather than
// being part of it — as are fit-to-shape layers themselves (they'd recurse).
// Measured once per render pass; buildLayerSlabs runs per layer.
let _layerDimsCache = null;
function invalidateModelWidth() { _layerDimsCache = null; }
function layerDims() {
  if (_layerDimsCache) return _layerDimsCache;
  const dims = new Map();
  for (const l of layerConfig) {
    if (isCutter(l) || l.visible === false) continue;
    if (l.type === 'keychain') continue;
    if (l.type === 'shape' && l.fitToShape) continue;
    const r = getLayerShapes(l);
    if (r) dims.set(l._key, { w: r.width, h: r.height });
  }
  return (_layerDimsCache = dims);
}
function modelBounds(exclude) {
  let width = 0, height = 0;
  for (const [key, d] of layerDims()) {
    if (exclude && key === exclude._key) continue;
    width = Math.max(width, d.w); height = Math.max(height, d.h);
  }
  return { width, height };
}
function modelWidth() { return modelBounds().width; }

// A round-magnet backing can auto-repeat across the badge, matching the
// original generator: one magnet per `repeatThreshold` mm of width, spread
// evenly. Returns the cutter expanded into its repeated copies.
function expandCutter(c) {
  const t = c.repeatThreshold || 0;
  if (!(c.type === 'backing' && c.shapeType === 'round' && t > 0)) return [c];
  const w = modelWidth();
  const n = Math.max(1, Math.ceil(w / t));
  if (n <= 1 || !w) return [c];
  const copies = [];
  for (let k = 1; k <= n; k++) {
    copies.push({ ...c, offsetX: (c.offsetX || 0) + w * (2 * k - 1 - n) / (2 * n) });
  }
  return copies;
}

function buildLayerSlabs(layer) {
  const base = getLayerShapes(layer);
  if (!base) return [];
  const z0 = layer.offsetZ || 0, z1 = z0 + (layer.depth || 1);
  // "Only apply to above layer" limits a negative to the nearest non-cutter
  // layer above it in the list, rather than everything it overlaps.
  const targetIdx = layerConfig.indexOf(layer);
  const appliesTo = c => {
    if (!c.negAboveOnly) return true;
    for (let j = layerConfig.indexOf(c) - 1; j >= 0; j--) {
      if (!isCutter(layerConfig[j])) return j === targetIdx;
    }
    return false;
  };
  const cutters = layerConfig
    .filter(c => isCutter(c) && c.visible !== false && zRangesOverlap(layer, c) && appliesTo(c))
    .flatMap(expandCutter);
  if (!cutters.length) return [{ zStart: z0, depth: z1 - z0, result: base }];

  const cuts = new Set([z0, z1]);
  for (const c of cutters) {
    const cz0 = c.offsetZ || 0, cz1 = cz0 + (c.depth || 1);
    if (cz0 > z0 && cz0 < z1) cuts.add(cz0);
    if (cz1 > z0 && cz1 < z1) cuts.add(cz1);
  }
  const bounds = [...cuts].sort((a, b) => a - b);

  const slabs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1], mid = (a + b) / 2;
    let result = base;
    for (const c of cutters) {
      if (!result) break;
      const cz0 = c.offsetZ || 0, cz1 = cz0 + (c.depth || 1);
      if (mid > cz0 && mid < cz1) result = applyNegative(layer, result, c);
    }
    if (result && result.shapes.length) slabs.push({ zStart: a, depth: b - a, result });
  }
  return slabs;
}

function buildBadge() {
  invalidateModelWidth();
  badgeGroup.children.filter(c => c !== grid && c !== freeMoveHandles).forEach(c => badgeGroup.remove(c));
  let maxW = 0, maxH = 0, minZ = Infinity, maxZ = -Infinity;
  // Every layer sits at its own Z — no auto-stacking, the user sets offsets.
  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    if (isCutter(layer) || layer.visible === false) continue;
    const mat = new THREE.MeshPhongMaterial({ color: parseInt((layer.hex || '#888888').replace('#',''), 16), shininess: 40 });
    for (const slab of buildLayerSlabs(layer)) {
      const geo = new THREE.ExtrudeGeometry(slab.result.shapes, { depth: slab.depth, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(layer.offsetX || 0, layer.offsetY || 0, slab.zStart);
      mesh.rotation.z = (layer.rotation || 0) * Math.PI / 180;
      badgeGroup.add(mesh);
      maxW = Math.max(maxW, slab.result.width); maxH = Math.max(maxH, slab.result.height);
      minZ = Math.min(minZ, slab.zStart); maxZ = Math.max(maxZ, slab.zStart + slab.depth);
    }
  }
  // Cutters render as nothing, so ghost the selected one to show where it sits.
  const sel = layerConfig[selectedLayerIndex];
  if (sel && isCutter(sel) && sel.visible !== false) {
    const ghost = getLayerShapes(sel);
    if (ghost && ghost.shapes.length) {
      // depthTest off so it shows through the badge body — a cutter usually
      // sits inside the solid layers it's cutting.
      const mat = new THREE.MeshPhongMaterial({
        color: 0xff5555, transparent: true, opacity: 0.35,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      });
      // Ghost every repeated copy, so auto-repeat is visible while editing.
      for (const copy of expandCutter(sel)) {
        const geo = new THREE.ExtrudeGeometry(ghost.shapes, { depth: sel.depth || 1, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(copy.offsetX || 0, copy.offsetY || 0, copy.offsetZ || 0);
        mesh.rotation.z = (sel.rotation || 0) * Math.PI / 180;
        mesh.renderOrder = 998;
        badgeGroup.add(mesh);
      }
    }
  }

  const sizeLabel = document.getElementById('badgeSizeLabel');
  if (sizeLabel) {
    const d = isFinite(minZ) ? maxZ - minZ : 0;
    sizeLabel.textContent = maxW ? `W ${maxW.toFixed(1)} × H ${maxH.toFixed(1)} × D ${d.toFixed(1)} mm` : '';
  }
  updateHandlePosition();
}

// ── 3MF export ───────────────────────────────────────────────────
function buildExportObjects() {
  invalidateModelWidth();
  const objects = [];
  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    if (isCutter(layer) || layer.visible === false) continue;
    // One 3MF object per Z band (see buildLayerSlabs) — same colour/extruder.
    const slabs = buildLayerSlabs(layer);
    slabs.forEach((slab, s) => {
      let geo = new THREE.ExtrudeGeometry(slab.result.shapes, { depth: slab.depth, bevelEnabled: false });
      geo.applyMatrix4(new THREE.Matrix4().makeRotationZ((layer.rotation || 0) * Math.PI / 180));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(layer.offsetX || 0, layer.offsetY || 0, slab.zStart));
      geo = _badgeMergeVerticesForExport(geo);
      const base = layerLabel(layer) || `layer${i+1}`;
      const label = slabs.length > 1 ? `${base}_${s+1}` : base;
      objects.push({ geo, name: label.slice(0, 30) || `layer${i+1}`, colour: layer.hex, extruder: i + 1, id: objects.length + 1 });
    });
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
