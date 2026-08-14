function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escJsAttr(s){ return esc(String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }

// window.prompt/confirm/alert aren't reliable in every embedding context (e.g.
// automated/kiosk browser shells) — use a small inline modal instead.
function askText(message, defaultValue){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML=`<div class="bm-modal"><div class="bm-modal-msg"></div><input type="text" class="adv-text-input" id="bmModalInput"><div class="bm-modal-btns"><button class="btn sm" id="bmModalCancel">Cancel</button><button class="btn sm primary" id="bmModalOk">OK</button></div></div>`;
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const input=overlay.querySelector('#bmModalInput');
    input.value=defaultValue||''; input.focus(); input.select();
    const close=val=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#bmModalOk').onclick=()=>close(input.value.trim()||null);
    overlay.querySelector('#bmModalCancel').onclick=()=>close(null);
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close(null); });
    input.onkeydown=e=>{ if(e.key==='Enter') close(input.value.trim()||null); if(e.key==='Escape') close(null); };
  });
}
function askConfirm(message, confirmLabel='Delete'){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML=`<div class="bm-modal"><div class="bm-modal-msg"></div><div class="bm-modal-btns"><button class="btn sm" id="bmModalCancel">Cancel</button><button class="btn sm primary" id="bmModalOk">${esc(confirmLabel)}</button></div></div>`;
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const close=val=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#bmModalOk').onclick=()=>close(true);
    overlay.querySelector('#bmModalCancel').onclick=()=>close(false);
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close(false); });
  });
}

function setStatus(msg,cls=''){
  const el=document.getElementById('status');
  if(!el) return;
  el.textContent=msg; el.className='status'+(cls?' '+cls:'');
}

// ── Supabase ──────────────────────────────────────────────────
const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';
let sbToken=null, currentUser=null;

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(sbToken||SB_KEY),'Content-Type':'application/json','Prefer':'return=representation'}; }
async function sbGet(table,q=''){ const r=await fetch(`${SB_URL}/rest/v1/${table}${q}`,{headers:sbHeaders()}); return r.json(); }
async function sbPatch(table,q,row){ const r=await fetch(`${SB_URL}/rest/v1/${table}${q}`,{method:'PATCH',headers:sbHeaders(),body:JSON.stringify(row)}); if(!r.ok) return await r.json(); return null; }
async function sbUpsert(table,row){ const r=await fetch(`${SB_URL}/rest/v1/${table}`,{method:'POST',headers:{...sbHeaders(),'Prefer':'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)}); return r.json(); }
async function sbDelete(table,q){ const r=await fetch(`${SB_URL}/rest/v1/${table}${q}`,{method:'DELETE',headers:sbHeaders()}); if(!r.ok) return await r.json(); return null; }

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
    localStorage.setItem('badgemaker_token',sbToken);
    showApp();
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='block';
    btn.disabled=false; btn.innerHTML='<i class="ti ti-login"></i> Sign in';
  }
}

async function restoreSession(){
  const t=localStorage.getItem('badgemaker_token')||localStorage.getItem('pd_access_token')||localStorage.getItem('pd_token'); if(!t) return false;
  try{
    const res=await fetch(`${SB_URL}/auth/v1/user`,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+t}});
    if(!res.ok) return false;
    sbToken=t; currentUser=await res.json(); return true;
  }catch(e){ return false; }
}

function doLogout(){
  localStorage.removeItem('badgemaker_token');
  sbToken=null; currentUser=null;
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}

async function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='flex';
  document.getElementById('userChip').textContent=currentUser?.user_metadata?.display_name||currentUser?.email||'';
  setStatus('Loading…');
  try{ await loadBuiltinFont(); } catch(e){ setStatus('Could not load built-in font','err'); }
  await loadColours();
  await loadFonts();
  await loadModels();
}

// ── State ────────────────────────────────────────────────────
// layerConfig entries: {_key, id, order, type, content, inputId, hex, colourId, fontId, fontObj,
//                        fontSize, border, depth, offsetX, offsetY, offsetZ, rotation}
// inputs entries: {_key, id, name, defaultValue, order} — inputId on a layer
// refers to an input's _key (translated to/from the real DB id on load/save).
let colours=[], fonts=[], models=[], currentModel=null, layerConfig=[], inputs=[], selectedLayerIndex=-1, deletedLayerIds=[], deletedInputIds=[];
let _layerKeySeq=1, _inputKeySeq=1;

