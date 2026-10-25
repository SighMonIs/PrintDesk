// EmbossMak3r — artwork tracing and roller/body geometry.
// Pure computation: no app state, no UI. Needs THREE, ClipperLib and the
// helpers in ../shared/3mf.js (_badgeClipperUnion, _badgeClipperOffset,
// _badgeCommandsToClipper, _badgeMergeVerticesForExport, _badgeConcatGeometries).
//
// Coordinates. The design surface is the roller unrolled flat:
//   u — around the circumference, 0 … wrap (= pi * diameter)
//   v — along the axis,           0 … width
// Artwork becomes Clipper paths in (u, v) mm, then gets wrapped onto the
// cylinder, so what you lay out flat is what rolls onto the card.
//
// The assembly uses Z as the roller axis, Y as the roller-to-roller direction
// and X as the direction the card travels.

const ESCALE = 1000;    // Clipper integer units per mm — same as shared/3mf.js
const ESEG   = 0.4;     // longest polyline segment, mm. Straight in the flat
                        // design is curved on the roller, so edges get chopped
                        // this fine before wrapping or the wrap cuts corners.

// ── Clipper path helpers ───────────────────────────────────────
function eToClipper(pts){ return pts.map(p => ({ X: Math.round(p[0]*ESCALE), Y: Math.round(p[1]*ESCALE) })); }
function eFromClipper(path){ return path.map(p => [p.X/ESCALE, p.Y/ESCALE]); }

function ePathsBBox(paths){
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for(const p of paths) for(const pt of p){
    if(pt.X<minX) minX=pt.X; if(pt.X>maxX) maxX=pt.X;
    if(pt.Y<minY) minY=pt.Y; if(pt.Y>maxY) maxY=pt.Y;
  }
  if(!isFinite(minX)) return null;
  return { minX:minX/ESCALE, maxX:maxX/ESCALE, minY:minY/ESCALE, maxY:maxY/ESCALE };
}

// Centre on the artwork's own bounding box, optionally scale it to fit a box,
// rotate, then drop it at (x, y). Every element kind goes through this, so
// "move/scale/rotate" means the same thing whatever the source was.
function eTransformPaths(paths, { flipY=false, fitW=0, fitH=0, rot=0, x=0, y=0 }){
  const bb = ePathsBBox(paths);
  if(!bb) return [];
  const cx=(bb.minX+bb.maxX)/2, cy=(bb.minY+bb.maxY)/2;
  const w=bb.maxX-bb.minX, h=bb.maxY-bb.minY;
  let s=1;
  if(fitW>0 && fitH>0 && w>1e-6 && h>1e-6) s=Math.min(fitW/w, fitH/h);
  const c=Math.cos(rot), sn=Math.sin(rot), fy=flipY?-1:1;
  return paths.map(p => p.map(pt => {
    const px=(pt.X/ESCALE-cx)*s, py=(pt.Y/ESCALE-cy)*s*fy;
    return { X: Math.round((px*c-py*sn+x)*ESCALE), Y: Math.round((px*sn+py*c+y)*ESCALE) };
  }));
}

function eResample(paths, maxSeg=ESEG){
  const lim=maxSeg*ESCALE;
  return paths.map(p => {
    const out=[];
    for(let i=0;i<p.length;i++){
      const a=p[i], b=p[(i+1)%p.length];
      out.push(a);
      const d=Math.hypot(b.X-a.X, b.Y-a.Y);
      if(d>lim){
        const n=Math.ceil(d/lim);
        for(let k=1;k<n;k++) out.push({ X: Math.round(a.X+(b.X-a.X)*k/n), Y: Math.round(a.Y+(b.Y-a.Y)*k/n) });
      }
    }
    return out;
  });
}

function ePointInPath(pt, path){
  let inside=false;
  for(let i=0,j=path.length-1;i<path.length;j=i++){
    const a=path[i], b=path[j];
    if((a.Y>pt.Y)!==(b.Y>pt.Y) && pt.X < a.X+(b.X-a.X)*(pt.Y-a.Y)/(b.Y-a.Y)) inside=!inside;
  }
  return inside;
}

