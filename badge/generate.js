// ── Badge 3MF Generator ─────────────────────────────────────────
// Pure computation module. No DOM reads, no globals, no auth.
// Loaded dynamically by the main app when the Generate Badge button is clicked.
// Requires THREE, ClipperLib, opentype to be loaded first.

const BADGE_FONT_SIZE_MM = 49;
const BADGE_SCALE        = 1000;
const BADGE_HOLE_W       = 46;
const BADGE_HOLE_H       = 14;
const BADGE_LAYER_NAMES  = ['Red', 'Yellow', 'Black', 'Jade White'];
const BADGE_FONT_PATH    = '/badge/LEGO.TTF';

let _badgeFont = null;

function badgeBackingConfig(backing) {
  if (backing === 'Pin')    return { w: 32, h: 7,  d: 2, name: 'pin' };
  if (backing === 'Magnet') return { w: 46, h: 14, d: 2, name: 'magnet' };
  return null;
}

function badgeClipper_commandsToClipper(cmds) {
  const polys = []; let cur = null, lx = 0, ly = 0;
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur?.length > 2) polys.push(cur);
      cur = [{ X: Math.round(c.x * BADGE_SCALE), Y: Math.round(c.y * BADGE_SCALE) }];
      lx = c.x; ly = c.y;
    } else if (c.type === 'L') {
      cur?.push({ X: Math.round(c.x * BADGE_SCALE), Y: Math.round(c.y * BADGE_SCALE) });
      lx = c.x; ly = c.y;
    } else if (c.type === 'C') {
      for (let t = 0.1; t <= 1.001; t += 0.1) {
        const u = 1 - t;
        cur?.push({ X: Math.round((u*u*u*lx+3*u*u*t*c.x1+3*u*t*t*c.x2+t*t*t*c.x)*BADGE_SCALE), Y: Math.round((u*u*u*ly+3*u*u*t*c.y1+3*u*t*t*c.y2+t*t*t*c.y)*BADGE_SCALE) });
      }
      lx = c.x; ly = c.y;
    } else if (c.type === 'Q') {
      for (let t = 0.1; t <= 1.001; t += 0.1) {
        const u = 1 - t;
        cur?.push({ X: Math.round((u*u*lx+2*u*t*c.x1+t*t*c.x)*BADGE_SCALE), Y: Math.round((u*u*ly+2*u*t*c.y1+t*t*c.y)*BADGE_SCALE) });
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

function badgeClipper_union(polys) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(polys, ClipperLib.PolyType.ptSubject, true);
  const result = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, result, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return result;
}

function badgeClipper_offset(paths, deltaMM) {
  const co = new ClipperLib.ClipperOffset();
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const result = new ClipperLib.Paths();
  co.Execute(result, deltaMM * BADGE_SCALE);
  return result;
}

function badgeBboxCentre(paths) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const path of paths) for (const pt of path) {
    if (pt.X < minX) minX = pt.X; if (pt.X > maxX) maxX = pt.X;
    if (pt.Y < minY) minY = pt.Y; if (pt.Y > maxY) maxY = pt.Y;
  }
  return { offX: (minX+maxX)/2/BADGE_SCALE, offY: (minY+maxY)/2/BADGE_SCALE };
}

