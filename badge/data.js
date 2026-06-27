const LAYER_NAMES = ['Red', 'Yellow', 'Black', 'Jade White'];

// ── Supabase ──────────────────────────────────────────────────
const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';
let sbToken=null, currentUser=null;

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(sbToken||SB_KEY),'Content-Type':'application/json','Prefer':'return=representation'}; }
async function sbGet(table,q=''){ const r=await fetch(`${SB_URL}/rest/v1/${table}${q}`,{headers:sbHeaders()}); return r.json(); }
async function sbPatch(table,q,row){ const r=await fetch(`${SB_URL}/rest/v1/${table}${q}`,{method:'PATCH',headers:sbHeaders(),body:JSON.stringify(row)}); if(!r.ok) return await r.json(); return null; }
async function sbUpsert(table,row){ const r=await fetch(`${SB_URL}/rest/v1/${table}`,{method:'POST',headers:{...sbHeaders(),'Prefer':'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)}); return r.json(); }

// ── Auth ──────────────────────────────────────────────────────
async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value;
  const errEl=document.getElementById('loginError');
  const btn=document.getElementById('loginBtn');
  errEl.style.display='none';
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Signing in…';
  try{
    const res=await fetch(`${SB_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'apikey':SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const data=await res.json();
    if(data.error) throw new Error(data.error_description||data.error);
    sbToken=data.access_token; currentUser=data.user;
    localStorage.setItem('badge2_token',sbToken);
    showApp();
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='block';
    btn.disabled=false; btn.innerHTML='<i class="ti ti-login"></i> Sign in';
  }
}

async function restoreSession(){
  const t=localStorage.getItem('badge2_token')||localStorage.getItem('pd_access_token')||localStorage.getItem('pd_token'); if(!t) return false;
  try{
    const res=await fetch(`${SB_URL}/auth/v1/user`,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+t}});
    if(!res.ok) return false;
    sbToken=t; currentUser=await res.json(); return true;
  }catch(e){ return false; }
}

function doLogout(){
  localStorage.removeItem('badge2_token');
  sbToken=null; currentUser=null;
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}

async function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='flex';
  document.getElementById('userChip').textContent=currentUser?.user_metadata?.display_name||currentUser?.email||'';
  const saved=localStorage.getItem('badge2_lastName');
  if(saved){ const el=document.getElementById('nameInput'); el.value=saved; updateNameClear(el); }
  await loadColours();
  await loadModels();
}

// ── URL param pre-fill (from PrintDesk Generate Badge link) ───
let _urlParamsApplied=false;
function applyUrlParams(){
  if(_urlParamsApplied) return; _urlParamsApplied=true;
  const p=new URLSearchParams(location.search);
  const name=p.get('name'), backing=p.get('backing'), colourStr=p.get('colours');
  if(!name&&!backing&&!colourStr) return;
  if(name){
    const el=document.getElementById('nameInput');
    el.value=name; localStorage.setItem('badge2_lastName',name); updateNameClear(el);
  }
  if(backing){ const sel=document.getElementById('backingSelect'); if(sel) sel.value=backing; }
  if(colourStr){
    colourStr.split('|').map(s=>s.trim()).forEach((n,i)=>{
      if(i>=layerConfig.length) return;
      const c=colours.find(c=>c.name.toLowerCase()===n.toLowerCase());
      if(c){ layerConfig[i].hex=c.code; layerConfig[i].colourId=c.id; }
    });
    buildLayerUI();
  }
  scheduleRender();
}

function onNameInput(){
  const el=document.getElementById('nameInput');
  localStorage.setItem('badge2_lastName',el.value);
  updateNameClear(el);
  scheduleRender();
}

function updateNameClear(el){
  document.getElementById('nameClearBtn').style.display=el.value?'flex':'none';
}

function clearName(){
  const el=document.getElementById('nameInput');
  el.value=''; localStorage.removeItem('badge2_lastName');
  updateNameClear(el); scheduleRender();
}

// ── Data ──────────────────────────────────────────────────────
// layerConfig uses badge2 format: {id, model_id, order, hex, colourId, border, depth, hasSlot, isText}
let colours=[], models=[], currentModel=null, layerConfig=[];

function setStatus(msg,cls=''){
  const el=document.getElementById('status');
  if(!el) return;
  el.textContent=msg; el.className='status'+(cls?' '+cls:'');
}

async function loadColours(){ colours=await sbGet('colours','?available=eq.true&order=id'); }

async function loadModels(){
  models=await sbGet('badge_models','?archived=eq.false&order=name');
  const sel=document.getElementById('modelSelect');
  sel.innerHTML=models.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  if(models.length) await loadModel();
}

async function loadModel(){
  const id=document.getElementById('modelSelect').value;
  currentModel=models.find(m=>m.id===id); if(!currentModel) return;
  const [layers,settings,prefs]=await Promise.all([
    sbGet('badge_model_layers',`?model_id=eq.${id}&order=layer_order`),
    sbGet('badge_model_settings',`?model_id=eq.${id}`),
    sbGet('badge_user_preferences',`?model_id=eq.${id}&user_id=eq.${currentUser.id}`)
  ]);

  // Map Supabase layers to badge2 format (filled=false → isText)
  layerConfig=layers.map((l,i)=>({
    id:l.id, model_id:l.model_id, order:l.layer_order,
    hex:l.colour_hex, colourId:l.colour_id,
    border:l.border_mm, depth:l.thickness_mm,
    hasSlot:i===0, isText:!l.filled,
  }));

  const s=settings[0]||{};
  document.getElementById('fontSize').value=currentModel.font_size||49;
  document.getElementById('letterSpacing').value=s.letter_spacing||0;
  if(s.round_magnet_diameter!=null)  document.getElementById('rndMagDiam').value=s.round_magnet_diameter;
  if(s.round_magnet_depth!=null)     document.getElementById('rndMagDepth').value=s.round_magnet_depth;
  if(s.round_magnet_threshold!=null) document.getElementById('rndMagThreshold').value=s.round_magnet_threshold;

  const p=prefs[0]||{};
  defRotX=parseFloat(p.def_rot_x??'-0.4');
  defRotY=parseFloat(p.def_rot_y??'0.2');
  defZoom=parseFloat(p.def_zoom??'1');
  scrollZoomSpeed=parseFloat(p.zoom_speed??'0.01');
  resetView();
  const zs=document.getElementById('zoomSpd'),zsn=document.getElementById('zoomSpdN');
  if(zs){zs.value=scrollZoomSpeed;zsn.value=scrollZoomSpeed.toFixed(3);}

  buildLayerUI();
  loadRndMagSettings();
  applyUrlParams();
  loadPreviousCombos();
  setStatus('');

  const fontPath=currentModel.font_path||FONT_PATH;
  const doAutoExport=()=>{
    if(new URLSearchParams(location.search).get('autoExport')!=='1') return;
    try{ exportTMF(); } catch(e){ console.error('Badge auto-export failed',e); }
  };
  if(!font){
    setStatus('Loading font…');
    opentype.load(fontPath,(err,f)=>{
      if(err){setStatus('Could not load font: '+fontPath,'err');return;}
      font=f; setStatus('Ready','ok');
      document.getElementById('exportBtn').disabled=false;
      buildBadge(); doAutoExport();
    });
  } else {
    document.getElementById('exportBtn').disabled=false;
    buildBadge(); doAutoExport();
  }
}

async function saveModelSettings(){
  const id=currentModel?.id; if(!id) return;
  setStatus('Saving…');
  try{
    const fontSize=+document.getElementById('fontSize').value;
    const letterSpacing=+document.getElementById('letterSpacing').value;

    const mRes=await sbPatch('badge_models',`?id=eq.${id}`,{font_size:fontSize});
    if(mRes) throw new Error(mRes.message||mRes.error||'badge_models save failed');
    currentModel.font_size=fontSize;

    const existing=await sbGet('badge_model_settings',`?model_id=eq.${id}`);
    const sRes=await sbUpsert('badge_model_settings',{
      ...(existing[0]?{id:existing[0].id}:{}),
      model_id:id,
      letter_spacing:letterSpacing,
      round_magnet_diameter:  +document.getElementById('rndMagDiam').value||17.15,
      round_magnet_depth:     +document.getElementById('rndMagDepth').value||2,
      round_magnet_threshold: +document.getElementById('rndMagThreshold').value||60,
    });
    if(sRes?.code||sRes?.error) throw new Error(sRes.message||sRes.error||'badge_model_settings save failed');

    for(const l of layerConfig){
      const lRes=await sbUpsert('badge_model_layers',{
        id:l.id, model_id:l.model_id, layer_order:l.order,
        colour_id:l.colourId||null, colour_hex:l.hex,
        border_mm:l.border, thickness_mm:l.depth, filled:!l.isText,
      });
      if(lRes?.code||lRes?.error) throw new Error(lRes.message||lRes.error||`layer ${l.order} save failed`);
    }
    setStatus('Saved','ok'); setTimeout(()=>setStatus(''),2000);
  }catch(e){
    setStatus('Save failed: '+e.message,'err');
  }
}

// ── Layer UI ──────────────────────────────────────────────────
let openPickerId=null, openCombo=false, previousCombos=[];

function loadRndMagSettings(){
  const el=(id,key,def)=>{const e=document.getElementById(id);if(e)e.value=localStorage.getItem(key)||def;};
  el('rndMagDiam','badge2_rndDiam','17.15');
  el('rndMagDepth','badge2_rndDepth','2');
  el('rndMagThreshold','badge2_rndThreshold','60');
}
function saveRndMagSettings(){
  const v=(id,def)=>document.getElementById(id)?.value||def;
  localStorage.setItem('badge2_rndDiam',      v('rndMagDiam','17.15'));
  localStorage.setItem('badge2_rndDepth',     v('rndMagDepth','2'));
  localStorage.setItem('badge2_rndThreshold', v('rndMagThreshold','60'));
}

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

  const settingsEl=document.getElementById('layerSettings');
  settingsEl.innerHTML=layerConfig.map((l,i)=>`
    <div class="layer-setting-block">
      <div class="layer-setting-header">
        <div style="width:10px;height:10px;border-radius:2px;background:${l.hex};border:1px solid rgba(255,255,255,0.15)"></div>
        ${LAYER_NAMES[i] || 'Layer '+(i+1)}${l.isText?' (Text)':''}
      </div>
      ${l.isText
        ? `<div class="layer-setting-row"><label>Type</label><span style="font-size:11px;color:var(--muted)">Text layer</span></div>`
        : `<div class="layer-setting-row"><label>Border (mm)</label><input type="number" value="${l.border}" min="0" max="20" step="0.5" onchange="layerConfig[${i}].border=+this.value;scheduleRender()"></div>`
      }
      <div class="layer-setting-row"><label>Depth (mm)</label><input type="number" value="${l.depth}" min="0.5" max="10" step="0.5" onchange="layerConfig[${i}].depth=+this.value;scheduleRender()"></div>
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
  openPickerId=null; buildLayerUI(); scheduleRender();
}

async function loadPreviousCombos(){
  try{
    const orders=await sbGet('orders','?select=options&options=not.is.null&order=id.desc&limit=200');
    const seen=new Set(); previousCombos=[];
    for(const o of orders){
      if(!o.options) continue;
      const parts=o.options.split('||');
      const colourParts=parts.filter(p=>{const name=p.split(':')[0]?.toLowerCase()||'';return name.includes('colour')||name.includes('color');});
      if(!colourParts.length) continue;
      const colourNames=colourParts[0]?.split(':').slice(1).join(':').trim().split('|').map(s=>s.trim()).filter(Boolean)||[];
      if(colourNames.length!==layerConfig.length) continue;
      const key=colourNames.join('|'); if(seen.has(key)) continue; seen.add(key);
      const hexCodes=colourNames.map(name=>{const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());return{name,hex:c?.code||'#888888',id:c?.id||null};});
      previousCombos.push({key,colours:hexCodes});
      if(previousCombos.length>=20) break;
    }
  }catch(e){console.warn('Could not load combos:',e);}
  buildComboList();
}

function buildComboList(){
  const list=document.getElementById('comboList'); if(!list) return;
  list.innerHTML=[
    `<div class="cp-option" onclick="selectCombo('custom')"><i class="ti ti-adjustments" style="font-size:13px;color:var(--muted)"></i><span>Custom</span></div>`,
    previousCombos.length?'<div style="height:1px;background:var(--border);margin:4px 0"></div>':'',
    ...previousCombos.map((combo,i)=>`<div class="cp-option" onclick="selectCombo(${i})"><div style="display:flex;gap:3px">${combo.colours.map(c=>`<div class="combo-swatch" style="background:${c.hex}" title="${c.name}"></div>`).join('')}</div><span style="font-size:11px">${combo.colours.map(c=>c.name).join(' · ')}</span></div>`)
  ].join('');
  if(previousCombos.length>0) updateComboDisplay(previousCombos[0]);
  else selectCombo('custom');
}

function toggleComboList(btn){
  const list=document.getElementById('comboList');
  if(list.style.display!=='none'){list.style.display='none';openCombo=false;return;}
  const rect=btn.getBoundingClientRect();
  list.style.top=(rect.bottom+4)+'px'; list.style.left=rect.left+'px'; list.style.width=Math.max(rect.width,260)+'px';
  list.style.display=''; openCombo=true;
}

function selectCombo(idx){
  document.getElementById('comboList').style.display='none'; openCombo=false;
  if(idx==='custom'){
    document.getElementById('layerColoursList').style.display='flex';
    document.getElementById('comboLabel').textContent='Custom';
    document.getElementById('comboSwatches').innerHTML='<i class="ti ti-adjustments" style="font-size:13px;color:var(--muted)"></i>';
    return;
  }
  const combo=previousCombos[idx]; if(!combo) return;
  document.getElementById('layerColoursList').style.display='none';
  combo.colours.forEach((c,i)=>{
    if(i<layerConfig.length){ layerConfig[i].hex=c.hex; layerConfig[i].colourId=c.id; }
  });
  updateComboDisplay(combo); buildLayerUI(); scheduleRender();
}

function updateComboDisplay(combo){
  document.getElementById('comboSwatches').innerHTML=combo.colours.map(c=>`<div class="combo-swatch" style="background:${c.hex}" title="${c.name}"></div>`).join('');
  document.getElementById('comboLabel').textContent=combo.colours.map(c=>c.name).join(' · ');
}

function toggleAccordion(){
  const b=document.getElementById('accordionBody'),c=document.getElementById('accordionChevron');
  const open=b.style.display!=='none';
  b.style.display=open?'none':''; c.style.transform=open?'':'rotate(180deg)';
}

// ── Boot ──────────────────────────────────────────────────────
(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