// Clipper hands back outers oriented positively and holes negatively; pair
// each hole with the outer that contains it.
// ponytail: a one-level nesting test. An island inside a hole (a dot inside a
// ring inside a disc) would be read as a hole of the outer — rare in a logo,
// and the fix is a full PolyTree walk when something actually needs it.
function eRegions(paths){
  const outers=[], holes=[];
  for(const p of paths){
    if(p.length<3) continue;
    (ClipperLib.Clipper.Orientation(p) ? outers : holes).push(p);
  }
  return outers.map(o => ({ outer:o, holes: holes.filter(h => ePointInPath(h[0], o)) }));
}

// ── SVG import ─────────────────────────────────────────────────
// The browser is the SVG path parser: an off-screen <svg> gives exact
// getPointAtLength sampling, which covers arcs and every command form without
// a parser of our own.
let _eSvgHost=null;
function eSvgHost(){
  if(!_eSvgHost){
    _eSvgHost=document.createElementNS('http://www.w3.org/2000/svg','svg');
    _eSvgHost.setAttribute('width','1000');
    _eSvgHost.setAttribute('height','1000');
    _eSvgHost.setAttribute('viewBox','0 0 1000 1000');
    _eSvgHost.style.cssText='position:absolute;left:-9999px;top:0;visibility:hidden;overflow:visible';
    document.body.appendChild(_eSvgHost);
  }
  return _eSvgHost;
}

// Everything that isn't a <path> gets rewritten as one, so a single sampler
// covers the lot. Rounded-rect corners (rx/ry) are squared off.
function eShapeToD(el){
  const n=el.tagName.toLowerCase(), a=k=>parseFloat(el.getAttribute(k))||0;
  if(n==='path') return el.getAttribute('d')||'';
  if(n==='rect'){
    const x=a('x'), y=a('y'), w=a('width'), h=a('height');
    return w&&h ? `M${x} ${y}H${x+w}V${y+h}H${x}Z` : '';
  }
  if(n==='circle'){
    const cx=a('cx'), cy=a('cy'), r=a('r');
    return r ? `M${cx-r} ${cy}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0Z` : '';
  }
  if(n==='ellipse'){
    const cx=a('cx'), cy=a('cy'), rx=a('rx'), ry=a('ry');
    return rx&&ry ? `M${cx-rx} ${cy}a${rx} ${ry} 0 1 0 ${2*rx} 0a${rx} ${ry} 0 1 0 ${-2*rx} 0Z` : '';
  }
  if(n==='polygon'||n==='polyline'){
    const pts=(el.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number).filter(v=>!isNaN(v));
    if(pts.length<6) return '';
    let d=`M${pts[0]} ${pts[1]}`;
    for(let i=2;i<pts.length-1;i+=2) d+=`L${pts[i]} ${pts[i+1]}`;
    return d+'Z';
  }
  if(n==='line') return `M${a('x1')} ${a('y1')}L${a('x2')} ${a('y2')}`;
  return '';
}

function eApplyCTM(m, x, y){ return m ? [m.a*x+m.c*y+m.e, m.b*x+m.d*y+m.f] : [x, y]; }

// Subpaths are isolated by measuring prefixes of the `d` string: path length
// is additive over segments, so subpath i spans [len(prefix i-1), len(prefix
// i)] of the whole path. Sampling the untouched full path over that span keeps
// relative `m` commands — which start from the previous subpath's end — right.
function eSamplePathD(d, ctm){
  const host=eSvgHost();
  const mk=dd=>{
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',dd); host.appendChild(p); return p;
  };
  const len=p=>{ try{ return p.getTotalLength(); }catch(e){ return 0; } };
  const subs=d.match(/[Mm][^Mm]*/g);
  if(!subs) return [];
  const full=mk(d);
  const total=len(full);
  if(!total){ full.remove(); return []; }
  const bounds=[];
  for(let i=0;i<subs.length;i++){
    const pre=mk(subs.slice(0,i+1).join(''));
    bounds.push(Math.min(total, len(pre)));
    pre.remove();
  }
  const step=total/1200;
  const loops=[]; let prev=0;
  for(const end of bounds){
    const span=end-prev;
    if(span>total*1e-4){
      const n=Math.max(8, Math.min(900, Math.round(span/step)));
      const loop=[];
      for(let k=0;k<n;k++){
        try{
          const pt=full.getPointAtLength(prev+span*k/n);
          loop.push(eApplyCTM(ctm, pt.x, pt.y));
        }catch(e){ /* degenerate segment — skip the sample */ }
      }
      if(loop.length>2) loops.push(loop);
    }
    prev=end;
  }
  full.remove();
  return loops;
}