function badgeMergeVertices(geo) {
  const nonIdx = geo.toNonIndexed(), pos = nonIdx.attributes.position;
  const map = new Map(), newPos = [], newIdx = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x*1e4)},${Math.round(y*1e4)},${Math.round(z*1e4)}`;
    if (!map.has(key)) { map.set(key, newPos.length/3); newPos.push(x,y,z); }
    newIdx.push(map.get(key));
  }
  const filteredIdx = [];
  for (let i = 0; i < newIdx.length; i += 3)
    if (newIdx[i]!==newIdx[i+1]&&newIdx[i+1]!==newIdx[i+2]&&newIdx[i]!==newIdx[i+2])
      filteredIdx.push(newIdx[i],newIdx[i+1],newIdx[i+2]);
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(filteredIdx), 1));
  return result;
}

function badgeBuildSolidExtrusion(clipperOuters, depth, offX, offY) {
  const positions = [], indices = [];
  for (const outer of clipperOuters) {
    if (!ClipperLib.Clipper.Orientation(outer)) continue;
    const n = outer.length; if (n < 3) continue;
    const base = positions.length/3;
    const pts = outer.map(p => [p.X/BADGE_SCALE-offX, offY-p.Y/BADGE_SCALE]);
    for (const [x,y] of pts) positions.push(x,y,0);
    for (const [x,y] of pts) positions.push(x,y,depth);
    for (let i = 0; i < n; i++) {
      const j=(i+1)%n, b0=base+i, b1=base+j, t0=base+n+i, t1=base+n+j;
      indices.push(b0,b1,t0, b1,t1,t0);
    }
    const v2 = pts.map(([x,y]) => new THREE.Vector2(x,y));
    const cap = THREE.ShapeUtils.triangulateShape(v2,[]);
    for (const [a,b,c] of cap) {
      indices.push(base+n+a,base+n+b,base+n+c);
      indices.push(base+a,base+c,base+b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions),3));
  geo.setIndex(indices);
  return geo;
}

function badgeMakeCutoutGeo(w,h,d) {
  const geo = new THREE.BoxGeometry(w,h,d);
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0,0,-d/2));
  return geo;
}

function badgeBuild3MF(objects, name) {
  let objXml='', comps='';
  objects.forEach(obj => {
    const pos=obj.geo.attributes.position, idx=obj.geo.index;
    let verts='', tris='';
    for (let i=0;i<pos.count;i++) verts+=`   <vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}"/>\n`;
    if (idx) { for (let i=0;i<idx.count;i+=3) tris+=`   <triangle v1="${idx.getX(i)}" v2="${idx.getX(i+1)}" v3="${idx.getX(i+2)}"/>\n`; }
    else     { for (let i=0;i<pos.count;i+=3) tris+=`   <triangle v1="${i}" v2="${i+1}" v3="${i+2}"/>\n`; }
    objXml+=`  <object id="${obj.id}" type="${obj.negative?'other':'model'}" name="${obj.name}">\n   <mesh>\n    <vertices>\n${verts}    </vertices>\n    <triangles>\n${tris}    </triangles>\n   </mesh>\n  </object>\n`;
    comps+=`    <component objectid="${obj.id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n`;
  });
  const wId=objects.length+1;
  objXml+=`  <object id="${wId}" type="model" name="${name}">\n   <components>\n${comps}   </components>\n  </object>\n`;
  const modelXml=`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <resources>\n${objXml} </resources>\n <build>\n  <item objectid="${wId}"/>\n </build>\n</model>`;
  let parts='';
  objects.forEach(obj => { parts+=`    <part id="${obj.id}" subtype="${obj.negative?'negative_part':'normal_part'}">\n      <metadata key="name" value="${obj.name}"/>\n      <metadata key="extruder" value="${obj.extruder}"/>\n    </part>\n`; });
  const modelSettings=`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="${wId}">\n    <metadata key="name" value="${name}"/>\n    <metadata key="extruder" value="1"/>\n${parts}  </object>\n</config>`;
  const filamentColours=objects.filter(o=>!o.negative).map(o=>o.colour);
  const n=filamentColours.length;
  const projectSettings=JSON.stringify({from:'project',name:'project_settings',version:'02.04.00.70',printer_model:'Bambu Lab H2C',printer_settings_id:'Bambu Lab H2C 0.4 nozzle',filament_colour:filamentColours,filament_multi_colour:filamentColours,filament_type:Array(n).fill('PLA'),filament_settings_id:Array(n).fill('Bambu PLA Basic @BBL H2C'),filament_vendor:Array(n).fill('Bambu Lab'),filament_is_support:Array(n).fill('0'),filament_ids:Array(n).fill('GFA00')});
  return { modelXml, modelSettings, projectSettings };
}

function badgeCrc32(data) {
  let c=0xFFFFFFFF;
  for (let i=0;i<data.length;i++){c^=data[i];for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xEDB88320:0);}
  return(c^0xFFFFFFFF)>>>0;
}

