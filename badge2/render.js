// ── Three.js setup ────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const pane     = document.getElementById('previewPane');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x18181b);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(0, -80, 160);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(50, -50, 100); scene.add(dl);
const fl = new THREE.DirectionalLight(0xffffff, 0.3); fl.position.set(-50, 50, 50);  scene.add(fl);

const badgeGroup = new THREE.Group();
scene.add(badgeGroup);

function resize() {
  const w = pane.clientWidth, h = pane.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(pane);
resize();

// ── Camera controls ───────────────────────────────────────────
let rotX = -0.4, rotY = 0.2, zoom = 1;
let isDragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  rotY += (e.clientX - lastX) * 0.01;
  rotX += (e.clientY - lastY) * 0.01;
  rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', e => {
  zoom *= e.deltaY > 0 ? 1.05 : 0.95;
  zoom = Math.max(0.3, Math.min(4, zoom));
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

// ── Layer defaults ────────────────────────────────────────────
const defaultLayers = [
  { hex: '#ef4444', border: 6, depth: 3, hasSlot: true  },
  { hex: '#f4ee2a', border: 4, depth: 1, hasSlot: false },
  { hex: '#1a1a1a', border: 2, depth: 1, hasSlot: false },
];

// ── Layer UI ──────────────────────────────────────────────────
function buildLayerUI() {
  document.getElementById('layerList').innerHTML = defaultLayers.map((l, i) => `
    <div class="layer-item" data-index="${i}">
      <input type="color" class="layer-colour" value="${l.hex}" oninput="scheduleRender()">
      <div class="layer-fields">
        <div class="field-row">
          <label>Border</label>
          <input type="number" class="layer-border" value="${l.border}" min="0" max="30" step="0.5" oninput="scheduleRender()">
          <span>mm</span>
        </div>
        <div class="field-row">
          <label>Depth</label>
          <input type="number" class="layer-depth" value="${l.depth}" min="0.5" max="10" step="0.5" oninput="scheduleRender()">
          <span>mm</span>
        </div>
      </div>
    </div>
  `).join('');
}

function getLayerConfig() {
  return Array.from(document.querySelectorAll('.layer-item')).map((el, i) => ({
    hex:      el.querySelector('.layer-colour').value,
    border:   parseFloat(el.querySelector('.layer-border').value) || 0,
    depth:    parseFloat(el.querySelector('.layer-depth').value)  || 1,
    hasSlot:  i === 0,
  }));
}

// ── Constants ─────────────────────────────────────────────────
const FONT_SIZE_MM = 49;
const HOLE_W       = 46;
const HOLE_H       = 14;
const SCALE        = 1000;

let font = null, timer = null;

buildLayerUI();

opentype.load('LEGO.TTF', (err, f) => {
  if (err) { console.error('Font load failed:', err); return; }
  font = f;
  buildBadge();
});

function scheduleRender() { clearTimeout(timer); timer = setTimeout(buildBadge, 300); }

// ── Build ─────────────────────────────────────────────────────
function buildBadge() {
  if (!font) return;
  const text = (document.getElementById('nameInput').value || 'NAME').toUpperCase();

  while (badgeGroup.children.length) badgeGroup.remove(badgeGroup.children[0]);

  const polys = commandsToClipper(font.getPath(text, 0, 0, FONT_SIZE_MM).commands);
  if (!polys.length) return;

  const unioned = clipperUnion(polys);

  // Morphological close: expand far enough to bridge all inter-letter gaps,
  // then contract back to 0. Result is the letter shapes with gaps filled.
  const MERGE_MM   = FONT_SIZE_MM * 0.35; // ~17mm — safely larger than any gap
  const merged     = clipperOffset(unioned, MERGE_MM);
  const filledBase = clipperOffset(merged, -MERGE_MM);

  const { offX, offY } = bboxCentre(filledBase);

  let z = 0;
  for (const layer of getLayerConfig()) {
    const colour = parseInt(layer.hex.slice(1), 16);

    if (layer.hasSlot && layer.depth > 1) {
      addLayer(filledBase, layer.border, offX, offY, colour, layer.depth - 1, z, true);
      addLayer(filledBase, layer.border, offX, offY, colour, 1, z + layer.depth - 1, false);
    } else {
      addLayer(filledBase, layer.border, offX, offY, colour, layer.depth, z, layer.hasSlot);
    }

    z += layer.depth;
  }
}

// ── Layer builder ─────────────────────────────────────────────
function addLayer(filledBase, borderMM, offX, offY, colour, depth, zPos, includeSlot) {
  const working = borderMM > 0 ? clipperOffset(filledBase, borderMM) : filledBase;

  const outers = [], innerHoles = [];
  for (const path of working) {
    (ClipperLib.Clipper.Orientation(path) ? outers : innerHoles).push(path);
  }

  const hw = HOLE_W / 2, hh = HOLE_H / 2;

  const shapes = outers.map(outer => {
    const shape = new THREE.Shape(
      outer.map(p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY)))
    );
    for (const h of innerHoles) {
      shape.holes.push(new THREE.Path(
        h.map(p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY)))
      ));
    }
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

// ── Clipper helpers ───────────────────────────────────────────
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