function eUnion(loops, fillType){
  if(!loops.length) return [];
  const c=new ClipperLib.Clipper();
  c.AddPaths(loops, ClipperLib.PolyType.ptSubject, true);
  const r=new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, r, fillType, fillType);
  return r;
}
function eOffsetEnds(loops, deltaMM, endType){
  if(!loops.length) return [];
  const co=new ClipperLib.ClipperOffset();
  co.AddPaths(loops, ClipperLib.JoinType.jtRound, endType);
  const r=new ClipperLib.Paths();
  co.Execute(r, deltaMM*ESCALE);
  return r;
}

function eSvgPaths(src){
  let root;
  try{
    const doc=new DOMParser().parseFromString(src,'image/svg+xml');
    if(doc.querySelector('parsererror')) return [];
    root=doc.documentElement;
  }catch(e){ return []; }
  if(!root || root.tagName.toLowerCase()!=='svg') return [];
  const host=eSvgHost();
  const clone=host.ownerDocument.importNode(root, true);
  host.appendChild(clone);
  const nonzero=[], evenodd=[], strokes=[];
  try{
    const rootCTM = clone.getScreenCTM ? clone.getScreenCTM() : null;
    clone.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').forEach(el=>{
      const d=eShapeToD(el);
      if(!d) return;
      let ctm=null;
      try{
        // Element space → root space. A missing CTM only costs us relative
        // placement between shapes; a whole-file translate or scale washes
        // out anyway, because the artwork is re-centred and refitted.
        if(rootCTM && el.getScreenCTM) ctm=rootCTM.inverse().multiply(el.getScreenCTM());
      }catch(e){ ctm=null; }
      const loops=eSamplePathD(d, ctm).map(eToClipper);
      if(!loops.length) return;

      // The clone is in the live document, so computed style resolves CSS,
      // presentation attributes and inheritance in one go.
      const cs=getComputedStyle(el);
      const filled = cs.fill && cs.fill!=='none';
      const stroked = cs.stroke && cs.stroke!=='none';
      if(filled || !stroked){
        // Unfilled and unstroked shouldn't happen, but an invisible shape is
        // likelier to be a mistake in the file than something to drop.
        (cs.fillRule==='evenodd' ? evenodd : nonzero).push(...loops);
      }
      if(stroked){
        // Line art carries its shape in the stroke, so outline it rather than
        // flooding the path it traces.
        const sc=ctm ? Math.sqrt(Math.abs(ctm.a*ctm.d-ctm.b*ctm.c))||1 : 1;
        const sw=(parseFloat(cs.strokeWidth)||1)*sc;
        if(sw>0) strokes.push(...eOffsetEnds(loops, sw/2, ClipperLib.EndType.etOpenRound));
      }
    });
  } finally { clone.remove(); }
  // Each fill rule resolves on its own, then the results combine: Clipper
  // normalises orientation on output, so holes survive the second union.
  const merged=[...eUnion(nonzero, ClipperLib.PolyFillType.pftNonZero),
               ...eUnion(evenodd, ClipperLib.PolyFillType.pftEvenOdd),
               ...strokes];
  return merged.length ? _badgeClipperUnion(merged) : [];
}

