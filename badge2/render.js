const FONT_SIZE = 72;
const SCALE     = 1000; // Clipper integer precision

let font = null, timer = null;
let canvases = [], ctxs = [];

window.addEventListener('DOMContentLoaded', () => {
  canvases = [1, 2, 3].map(i => document.getElementById('c' + i));
  ctxs     = canvases.map(c => c.getContext('2d'));
  window.addEventListener('resize', () => { resizeAll(); render(); });
  resizeAll();
  opentype.load('LEGO.TTF', (err, f) => {
    if (err) { console.error('Font load failed:', err); return; }
    font = f;
    render();
  });
});

function resizeAll() {
  const w = Math.floor(window.innerWidth * 0.88);
  canvases.forEach(c => { c.width = w; c.height = 150; });
}

function scheduleRender() {
  clearTimeout(timer);
  timer = setTimeout(render, 150);
}

function centredOtPath(text, w, h) {
  const probe = font.getPath(text, 0, 0, FONT_SIZE);
  const bb    = probe.getBoundingBox();
  const x     = (w - (bb.x2 - bb.x1)) / 2 - bb.x1;
  const y     = (h - (bb.y2 - bb.y1)) / 2 - bb.y1;
  return font.getPath(text, x, y, FONT_SIZE);
}

function render() {
  if (!font) return;
  const text   = (document.getElementById('nameInput').value || 'NAME').toUpperCase();
  const border = parseFloat(document.getElementById('borderRange').value) || 10;
  const w = canvases[0].width, h = 150;

  const otPath = centredOtPath(text, w, h);
  const path2d = new Path2D(otPath.toPathData(3));

  // ── 1. Centered stroke ────────────────────────────────────────
  // Stroke is drawn centered on the path edge: half inside, half outside.
  // Fill is drawn on top — the inner half of the stroke remains visible under the fill.
  {
    const ctx = ctxs[0];
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth   = border;
    ctx.lineJoin    = 'round';
    ctx.stroke(path2d);
    ctx.fillStyle = '#ffffff';
    ctx.fill(path2d);
  }

  // ── 2. Outside stroke ─────────────────────────────────────────
  // Double-width stroke so half is inside the fill area.
  // Fill drawn on top covers the inner half, leaving exactly `border` px outside.
  {
    const ctx = ctxs[1];
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth   = border * 2;
    ctx.lineJoin    = 'round';
    ctx.stroke(path2d);
    ctx.fillStyle = '#ffffff';
    ctx.fill(path2d);
  }

  // ── 3. Clipper polygon offset ─────────────────────────────────
  // Expand the glyph polygons outward by `border` px using Clipper's offset.
  // Fill the expanded shape in red, then fill the original text on top.
  {
    const ctx   = ctxs[2];
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, w, h);

    const polys = commandsToClipper(otPath.commands);
    const co    = new ClipperLib.ClipperOffset();
    co.AddPaths(polys, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const expanded = new ClipperLib.Paths();
    co.Execute(expanded, border * SCALE);

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    drawClipperPaths(ctx, expanded);
    ctx.fill('evenodd');

    ctx.fillStyle = '#ffffff';
    ctx.fill(path2d);
  }
}

// Convert opentype path commands → Clipper integer polygons.
// Curves are sampled into line segments at ~10 points each.
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

function drawClipperPaths(ctx, paths) {
  for (const p of paths) {
    if (!p.length) continue;
    ctx.moveTo(p[0].X / SCALE, p[0].Y / SCALE);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].X / SCALE, p[i].Y / SCALE);
    ctx.closePath();
  }
}
