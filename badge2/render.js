const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let font = null, timer = null;

const FONT_SIZE = 72;
const COLOUR    = '#ef4444';

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

  ctx.fillStyle = '#27272a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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
}