function makeDefaultLayer(order){
  return {
    _key:_layerKeySeq++, id:null, order, type:'text', shapeType:'rectangle', negative:false, fillGaps:false, name:null, visible:true,
    content:'TEXT', inputId:null, hex: colours[0]?.code || '#e8e8e6', colourId: colours[0]?.id || null,
    fontId:null, fontObj: getCachedFont(null),
    fontSize:20, border:0, depth:1,
    offsetX:0, offsetY:0, offsetZ:0, rotation:0,
  };
}

function makeDefaultInput(order){
  return { _key:_inputKeySeq++, id:null, name:`Field ${order+1}`, defaultValue:'', order };
}

// ── Unsaved-changes tracking ────────────────────────────────────
let isDirty=false, dirtyLayerKeys=new Set(), dirtyInputKeys=new Set();
function markDirty(layerKey){
  isDirty=true;
  if(layerKey!=null) dirtyLayerKeys.add(layerKey);
  const btn=document.getElementById('saveBtn');
  if(btn) btn.classList.add('dirty');
}
function markInputDirty(inputKey){
  isDirty=true;
  dirtyInputKeys.add(inputKey);
  const btn=document.getElementById('saveBtn');
  if(btn) btn.classList.add('dirty');
  const row=document.querySelector(`.input-row[data-key="${inputKey}"]`);
  if(row) row.classList.add('dirty');
}
function clearDirty(){
  isDirty=false; dirtyLayerKeys.clear(); dirtyInputKeys.clear();
  const btn=document.getElementById('saveBtn');
  if(btn) btn.classList.remove('dirty');
}

function colourName(hex){ const c=colours.find(c=>c.code?.toLowerCase()===(hex||'').toLowerCase()); return c?c.name:hex; }

async function loadColours(){ colours=await sbGet('colours','?available=eq.true&order=id'); }

async function loadFonts(){
  fonts = await sbGet('badgemaker_fonts','?order=name');
  for(const f of fonts){
    try{ parseAndCacheFont(f.id, f.data_base64); } catch(e){ console.warn('Bad font in DB:',f.name,e); }
  }
  buildFontDropdown();
}

function buildFontDropdown(){
  const sel=document.getElementById('layFont');
  const cur=sel.value;
  sel.innerHTML = '<option value="">LEGO (built-in)</option>' + fonts.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');
  sel.value = cur;
}

// ── Models ───────────────────────────────────────────────────
async function refreshModelDropdown(selectId){
  models = await sbGet('badgemaker_models','?archived=eq.false&order=name');
  const sel=document.getElementById('modelSelect');
  sel.innerHTML = models.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if(selectId!=null) sel.value = selectId;
}

async function loadModels(){
  await refreshModelDropdown();
  if(models.length) await loadModel(models[0].id);
  else resetToNewModel(null);
}

function onModelSelect(){
  const val = document.getElementById('modelSelect').value;
  if(!val){ resetToNewModel(null); return; }
  loadModel(val);
}

function resetToNewModel(name){
  currentModel = name ? { id:null, name } : null;
  deletedLayerIds = []; deletedInputIds = [];
  layerConfig = [makeDefaultLayer(0)];
  inputs = [];
  selectedLayerIndex = 0;
  document.getElementById('modelSelect').value = '';
  markDirty(layerConfig[0]._key);
  buildInputListUI(); buildLayerListUI(); buildLayerEditorUI();
  document.getElementById('exportBtn').disabled = false;
  setStatus(name ? `New model "${name}" — click Save to create` : 'No models yet — click Save to create one');
  scheduleRender();
}

async function newModel(){
  const name = await askText('Model name:');
  if(!name) return;
  resetToNewModel(name);
}

async function renameModel(){
  if(!currentModel){ setStatus('Select or create a model first.','err'); return; }
  const name = await askText('Rename model:', currentModel.name);
  if(!name) return;
  currentModel.name = name;
  if(currentModel.id){
    await sbPatch('badgemaker_models', `?id=eq.${currentModel.id}`, {name, updated_at:new Date().toISOString()});
    await refreshModelDropdown(currentModel.id);
  } else {
    markDirty();
  }
  setStatus('Renamed','ok'); setTimeout(()=>setStatus(''),1500);
}

async function deleteModel(){
  if(!currentModel || !currentModel.id){ resetToNewModel(null); return; }
  const ok = await askConfirm(`Delete "${currentModel.name}"? This can't be undone.`);
  if(!ok) return;
  await sbDelete('badgemaker_models', `?id=eq.${currentModel.id}`);
  await loadModels();
}

