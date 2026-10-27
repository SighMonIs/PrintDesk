// LithoMak3r geometry — lithophane Christmas baubles.
//
// The bauble is a spherical shell with a hole at each pole. Image brightness
// sets the local wall thickness: bright pixels go thin so more light gets
// through, dark pixels go thick. The relief sits on the inside by default so
// the outside stays a clean sphere.
//
// Images are laid out as panels around the equator — N images (times a repeat
// count) each get an equal slice of the 360°. Within its slice an image is
// mapped undistorted: the sphere's circumference shrinks towards the poles, so
// rows further from the equator take a narrower slice of angle for the same
// number of millimetres. Whatever's left over around a panel stays plain.
//
// Everything is mm with Z up — same as the 3MF the slicer gets.

const LITHO_DETAIL = {
  draft:  { segsU: 120, segsV: 80,  label: 'Draft — fast' },
  normal: { segsU: 240, segsV: 160, label: 'Normal' },
  fine:   { segsU: 400, segsV: 268, label: 'Fine — slow, big file' },
};

// A plain gutter between neighbouring panels, as a fraction of the slice.
// Without it the two panels either side of θ=0 share a column of vertices and
// you get a crease where one image's edge meets the next one's.
const L_PANEL_GAP = 0.05;

// Bilinear — nearest-neighbour bands badly once it's printed.
function lSampleLum(im, u, v) {
  const x = Math.min(im.w - 1, Math.max(0, u * (im.w - 1)));
  const y = Math.min(im.h - 1, Math.max(0, v * (im.h - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(im.w - 1, x0 + 1), y1 = Math.min(im.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, L = im.lum;
  const a = L[y0 * im.w + x0], b = L[y0 * im.w + x1];
  const c = L[y1 * im.w + x0], d = L[y1 * im.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function lPanelCount(p, imgs) {
  return Math.max(1, imgs.length * Math.max(1, p.repeat));
}

// The latitude band each image occupies. Height follows the image's aspect,
// width follows the widest row in the band — so two passes settle the pair.
function lBands(p, imgs, f0, f1) {
  const panels = lPanelCount(p, imgs);
  const phiC = Math.min(f1, Math.max(f0, p.centreDeg * Math.PI / 180));
  return imgs.map(im => {
    let sinRef = Math.max(0.05, Math.sin(phiC)), top = f0, bot = f1;
    for (let it = 0; it < 2; it++) {
      const dphi = Math.min(f1 - f0, 2 * Math.PI * sinRef * (im.h / im.w) / panels);
      top = Math.max(f0, Math.min(f1 - dphi, phiC - dphi / 2));
      bot = top + dphi;
      sinRef = (top <= Math.PI / 2 && bot >= Math.PI / 2)
        ? 1 : Math.max(Math.sin(top), Math.sin(bot));
    }
    return { top, bot, sinRef };
  });
}

function lThickness(th, phi, sp, imgs, bands, sliceW, p) {
  if (!imgs.length) return p.thinMM;
  const a = th / sliceW;
  const k = Math.floor(a) % imgs.length;
  const b = bands[k];
  if (phi < b.top || phi > b.bot) return p.thinMM;
  const u = 0.5 + ((a - Math.floor(a)) - 0.5) * (b.sinRef / Math.max(0.02, sp)) / (1 - L_PANEL_GAP);
  if (u < 0 || u > 1) return p.thinMM;
  const v = (phi - b.top) / Math.max(1e-6, b.bot - b.top);
  return p.thinMM + (1 - lSampleLum(imgs[k], u, v)) * (p.thickMM - p.thinMM);
}

function lBuildShell(p, imgs) {
  const nU = p.segsU, nV = p.segsV, R = p.dia / 2;
  const f0 = p.topHole * Math.PI / 180;
  const f1 = Math.PI - p.botHole * Math.PI / 180;
  const bands = lBands(p, imgs, f0, f1);
  const sliceW = 2 * Math.PI / lPanelCount(p, imgs);
  const outside = p.reliefSide === 'outside';

  const rows = nV + 1, ringBase = rows * nU;
  const pos = new Float32Array(rows * nU * 2 * 3);
  for (let i = 0; i < rows; i++) {
    const phi = f0 + (f1 - f0) * i / nV, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j < nU; j++) {
      const th = 2 * Math.PI * j / nU;
      const t = lThickness(th, phi, sp, imgs, bands, sliceW, p);
      const rIn  = outside ? R - p.thickMM : R - t;
      const rOut = outside ? rIn + t       : R;
      const ct = Math.cos(th), st = Math.sin(th);
      let k = (i * nU + j) * 3;
      pos[k] = rOut * sp * ct; pos[k + 1] = rOut * sp * st; pos[k + 2] = rOut * cp;
      k = (ringBase + i * nU + j) * 3;
      pos[k] = rIn * sp * ct;  pos[k + 1] = rIn * sp * st;  pos[k + 2] = rIn * cp;
    }
  }

  // Outer and inner grids share their wrap column, so the seam is watertight
  // without a weld pass. Rims close the two pole holes.
  const O = (i, j) => i * nU + (j % nU);
  const I = (i, j) => ringBase + i * nU + (j % nU);
  const idx = new Uint32Array((nV * nU * 4 + nU * 4) * 3);
  let n = 0;
  const tri = (a, b, c) => { idx[n++] = a; idx[n++] = b; idx[n++] = c; };
  for (let i = 0; i < nV; i++) for (let j = 0; j < nU; j++) {
    tri(O(i, j), O(i + 1, j), O(i + 1, j + 1));
    tri(O(i, j), O(i + 1, j + 1), O(i, j + 1));
    tri(I(i, j), I(i + 1, j + 1), I(i + 1, j));
    tri(I(i, j), I(i, j + 1), I(i + 1, j + 1));
  }
  for (let j = 0; j < nU; j++) {
    tri(I(0, j), O(0, j), O(0, j + 1));
    tri(I(0, j), O(0, j + 1), I(0, j + 1));
    tri(I(nV, j), O(nV, j + 1), O(nV, j));
    tri(I(nV, j), I(nV, j + 1), O(nV, j + 1));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

// A half-torus arching over the top hole, feet landing on the rim. Thread the
// ribbon through that. Printed last, at the apex, so its crown is a short
// bridge — fine at this span.
function lBuildArch(p) {
  const R = p.dia / 2, f0 = p.topHole * Math.PI / 180;
  const rim = R * Math.sin(f0), zTop = R * Math.cos(f0), tube = p.hangerMM / 2;
  if (rim < tube * 1.5) return null;

  const A = 72, C = 18, ext = 0.16;  // ext buries the feet in the shell wall
  const a0 = -ext, a1 = Math.PI + ext, rows = A + 1;
  const pos = new Float32Array((rows * C + 2) * 3);
  for (let i = 0; i < rows; i++) {
    const a = a0 + (a1 - a0) * i / A, ca = Math.cos(a), sa = Math.sin(a);
    const cx = rim * ca, cz = zTop + rim * sa;
    for (let j = 0; j < C; j++) {
      const v = 2 * Math.PI * j / C, cv = Math.cos(v), sv = Math.sin(v);
      const k = (i * C + j) * 3;
      pos[k] = cx + tube * cv * ca; pos[k + 1] = tube * sv; pos[k + 2] = cz + tube * cv * sa;
    }
  }
  const c0 = rows * C, c1 = c0 + 1;
  pos[c0 * 3] = rim * Math.cos(a0); pos[c0 * 3 + 2] = zTop + rim * Math.sin(a0);
  pos[c1 * 3] = rim * Math.cos(a1); pos[c1 * 3 + 2] = zTop + rim * Math.sin(a1);

  const V = (i, j) => i * C + (j % C);
  const idx = new Uint32Array((A * C * 2 + C * 2) * 3);
  let n = 0;
  const tri = (a, b, c) => { idx[n++] = a; idx[n++] = b; idx[n++] = c; };
  for (let i = 0; i < A; i++) for (let j = 0; j < C; j++) {
    tri(V(i, j), V(i, j + 1), V(i + 1, j + 1));
    tri(V(i, j), V(i + 1, j + 1), V(i + 1, j));
  }
  for (let j = 0; j < C; j++) {
    tri(c0, V(0, j + 1), V(0, j));
    tri(c1, V(A, j), V(A, j + 1));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function lBuildParts(p, imgs) {
  const parts = [{ name: 'Bauble', geo: lBuildShell(p, imgs) }];
  if (p.hanger) {
    const arch = lBuildArch(p);
    if (arch) parts.push({ name: 'Hanger', geo: arch });
  }
  return parts;
}

// Sizes worked out for the hint line and the size label.
function lDerived(p, imgs) {
  const R = p.dia / 2;
  const f0 = p.topHole * Math.PI / 180, f1 = Math.PI - p.botHole * Math.PI / 180;
  const panels = lPanelCount(p, imgs);
  const bands = lBands(p, imgs, f0, f1);
  const tris = p.segsV * p.segsU * 4 + p.segsU * 4 + (p.hanger ? 72 * 18 * 2 + 36 : 0);
  return {
    panels, tris,
    topHoleMM: 2 * R * Math.sin(f0),
    botHoleMM: 2 * R * Math.sin(Math.PI - f1),
    panel: bands.length ? {
      w: 2 * Math.PI * R * bands[0].sinRef / panels * (1 - L_PANEL_GAP),
      h: R * (bands[0].bot - bands[0].top),
    } : null,
  };
}

// Manifold check on a small shell: every edge must be used exactly twice, once
// each way. Run with ?selfcheck on the URL.
function lSelfCheck() {
  const p = {
    dia: 60, topHole: 14, botHole: 16, thinMM: 0.7, thickMM: 2.6,
    centreDeg: 90, repeat: 1, reliefSide: 'inside', segsU: 16, segsV: 10,
    hanger: true, hangerMM: 3.6,
  };
  const lum = new Float32Array(16).fill(0.5);
  for (const part of lBuildParts(p, [{ w: 4, h: 4, lum }])) {
    const idx = part.geo.index.array, seen = new Map();
    for (let i = 0; i < idx.length; i += 3) {
      for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const dir = a < b ? 1 : -1;
        seen.set(key, (seen.get(key) || 0) + dir);
      }
    }
    const bad = [...seen.values()].filter(v => v !== 0).length;
    console.assert(bad === 0, `${part.name}: ${bad} non-manifold edges of ${seen.size}`);
    if (!bad) console.log(`${part.name}: manifold, ${seen.size} edges`);
  }
}