// ── Image tracing (marching squares) ───────────────────────────
// Segment table, cell corners a=TL b=TR c=BR d=BL, code = a*8+b*4+c*2+d.
// Each segment runs with the ink on its left, which is what makes the loops
// stitch together and come out consistently wound.
const E_MS_EDGES = {
  1:[['B','L']],              2:[['R','B']],              3:[['R','L']],
  4:[['T','R']],              5:[['T','R'],['B','L']],    6:[['T','B']],
  7:[['T','L']],              8:[['L','T']],              9:[['B','T']],
  10:[['L','T'],['R','B']],  11:[['R','T']],             12:[['L','R']],
  13:[['B','R']],            14:[['L','B']],
};

// Raster → outlines. Luminance threshold, then marching squares over the
// pixel grid with the segments stitched into closed loops.
// ponytail: no curve fitting. At 8 px/mm the staircase is 0.125 mm, well under
// a 0.4 mm nozzle, and Clipper's round offset softens what's left. Bring in
// potrace-style fitting only if the steps ever show up in a print.
function eTraceImage(img, boxW, boxH, threshold, invert){
  const PPMM=8;
  const w=Math.max(8, Math.min(1400, Math.round((boxW||20)*PPMM)));
  const h=Math.max(8, Math.min(1400, Math.round((boxH||20)*PPMM)));
  const cv=document.createElement('canvas');
  cv.width=w; cv.height=h;
  const cx=cv.getContext('2d',{ willReadFrequently:true });
  cx.drawImage(img, 0, 0, w, h);
  let px;
  try{ px=cx.getImageData(0,0,w,h).data; }catch(e){ return []; }

  // 1 px transparent border so every loop closes inside the grid.
  const W=w+2, H=h+2;
  const on=new Uint8Array(W*H);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=(y*w+x)*4;
    if(px[i+3]<128) continue;                 // transparent is never ink
    const lum=px[i]*0.299+px[i+1]*0.587+px[i+2]*0.114;
    if(invert ? lum>threshold : lum<threshold) on[(y+1)*W+(x+1)]=1;
  }

  // Cell → oriented segments, keyed on doubled coordinates so endpoints match
  // exactly (every midpoint sits on a half-integer).
  const byStart=new Map();
  const segs=[];
  for(let y=0;y<H-1;y++) for(let x=0;x<W-1;x++){
    const a=on[y*W+x], b=on[y*W+x+1], c=on[(y+1)*W+x+1], d=on[(y+1)*W+x];
    const code=a*8+b*4+c*2+d;
    const list=E_MS_EDGES[code];
    if(!list) continue;
    const pt={
      T:[2*x+1, 2*y    ],
      R:[2*x+2, 2*y+1  ],
      B:[2*x+1, 2*y+2  ],
      L:[2*x,   2*y+1  ],
    };
    for(const [s,e] of list){
      const seg={ a:pt[s], b:pt[e], used:false };
      segs.push(seg);
      const k=seg.a[0]+','+seg.a[1];
      if(!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push(seg);
    }
  }

  const loops=[];
  for(const seg of segs){
    if(seg.used) continue;
    const loop=[];
    let cur=seg, guard=0;
    while(cur && !cur.used && guard++ < segs.length+4){
      cur.used=true;
      loop.push(cur.a);
      const next=(byStart.get(cur.b[0]+','+cur.b[1])||[]).find(s=>!s.used);
      cur=next;
    }
    if(loop.length>2){
      // Doubled grid → mm inside the element box, border removed.
      loops.push(eToClipper(loop.map(([dx,dy]) => [
        (dx/2-1)/PPMM, (dy/2-1)/PPMM,
      ])));
    }
  }
  if(!loops.length) return [];
  // Round off the staircase, then union to normalise winding.
  const cleaned=ClipperLib.Clipper.CleanPolygons(loops, 0.1*ESCALE);
  return _badgeClipperUnion(cleaned.filter(p=>p.length>2));
}