async function loadModel(id){
  currentModel = models.find(m=>String(m.id)===String(id));
  if(!currentModel) return;
  deletedLayerIds = []; deletedInputIds = [];
  const [rows, inputRows] = await Promise.all([
    sbGet('badgemaker_layers', `?model_id=eq.${currentModel.id}&order=layer_order`),
    sbGet('badgemaker_inputs', `?model_id=eq.${currentModel.id}&order=input_order`),
  ]);
  inputs = inputRows.map(r=>({ _key:_inputKeySeq++, id:r.id, name:r.name, defaultValue:r.default_value, order:r.input_order }));
  const inputKeyById = new Map(inputs.map(i=>[String(i.id), i._key]));
  layerConfig = rows.map(r=>{
    // 'square'/'circle' are legacy layer_type values from before Type/Shape split
    const isLegacyShape = r.layer_type==='square' || r.layer_type==='circle';
    return {
      _key:_layerKeySeq++, id:r.id, order:r.layer_order,
      type: isLegacyShape ? 'shape' : (r.layer_type||'text'),
      shapeType: r.shape_type || (r.layer_type==='circle' ? 'circle' : 'rectangle'),
      negative:!!r.is_negative, fillGaps:!!r.fill_gaps, name:r.name||null, visible:r.visible!==false,
      content:r.content, inputId: r.input_id!=null ? (inputKeyById.get(String(r.input_id))??null) : null,
      hex:r.colour_hex, colourId:r.colour_id,
      fontId:r.font_id, fontObj:getCachedFont(r.font_id),
      fontSize:r.font_size, border:r.border_mm, depth:r.thickness_mm,
      offsetX:r.offset_x, offsetY:r.offset_y, offsetZ:r.offset_z, rotation:r.rotation,
    };
  });
  if(!layerConfig.length) layerConfig=[makeDefaultLayer(0)];
  selectedLayerIndex = 0;
  clearDirty();
  buildInputListUI(); buildLayerListUI(); buildLayerEditorUI();
  document.getElementById('exportBtn').disabled=false;
  setStatus('');
  scheduleRender();
}

async function saveModel(){
  setStatus('Saving…');
  try{
    if(!currentModel){
      const name = await askText('Model name:');
      if(!name){ setStatus(''); return; }
      currentModel = {id:null, name};
    }
    if(!currentModel.id){
      const created = await sbUpsert('badgemaker_models', {name:currentModel.name});
      if(created?.code||created?.error) throw new Error(created?.message||created?.error||'Create failed');
      currentModel = created[0];
    } else {
      const res = await sbPatch('badgemaker_models', `?id=eq.${currentModel.id}`, {name:currentModel.name, updated_at:new Date().toISOString()});
      if(res) throw new Error(res.message||res.error||'Save failed');
    }
    const inputKeyToId = new Map();
    for(let i=0;i<inputs.length;i++){
      const inp = inputs[i];
      const row = {
        ...(inp.id?{id:inp.id}:{}),
        model_id: currentModel.id, input_order: i,
        name: inp.name||`Field ${i+1}`, default_value: inp.defaultValue||'',
      };
      const res = await sbUpsert('badgemaker_inputs', row);
      if(res?.code||res?.error) throw new Error(res.message||res.error||`Input ${i+1} save failed`);
      if(!inp.id && res[0]) inp.id = res[0].id;
      inputKeyToId.set(inp._key, inp.id);
    }
    for(const id of deletedInputIds){ await sbDelete('badgemaker_inputs', `?id=eq.${id}`); }
    deletedInputIds = [];

    for(let i=0;i<layerConfig.length;i++){
      const l = layerConfig[i];
      const row = {
        ...(l.id?{id:l.id}:{}),
        model_id: currentModel.id, layer_order: i, layer_type: l.type||'text',
        shape_type: l.type==='shape' ? (l.shapeType||'rectangle') : null,
        is_negative: !!l.negative, fill_gaps: !!l.fillGaps, name: l.name||null, visible: l.visible!==false,
        content: l.content||'', input_id: l.inputId!=null ? (inputKeyToId.get(l.inputId)||null) : null,
        colour_hex: l.hex, colour_id: l.colourId||null,
        font_id: l.fontId||null, font_size: l.fontSize,
        border_mm: l.border, thickness_mm: l.depth,
        offset_x: l.offsetX, offset_y: l.offsetY, offset_z: l.offsetZ, rotation: l.rotation,
      };
      const res = await sbUpsert('badgemaker_layers', row);
      if(res?.code||res?.error) throw new Error(res.message||res.error||`Layer ${i+1} save failed`);
      if(!l.id && res[0]) l.id = res[0].id;
    }
    for(const id of deletedLayerIds){ await sbDelete('badgemaker_layers', `?id=eq.${id}`); }
    deletedLayerIds = [];
    await refreshModelDropdown(currentModel.id);
    clearDirty(); buildInputListUI(); buildLayerListUI();
    setStatus('Saved','ok'); setTimeout(()=>setStatus(''),2000);
  }catch(e){
    setStatus('Save failed: '+e.message,'err');
  }
}

