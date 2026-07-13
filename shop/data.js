// Trimmed copy of badge/data.js for the customer shop — keeps the colour/model/
// layer engine, drops badge-admin login, 3MF export, "save model defaults", and
// the "previously used colour combos" convenience picker (admin-only, reads all orders).
const LAYER_NAMES = ['Red', 'Yellow', 'Black', 'Jade White'];

const MODEL_TYPES = [
  { id: 'badge-magnet',       label: 'Badge - Magnet',       backing: 'Magnet'       },
  { id: 'badge-pin',          label: 'Badge - Pin',          backing: 'Pin'          },
  { id: 'badge-round-magnet', label: 'Badge - Round Magnet', backing: 'Round Magnet' },
  { id: 'keychain',           label: 'Keychain',             backing: 'Keychain'     },
  { id: 'dog-tag',            label: 'Dog Tag',              backing: 'Magnet'       },
  { id: 'plaque',             label: 'Plaque',               backing: 'Magnet'       },
];

function getDefaultLayerConfig() {
  return [
    { id: null, model_id: null, order: 0, hex: '#c0392b', colourId: null, border: 3,   depth: 1, hasSlot: true,  isText: false },
    { id: null, model_id: null, order: 1, hex: '#f1c40f', colourId: null, border: 1.5, depth: 1, hasSlot: false, isText: false },
    { id: null, model_id: null, order: 2, hex: '#1a1a1a', colourId: null, border: 0.5, depth: 1, hasSlot: false, isText: false },
    { id: null, model_id: null, order: 3, hex: '#e8e8e6', colourId: null, border: 0,   depth: 1, hasSlot: true,  isText: true  },
  ];
}

// ponytail: no admin "Advanced" panel exists in the shop, so this is a no-op —
// kept only because loadModel() still calls it and every lookup guards on null.
function updateAdvancedPanel(typeId) {
  const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };
  show('sectionBackingPos',  ['badge-magnet','badge-pin','dog-tag','plaque'].includes(typeId));
  show('sectionRndMag',      typeId === 'badge-round-magnet');
  show('sectionKeychain',    typeId === 'keychain');
}

// ── Supabase ──────────────────────────────────────────────────
const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(window.sbToken||SB_KEY),'Content-Type':'application/json','Prefer':'return=representation'}; }
async function sbGet(table,q=''){ const r=await fetch(`${SB_URL}/rest/v1/${table}${q}`,{headers:sbHeaders()}); return r.json(); }

// ── Data ──────────────────────────────────────────────────────
let colours=[], models=[], currentModel=null, layerConfig=[];

function setStatus(msg,cls=''){
  const el=document.getElementById('status');
  if(!el) return;
  el.textContent=msg; el.className='status'+(cls?' '+cls:'');
}

async function loadColours(){ colours=await sbGet('colours','?available=eq.true&order=id'); }
async function loadModelsList(){
  models=await sbGet('badge_models','?archived=eq.false&order=name');
  document.getElementById('modelSelect').innerHTML=MODEL_TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('');
}