// ── Element → artwork paths ────────────────────────────────────
// One element, in (u, v) mm, ready to wrap. `ctx.font(id)` returns an
// opentype font; `ctx.image(content)` a loaded HTMLImageElement or null.
function eElementPaths(el, ctx){
  const rot=(el.rotation||0)*Math.PI/180;
  let raw=[], flipY=false, fitW=0, fitH=0;

  if(el.kind==='text'){
    const font=ctx.font(el.fontId);
    if(!font || !el.content) return [];
    const cmds=font.getPath(el.content, 0, 0, el.fontSize||10).commands;
    raw=_badgeClipperUnion(_badgeCommandsToClipper(cmds));
    flipY=true;                        // font space is y-down
  } else if(el.kind==='rect'){
    const w=el.sizeW||10, h=el.sizeH||10;
    raw=[eToClipper([[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]])];
  } else if(el.kind==='circle'){
    const rx=(el.sizeW||10)/2, ry=(el.sizeH||10)/2, n=96;
    const pts=[];
    for(let i=0;i<n;i++){ const t=2*Math.PI*i/n; pts.push([rx*Math.cos(t), ry*Math.sin(t)]); }
    raw=[eToClipper(pts)];
  } else if(el.kind==='svg'){
    if(!el.content) return [];
    raw=eSvgPaths(el.content);
    flipY=true;                        // SVG space is y-down too
    fitW=el.sizeW; fitH=el.sizeH;
  } else if(el.kind==='image'){
    const img=ctx.image(el.content);
    if(!img) return [];
    raw=eTraceImage(img, el.sizeW, el.sizeH, el.threshold??128, !!el.invert);
    flipY=true;
    fitW=el.sizeW; fitH=el.sizeH;
  }
  if(!raw.length) return [];

  let out=eTransformPaths(raw, { flipY, fitW, fitH, rot, x:el.posU||0, y:el.posV||0 });
  if(el.outlineMM) out=_badgeClipperOffset(out, el.outlineMM);
  return out;
}

// Every visible element, unioned into one set of paths — overlapping elements
// become one raised feature rather than two walls meeting in a seam.
function eArtworkPaths(elements, ctx){
  const all=[];
  for(const el of elements){
    if(el.visible===false) continue;
    for(const p of eElementPaths(el, ctx)) all.push(p);
  }
  return all.length ? _badgeClipperUnion(all) : [];
}

// ── Wrapping flat artwork onto the roller ──────────────────────
// u becomes an angle at the base radius, v becomes z. The walls run radially,
// so a feature's top face is a touch wider than its footprint — the same
// thing that happens when you bend a sheet, and what the card actually meets.
function eWrapRegion(region, { baseR, rIn, rOut, uOff=0 }){
  const loops=[eFromClipper(region.outer), ...region.holes.map(eFromClipper)];
  const contour=loops[0].map(p=>new THREE.Vector2(p[0],p[1]));
  const holeV=loops.slice(1).map(l=>l.map(p=>new THREE.Vector2(p[0],p[1])));
  let tri;
  try{ tri=THREE.ShapeUtils.triangulateShape(contour, holeV); }
  catch(e){ return null; }
  if(!tri || !tri.length) return null;

  const flat=[].concat(...loops);
  const n=flat.length;
  const pos=new Float32Array(n*6);
  const put=(o, p, r) => {
    const t=(p[0]+uOff)/baseR;
    pos[o]=r*Math.cos(t); pos[o+1]=r*Math.sin(t); pos[o+2]=p[1];
  };
  for(let i=0;i<n;i++){ put(i*3, flat[i], rIn); put((n+i)*3, flat[i], rOut); }

  const idx=[];
  for(const [a,b,c] of tri){ idx.push(n+a, n+b, n+c); idx.push(a, c, b); }
  let base=0;
  for(const loop of loops){
    const m=loop.length;
    for(let i=0;i<m;i++){
      const j=(i+1)%m, b0=base+i, b1=base+j;
      idx.push(b0, b1, n+b0,  b1, n+b1, n+b0);
    }
    base+=m;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

// Artwork paths → one geometry per repeat, wrapped. `grow` widens the
// footprint (the recessed roller needs clearance for the paper to fold into).
function eWrapArtwork(paths, p, { rIn, rOut, grow=0, mirror=false }){
  if(!paths.length) return [];
  let work=paths;
  if(mirror){
    // The two rollers turn opposite ways, so the recess runs backwards along
    // the circumference for the bump to land in it. Mirroring reverses the
    // winding, so re-union to put outers and holes back the right way round.
    work=_badgeClipperUnion(work.map(path => path.map(pt => ({ X: Math.round(p.tileU*ESCALE)-pt.X, Y: pt.Y })).reverse()));
  }
  if(grow) work=_badgeClipperOffset(work, grow);
  work=eResample(work);
  // Specks below a quarter of a square millimetre can't emboss anyway, and a
  // detailed photo traces into thousands of them — dropping them is what
  // keeps triangulation from locking the tab up. The cap is the backstop.
  let regions=eRegions(work)
    .filter(r => Math.abs(ClipperLib.Clipper.Area(r.outer))/(ESCALE*ESCALE) > 0.25)
    .sort((a,b) => Math.abs(ClipperLib.Clipper.Area(b.outer))-Math.abs(ClipperLib.Clipper.Area(a.outer)));
  if(regions.length>400) regions=regions.slice(0,400);
  const geos=[];
  for(let k=0;k<p.repeat;k++){
    const uOff=k*p.tileU;
    for(const r of regions){
      const g=eWrapRegion(r, { baseR:p.dia/2, rIn, rOut, uOff });
      if(g) geos.push(g);
    }
  }
  return geos;
}

// ── Primitives ─────────────────────────────────────────────────
function eCylZ(r, len, z0, seg=64){
  const g=new THREE.CylinderGeometry(r, r, len, seg);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2));
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, z0+len/2));
  return _badgeMergeVerticesForExport(g);
}