// ── Inputs UI ────────────────────────────────────────────────
function buildInputListUI(){
  const el = document.getElementById('inputList');
  el.innerHTML = inputs.map((inp,i)=>`
    <div class="input-row${dirtyInputKeys.has(inp._key)?' dirty':''}" data-key="${inp._key}">
      <input class="input-name" value="${esc(inp.name)}" placeholder="Field name" oninput="onInputFieldChange(${i},'name',this.value)">
      <input class="input-value" value="${esc(inp.defaultValue)}" placeholder="Value" oninput="onInputFieldChange(${i},'defaultValue',this.value)">
      <button class="lr-btn" title="Delete" onclick="removeInput(${i})"><i class="ti ti-trash"></i></button>
    </div>`).join('');
}

function addInput(){
  const inp = makeDefaultInput(inputs.length);
  inputs.push(inp);
  markInputDirty(inp._key);
  buildInputListUI();
  buildLayerEditorUI();
}

function removeInput(i){
  const [removed] = inputs.splice(i,1);
  if(removed.id) deletedInputIds.push(removed.id);
  layerConfig.forEach(l=>{ if(l.inputId===removed._key) l.inputId=null; });
  markDirty();
  buildInputListUI(); buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}

// Field edits update state in place (no full re-render) so the input the
// user is actively typing in never loses focus/cursor position.
function onInputFieldChange(i, field, value){
  const inp = inputs[i];
  if(!inp) return;
  inp[field]=value;
  markInputDirty(inp._key);
  if(field==='name') buildLayerEditorUI(); // dropdown option labels
  buildLayerListUI(); // list labels may show bound input values
  scheduleRender();
}

// ── Layer list UI ────────────────────────────────────────────
function layerLabel(l){
  if(l.name) return l.name;
  if(l.type==='shape') return l.shapeType==='circle' ? 'Circle' : 'Rectangle';
  if(l.inputId!=null){
    const inp = inputs.find(x=>x._key===l.inputId);
    return inp ? (inp.defaultValue || `[${inp.name}]`) : '(empty)';
  }
  return l.content||'(empty)';
}

let openLayerMenuIndex=null;
function toggleLayerMenu(i){
  openLayerMenuIndex = openLayerMenuIndex===i ? null : i;
  buildLayerListUI();
}
function closeLayerMenu(){ openLayerMenuIndex=null; buildLayerListUI(); }
function onGlobalClickCloseLayerMenu(e){
  if(openLayerMenuIndex!==null && !e.target.closest('.layer-row-menu-wrap')) closeLayerMenu();
}

async function renameLayer(i){
  const l = layerConfig[i];
  if(!l) return;
  const name = await askText('Layer name:', l.name || layerLabel(l));
  if(!name) return;
  l.name = name;
  markDirty(l._key);
  buildLayerListUI();
}

let dragSrcIndex=null;
function onLayerDragStart(e,i){
  dragSrcIndex=i;
  e.dataTransfer.effectAllowed='move';
  e.currentTarget.classList.add('dragging');
}
function onLayerDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
}
function onLayerDrop(e,i){
  e.preventDefault();
  if(dragSrcIndex===null || dragSrcIndex===i) return;
  const [moved] = layerConfig.splice(dragSrcIndex,1);
  const dest = dragSrcIndex<i ? i-1 : i;
  layerConfig.splice(dest,0,moved);
  if(selectedLayerIndex===dragSrcIndex) selectedLayerIndex=dest;
  else if(dragSrcIndex<selectedLayerIndex && dest>=selectedLayerIndex) selectedLayerIndex--;
  else if(dragSrcIndex>selectedLayerIndex && dest<=selectedLayerIndex) selectedLayerIndex++;
  dragSrcIndex=null;
  markDirty();
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}
function onLayerDragEnd(){
  dragSrcIndex=null;
  document.querySelectorAll('.layer-row.dragging').forEach(el=>el.classList.remove('dragging'));
}