// Called by shop.js once it has decided the MODEL_TYPES id for the selected
// category/backing combo and set #modelSelect's value.
async function loadModel(){
  const typeId=document.getElementById('modelSelect').value;
  const type=MODEL_TYPES.find(t=>t.id===typeId); if(!type) return;
  currentModel=models.find(m=>m.name===type.label)||null;
  updateAdvancedPanel(typeId);

  if(!currentModel){
    layerConfig=getDefaultLayerConfig();
    buildLayerUI();
    renderReady();
    return;
  }

  const [layers,settings]=await Promise.all([
    sbGet('badge_model_layers',`?model_id=eq.${currentModel.id}&order=layer_order`),
    sbGet('badge_model_settings',`?model_id=eq.${currentModel.id}`),
  ]);

  layerConfig=layers.length?layers.map((l,i)=>({
    id:l.id, model_id:l.model_id, order:l.layer_order,
    hex:l.colour_hex, colourId:l.colour_id,
    border:l.border_mm, depth:l.thickness_mm,
    hasSlot:i===0, isText:!l.filled,
  })):getDefaultLayerConfig();

  const s=settings[0]||{};
  const fs=document.getElementById('fontSize'); if(fs) fs.value=currentModel.font_size||49;
  const ls=document.getElementById('letterSpacing'); if(ls) ls.value=s.letter_spacing||0;
  const ws=document.getElementById('wordSpacing'); if(ws) ws.value=s.word_spacing||0;
  if(s.round_magnet_diameter!=null)  document.getElementById('rndMagDiam')?.setAttribute('value',s.round_magnet_diameter);
  if(s.round_magnet_depth!=null)     document.getElementById('rndMagDepth')?.setAttribute('value',s.round_magnet_depth);
  if(s.round_magnet_threshold!=null) document.getElementById('rndMagThreshold')?.setAttribute('value',s.round_magnet_threshold);
  // Site-wide default view for this product type (set via the staff-only
  // camera controls) — applies to every visitor, not just whoever saved it.
  if(s.def_rot_x!=null && s.def_rot_y!=null && s.def_zoom!=null && typeof resetView==='function'){
    defRotX=+s.def_rot_x; defRotY=+s.def_rot_y; defZoom=+s.def_zoom;
    resetView();
  }

  buildLayerUI();

  const fontPath=currentModel.font_path||FONT_PATH;
  const doRender = ()=>{ renderReady(); };
  if(!font){
    opentype.load(fontPath,(err,f)=>{
      if(err){setStatus('Could not load font','err');return;}
      font=f; doRender();
    });
  } else {
    doRender();
  }
}

function renderReady(){
  if(!font){
    opentype.load(FONT_PATH,(err,f)=>{
      if(err){setStatus('Could not load font','err');return;}
      font=f; buildBadge();
    });
  } else {
    buildBadge();
  }
}

// ── Layer UI (customer-facing colour picker) ───────────────────
let openPickerId=null;

function buildLayerUI(){
  const colList=document.getElementById('layerColoursList');
  colList.innerHTML=layerConfig.map((l,i)=>`
    <div class="layer-colour-row">
      <span class="layer-colour-label">${LAYER_NAMES[i] || 'Layer '+(i+1)}</span>
      <div class="colour-picker-wrap" id="cpw-${i}">
        <div class="colour-picker-btn" onclick="toggleCp(${i},this)">
          <div class="cp-swatch" id="cps-${i}" style="background:${l.hex}"></div>
          <span class="cp-label" id="cpl-${i}">${colourName(l.hex)}</span>
          <i class="ti ti-chevron-down" style="font-size:11px;color:var(--muted);flex-shrink:0"></i>
        </div>
        <div class="colour-picker-list" id="cplist-${i}" style="display:none">
          ${colours.map(c=>`<div class="cp-option" onclick="selectColour(${i},'${c.code}','${c.id}','${c.name}')"><div class="cp-swatch" style="background:${c.code}"></div><span>${c.name}</span></div>`).join('')}
        </div>
      </div>
    </div>`).join('');
}

function colourName(hex){ const c=colours.find(c=>c.code?.toLowerCase()===hex?.toLowerCase()); return c?c.name:hex; }

function toggleCp(i,btn){
  if(openPickerId!==null&&openPickerId!==i){ const prev=document.getElementById('cplist-'+openPickerId); if(prev) prev.style.display='none'; }
  const list=document.getElementById('cplist-'+i);
  if(list.style.display!=='none'){list.style.display='none';openPickerId=null;return;}
  const rect=btn.getBoundingClientRect();
  list.style.top=(rect.bottom+4)+'px'; list.style.left=rect.left+'px'; list.style.width=rect.width+'px';
  list.style.display=''; openPickerId=i;
}

function selectColour(i,hex,colId,name){
  layerConfig[i].hex=hex; layerConfig[i].colourId=colId;
  document.getElementById('cps-'+i).style.background=hex;
  document.getElementById('cpl-'+i).textContent=name;
  document.getElementById('cplist-'+i).style.display='none';
  openPickerId=null; scheduleRender();
  if(window.onShopOptionsChanged) window.onShopOptionsChanged();
}

document.addEventListener('click', e => {
  if (openPickerId !== null && !e.target.closest('.colour-picker-wrap')) {
    const el = document.getElementById('cplist-' + openPickerId); if (el) el.style.display = 'none'; openPickerId = null;
  }
});