function badgeBuildZip({modelXml, modelSettings, projectSettings}) {
  const enc=new TextEncoder();
  const files=[
    {name:'[Content_Types].xml', data:enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/></Types>`)},
    {name:'_rels/.rels', data:enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/model_settings.config" Id="rel1" Type="http://schemas.bambulab.com/package/2021/model-settings"/><Relationship Target="/Metadata/project_settings.config" Id="rel2" Type="http://schemas.bambulab.com/package/2021/project-settings"/></Relationships>`)},
    {name:'3D/3dmodel.model', data:enc.encode(modelXml)},
    {name:'Metadata/model_settings.config', data:enc.encode(modelSettings)},
    {name:'Metadata/project_settings.config', data:enc.encode(projectSettings)},
  ];
  const parts=[], cd=[]; let off=0;
  for (const f of files) {
    const nb=enc.encode(f.name), d=f.data, crc=badgeCrc32(d);
    const loc=new Uint8Array(30+nb.length+d.length), dv=new DataView(loc.buffer);
    dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0,true);dv.setUint16(8,0,true);dv.setUint16(10,0,true);dv.setUint16(12,0,true);dv.setUint32(14,crc,true);dv.setUint32(18,d.length,true);dv.setUint32(22,d.length,true);dv.setUint16(26,nb.length,true);dv.setUint16(28,0,true);
    loc.set(nb,30); loc.set(d,30+nb.length); parts.push(loc);
    const ce=new Uint8Array(46+nb.length), cv=new DataView(ce.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0,true);cv.setUint16(10,0,true);cv.setUint16(12,0,true);cv.setUint16(14,0,true);cv.setUint32(16,crc,true);cv.setUint32(20,d.length,true);cv.setUint32(24,d.length,true);cv.setUint16(28,nb.length,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);cv.setUint32(42,off,true);
    ce.set(nb,46); cd.push(ce); off+=loc.length;
  }
  const cdSize=cd.reduce((s,c)=>s+c.length,0);
  const eocd=new Uint8Array(22), ev=new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,cdSize,true);ev.setUint32(16,off,true);ev.setUint16(20,0,true);
  const all=[...parts,...cd,eocd];
  const res=new Uint8Array(all.reduce((s,p)=>s+p.length,0));
  let p=0; for (const a of all){res.set(a,p);p+=a.length;}
  return res;
}

// ── Main entry point ────────────────────────────────────────────
// opts: { name, layerConfig, backing, font, fontSize }
function badgeGenerate3MF(opts) {
  const { name, layerConfig, backing, font, fontSize = BADGE_FONT_SIZE_MM } = opts;
  const fsize = fontSize;
  const polys = badgeClipper_commandsToClipper(font.getPath(name, 0, 0, fsize).commands);
  const unioned = badgeClipper_union(polys);
  const { offX, offY } = badgeBboxCentre(unioned);
  const backingCfg = badgeBackingConfig(backing);

  let zOff = 0;
  const objects = [];

  for (let i = 0; i < layerConfig.length; i++) {
    const layer = layerConfig[i];
    const slotD = layer.hasSlot ? (backingCfg?.d ?? 2) : 0;
    let geo;
    if (layer.isText) {
      const shapePath = new THREE.ShapePath();
      const cmds = font.getPath(name, 0, 0, fsize).commands;
      for (const c of cmds) {
        if      (c.type==='M') shapePath.moveTo(c.x-offX, offY-c.y);
        else if (c.type==='L') shapePath.lineTo(c.x-offX, offY-c.y);
        else if (c.type==='C') shapePath.bezierCurveTo(c.x1-offX,offY-c.y1,c.x2-offX,offY-c.y2,c.x-offX,offY-c.y);
        else if (c.type==='Q') shapePath.quadraticCurveTo(c.x1-offX,offY-c.y1,c.x-offX,offY-c.y);
        else if (c.type==='Z') shapePath.currentPath.closePath();
      }
      geo = new THREE.ExtrudeGeometry(shapePath.toShapes(false), { depth: layer.depth, bevelEnabled: false });
      geo = badgeMergeVertices(geo);
    } else {
      const working = layer.border > 0 ? badgeClipper_offset(unioned, layer.border) : unioned;
      const outers = working.filter(p => ClipperLib.Clipper.Orientation(p));
      geo = badgeBuildSolidExtrusion(outers, slotD + layer.depth, offX, offY);
    }
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, zOff));
    objects.push({ geo, name: BADGE_LAYER_NAMES[i]||`layer${i+1}`, colour: layer.hex, extruder: i+1, id: objects.length+1 });
    zOff += slotD + layer.depth;
  }

  if (backingCfg && objects.length > 0) {
    let cutGeo = badgeMakeCutoutGeo(backingCfg.w, backingCfg.h, backingCfg.d);
    cutGeo = badgeMergeVertices(cutGeo);
    cutGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, backingCfg.d));
    objects.push({ geo: cutGeo, name: `${backingCfg.name}_cutout`, colour: '#000000', extruder: 1, id: objects.length+1, negative: true });
  }

  const tmfData = badgeBuild3MF(objects, name);
  return badgeBuildZip(tmfData);
}

// ── Font loader (cached) ────────────────────────────────────────
async function badgeLoadFont() {
  if (_badgeFont) return _badgeFont;
  return new Promise((resolve, reject) => {
    opentype.load(BADGE_FONT_PATH, (err, f) => {
      if (err) reject(err); else { _badgeFont = f; resolve(f); }
    });
  });
}