function eExtrudeZ(shapes, depth, z0){
  const g=new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled:false });
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, z0));
  return _badgeMergeVerticesForExport(g);
}

function eRoundRect(w, h, r){
  r=Math.max(0, Math.min(r, w/2-0.01, h/2-0.01));
  const s=new THREE.Shape();
  s.moveTo(-w/2+r, -h/2);
  s.lineTo(w/2-r, -h/2);  s.absarc(w/2-r,  -h/2+r, r, -Math.PI/2, 0, false);
  s.lineTo(w/2,   h/2-r); s.absarc(w/2-r,   h/2-r, r, 0, Math.PI/2, false);
  s.lineTo(-w/2+r, h/2);  s.absarc(-w/2+r,  h/2-r, r, Math.PI/2, Math.PI, false);
  s.lineTo(-w/2, -h/2+r); s.absarc(-w/2+r, -h/2+r, r, Math.PI, 1.5*Math.PI, false);
  return s;
}

function eCirclePath(cx, cy, r, n=48, Ctor=THREE.Path){
  const pts=[];
  for(let i=0;i<n;i++){ const t=-2*Math.PI*i/n; pts.push(new THREE.Vector2(cx+r*Math.cos(t), cy+r*Math.sin(t))); }
  return new Ctor(pts);
}

// A round shaft with one flat, so a pushed-on knob can actually drive it.
function eDShape(r, flat, n=56){
  const x=Math.max(-r+0.01, Math.min(r-0.01, r-flat));
  const a=Math.acos(x/r);
  const pts=[];
  for(let i=0;i<=n;i++){ const t=a+(2*Math.PI-2*a)*i/n; pts.push(new THREE.Vector2(r*Math.cos(t), r*Math.sin(t))); }
  return new THREE.Shape(pts);
}

// ponytail: straight-flank teeth, not involute. These only hold the two
// rollers in phase — the pattern has to land on the same spot every turn —
// at 1:1 and under grease, carrying almost no load. Swap in involute flanks
// if a print ever binds.
function eGearShape(teeth, pitchR, phase){
  teeth=Math.max(8, Math.round(teeth));
  const m=2*pitchR/teeth;
  const rr=Math.max(1, pitchR-1.25*m), rt=pitchR+m;
  const pitch=2*Math.PI/teeth;
  const half=pitch/4;                    // tooth takes half the pitch at the pitch circle
  const ht=half*0.45, hr=Math.min(half*1.55, pitch*0.46);
  const pts=[];
  for(let k=0;k<teeth;k++){
    const a=phase+k*pitch, aNext=phase+(k+1)*pitch;
    const at=(r,da)=>pts.push(new THREE.Vector2(r*Math.cos(a+da), r*Math.sin(a+da)));
    at(rr,-hr); at(pitchR,-half); at(rt,-ht); at(rt,ht); at(pitchR,half); at(rr,hr);
    const from=a+hr, to=aNext-hr;
    for(let s=1;s<4;s++){ const t=from+(to-from)*s/4; pts.push(new THREE.Vector2(rr*Math.cos(t), rr*Math.sin(t))); }
  }
  return new THREE.Shape(pts);
}

