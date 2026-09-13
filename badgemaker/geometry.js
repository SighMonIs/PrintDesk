// BadgeMak3r layer geometry — pure computation, no viewer/DOM.
// Loaded by badgemaker/index.html (before engine.js) and headlessly by
// PrintDesk (app.js) to build order badges from a BadgeMak3r template.
// Requires THREE, ClipperLib, opentype and ../shared/3mf.js globals.
// Owns the model-state globals `layerConfig` and `inputs`: BadgeMak3r's
// data.js edits them in place, PrintDesk assigns a template's rows to them
// before calling buildExportObjects.

let layerConfig = [], inputs = [];

// ── Font loading/caching ───────────────────────────────────────
const fontCache = new Map(); // key ('builtin' or font.id) -> opentype Font
let builtinFontPromise = null;

function loadBuiltinFont(url = '../badge/LEGO.TTF') {
  if (fontCache.has('builtin')) return Promise.resolve(fontCache.get('builtin'));
  if (builtinFontPromise) return builtinFontPromise;
  builtinFontPromise = new Promise((resolve, reject) => {
    opentype.load(url, (err, f) => {
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
  let w, h;   // (rounded rectangles reuse `border` as their corner radius)
  if (layer.fitToShape) {
    const b = modelBounds(layer);
    w = Math.max(0.1, b.width  + (layer.fontSize || 0));
    h = Math.max(0.1, b.height + (layer.height   || 0));
  } else {
    w = layer.fontSize || 20; h = layer.height || 20;
  }
  const hw = w / 2, hh = h / 2;
  if (layer.shapeType === 'roundedrect') {
    // `border` doubles as the corner radius here, clamped so it can't exceed
    // half the shorter side (beyond that the corners would overlap).
    const r = Math.max(0, Math.min(layer.border || 0, Math.min(w, h) / 2));
    if (r > 0) {
      shape.moveTo(-hw + r, -hh);
      shape.lineTo(hw - r, -hh);
      shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
      shape.lineTo(hw, hh - r);
      shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
      shape.lineTo(-hw + r, hh);
      shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
      shape.lineTo(-hw, -hh + r);
      shape.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
      shape.closePath();
      return { shapes: [shape], width: w, height: h };
    }
  }
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  return { shapes: [shape], width: w, height: h };
}

// Vertical text: one character per line, each centred on its own advance
// width. cmdsToCenteredShapes recentres the whole block afterwards. Letter
// spacing becomes the gap between lines here, word spacing the gap at a space.
function verticalTextCommands(font, text, size, letterSpacing = 0, wordSpacing = 0, lineSpacing = 0) {
  const cmds = [];
  let y = 0;
  for (const ch of [...text]) {
    if (ch === '\n') { y += size + lineSpacing; continue; }
    if (ch === ' ') { y += size + letterSpacing + wordSpacing; continue; }
    cmds.push(...font.getPath(ch, -font.getAdvanceWidth(ch, size) / 2, y, size).commands);
    y += size + letterSpacing;
  }
  return cmds;
}

// Multi-line text: one baseline per newline-separated line, each aligned on
// the ink it actually draws rather than on its advance width. Advance width
// includes the side bearings, and a heavy italic display face carries enough
// of those — plus ink that overhangs the advance entirely — to throw a line
// visibly off the one above it. Ink is also what the block itself is centred
// on afterwards (cmdsToCenteredShapes), so lines and block now agree.
// lineSpacing is the extra gap on top of the em size between baselines; only
// the offsets *between* lines matter here.
// lineOffsets nudges individual lines sideways on top of that. Only the
// differences between them show: the block is recentred on its ink after, so
// shifting every line by the same amount moves nothing.
function multilineTextCommands(font, text, size, letterSpacing, wordSpacing, lineSpacing, align = 'center', lineOffsets = []) {
  const lines = text.split('\n');
  if (lines.length === 1) return _badgeGetTextCommands(font, text, size, letterSpacing, wordSpacing);
  return lines.flatMap((line, i) => {
    const probe = _badgeGetTextCommands(font, line, size, letterSpacing, wordSpacing);
    if (!probe.length) return [];                      // blank line, still advances y
    const path = new opentype.Path(); path.commands = probe;
    const { x1, x2 } = path.getBoundingBox();          // curve-accurate, unlike raw command points
    const aligned = align === 'left' ? -x1 : align === 'right' ? -x2 : -(x1 + x2) / 2;
    const x = aligned + (+lineOffsets[i] || 0);
    return _badgeGetTextCommands(font, line, size, letterSpacing, wordSpacing, x, i * (size + lineSpacing));
  });
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
// Ring geometry follows the original generator (shared/render.js): the outer
// is a D — a semicircle with flat sides running into the badge — and the hole
// is a matching slot, semicircular at the far end with a filleted flat edge
// facing the badge. Built with the connector pointing +x, then rotated.
// Defaults line up with the original's (⌀10 hole, 3mm flat, 2.5mm wall).
const KEYCHAIN_FLAT = 0.6;    // flat edge distance from centre, as a fraction of r
const KEYCHAIN_FILLET = 1;    // corner radius on the hole's flat edge, mm

function keySide(side) {
  return side === 'right' ? 0 : side === 'up' ? Math.PI / 2
       : side === 'left'  ? Math.PI : -Math.PI / 2;
}
function toClipRot(pts, phi) {
  const cos = Math.cos(phi), sin = Math.sin(phi);
  return pts.map(([x, y]) => ({
    X: Math.round((x * cos - y * sin) * _BADGE_SCALE),
    Y: Math.round((x * sin + y * cos) * _BADGE_SCALE),
  }));
}
// Semicircle on the far side (+x is the connector direction), from (0,r) round
// through (-r,0) to (0,-r).
function farSemicircle(r, N = 48) {
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / N;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function keychainOuterPath(outerR, conn, side) {
  const pts = farSemicircle(outerR);
  pts.push([conn, -outerR], [conn, outerR]);   // flat sides into the badge
  return toClipRot(pts, keySide(side));
}

function keychainHolePath(r, side, hasConnector) {
  if (!hasConnector) return circleToClipper(0, 0, r);
  const f = r * KEYCHAIN_FLAT;                       // flat edge position
  const fr = Math.min(KEYCHAIN_FILLET, r * 0.4, f);  // corner radius
  const pts = farSemicircle(r);
  const Nf = 8;
  pts.push([f - fr, -r]);                            // bottom edge
  for (let i = 0; i <= Nf; i++) {                    // bottom corner
    const a = -Math.PI / 2 + (Math.PI / 2) * i / Nf;
    pts.push([f - fr + fr * Math.cos(a), -r + fr + fr * Math.sin(a)]);
  }
  pts.push([f, r - fr]);                             // flat edge
  for (let i = 0; i <= Nf; i++) {                    // top corner
    const a = (Math.PI / 2) * i / Nf;
    pts.push([f - fr + fr * Math.cos(a), r - fr + fr * Math.sin(a)]);
  }
  return toClipRot(pts, keySide(side));
}

function getKeychainShapes(layer) {
  const innerR = (layer.fontSize || 10) / 2;
  const wall   = layer.height || 2.5;
  const outerR = innerR + wall;
  const side   = KEYCHAIN_SIDES.includes(layer.shapeType) ? layer.shapeType : 'none';
  const conn   = Math.max(0, layer.border || 0);

  // Outer silhouette: a D — semicircle plus flat sides running into the
  // badge — or a plain disc when there's no connector.
  const hasConn = side !== 'none' && conn > 0;
  const outerPaths = [hasConn ? keychainOuterPath(outerR, conn, side)
                              : circleToClipper(0, 0, outerR)];
  const unioned = _badgeClipperUnion(outerPaths);
  const outers = unioned.filter(p => ClipperLib.Clipper.Orientation(p));
  if (!outers.length) return null;

  const toVec2 = p => new THREE.Vector2(p.X / _BADGE_SCALE, p.Y / _BADGE_SCALE);
  const shapes = outers.map(o => new THREE.Shape(o.map(toVec2)));
  // Punch the ring hole into whichever outer contour contains it.
  const holePath = keychainHolePath(innerR, side, hasConn);
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
  const size = layer.fontSize || 20;
  const ls = layer.letterSpacing || 0, ws = layer.wordSpacing || 0, lsp = layer.lineSpacing || 0;
  const cmds = layer.vertical ? verticalTextCommands(font, text, size, ls, ws, lsp)
                              : multilineTextCommands(font, text, size, ls, ws, lsp, layer.align, layer.lineOffsets || []);
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
  // Winding has to be normalised — outer one way, holes the other. THREE
  // shapes don't guarantee it (the keychain ring's hole is wound the same
  // way as its outer circle), and under Clipper's NonZero fill a same-wound
  // hole counts as solid, which silently filled the ring in.
  const wound = (pts, wantOuter) => {
    const p = pts.map(xf);
    return ClipperLib.Clipper.Orientation(p) === wantOuter ? p : p.reverse();
  };
  const paths = [wound(shape.getPoints(24), true)];
  for (const h of shape.holes) paths.push(wound(h.getPoints(24), false));
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

// ── DB rows → in-memory model ───────────────────────────────────
// Shared by BadgeMak3r's loadModel and PrintDesk's template loader so both
// build identical layer objects from badgemaker_layers / badgemaker_inputs.
let _layerKeySeq = 1, _inputKeySeq = 1;

function modelFromRows(layerRows, inputRows) {
  const inputs = inputRows.map(r => ({ _key: _inputKeySeq++, id: r.id, name: r.name, defaultValue: r.default_value, order: r.input_order, fromOption: r.from_option || null }));
  const inputKeyById = new Map(inputs.map(i => [String(i.id), i._key]));
  const layerConfig = layerRows.map(r => {
    // 'square'/'circle' are legacy layer_type values from before Type/Shape split
    const isLegacyShape = r.layer_type === 'square' || r.layer_type === 'circle';
    return {
      _key: _layerKeySeq++, id: r.id, order: r.layer_order,
      type: isLegacyShape ? 'shape' : (r.layer_type || 'text'),
      shapeType: r.shape_type || (r.layer_type === 'circle' ? 'circle' : 'rectangle'),
      negative: !!r.is_negative, negAboveOnly: !!r.negative_above_only, fillGaps: !!r.fill_gaps, fitToShape: !!r.fit_to_shape, vertical: !!r.vertical, name: r.name || null, visible: r.visible !== false,
      content: r.content, inputId: r.input_id != null ? (inputKeyById.get(String(r.input_id)) ?? null) : null,
      hex: r.colour_hex, colourId: r.colour_id,
      fontId: r.font_id, fontObj: getCachedFont(r.font_id),
      fontSize: r.font_size, height: r.height_mm || 20, border: r.border_mm, depth: r.thickness_mm,
      repeatThreshold: r.repeat_threshold_mm || 0,
      letterSpacing: r.letter_spacing_mm || 0, wordSpacing: r.word_spacing_mm || 0, lineSpacing: r.line_spacing_mm || 0, align: r.text_align || 'center',
      lineOffsets: Array.isArray(r.line_offsets_mm) ? r.line_offsets_mm.map(Number) : [],
      offsetX: r.offset_x, offsetY: r.offset_y, offsetZ: r.offset_z, rotation: r.rotation,
      showWhenOption: r.show_when_option || null, showWhenValue: r.show_when_value || null,
      colourFromOption: r.colour_from_option || null, colourFromIndex: r.colour_from_index || null,
    };
  });
  return { inputs, layerConfig };
}

// ── Order bindings ──────────────────────────────────────────────
// Applies a PrintDesk order's option values ({ [optionName]: value }) to a
// model from modelFromRows: bound inputs take the option's text, layers with
// a "show when" condition are shown only for that dropdown value, and layers
// with a colour binding take the Nth colour of that colour option.
// colourHex(name) resolves a colour name to hex (null when unknown).
// Returns human-readable warnings for anything the order didn't supply.
function applyOrderBindings(model, orderOpts, colourHex) {
  const warnings = new Set();
  const get = name => {
    const want = (name || '').trim().toLowerCase();
    const k = Object.keys(orderOpts || {}).find(k => k.trim().toLowerCase() === want);
    return k ? String(orderOpts[k] ?? '').trim() : '';
  };
  if (model.inputs.some(i => i.fromOption)) {
    for (const inp of model.inputs) if (inp.fromOption) inp.defaultValue = get(inp.fromOption);
  } else {
    // Unbound template: the order's Text goes into the input named "Name"
    // (else the first input, else the first text layer).
    const text = get('Text') || get('Name');
    const target = model.inputs.find(i => (i.name || '').trim().toLowerCase() === 'name') || model.inputs[0];
    if (target) target.defaultValue = text;
    else { const tl = model.layerConfig.find(l => l.type === 'text'); if (tl) tl.content = text; }
  }
  for (const l of model.layerConfig) {
    if (l.showWhenOption) {
      const v = get(l.showWhenOption);
      if (!v) warnings.add(`"${l.showWhenOption}" not set on the order — "${layerLabel(l)}" hidden`);
      // The binding alone decides visibility: the editor's eye toggle is a
      // design-time aid for looking at one of several alternative layers.
      l.visible = !!v && v.toLowerCase() === String(l.showWhenValue || '').trim().toLowerCase();
    }
    if (l.colourFromOption) {
      const idx = l.colourFromIndex || 1;
      const name = get(l.colourFromOption).split('|').map(x => x.trim())[idx - 1];
      const hex = name ? colourHex(name) : null;
      if (hex) l.hex = hex;
      else warnings.add(`No colour #${idx} for "${l.colourFromOption}" on the order — "${layerLabel(l)}" keeps its template colour`);
    }
  }
  return [...warnings];
}

// A layer bound to a PrintDesk option belongs to that option's group in the
// sidebar: every variant of a dropdown, or every slot of a colour selector.
function layerGroupKey(l) {
  if (l.showWhenOption) return 'dd:' + l.showWhenOption;
  if (l.colourFromOption) return 'col:' + l.colourFromOption;
  return '';
}

// ── Layer labels (sidebar + 3MF part names) ─────────────────────
const BACKING_LABELS = {magnet:'Magnet backing', pin:'Pin backing', round:'Round magnet'};
function layerLabel(l){
  if(l.name) return l.name;
  if(l.type==='keychain') return 'Keychain ring';
  if(l.type==='backing') return BACKING_LABELS[l.shapeType] || 'Backing';
  if(l.type==='shape') return l.shapeType==='circle' ? 'Circle'
    : l.shapeType==='roundedrect' ? 'Rounded rectangle' : 'Rectangle';
  if(l.inputId!=null){
    const inp = inputs.find(x=>x._key===l.inputId);
    return inp ? (inp.defaultValue.replace(/\n/g,' ') || `[${inp.name}]`) : '(empty)';
  }
  return l.content?.replace(/\n/g,' ') || '(empty)';
}

// ── 3MF export ───────────────────────────────────────────────────
function buildExportObjects() {
  invalidateModelWidth();
  const objects = [];
  const filamentHexes = []; // one filament slot per distinct colour, in sidebar order
  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    if (isCutter(layer) || layer.visible === false) continue;
    // Cutters can split a layer into several Z bands (see buildLayerSlabs);
    // export them as one mesh so the part is named exactly like the sidebar.
    const geos = buildLayerSlabs(layer).map(slab => {
      const geo = new THREE.ExtrudeGeometry(slab.result.shapes, { depth: slab.depth, bevelEnabled: false });
      geo.applyMatrix4(new THREE.Matrix4().makeRotationZ((layer.rotation || 0) * Math.PI / 180));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(layer.offsetX || 0, layer.offsetY || 0, slab.zStart));
      return _badgeMergeVerticesForExport(geo);
    });
    if (!geos.length) continue;
    const hex = (layer.hex || '#888888').toLowerCase();
    let slot = filamentHexes.indexOf(hex);
    const newSlot = slot < 0;
    if (newSlot) slot = filamentHexes.push(hex) - 1;
    objects.push({
      geo: _badgeConcatGeometries(geos), name: layerLabel(layer) || `Layer ${i+1}`,
      colour: hex, extruder: slot + 1, id: objects.length + 1, skipFilamentSlot: !newSlot,
    });
  }
  return objects;
}
