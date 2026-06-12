const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let font = null, timer = null;

const FONT_SIZE  = 72;
const COLOUR     = '#ef4444';
const PX_PER_MM  = FONT_SIZE / 49; // 49mm = badge default font size
const HOLE_W_MM  = 46;
const HOLE_H_MM  = 14;

function resize() {
  canvas.width  = Math.floor(window.innerWidth * 0.9);
  canvas.height = 160;
  render();
}
window.addEventListener('resize', resize);
resize();

opentype.load('LEGO.TTF', (err, f) => {
  if (err) { console.error('Font load failed:', err); return; }
  font = f;
  render();
});

function scheduleRender() {
  clearTimeout(timer);
  timer = setTimeout(render, 150);
}

function render() {
  if (!font) return;
  const text   = (document.getElementById('nameInput').value || 'NAME').toUpperCase();
  const border = parseFloat(document.getElementById('borderRange').value) || 0;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const probe = font.getPath(text, 0, 0, FONT_SIZE);
  const bb    = probe.getBoundingBox();
  const x     = (canvas.width  - (bb.x2 - bb.x1)) / 2 - bb.x1;
  const y     = (canvas.height - (bb.y2 - bb.y1)) / 2 - bb.y1;

  const path2d = new Path2D(font.getPath(text, x, y, FONT_SIZE).toPathData(3));

  // Outside stroke + fill, same colour → merges into one solid shape
  ctx.strokeStyle = COLOUR;
  ctx.lineWidth   = border * 2;
  ctx.lineJoin    = 'round';
  ctx.stroke(path2d);
  ctx.fillStyle = COLOUR;
  ctx.fill(path2d);

  // ── Magnet cutout ─────────────────────────────────────────────
  // Centre of the shape = canvas centre (text is centred there already).
  // Convert mm → px using the same scale as the font.
  const cx    = canvas.width  / 2;
  const cy    = canvas.height / 2;
  const holeW = HOLE_W_MM * PX_PER_MM;
  const holeH = HOLE_H_MM * PX_PER_MM;
  const holeX = cx - holeW / 2;
  const holeY = cy - holeH / 2;

  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'black';
  ctx.fillRect(holeX, holeY, holeW, holeH);
  ctx.globalCompositeOperation = 'source-over';

  // Faint outline so the slot is visible against any background
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(holeX, holeY, holeW, holeH);
}
