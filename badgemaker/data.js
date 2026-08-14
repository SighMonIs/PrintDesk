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

// Three-way prompt for the unsaved-changes guard.
function askSaveDiscard(message){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML=`<div class="bm-modal"><div class="bm-modal-msg"></div><div class="bm-modal-btns">`
      +`<button class="btn sm" id="bmCancel">Cancel</button>`
      +`<button class="btn sm" id="bmDiscard">Discard</button>`
      +`<button class="btn sm primary" id="bmSave">Save</button></div></div>`;
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const close=v=>{ overlay.remove(); resolve(v); };
    overlay.querySelector('#bmSave').onclick=()=>close('save');
    overlay.querySelector('#bmDiscard').onclick=()=>close('discard');
    overlay.querySelector('#bmCancel').onclick=()=>close('cancel');
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close('cancel'); });
  });
}

// Called before anything that would abandon in-progress edits.
// Returns false if the user backed out.
async function confirmLeaveUnsaved(){
  if(!isDirty) return true;
  const choice = await askSaveDiscard(`"${currentModel?.name||'This model'}" has unsaved changes.`);
  if(choice==='cancel') return false;
  if(choice==='save'){
    await saveModel();
    if(isDirty) return false;   // save failed — stay put rather than lose work
  }
  return true;
}

function setStatus(msg,cls=''){
  const el=document.getElementById('status');
  if(!el) return;
  el.textContent=msg; el.className='status'+(cls?' '+cls:'');
}

// ── Supabase ──────────────────────────────────────────────────
const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';
let sbToken=null, sbRefreshToken=null, currentUser=null;

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(sbToken||SB_KEY),'Content-Type':'application/json','Prefer':'return=representation'}; }