function toggleLayerVisible(i){
  const l = layerConfig[i];
  if(!l) return;
  l.visible = l.visible===false;
  markDirty(l._key);
  buildLayerListUI(); scheduleRender();
}

function buildLayerListUI(){
  const el = document.getElementById('layerList');
  el.innerHTML = layerConfig.map((l,i)=>`
    <div class="layer-row${i===selectedLayerIndex?' selected':''}${dirtyLayerKeys.has(l._key)?' dirty':''}${l.negative?' negative':''}${l.visible===false?' hidden-layer':''}"
      onclick="selectLayer(${i})" draggable="true"
      ondragstart="onLayerDragStart(event,${i})" ondragover="onLayerDragOver(event)" ondrop="onLayerDrop(event,${i})" ondragend="onLayerDragEnd()">
      <i class="ti ti-grip-vertical lr-grip"></i>
      <button class="lr-btn" title="${l.visible===false?'Show layer':'Hide layer'}" onclick="event.stopPropagation();toggleLayerVisible(${i})"><i class="ti ${l.visible===false?'ti-eye-off':'ti-eye'}"></i></button>
      ${l.negative ? '<i class="ti ti-corner-left-up lr-neg-arrow" title="Cuts the layer above"></i>' : `<div class="lr-swatch" style="background:${l.hex}"></div>`}
      <span class="lr-label">${esc(layerLabel(l))}</span>
      <div class="layer-row-menu-wrap">
        <button class="lr-btn" title="Layer options" onclick="event.stopPropagation();toggleLayerMenu(${i})"><i class="ti ti-dots-vertical"></i></button>
        <div class="layer-row-menu" style="display:${openLayerMenuIndex===i?'flex':'none'}" onclick="event.stopPropagation()">
          <div class="lrm-item" onclick="duplicateLayer(${i});closeLayerMenu()"><i class="ti ti-copy"></i> Duplicate</div>
          <div class="lrm-item" onclick="renameLayer(${i});closeLayerMenu()"><i class="ti ti-edit"></i> Rename</div>
          <div class="lrm-item danger" onclick="removeLayer(${i});closeLayerMenu()"><i class="ti ti-trash"></i> Delete</div>
        </div>
      </div>
    </div>`).join('');
}

function selectLayer(i){ selectedLayerIndex=i; buildLayerListUI(); buildLayerEditorUI(); }

function addLayer(){
  const l = makeDefaultLayer(layerConfig.length);
  layerConfig.push(l);
  selectedLayerIndex = layerConfig.length-1;
  markDirty(l._key);
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}

function removeLayer(i){
  if(layerConfig.length<=1){ setStatus('A badge needs at least one layer.','err'); return; }
  const [removed] = layerConfig.splice(i,1);
  if(removed.id) deletedLayerIds.push(removed.id);
  if(selectedLayerIndex>=layerConfig.length) selectedLayerIndex=layerConfig.length-1;
  markDirty();
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}

function duplicateLayer(i){
  const copy = {...layerConfig[i], id:null, _key:_layerKeySeq++};
  layerConfig.splice(i+1,0,copy);
  selectedLayerIndex=i+1;
  markDirty(copy._key);
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}

// ── Layer editor UI ──────────────────────────────────────────
function buildLayerEditorUI(){
  const editor = document.getElementById('layerEditor');
  const l = layerConfig[selectedLayerIndex];
  if(!l){ editor.style.display='none'; return; }
  editor.style.display='flex';
  document.getElementById('layType').value = l.type||'text';
  document.getElementById('shapeTypeRow').style.display = (l.type==='shape') ? '' : 'none';
  document.getElementById('layShapeType').value = l.shapeType||'rectangle';
  document.getElementById('layNegative').checked = !!l.negative;
  document.getElementById('textOnlyFields').style.display = (l.type==='text') ? '' : 'none';
  const srcSel = document.getElementById('layInputSource');
  srcSel.innerHTML = '<option value="">Literal text</option>' + inputs.map(inp=>`<option value="${inp._key}">${esc(inp.name)}</option>`).join('');
  srcSel.value = l.inputId||'';
  document.getElementById('layContentRow').style.display = l.inputId!=null ? 'none' : '';
  document.getElementById('layContent').value = l.content||'';
  document.getElementById('layFillGaps').checked = !!l.fillGaps;
  buildFontDropdown();
  document.getElementById('layFont').value = l.fontId||'';
  document.getElementById('layFontSize').value = l.fontSize;
  document.getElementById('layBorder').value = l.border;
  document.getElementById('layDepth').value = l.depth;
  document.getElementById('layOffX').value = l.offsetX;
  document.getElementById('layOffY').value = l.offsetY;
  document.getElementById('layOffZ').value = computeLayerZ(l) + (l.offsetZ||0);
  document.getElementById('layRotation').value = l.rotation;
  document.getElementById('layColourSwatch').style.background = l.hex;
  document.getElementById('layColourLabel').textContent = colourName(l.hex);
  document.getElementById('layFreeMove').checked = !!l.freeMove;
  setFreeMoveLayer(l.freeMove ? l : null);
  wrapSpinners(editor);
}

