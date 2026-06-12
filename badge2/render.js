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

// ── Constants ─────────────────────────────────────────────────
const FONT_SIZE_MM  = 49;   // font rendered in mm
const EXTRUDE_DEPTH = 2;    // mm
const HOLE_W        = 46;   // magnet slot mm
const HOLE_H        = 14;
const SCALE         = 1000; // Clipper integer precision
const COLOUR        = 0xef4444;

let font = null, timer = null;

opentype.load('LEGO.TTF', (err, f) => {
  if (err) { console.error('Font load failed:', err); return; }
  font = f;
  buildBadge();
});

function scheduleRender() { clearTimeout(timer); timer = setTimeout(buildBadge, 300); }

// ── Build ─────────────────────────────────────────────────────
function buildBadge() {
  if (!font) return;
  const text     = (document.getElementById('nameInput').value || 'NAME').toUpperCase();
  const borderMM = parseFloat(document.getElementById('borderRange').value) || 0;

  while (badgeGroup.children.length) badgeGroup.remove(badgeGroup.children[0]);

  // 1. Opentype → Clipper polygons
  const polys = commandsToClipper(font.getPath(text, 0, 0, FONT_SIZE_MM).commands);
  if (!polys.length) return;

  // 2. Union all letter polygons
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(polys, ClipperLib.PolyType.ptSubject, true);
  const unioned = new ClipperLib.Paths();
  clipper.Execute(ClipperLib.ClipType.ctUnion, unioned,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  // 3. Offset by border (round joins)
  let working = unioned;
  if (borderMM > 0) {
    const co = new ClipperLib.ClipperOffset();
    co.AddPaths(unioned, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const expanded = new ClipperLib.Paths();
    co.Execute(expanded, borderMM * SCALE);
    working = expanded;
  }

  // 4. Bounding box → centre offset for Three.js
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const path of working) {
    for (const pt of path) {
      if (pt.X < minX) minX = pt.X; if (pt.X > maxX) maxX = pt.X;
      if (pt.Y < minY) minY = pt.Y; if (pt.Y > maxY) maxY = pt.Y;
    }
  }
  const offX = (minX + maxX) / 2 / SCALE;
  const offY = (minY + maxY) / 2 / SCALE;

  // 5. Split into outers and holes
  // Clipper Orientation=true → CW in screen → CCW in Three.js (Y flipped) → outer
  const outers = [], innerHoles = [];
  for (const path of working) {
    (ClipperLib.Clipper.Orientation(path) ? outers : innerHoles).push(path);
  }

  // 6. Magnet slot — centred at origin (same centre as the shape)
  const hw = HOLE_W / 2, hh = HOLE_H / 2;

  // 7. Build THREE.Shape per outer, add inner holes + magnet slot
  const shapes = outers.map(outer => {
    const shape = new THREE.Shape(
      outer.map(p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY)))
    );

    for (const h of innerHoles) {
      shape.holes.push(new THREE.Path(
        h.map(p => new THREE.Vector2(p.X / SCALE - offX, -(p.Y / SCALE - offY)))
      ));
    }

    const slot = new THREE.Path();
    slot.moveTo(-hw, -hh);
    slot.lineTo( hw, -hh);
    slot.lineTo( hw,  hh);
    slot.lineTo(-hw,  hh);
    slot.closePath();
    shape.holes.push(slot);

    return shape;
  });

  // 8. Extrude
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: EXTRUDE_DEPTH, bevelEnabled: false });
  const mat = new THREE.MeshPhongMaterial({ color: COLOUR, shininess: 40 });
  badgeGroup.add(new THREE.Mesh(geo, mat));
}

// ── Clipper helpers ───────────────────────────────────────────
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
