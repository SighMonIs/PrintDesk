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
const CUBE_PX = 104, CUBE_MARGIN = 12, CUBE_BOTTOM = 42;
const cubeScene = new THREE.Scene();
// Frustum just clears the cube's half-diagonal (√3 ≈ 1.732) so a corner-on
// view still fits, while keeping the cube big enough to click comfortably.
const CUBE_HALF = 1.78;
const cubeCam = new THREE.OrthographicCamera(-CUBE_HALF, CUBE_HALF, CUBE_HALF, -CUBE_HALF, 0.1, 100);
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

// Mesh and outline live in one group so they rotate together — rotating the
// mesh alone left the green edges stationary.
const cubeGroup = new THREE.Group();
const cubeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  CUBE_FACES.map(f => new THREE.MeshBasicMaterial({ map: faceTexture(f) }))
);
cubeGroup.add(cubeMesh);
cubeGroup.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 2.02, 2.02)),
  new THREE.LineBasicMaterial({ color: 0x3ecf8e })
));
cubeScene.add(cubeGroup);
cubeCam.position.copy(new THREE.Vector3(0, -80, 160).normalize().multiplyScalar(10));
cubeCam.lookAt(0, 0, 0);

function cubeViewportRect() {
  const w = pane.clientWidth, h = pane.clientHeight;
  return { x: CUBE_MARGIN, y: CUBE_BOTTOM, w: CUBE_PX, h: CUBE_PX, paneW: w, paneH: h };
}

function renderViewCube() {
  const r = cubeViewportRect();
  cubeGroup.rotation.set(rotX, rotY, 0);
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

// ── Preview rebuild ─────────────────────────────────────────────
let renderTimer = null;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(buildBadge, 150); }

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

// ── Print bed preview ────────────────────────────────────────────
// Printable X × Y in mm, then the dual-nozzle X range where fitted. On the
// H2C the plate is 330 wide but only x 25–325 is reachable by both nozzles —
// the 25mm strip on the left is left-nozzle-only, so nothing multi-colour
// can sit there. H2D/H2S have no range here: give me their numbers to add it.
const BAMBU_BEDS = {
  'A1 mini': [180, 180],
  'A1': [256, 256],
  'P1P': [256, 256],
  'P1S': [256, 256],
  'X1': [256, 256],
  'X1 Carbon': [256, 256],
  'X1E': [256, 256],
  'H2C': [330, 320, 25, 325],
  'H2D': [350, 320],
  'H2S': [350, 320],
};

// Placement while the bed modal is open — reset every time it opens.
let bedView = null;