// Free Move is a client-side editing aid (which axis handles are showing),
// not saved data — toggling it doesn't dirty the model.
function onFreeMoveToggle(checked){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l.freeMove = checked;
  setFreeMoveLayer(checked ? l : null);
}

// Called by engine.js while a gizmo handle is being dragged, so the number
// fields + layer list stay in sync live (no full editor rebuild mid-drag).
function onFreeMoveDrag(l){
  if(l!==layerConfig[selectedLayerIndex]) return;
  document.getElementById('layOffX').value = l.offsetX;
  document.getElementById('layOffY').value = l.offsetY;
  document.getElementById('layOffZ').value = computeLayerZ(l) + (l.offsetZ||0);
  markDirty(l._key);
}

function onLayerFieldChange(field, value){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  // The Z field shows the layer's actual resolved position (auto-stack +
  // manual nudge), not the raw nudge — convert back to the stored delta.
  if(field==='offsetZ') l.offsetZ = value - computeLayerZ(l);
  else l[field]=value;
  if(field==='type' && value==='shape' && !l.shapeType) l.shapeType='rectangle';
  markDirty(l._key);
  if(field==='content'||field==='type'||field==='shapeType'||field==='inputId'||field==='negative') buildLayerListUI();
  if(field==='type'||field==='inputId') buildLayerEditorUI();
  scheduleRender();
}

function onLayerFontChange(fontId){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l.fontId = fontId || null;
  l.fontObj = getCachedFont(l.fontId);
  markDirty(l._key);
  scheduleRender();
}

// ── Colour picker (single, for the selected layer) ────────────
let colourPickerOpen=false;
function toggleLayerColourPicker(){
  const list=document.getElementById('layColourList');
  if(list.style.display!=='none'){ list.style.display='none'; colourPickerOpen=false; return; }
  list.innerHTML = colours.map(c=>`<div class="cp-option" onclick="selectLayerColour('${escJsAttr(c.code)}','${escJsAttr(c.id)}')"><div class="cp-swatch" style="background:${c.code}"></div><span>${esc(c.name)}</span></div>`).join('');
  list.style.display='';
  colourPickerOpen=true;
}
function selectLayerColour(hex,colId){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l.hex=hex; l.colourId=colId;
  document.getElementById('layColourList').style.display='none'; colourPickerOpen=false;
  markDirty(l._key);
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}
function onGlobalClickCloseColourPicker(e){
  if(colourPickerOpen && !e.target.closest('#layColourWrap')){
    document.getElementById('layColourList').style.display='none'; colourPickerOpen=false;
  }
}

// ── Font upload ────────────────────────────────────────────────
async function uploadFont(file){
  if(!file) return;
  setStatus('Uploading font…');
  try{
    const buf = await file.arrayBuffer();
    let parsed;
    try{ parsed = opentype.parse(buf); } catch(e){ throw new Error('Not a valid TTF/OTF font file'); }
    const name = parsed.names?.fontFamily?.en || file.name.replace(/\.(ttf|otf)$/i,'');
    const base64 = arrayBufferToBase64(buf);
    const created = await sbUpsert('badgemaker_fonts', {name, data_base64:base64});
    if(created?.code||created?.error) throw new Error(created?.message||created?.error||'Font upload failed');
    const row = created[0];
    fonts.push(row);
    fontCache.set(row.id, parsed);
    buildFontDropdown();
    if(layerConfig[selectedLayerIndex]){
      document.getElementById('layFont').value = row.id;
      onLayerFontChange(row.id);
    }
    setStatus(`Uploaded "${name}"`,'ok'); setTimeout(()=>setStatus(''),2000);
  }catch(e){
    setStatus('Font upload failed: '+e.message,'err');
  }
  document.getElementById('fontUploadInput').value='';
}

// ── Boot ──────────────────────────────────────────────────────
(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