// A knob with cosine finger lobes — grippier than a plain disc and still one
// closed outline, so it needs no boolean.
function eKnobShape(r, lobes, depth){
  const n=240, pts=[];
  for(let i=0;i<n;i++){
    const t=2*Math.PI*i/n;
    const rr=r-depth*0.5*(1+Math.cos(lobes*t));
    pts.push(new THREE.Vector2(rr*Math.cos(t), rr*Math.sin(t)));
  }
  return new THREE.Shape(pts);
}

// ── Parameters ─────────────────────────────────────────────────
// Derived numbers in one place, so the UI, the flat view and the mesh can't
// drift apart. wrap is the design length around the roller; the diameter
// follows from it.
function eParams(m){
  const wrap=Math.max(10, +m.wrapMM||85.6);
  const dia=wrap/Math.PI;
  const repeat=Math.max(1, Math.round(+m.repeatCount||1));
  const gearT=Math.max(2, +m.gearMM||4);
  const plateT=Math.max(2, +m.plateMM||4);
  const CL=0.6;                                   // axial slop either side of a plate
  const zBody=gearT+plateT+CL;
  return {
    wrap, dia, repeat,
    tileU: wrap/repeat,
    width: Math.max(5, +m.widthMM||54),
    emboss: Math.max(0.1, +m.embossMM||0.6),
    paper: Math.max(0, +m.paperMM||0.3),
    clear: +m.clearanceMM||0,
    axle: Math.max(2, +m.axleMM||5),
    teeth: Math.max(8, Math.round(+m.gearTeeth||18)),
    gearT, plateT, CL, zBody,
    post: Math.max(3, +m.postMM||6),
    knob: Math.max(10, +m.knobMM||26),
    nip: Math.max(0, +m.nipMM||0.4),
    margin: Math.max(3, +m.marginMM||7),
    stub: 9,                                      // knob-end axle, mm
  };
}
function eCentreDist(p){ return p.dia+p.nip; }

// ── Rollers ────────────────────────────────────────────────────
// `which`: 'emboss' (artwork raised) or 'deboss' (artwork recessed). Each
// roller is gear, axle, body, axle, flatted knob stub along +Z, with the
// artwork on the body. Returns { solid:[geo], cut:[geo] } — `cut` is the
// recessed roller's artwork, which the slicer subtracts as a negative part.
function eBuildRoller(paths, p, which){
  const R=p.dia/2;
  const solid=[], cut=[];
  const emboss = which==='emboss';

  // Phases put a tooth of the raised roller into a gap of the recessed one at
  // the nip (the rollers sit one above the other, so they mesh at ±90°).
  const phase = emboss ? -Math.PI/2 : Math.PI/2-Math.PI/p.teeth;
  solid.push(eExtrudeZ([eGearShape(p.teeth, R, phase)], p.gearT, 0));

  // Registration dot at u = 0 on the gear's outer face: line both dots up and
  // the raised pattern meets its recess.
  const dot=eCylZ(1.1, 1.2, -1.2, 20);
  dot.applyMatrix4(new THREE.Matrix4().makeTranslation(R*0.62, 0, 0));
  solid.push(dot);

  solid.push(eCylZ(p.axle/2, p.plateT+p.CL+0.3, p.gearT-0.3));
  solid.push(eCylZ(R, p.width, p.zBody));
  const zEnd=p.zBody+p.width;
  solid.push(eCylZ(p.axle/2, p.plateT+p.CL, zEnd));
  solid.push(eExtrudeZ([eDShape(p.axle/2, p.axle*0.22)], p.stub, zEnd+p.plateT+p.CL));

  const art=eWrapArtwork(paths, p, emboss
    // Raised: sunk 0.3 mm into the body so the two shells fuse.
    ? { rIn: R-0.3, rOut: R+p.emboss }
    // Recessed: starts above the surface so the cut reaches it, and goes deep
    // enough for the bump plus the paper it folds in.
    : { rIn: R-(p.emboss+p.paper), rOut: R+0.4, grow: p.clear, mirror: true });
  for(const g of art){
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, p.zBody));
    (emboss ? solid : cut).push(_badgeMergeVerticesForExport(g));
  }
  return { solid, cut };
}