// Same slabs the 3D preview and the 3MF export use, flattened to
// world-space outlines for a top-down view.
function bedFootprint() {
  const parts = [];
  for (const layer of layerConfig) {
    if (isCutter(layer) || layer.visible === false) continue;
    for (const slab of buildLayerSlabs(layer)) parts.push({ layer, slab });
  }
  parts.sort((a, b) => a.slab.zStart - b.slab.zStart); // paint bottom-up
  return parts.map(({ layer, slab }) => {
    const a = (layer.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const tf = p => ({ x: p.x * c - p.y * s + (layer.offsetX || 0), y: p.x * s + p.y * c + (layer.offsetY || 0) });
    return {
      hex: layer.hex || '#888888',
      rings: slab.result.shapes.map(sh => ({ outer: sh.getPoints(24).map(tf), holes: (sh.holes || []).map(h => h.getPoints(24).map(tf)) })),
    };
  });
}

// Footprint re-centred on its own origin, so placement is just x/y/rot.
function bedModel() {
  const parts = bedFootprint();
  const all = parts.flatMap(p => p.rings.flatMap(r => r.outer));
  if (!all.length) return { parts: [], w: 0, h: 0 };
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const shift = p => ({ x: p.x - cx, y: p.y - cy });
  return {
    parts: parts.map(p => ({ hex: p.hex, rings: p.rings.map(r => ({ outer: r.outer.map(shift), holes: r.holes.map(h => h.map(shift)) })) })),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function drawBedCanvas() {
  const v = bedView, cv = document.getElementById('bedCanvas');
  if (!v || !cv) return;
  const [bw, bh] = BAMBU_BEDS[v.printer] || BAMBU_BEDS['A1'];
  const ctx = cv.getContext('2d');
  const pad = 24;
  const s = Math.min((cv.width - pad * 2) / bw, (cv.height - pad * 2) / bh);
  const ox = (cv.width - bw * s) / 2, oy = (cv.height - bh * s) / 2;
  // mm <-> canvas pixels (canvas Y is flipped)
  v.toPx = p => ({ x: ox + p.x * s, y: oy + bh * s - p.y * s });
  v.toMm = p => ({ x: (p.x - ox) / s, y: (oy + bh * s - p.y) / s });

  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(ox, oy, bw * s, bh * s);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  for (let x = 50; x < bw; x += 50) { ctx.beginPath(); ctx.moveTo(ox + x * s, oy); ctx.lineTo(ox + x * s, oy + bh * s); ctx.stroke(); }
  for (let y = 50; y < bh; y += 50) { ctx.beginPath(); ctx.moveTo(ox, oy + y * s); ctx.lineTo(ox + bw * s, oy + y * s); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(ox, oy, bw * s, bh * s);

  // The canvas is drawn at 900px but displayed ~1/3 that, so anything meant to
  // be a fixed on-screen size is scaled by canvas pixels per CSS pixel.
  v.hs = cv.width / (cv.getBoundingClientRect().width || cv.width);
  const hs = v.hs;

  const [, , dx0, dx1] = BAMBU_BEDS[v.printer] || [];
  const zoned = dx0 != null;
  if (zoned) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(ox, oy, dx0 * s, bh * s);
    ctx.fillRect(ox + dx1 * s, oy, (bw - dx1) * s, bh * s);
    ctx.setLineDash([8 * hs, 6 * hs]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5 * hs;
    for (const zx of [dx0, dx1]) { ctx.beginPath(); ctx.moveTo(ox + zx * s, oy); ctx.lineTo(ox + zx * s, oy + bh * s); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(ox + dx0 * s / 2, oy + bh * s / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${11 * hs}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Left nozzle only', 0, 0);
    ctx.restore();
  }

  const fit = document.getElementById('bedFit');
  if (!v.model.parts.length) { if (fit) fit.textContent = 'Nothing to place — add a layer first.'; return; }

  const { x, y, rot } = v.place, c = Math.cos(rot), sn = Math.sin(rot);
  const place = p => ({ x: p.x * c - p.y * sn + x, y: p.x * sn + p.y * c + y });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const part of v.model.parts) {
    ctx.fillStyle = part.hex;
    ctx.beginPath();
    for (const ring of part.rings) {
      for (const loop of [ring.outer, ...ring.holes]) {
        const isOuter = loop === ring.outer;
        loop.forEach((raw, i) => {
          const m = place(raw), p = v.toPx(m);
          if (isOuter) {
            minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x);
            minY = Math.min(minY, m.y); maxY = Math.max(maxY, m.y);
          }
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        });
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
  }

  const centre = v.toPx(v.place);
  v.knob = null;
  if (v.rotate) {
    const dx = Math.sin(rot), dy = -Math.cos(rot);
    // Keep the knob on the canvas: a big badge (or one near an edge) would
    // otherwise push it out of sight, with nothing left to drag.
    const edge = Math.min(
      dx > 0 ? (cv.width - centre.x) / dx : dx < 0 ? -centre.x / dx : Infinity,
      dy > 0 ? (cv.height - centre.y) / dy : dy < 0 ? -centre.y / dy : Infinity,
    ) - 22 * hs;
    const r = Math.max(34 * hs, Math.min(Math.hypot(v.model.w, v.model.h) / 2 * s + 30 * hs, edge));
    v.knob = { x: centre.x + dx * r, y: centre.y + dy * r };
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * hs;
    ctx.beginPath(); ctx.moveTo(centre.x, centre.y); ctx.lineTo(v.knob.x, v.knob.y); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(v.knob.x, v.knob.y, 14 * hs, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#18181b'; ctx.lineWidth = 2 * hs;   // curved arrow = spin me
    ctx.beginPath(); ctx.arc(v.knob.x, v.knob.y, 7 * hs, 0.9, 5.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(v.knob.x + 10 * hs, v.knob.y - 6 * hs);
    ctx.lineTo(v.knob.x + 2 * hs, v.knob.y - 6 * hs);
    ctx.lineTo(v.knob.x + 7 * hs, v.knob.y + 1 * hs);
    ctx.fill();
  }
  if (v.move) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(centre.x, centre.y, 14 * hs, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#18181b';
    for (let i = 0; i < 4; i++) {         // four arrowheads = drag me anywhere
      const a = i * Math.PI / 2, dx = Math.cos(a), dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(centre.x + dx * 10 * hs, centre.y + dy * 10 * hs);
      ctx.lineTo(centre.x + (dx * 4 - dy * 4) * hs, centre.y + (dy * 4 + dx * 4) * hs);
      ctx.lineTo(centre.x + (dx * 4 + dy * 4) * hs, centre.y + (dy * 4 - dx * 4) * hs);
      ctx.fill();
    }
  }

  const hint = document.getElementById('bedHint');
  if (hint) hint.textContent = v.move && v.rotate ? 'Drag the arrows to move, the knob to rotate.'
    : v.move ? 'Drag the arrows to move the badge.'
    : v.rotate ? 'Drag the knob to rotate the badge.' : '';

  const w = maxX - minX, h = maxY - minY;
  const onBed = minX >= 0 && minY >= 0 && maxX <= bw && maxY <= bh;
  // One extruder per layer, so anything past a single colour needs both nozzles.
  const multi = new Set(v.model.parts.map(p => p.hex)).size > 1;
  const zoneOk = !zoned || !multi || (minX >= dx0 && maxX <= dx1);
  if (fit) {
    let note = '';
    if (!onBed) note = w > bw || h > bh ? ' — too big for this printer' : ' — hanging off the bed';
    else if (!zoneOk) note = ' — in the left-nozzle-only strip, multi-colour needs the dashed area';
    fit.textContent = `Badge ${w.toFixed(1)} × ${h.toFixed(1)} mm on a ${bw} × ${bh} mm bed` + note;
    fit.style.color = note ? 'var(--red)' : 'var(--muted)';
  }
}

function openBedView() {
  const overlay = document.createElement('div');
  overlay.className = 'bm-modal-overlay';
  overlay.innerHTML = `<div class="bm-modal bm-modal-wide">
    <div class="adv-row"><label>Printer</label>
      <select class="adv-text-input" id="bedPrinter" style="width:150px">${Object.keys(BAMBU_BEDS).map(n => `<option>${esc(n)}</option>`).join('')}</select>
    </div>
    <div class="adv-row"><label>Move</label><input type="checkbox" id="bedMove" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"></div>
    <div class="adv-row"><label>Rotate</label><input type="checkbox" id="bedRotate" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"></div>
    <canvas id="bedCanvas" width="900" height="900"></canvas>
    <div class="bm-modal-msg" id="bedFit"></div>
    <div class="bm-modal-msg" id="bedHint" style="font-size:11px;color:var(--muted)"></div>
    <div class="bm-modal-btns"><button class="btn sm" id="bedClose">Close</button></div>
  </div>`;
  document.body.appendChild(overlay);

  const sel = overlay.querySelector('#bedPrinter');
  sel.value = localStorage.getItem('bmPrinter') || 'A1';
  if (!sel.value) sel.value = 'A1';
  const centreOnBed = () => {
    const [bw, bh, dx0, dx1] = BAMBU_BEDS[sel.value] || BAMBU_BEDS['A1'];
    bedView.place = { x: dx0 != null ? (dx0 + dx1) / 2 : bw / 2, y: bh / 2, rot: 0 };
  };
  bedView = { printer: sel.value, model: bedModel(), move: false, rotate: false, place: null };
  centreOnBed();

  const cv = overlay.querySelector('#bedCanvas');
  const at = e => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
  };
  const near = (p, q, r) => !!q && Math.hypot(p.x - q.x, p.y - q.y) < r;
  let drag = null;
  cv.onmousedown = e => {
    const p = at(e);
    if (bedView.rotate && near(p, bedView.knob, 20 * bedView.hs)) drag = 'rot';
    else if (bedView.move && near(p, bedView.toPx(bedView.place), 20 * bedView.hs)) drag = 'move';
    if (drag) e.preventDefault();
  };
  const onMove = e => {
    if (!bedView) return;
    const p = at(e);
    if (!drag) {
      const hot = (bedView.rotate && near(p, bedView.knob, 20 * bedView.hs)) || (bedView.move && near(p, bedView.toPx(bedView.place), 20 * bedView.hs));
      cv.style.cursor = hot ? 'grab' : 'default';
      return;
    }
    const m = bedView.toMm(p);
    if (drag === 'move') { bedView.place.x = m.x; bedView.place.y = m.y; }
    else bedView.place.rot = Math.atan2(m.y - bedView.place.y, m.x - bedView.place.x) - Math.PI / 2;
    drawBedCanvas();
  };
  const onUp = () => { drag = null; };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  const close = () => {
    overlay.remove(); bedView = null;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  sel.onchange = () => {
    localStorage.setItem('bmPrinter', sel.value);
    bedView.printer = sel.value; centreOnBed(); drawBedCanvas();
  };
  overlay.querySelector('#bedMove').onchange = e => { bedView.move = e.target.checked; drawBedCanvas(); };
  overlay.querySelector('#bedRotate').onchange = e => { bedView.rotate = e.target.checked; drawBedCanvas(); };
  overlay.querySelector('#bedClose').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  drawBedCanvas();
  // Handle sizes need the canvas's laid-out width, which isn't there yet on
  // the frame the modal is inserted.
  requestAnimationFrame(() => drawBedCanvas());
}