// Access tokens expire after ~1h. Rather than losing a long editing session
// to a failed save, swap in a fresh token using the refresh token and retry.
let _refreshInFlight = null;
async function refreshSession(){
  if(!sbRefreshToken) return false;
  if(_refreshInFlight) return _refreshInFlight;   // don't stampede on parallel 401s
  _refreshInFlight = (async()=>{
    try{
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`,{
        method:'POST', headers:{'apikey':SB_KEY,'Content-Type':'application/json'},
        body: JSON.stringify({refresh_token: sbRefreshToken}),
      });
      const data = await res.json();
      if(!res.ok || !data.access_token) return false;
      storeSession(data);
      return true;
    }catch(e){ return false; }
    finally{ _refreshInFlight = null; }
  })();
  return _refreshInFlight;
}

function storeSession(data){
  sbToken = data.access_token;
  if(data.refresh_token) sbRefreshToken = data.refresh_token;
  if(data.user) currentUser = data.user;
  localStorage.setItem('badgemaker_token', sbToken);
  if(sbRefreshToken) localStorage.setItem('badgemaker_refresh', sbRefreshToken);
}

// Single entry point so every call gets the refresh-and-retry behaviour.
// Headers are rebuilt per attempt so the retry picks up the new token, with
// any caller extras (e.g. upsert's Prefer) merged on top.
async function sbFetch(path, opts={}, extraHeaders={}){
  const send = () => fetch(`${SB_URL}/rest/v1/${path}`, {...opts, headers: {...sbHeaders(), ...extraHeaders}});
  let r = await send();
  if(r.status === 401 && await refreshSession()) r = await send();
  return r;
}

async function sbGet(table,q=''){ const r=await sbFetch(`${table}${q}`); return r.json(); }
async function sbPatch(table,q,row){ const r=await sbFetch(`${table}${q}`,{method:'PATCH',body:JSON.stringify(row)}); if(!r.ok) return await r.json(); return null; }
async function sbUpsert(table,row){ const r=await sbFetch(table,{method:'POST',body:JSON.stringify(row)},{'Prefer':'resolution=merge-duplicates,return=representation'}); return r.json(); }
async function sbDelete(table,q){ const r=await sbFetch(`${table}${q}`,{method:'DELETE'}); if(!r.ok) return await r.json(); return null; }

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
    storeSession(data);
    showApp();
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='block';
    btn.disabled=false; btn.innerHTML='<i class="ti ti-login"></i> Sign in';
  }
}

async function restoreSession(){
  const t=localStorage.getItem('badgemaker_token')||localStorage.getItem('pd_access_token')||localStorage.getItem('pd_token');
  sbRefreshToken=localStorage.getItem('badgemaker_refresh')||null;
  if(!t && !sbRefreshToken) return false;
  const fetchUser=async tok=>{
    const res=await fetch(`${SB_URL}/auth/v1/user`,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}});
    return res.ok ? res.json() : null;
  };
  try{
    if(t){
      const user=await fetchUser(t);
      if(user){ sbToken=t; currentUser=user; return true; }
    }
    // Stored token dead — a valid refresh token still gets us back in.
    if(await refreshSession()){
      currentUser = await fetchUser(sbToken);
      return !!currentUser;
    }
    return false;
  }catch(e){ return false; }
}

function doLogout(){
  localStorage.removeItem('badgemaker_token');
  localStorage.removeItem('badgemaker_refresh');
  sbToken=null; sbRefreshToken=null; currentUser=null;
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

// Layers get a plain incrementing name; rename via the row's ⋮ menu.
// Counts existing "Layer N" names so it doesn't collide after deletes.
function nextLayerName(){
  let max = 0;
  for(const l of layerConfig){
    const m = /^Layer (\d+)$/.exec(l.name || '');
    if(m) max = Math.max(max, +m[1]);
  }
  return `Layer ${Math.max(max + 1, layerConfig.length + 1)}`;
}

function makeDefaultLayer(order){
  return {
    _key:_layerKeySeq++, id:null, order, type:'text', shapeType:'rectangle', negative:false, negAboveOnly:false, fillGaps:false, fitToShape:false, name:nextLayerName(), visible:true,
    content:'TEXT', inputId:null, hex: colours[0]?.code || '#e8e8e6', colourId: colours[0]?.id || null,
    fontId:null, fontObj: getCachedFont(null),
    fontSize:20, height:20, border:0, depth:1, repeatThreshold:0,
    offsetX:0, offsetY:0, offsetZ:0, rotation:0,
  };
}

function makeDefaultInput(order){
  return { _key:_inputKeySeq++, id:null, name:`Field ${order+1}`, defaultValue:'', order };
}

// ── Unsaved-changes tracking ────────────────────────────────────
let isDirty=false, dirtyLayerKeys=new Set(), dirtyInputKeys=new Set();
function updateDirtyUI(){
  const save=document.getElementById('saveBtn');
  if(save) save.classList.toggle('dirty', isDirty);
  const revert=document.getElementById('revertBtn');
  if(revert) revert.style.display = isDirty ? '' : 'none';
}
function markDirty(layerKey){
  isDirty=true;
  if(layerKey!=null) dirtyLayerKeys.add(layerKey);
  updateDirtyUI();
}
function markInputDirty(inputKey){
  isDirty=true;
  dirtyInputKeys.add(inputKey);
  updateDirtyUI();
  const row=document.querySelector(`.input-row[data-key="${inputKey}"]`);
  if(row) row.classList.add('dirty');
}
function clearDirty(){
  isDirty=false; dirtyLayerKeys.clear(); dirtyInputKeys.clear();
  updateDirtyUI();
}

// Revert = re-read the saved model from the DB, throwing away in-memory edits.
// An unsaved new model has nothing to revert to, so fall back to the list.
async function revertChanges(){
  if(!isDirty) return;
  const ok = await askConfirm('Discard all unsaved changes?', 'Revert');
  if(!ok) return;
  setStatus('Reverting…');
  if(currentModel?.id) await loadModel(currentModel.id);
  else await loadModels();
  setStatus('Reverted','ok'); setTimeout(()=>setStatus(''),1500);
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

// Reopen whichever model was last open, so a refresh doesn't drop you back
// onto a finished badge. Falls back to the first model if it's since gone.
const LS_LAST_MODEL = 'badgemaker_lastModelId';

async function loadModels(){
  await refreshModelDropdown();
  if(!models.length){ resetToNewModel(null); return; }
  const last = localStorage.getItem(LS_LAST_MODEL);
  const wanted = models.find(m => String(m.id) === String(last));
  await loadModel((wanted || models[0]).id);
}

async function onModelSelect(){
  const val = document.getElementById('modelSelect').value;
  if(!await confirmLeaveUnsaved()){
    // Put the dropdown back on the model we're still editing.
    document.getElementById('modelSelect').value = currentModel?.id ?? '';
    return;
  }
  if(!val){ resetToNewModel(null); return; }
  loadModel(val);
}

function resetToNewModel(name){
  currentModel = name ? { id:null, name } : null;
  deletedLayerIds = []; deletedInputIds = [];
  layerConfig = [];              // clear first so naming restarts at "Layer 1"
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
  if(!await confirmLeaveUnsaved()) return;
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
  localStorage.removeItem(LS_LAST_MODEL);
  await loadModels();
}

// Copies the current model's layers and inputs into a brand new model.
// Done in memory then saved, so the ids are re-issued by the save path.
async function duplicateModel(){
  if(!currentModel){ setStatus('Select or create a model first.','err'); return; }
  const name = await askText('Name for the copy:', `${currentModel.name} copy`);
  if(!name) return;
  setStatus('Duplicating…');
  currentModel = { id:null, name };
  deletedLayerIds = []; deletedInputIds = [];
  // New _keys all round (ids are re-issued on save); layer→input bindings are
  // re-pointed at the copied inputs via old-key → new-key.
  const keyMap = new Map();
  inputs = inputs.map(i => {
    const newKey = _inputKeySeq++;
    keyMap.set(i._key, newKey);
    return {...i, _key:newKey, id:null};
  });
  layerConfig = layerConfig.map(l => ({
    ...l, _key:_layerKeySeq++, id:null,
    inputId: l.inputId != null ? (keyMap.get(l.inputId) ?? null) : null,
  }));
  document.getElementById('modelSelect').value = '';
  markDirty();
  buildInputListUI(); buildLayerListUI(); buildLayerEditorUI();
  await saveModel();
}

// ── Model options menu ────────────────────────────────────────
let modelMenuOpen=false;
function toggleModelMenu(){
  modelMenuOpen = !modelMenuOpen;
  document.getElementById('modelMenu').style.display = modelMenuOpen ? 'flex' : 'none';
}
function closeModelMenu(){
  modelMenuOpen = false;
  const el = document.getElementById('modelMenu');
  if(el) el.style.display = 'none';
}
function onGlobalClickCloseModelMenu(e){
  if(modelMenuOpen && !e.target.closest('.model-menu-wrap')) closeModelMenu();
}

// ── Account menu ──────────────────────────────────────────────
let userMenuOpen=false;
function toggleUserMenu(){
  userMenuOpen = !userMenuOpen;
  document.getElementById('userMenu').style.display = userMenuOpen ? 'flex' : 'none';
}
function onGlobalClickCloseUserMenu(e){
  if(userMenuOpen && !e.target.closest('.user-menu-wrap')){
    userMenuOpen = false;
    document.getElementById('userMenu').style.display = 'none';
  }
}

async function loadModel(id){
  currentModel = models.find(m=>String(m.id)===String(id));
  if(!currentModel) return;
  localStorage.setItem(LS_LAST_MODEL, currentModel.id);
  // Keep the dropdown in step however we got here (restored on load, etc).
  document.getElementById('modelSelect').value = currentModel.id;
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
      negative:!!r.is_negative, negAboveOnly:!!r.negative_above_only, fillGaps:!!r.fill_gaps, fitToShape:!!r.fit_to_shape, name:r.name||null, visible:r.visible!==false,
      content:r.content, inputId: r.input_id!=null ? (inputKeyById.get(String(r.input_id))??null) : null,
      hex:r.colour_hex, colourId:r.colour_id,
      fontId:r.font_id, fontObj:getCachedFont(r.font_id),
      fontSize:r.font_size, height:r.height_mm||20, border:r.border_mm, depth:r.thickness_mm,
      repeatThreshold:r.repeat_threshold_mm||0,
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
      localStorage.setItem(LS_LAST_MODEL, currentModel.id);   // newly created models skip loadModel
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
        // shape_type is the sub-type for shapes (rectangle/circle), backings
        // (magnet/pin/round) and keychains (connector direction) alike —
        // gating it on type==='shape' was wiping the other two on save.
        shape_type: l.shapeType || null,
        is_negative: !!l.negative, negative_above_only: !!l.negAboveOnly, fill_gaps: !!l.fillGaps, fit_to_shape: !!l.fitToShape, name: l.name||null, visible: l.visible!==false,
        content: l.content||'', input_id: l.inputId!=null ? (inputKeyToId.get(l.inputId)||null) : null,
        colour_hex: l.hex, colour_id: l.colourId||null,
        font_id: l.fontId||null, font_size: l.fontSize, height_mm: l.height||20,
        repeat_threshold_mm: l.repeatThreshold||0,
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

async function removeInput(i){
  const inp = inputs[i];
  if(!inp) return;
  const bound = layerConfig.filter(l=>l.inputId===inp._key).length;
  const warn = bound ? ` ${bound} layer(s) using it will fall back to their own text.` : '';
  const ok = await askConfirm(`Delete input "${inp.name}"?${warn}`);
  if(!ok) return;
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
const BACKING_LABELS = {magnet:'Magnet backing', pin:'Pin backing', round:'Round magnet'};
function layerLabel(l){
  if(l.name) return l.name;
  if(l.type==='keychain') return 'Keychain ring';
  if(l.type==='backing') return BACKING_LABELS[l.shapeType] || 'Backing';
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

// Live reorder: the row swaps position as you drag over its neighbours, so
// the list itself is the preview (no separate drop-indicator or ghost row).
let dragSrcIndex=null;
function onLayerDragStart(e,i){
  dragSrcIndex=i;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',String(i)); // Firefox needs data set to start a drag
  const img = new Image();
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  e.dataTransfer.setDragImage(img, 0, 0); // suppress the translucent ghost
}
function onLayerDragOver(e,i){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  if(dragSrcIndex===null || dragSrcIndex===i) return;
  const [moved] = layerConfig.splice(dragSrcIndex,1);
  layerConfig.splice(i,0,moved);
  if(selectedLayerIndex===dragSrcIndex) selectedLayerIndex=i;
  else if(dragSrcIndex<selectedLayerIndex && i>=selectedLayerIndex) selectedLayerIndex--;
  else if(dragSrcIndex>selectedLayerIndex && i<=selectedLayerIndex) selectedLayerIndex++;
  dragSrcIndex=i;
  buildLayerListUI();
}
function onLayerDrop(e){
  e.preventDefault();
}
function onLayerDragEnd(){
  if(dragSrcIndex!==null){
    dragSrcIndex=null;
    markDirty();
    buildLayerEditorUI(); scheduleRender();
  }
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
    <div class="layer-row${i===selectedLayerIndex?' selected':''}${dirtyLayerKeys.has(l._key)?' dirty':''}${(l.negative&&l.negAboveOnly)?' negative':''}${l.visible===false?' hidden-layer':''}"
      onclick="selectLayer(${i})" draggable="true"
      ondragstart="onLayerDragStart(event,${i})" ondragover="onLayerDragOver(event,${i})" ondrop="onLayerDrop(event)" ondragend="onLayerDragEnd()">
      <button class="lr-btn" title="${l.visible===false?'Show layer':'Hide layer'}" onclick="event.stopPropagation();toggleLayerVisible(${i})"><i class="ti ${l.visible===false?'ti-eye-off':'ti-eye'}"></i></button>
      ${l.negative && l.negAboveOnly
        ? '<i class="ti ti-corner-left-up lr-neg-arrow" title="Negative — cuts only the layer above"></i>'
        : l.type==='backing'
          ? '<i class="ti ti-layout-bottombar lr-neg-icon" title="Backing — cuts a mount slot"></i>'
          : l.negative
            ? '<i class="ti ti-ban lr-neg-icon" title="Negative — cuts the layers it overlaps"></i>'
            : `<div class="lr-swatch" style="background:${l.hex}"></div>`}
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

// Re-renders because the selected cutter is ghosted in the 3D view.
function selectLayer(i){ selectedLayerIndex=i; buildLayerListUI(); buildLayerEditorUI(); scheduleRender(); }

function addLayer(){
  const l = makeDefaultLayer(layerConfig.length);
  layerConfig.push(l);
  selectedLayerIndex = layerConfig.length-1;
  markDirty(l._key);
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
}

async function removeLayer(i){
  if(layerConfig.length<=1){ setStatus('A badge needs at least one layer.','err'); return; }
  const ok = await askConfirm(`Delete layer "${layerLabel(layerConfig[i])}"?`);
  if(!ok) return;
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
  const isBacking = l.type==='backing';
  document.getElementById('layType').value = l.type||'text';
  document.getElementById('shapeTypeRow').style.display = (l.type==='shape') ? '' : 'none';
  document.getElementById('layShapeType').value = (l.type==='shape' ? l.shapeType : null) || 'rectangle';
  document.getElementById('backingTypeRow').style.display = isBacking ? '' : 'none';
  if(isBacking) document.getElementById('layBackingType').value = l.shapeType||'magnet';
  // Backings are always cutouts, so the Negative toggle is redundant there.
  document.getElementById('negativeRow').style.display = (isBacking || l.type==='keychain') ? 'none' : '';
  document.getElementById('layNegative').checked = !!l.negative;
  document.getElementById('negAboveOnlyRow').style.display = (!isBacking && l.type!=='keychain' && l.negative) ? '' : 'none';
  document.getElementById('layNegAboveOnly').checked = !!l.negAboveOnly;
  // Auto-repeat only applies to round magnets (as in the original generator).
  const canRepeat = isBacking && l.shapeType==='round';
  const repeatOn = canRepeat && (l.repeatThreshold||0) > 0;
  document.getElementById('repeatingBlock').style.display = canRepeat ? '' : 'none';
  document.getElementById('layRepeat').checked = repeatOn;
  document.getElementById('repeatThresholdRow').style.display = repeatOn ? '' : 'none';
  document.getElementById('layRepeatThreshold').value = l.repeatThreshold || 60;
  const hint = document.getElementById('repeatHint');
  if(canRepeat) hint.textContent = repeatOn ? `${repeatCount(l)} magnet(s) across ${modelWidth().toFixed(1)}mm` : '';
  document.getElementById('textOnlyFields').style.display = (l.type==='text') ? '' : 'none';
  const srcSel = document.getElementById('layInputSource');
  srcSel.innerHTML = '<option value="">Literal text</option>' + inputs.map(inp=>`<option value="${inp._key}">${esc(inp.name)}</option>`).join('');
  srcSel.value = l.inputId||'';
  document.getElementById('layContentRow').style.display = l.inputId!=null ? 'none' : '';
  document.getElementById('layContent').value = l.content||'';
  document.getElementById('layFillGaps').checked = !!l.fillGaps;
  buildFontDropdown();
  document.getElementById('layFont').value = l.fontId||'';
  // The three dimension fields are shared across types, relabelled to suit:
  // text/shape/backing use Size|Width + Height + Stroke; keychain reuses them
  // as hole ⌀ + wall thickness + connector length.
  const isKeychain = l.type==='keychain';
  const isRound = isBacking ? l.shapeType==='round' : l.shapeType==='circle';
  const hasWH = (l.type==='shape' || isBacking) && !isRound;
  // Fit-to-shape turns Width/Height into +/- adjustments off the badge size.
  const canFit = l.type==='shape' && l.shapeType==='rectangle';
  const fitOn = canFit && !!l.fitToShape;
  document.getElementById('fitToShapeRow').style.display = canFit ? '' : 'none';
  document.getElementById('layFitToShape').checked = fitOn;
  document.getElementById('sizeOrWidthLabel').textContent =
    isKeychain ? 'Hole ⌀ (mm)' : fitOn ? 'Width +/− (mm)' : hasWH ? 'Width (mm)' : 'Size (mm)';
  document.getElementById('heightRow').style.display = (hasWH || isKeychain) ? '' : 'none';
  document.getElementById('heightLabel').textContent =
    isKeychain ? 'Wall thickness (mm)' : fitOn ? 'Height +/− (mm)' : 'Height (mm)';
  // Adjustments can go negative; absolute sizes can't.
  document.getElementById('layFontSize').min = fitOn ? -200 : (isKeychain ? 1 : 1);
  document.getElementById('layHeight').min = fitOn ? -200 : 1;
  document.getElementById('layHeight').value = l.height ?? 20;   // ?? so a 0 adjustment survives
  document.getElementById('borderRow').style.display = (l.type==='text' || isKeychain) ? '' : 'none';
  document.getElementById('borderLabel').textContent = isKeychain ? 'Connector length (mm)' : 'Stroke / border (mm)';
  document.getElementById('keychainSideRow').style.display = isKeychain ? '' : 'none';
  if(isKeychain) document.getElementById('layKeychainSide').value = l.shapeType||'none';
  // Cutouts (backings and negatives) are holes — they have no colour.
  document.getElementById('layColourWrap').closest('.adv-row').style.display = (isBacking || l.negative) ? 'none' : '';
  document.getElementById('layFontSize').value = l.fontSize;
  document.getElementById('layBorder').value = l.border;
  document.getElementById('layDepth').value = l.depth;
  document.getElementById('layOffX').value = l.offsetX;
  document.getElementById('layOffY').value = l.offsetY;
  document.getElementById('layOffZ').value = l.offsetZ;
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
  document.getElementById('layOffZ').value = l.offsetZ;
  markDirty(l._key);
}

function onLayerFieldChange(field, value){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l[field]=value;
  if(field==='type' && value==='shape' && !['rectangle','circle'].includes(l.shapeType)) l.shapeType='rectangle';
  if(field==='type' && value==='backing') applyBackingPreset(l, BACKING_PRESETS[l.shapeType] ? l.shapeType : 'magnet');
  if(field==='type' && value==='keychain'){
    // Defaults match the original generator's ring: 10mm hole, 2.5mm wall, 4mm deep.
    if(!KEYCHAIN_SIDES.includes(l.shapeType)) l.shapeType='right';
    l.fontSize=10; l.height=2.5; l.border=3; l.depth=4; l.negative=false;
  }
  markDirty(l._key);
  if(field==='content'||field==='type'||field==='shapeType'||field==='inputId'||field==='negative'||field==='negAboveOnly') buildLayerListUI();
  if(field==='type'||field==='shapeType'||field==='inputId'||field==='negative'||field==='negAboveOnly'||field==='repeatThreshold') buildLayerEditorUI();
  scheduleRender();
}

// Picking a backing preset fills in its real-world dimensions; they stay
// editable afterwards in case a specific magnet/pin differs.
function applyBackingPreset(l, presetKey){
  const p = BACKING_PRESETS[presetKey];
  if(!p) return;
  l.shapeType = presetKey;
  l.fontSize = p.width; l.height = p.height; l.depth = p.depth;
}

// Switching on fit-to-shape zeroes Width/Height so they start as pure
// adjustments; switching off restores concrete sizes from the fitted result.
function onFitToShapeToggle(checked){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  if(checked){
    l.fitToShape = true;
    l.fontSize = 0; l.height = 0;
  } else {
    const b = modelBounds(l);
    l.fitToShape = false;
    l.fontSize = Math.max(1, +(b.width  + (l.fontSize||0)).toFixed(2));
    l.height   = Math.max(1, +(b.height + (l.height  ||0)).toFixed(2));
  }
  markDirty(l._key);
  buildLayerEditorUI(); scheduleRender();
}

function repeatCount(l){
  const t = l.repeatThreshold||0, w = modelWidth();
  return (t>0 && w) ? Math.max(1, Math.ceil(w/t)) : 1;
}

// Threshold doubles as the on/off switch: 0 means no repeating.
function onRepeatToggle(checked){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l.repeatThreshold = checked ? (l.repeatThreshold || 60) : 0;
  markDirty(l._key);
  buildLayerEditorUI(); scheduleRender();
}

function onBackingTypeChange(presetKey){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  applyBackingPreset(l, presetKey);
  markDirty(l._key);
  buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
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
    fontCache.set(fontKey(row.id), parsed);
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

// Closing/reloading the tab or following a link out can't show our own modal,
// so fall back to the browser's native "leave site?" prompt.
window.addEventListener('beforeunload', e => {
  if(!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

// ── Boot ──────────────────────────────────────────────────────
(async()=>{ const ok=await restoreSession(); if(ok) showApp(); else setStatus(''); })();