// ── Body ───────────────────────────────────────────────────────
// Two side plates in the XY plane with the rollers between them. The card
// passes between the plates and through the nip, so the plates need no slot —
// they just have to stand further apart than the card is wide.
function eBuildBody(p){
  const cd=eCentreDist(p);
  const R=p.dia/2;
  const halfW=R+p.margin, halfH=cd/2+R+p.margin;
  const bore=p.axle/2+0.2;
  const px=halfW-p.margin*0.85, py=halfH-p.margin*0.85;
  const posts=[[px,py],[-px,py],[px,-py],[-px,-py]];

  const plate=cut=>{
    const s=eRoundRect(halfW*2, halfH*2, p.margin*0.8);
    s.holes.push(eCirclePath(0,  cd/2, bore));
    s.holes.push(eCirclePath(0, -cd/2, bore));
    if(cut) for(const [x,y] of posts) s.holes.push(eCirclePath(x, y, p.post/2+0.12));
    return s;
  };

  // Posts belong to the left plate and press into the right one. Printed
  // post-side up they need no support, and the whole body is two parts.
  const postLen=p.CL+p.width+p.CL+p.plateT;
  const left=[eExtrudeZ([plate(false)], p.plateT, p.gearT)];
  for(const [x,y] of posts){
    const g=eCylZ(p.post/2, postLen, p.gearT+p.plateT, 32);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, 0));
    left.push(g);
  }
  const right=[eExtrudeZ([plate(true)], p.plateT, p.zBody+p.width+p.CL)];

  const knobShape=eKnobShape(p.knob/2, 8, p.knob*0.07);
  knobShape.holes.push(new THREE.Path(eDShape(p.axle/2+0.18, p.axle*0.22).getPoints(56).reverse()));
  const knob=eExtrudeZ([knobShape], 8, p.zBody+p.width+p.CL+p.plateT+0.5);
  knob.applyMatrix4(new THREE.Matrix4().makeTranslation(0, cd/2, 0));

  return { left, right, knob };
}

// ── Whole assembly ─────────────────────────────────────────────
// Every part in its assembled position: one coordinate system for the preview
// and the export, so what you see is what the slicer gets.
// Returns [{ name, geo, negative }].
function eBuildAssembly(paths, p){
  const cd=eCentreDist(p);
  const out=[];
  const at=(geos, y) => {
    const mv=new THREE.Matrix4().makeTranslation(0, y, 0);
    return geos.map(g => { const c=g.clone(); c.applyMatrix4(mv); return c; });
  };

  const top=eBuildRoller(paths, p, 'emboss');
  const bot=eBuildRoller(paths, p, 'deboss');
  out.push({ name:'Roller_Emboss', geo:_badgeConcatGeometries(at(top.solid,  cd/2)) });
  out.push({ name:'Roller_Deboss', geo:_badgeConcatGeometries(at(bot.solid, -cd/2)) });
  if(bot.cut.length) out.push({ name:'Roller_Deboss_Recess', geo:_badgeConcatGeometries(at(bot.cut, -cd/2)), negative:true });

  const body=eBuildBody(p);
  out.push({ name:'Body_Plate_Posts', geo:_badgeConcatGeometries(body.left) });
  out.push({ name:'Body_Plate_Plain', geo:_badgeConcatGeometries(body.right) });
  out.push({ name:'Knob', geo:body.knob });
  return out;
}
