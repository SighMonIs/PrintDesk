function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Text boxes grow with their content — badge text can wrap or be typed over
// several lines. +2 covers the 1px borders (everything here is border-box).
function autoGrow(el){ el.style.height='auto'; el.style.height=(el.scrollHeight+2)+'px'; }
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
  await loadCategories();
  await loadModels();
}

// ── State ────────────────────────────────────────────────────
// layerConfig entries: {_key, id, order, type, content, inputId, hex, colourId, fontId, fontObj,
//                        fontSize, border, depth, offsetX, offsetY, offsetZ, rotation}
// inputs entries: {_key, id, name, defaultValue, order} — inputId on a layer
// refers to an input's _key (translated to/from the real DB id on load/save).
let colours=[], fonts=[], models=[], currentModel=null, selectedLayerIndex=-1, deletedLayerIds=[], deletedInputIds=[];   // layerConfig/inputs live in geometry.js

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
    _key:_layerKeySeq++, id:null, order, type:'text', shapeType:'rectangle', negative:false, negAboveOnly:false, fillGaps:false, fitToShape:false, vertical:false, name:nextLayerName(), visible:true,
    content:'TEXT', inputId:null, hex: colours[0]?.code || '#e8e8e6', colourId: colours[0]?.id || null,
    fontId:null, fontObj: getCachedFont(null),
    fontSize:20, height:20, border:0, depth:1, repeatThreshold:0, letterSpacing:0, wordSpacing:0, lineSpacing:0, align:'center', lineOffsets:[],
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

// ── Category link (which PrintDesk category downloads this model) ──
let categories=[];
async function loadCategories(){
  try{ categories = await sbGet('categories','?archived=eq.false&order=name'); }catch(e){ categories=[]; }
  if(!Array.isArray(categories)) categories=[];
  const sel=document.getElementById('categorySelect');
  sel.innerHTML = '<option value="">— None —</option>' + categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  syncCategorySelect();
}
function syncCategorySelect(){
  const sel=document.getElementById('categorySelect');
  if(sel) sel.value = currentModel?.category_id || '';
}
function onCategorySelect(){
  const val = document.getElementById('categorySelect').value || null;
  if(!currentModel) currentModel = { id:null, name:null };
  currentModel.category_id = val;
  markDirty();
  loadCategoryOptions().then(()=>{ if(val) scaffoldFromCategory(); });
}
async function syncWithCategory(){
  if(!currentModel?.category_id){ setStatus('Pick a category first.','err'); return; }
  await loadCategoryOptions();
  const added = scaffoldFromCategory();
  setStatus(added ? `Added ${added} from the category's options` : 'Already in sync with the category','ok');
  setTimeout(()=>setStatus(''),2500);
}

// ── Template structure from the category's options ─────────────────
// Text option → a bound input. Dropdown option → one layer per value, shown
// only for that value (backing presets when the option is a backing).
// Colour option → one layer per colour slot, pre-coloured from the option's
// defaults. Only ever adds what's missing; never removes or rebinds.
function scaffoldFromCategory(){
  let added = 0;
  for(const o of categoryOptions){
    if(o.display==='text' && !inputs.some(i=>i.fromOption===o.name)){
      const inp = makeDefaultInput(inputs.length);
      inp.name = o.name; inp.fromOption = o.name; inp.defaultValue = o.name.toUpperCase();
      inputs.push(inp); markInputDirty(inp._key); added++;
    }
  }
  const firstInput = inputs[0]?._key ?? null;
  for(const o of categoryOptions){
    if(o.display==='dropdown'){
      const isBacking = /backing/i.test(o.name);
      optionValues(o.name).filter(v=>v.toLowerCase()!=='custom').forEach((v,k)=>{
        if(layerConfig.some(l=>l.showWhenOption===o.name && l.showWhenValue===v)) return;
        const l = makeDefaultLayer(layerConfig.length);
        l.name = v; l.showWhenOption = o.name; l.showWhenValue = v;
        if(isBacking){
          l.type = 'backing';
          applyBackingPreset(l, /round/i.test(v) ? 'round' : /pin/i.test(v) ? 'pin' : 'magnet');
          l.negative = false;
        } else if(firstInput!=null){ l.inputId = firstInput; }
        l.visible = k===0;   // preview the first variant; PrintDesk decides by the order
        layerConfig.push(l); markDirty(l._key); added++;
      });
    } else if(o.display==='colour'){
      const defaults = (o.default_colours||'').split('|').map(x=>x.trim());
      const n = Math.max(1, o.num_colours||4);
      for(let k=1;k<=n;k++){
        if(layerConfig.some(l=>l.colourFromOption===o.name && l.colourFromIndex===k)) continue;
        const l = makeDefaultLayer(layerConfig.length);
        l.name = `${o.name} #${k}`; l.colourFromOption = o.name; l.colourFromIndex = k;
        if(firstInput!=null) l.inputId = firstInput;
        const c = colours.find(c=>c.name.toLowerCase()===(defaults[k-1]||'').toLowerCase());
        if(c){ l.hex = c.code; l.colourId = c.id; }
        // Sensible stack to start from: #1 is the bordered base, the rest sit on top.
        l.border = k===1 ? 3 : 0; l.offsetZ = k-1;
        layerConfig.push(l); markDirty(l._key); added++;
      }
    }
  }
  if(added){
    normaliseLayerGroups();
    if(selectedLayerIndex<0 || selectedLayerIndex>=layerConfig.length) selectedLayerIndex = 0;
    buildInputListUI(); buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
  }
  return added;
}

// Keeps each option's layers together in the list (group order = first
// appearance), so a layer whose binding changes snaps into its group.
function normaliseLayerGroups(){
  const sel = layerConfig[selectedLayerIndex];
  const out = [], groups = new Map();
  for(const l of layerConfig){
    const key = layerGroupKey(l);
    if(key && groups.has(key)) groups.get(key).push(l);
    else { const arr=[l]; if(key) groups.set(key, arr); out.push(arr); }
  }
  layerConfig = out.flat();
  if(sel) selectedLayerIndex = layerConfig.indexOf(sel);
}

// Which variant of a dropdown group is showing in the editor. Preview only —
// PrintDesk ignores the eye state of bound layers — so it doesn't dirty.
function groupPreviewValue(opt){
  const shown = layerConfig.find(l=>l.showWhenOption===opt && l.visible!==false);
  return shown ? shown.showWhenValue : (layerConfig.find(l=>l.showWhenOption===opt)?.showWhenValue || '');
}
function setGroupPreview(opt, value){
  for(const l of layerConfig) if(l.showWhenOption===opt) l.visible = (l.showWhenValue===value);
  buildLayerListUI(); scheduleRender();
}
function groupLabel(key){
  const name = key.slice(key.indexOf(':')+1);
  const o = categoryOptions.find(o=>o.name===name);
  if(key.startsWith('col:')) return `${name} — ${o ? (o.num_colours||4) : ''} colour${(o?.num_colours||4)===1?'':'s'} from the order`;
  return name;
}
function categoryName(id){ return categories.find(c=>String(c.id)===String(id))?.name || id; }

// The linked category's PrintDesk options — what inputs and layers can bind to.
let categoryOptions=[];
async function loadCategoryOptions(){
  const catId = currentModel?.category_id;
  categoryOptions = [];
  if(catId){
    try{ categoryOptions = await sbGet('options', `?cat_id=eq.${encodeURIComponent(catId)}&archived=eq.false&order=sort_order.asc,id.asc`); }catch(e){}
    if(!Array.isArray(categoryOptions)) categoryOptions=[];
  }
  buildInputListUI(); buildLayerEditorUI();
}
const textOptions   = () => categoryOptions.filter(o=>o.display==='text' || o.display==='dropdown');
const dropdownOptions = () => categoryOptions.filter(o=>o.display==='dropdown');
const colourOptions = () => categoryOptions.filter(o=>o.display==='colour');
const optionValues  = name => (categoryOptions.find(o=>o.name===name)?.options||'').split(',').map(v=>v.trim()).filter(Boolean);

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
  syncCategorySelect();
  categoryOptions = [];
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
  currentModel = { id:null, name };   // no category_id — the original keeps the link
  syncCategorySelect();
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
  syncCategorySelect();
  deletedLayerIds = []; deletedInputIds = [];
  const [rows, inputRows] = await Promise.all([
    sbGet('badgemaker_layers', `?model_id=eq.${currentModel.id}&order=layer_order`),
    sbGet('badgemaker_inputs', `?model_id=eq.${currentModel.id}&order=input_order`),
  ]);
  ({ inputs, layerConfig } = modelFromRows(rows, inputRows));
  loadCategoryOptions();   // async; re-renders the binding selects when it lands
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
    if(!currentModel?.name){
      const name = await askText('Model name:');
      if(!name){ setStatus(''); return; }
      currentModel = {...(currentModel||{}), id:null, name};
    }
    // Only sent when set, so models without a category still save on a
    // database that hasn't had the column added yet.
    const catId = currentModel.category_id || null;
    const hadCat = !!models.find(m => String(m.id)===String(currentModel.id||''))?.category_id;
    const catField = (catId || hadCat) ? {category_id: catId} : {};
    if(catId){
      // One model per category: PrintDesk picks whichever model has the link,
      // so an old link has to be cleared before this one is written.
      const other = models.find(m => m.category_id && String(m.category_id)===String(catId) && String(m.id)!==String(currentModel.id||''));
      if(other){
        const ok = await askConfirm(`"${categoryName(catId)}" is currently linked to "${other.name}". Move it to this model?`, 'Move');
        if(!ok){ setStatus('Save cancelled — category unchanged'); return; }
        const res = await sbPatch('badgemaker_models', `?id=eq.${other.id}`, {category_id:null});
        if(res) throw new Error(res.message||res.error||'Could not unlink the other model');
      }
    }
    if(!currentModel.id){
      const created = await sbUpsert('badgemaker_models', {name:currentModel.name, ...catField});
      if(created?.code||created?.error) throw new Error(created?.message||created?.error||'Create failed');
      currentModel = created[0];
      localStorage.setItem(LS_LAST_MODEL, currentModel.id);   // newly created models skip loadModel
    } else {
      const res = await sbPatch('badgemaker_models', `?id=eq.${currentModel.id}`, {name:currentModel.name, ...catField, updated_at:new Date().toISOString()});
      if(res) throw new Error(res.message||res.error||'Save failed');
    }
    const inputKeyToId = new Map();
    for(let i=0;i<inputs.length;i++){
      const inp = inputs[i];
      const row = {
        ...(inp.id?{id:inp.id}:{}),
        model_id: currentModel.id, input_order: i,
        name: inp.name||`Field ${i+1}`, default_value: inp.defaultValue||'',
        from_option: inp.fromOption||null,
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
        is_negative: !!l.negative, negative_above_only: !!l.negAboveOnly, fill_gaps: !!l.fillGaps, fit_to_shape: !!l.fitToShape, vertical: !!l.vertical, name: l.name||null, visible: l.visible!==false,
        content: l.content||'', input_id: l.inputId!=null ? (inputKeyToId.get(l.inputId)||null) : null,
        colour_hex: l.hex, colour_id: l.colourId||null,
        font_id: l.fontId||null, font_size: l.fontSize, height_mm: l.height||20,
        repeat_threshold_mm: l.repeatThreshold||0,
        letter_spacing_mm: l.letterSpacing||0, word_spacing_mm: l.wordSpacing||0, line_spacing_mm: l.lineSpacing||0, text_align: l.align||'center',
        // Only sent when actually used, so models that never touch it still
        // save on a database that hasn't had the column added yet.
        ...(l.lineOffsets&&l.lineOffsets.length ? {line_offsets_mm: l.lineOffsets} : {}),
        border_mm: l.border, thickness_mm: l.depth,
        offset_x: l.offsetX, offset_y: l.offsetY, offset_z: l.offsetZ, rotation: l.rotation,
        show_when_option: l.showWhenOption||null, show_when_value: l.showWhenOption ? (l.showWhenValue||null) : null,
        colour_from_option: l.colourFromOption||null, colour_from_index: l.colourFromOption ? (l.colourFromIndex||1) : null,
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
      <textarea class="input-value adv-textarea" rows="1" placeholder="Value" oninput="autoGrow(this);onInputFieldChange(${i},'defaultValue',this.value)">${esc(inp.defaultValue)}</textarea>
      <button class="lr-btn" title="Delete" onclick="removeInput(${i})"><i class="ti ti-trash"></i></button>
      ${currentModel?.category_id ? `<select class="input-bind" title="Filled from this order option in PrintDesk" onchange="onInputFieldChange(${i},'fromOption',this.value||null)">
        <option value="">Not filled from order</option>
        ${textOptions().map(o=>`<option value="${esc(o.name)}"${inp.fromOption===o.name?' selected':''}>From order: ${esc(o.name)}</option>`).join('')}
        ${inp.fromOption && !textOptions().some(o=>o.name===inp.fromOption) ? `<option value="${esc(inp.fromOption)}" selected>From order: ${esc(inp.fromOption)} (missing)</option>` : ''}
      </select>` : ''}
    </div>`).join('');
  el.querySelectorAll('textarea').forEach(autoGrow);
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
    normaliseLayerGroups();
    buildLayerListUI(); buildLayerEditorUI(); scheduleRender();
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
  let prevKey = null;
  el.innerHTML = layerConfig.map((l,i)=>{
    const key = layerGroupKey(l);
    let hdr = '';
    if(key && key!==prevKey){
      const opt = key.slice(key.indexOf(':')+1);
      const preview = key.startsWith('dd:')
        ? `<select class="lg-preview" title="Which variant to show while designing" onchange="setGroupPreview('${escJsAttr(opt)}',this.value)" onclick="event.stopPropagation()">${
            [...new Set(layerConfig.filter(x=>x.showWhenOption===opt).map(x=>x.showWhenValue))].map(v=>`<option value="${esc(v)}"${v===groupPreviewValue(opt)?' selected':''}>${esc(v)}</option>`).join('')}</select>`
        : '';
      hdr = `<div class="layer-group-hdr" title="${esc(key.startsWith('dd:') ? 'One layer per value of the '+opt+' option — PrintDesk shows the one matching the order' : 'Layers coloured from the order\'s '+opt+' picks')}">
        <i class="ti ${key.startsWith('dd:')?'ti-list-details':'ti-palette'}"></i><span class="lg-name">${esc(groupLabel(key))}</span>${preview}</div>`;
    }
    prevKey = key;
    return hdr + `
    <div class="layer-row${key?' in-group':''}${i===selectedLayerIndex?' selected':''}${dirtyLayerKeys.has(l._key)?' dirty':''}${(l.negative&&l.negAboveOnly)?' negative':''}${l.visible===false?' hidden-layer':''}"
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
      ${l.showWhenOption ? `<span class="lr-bind" title="Shown when ${esc(l.showWhenOption)} = ${esc(l.showWhenValue||'')}">${esc(l.showWhenValue||'')}</span>`
        : l.colourFromOption ? `<span class="lr-bind" title="Colour from the order's ${esc(l.colourFromOption)} #${l.colourFromIndex||1}">#${l.colourFromIndex||1}</span>` : ''}
      <div class="layer-row-menu-wrap">
        <button class="lr-btn" title="Layer options" onclick="event.stopPropagation();toggleLayerMenu(${i})"><i class="ti ti-dots-vertical"></i></button>
        <div class="layer-row-menu" style="display:${openLayerMenuIndex===i?'flex':'none'}" onclick="event.stopPropagation()">
          <div class="lrm-item" onclick="duplicateLayer(${i});closeLayerMenu()"><i class="ti ti-copy"></i> Duplicate</div>
          <div class="lrm-item" onclick="renameLayer(${i});closeLayerMenu()"><i class="ti ti-edit"></i> Rename</div>
          <div class="lrm-item danger" onclick="removeLayer(${i});closeLayerMenu()"><i class="ti ti-trash"></i> Delete</div>
        </div>
      </div>
    </div>`;
  }).join('');
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
  const isText = l.type==='text';
  document.getElementById('textOnlyFields').style.display = isText ? '' : 'none';
  // These live in Appearance but only apply to text, so they hide row by row
  // rather than with their block.
  for(const id of ['fillGapsRow','letterSpacingRow','wordSpacingRow','lineSpacingRow'])
    document.getElementById(id).style.display = isText ? '' : 'none';
  const srcSel = document.getElementById('layInputSource');
  srcSel.innerHTML = '<option value="">Literal text</option>' + inputs.map(inp=>`<option value="${inp._key}">${esc(inp.name)}</option>`).join('');
  srcSel.value = l.inputId||'';
  document.getElementById('layContentRow').style.display = l.inputId!=null ? 'none' : '';
  const contentEl = document.getElementById('layContent');
  contentEl.value = l.content||'';
  autoGrow(contentEl);
  document.getElementById('layFillGaps').checked = !!l.fillGaps;
  document.getElementById('layLetterSpacing').value = l.letterSpacing ?? 0;
  document.getElementById('layWordSpacing').value = l.wordSpacing ?? 0;
  document.getElementById('layLineSpacing').value = l.lineSpacing ?? 0;
  // Alignment only shifts one line against another, so it needs >1 line;
  // vertical text stacks single characters and has nothing to align.
  document.getElementById('layAlign').value = l.align || 'center';
  document.getElementById('alignRow').style.display = (isText && !l.vertical) ? '' : 'none';
  syncLineOffsetRows();
  // In vertical mode letter spacing is the gap between stacked characters.
  document.getElementById('letterSpacingLabel').textContent =
    l.vertical ? 'Character spacing (mm)' : 'Letter spacing (mm)';
  buildFontDropdown();
  document.getElementById('layFont').value = l.fontId||'';
  // The three dimension fields are shared across types, relabelled to suit:
  // text/shape/backing use Size|Width + Height + Stroke; keychain reuses them
  // as hole ⌀ + wall thickness + connector length.
  const isKeychain = l.type==='keychain';
  const isRound = isBacking ? l.shapeType==='round' : l.shapeType==='circle';
  const isRounded = l.type==='shape' && l.shapeType==='roundedrect';
  const hasWH = (l.type==='shape' || isBacking) && !isRound;
  document.getElementById('verticalTextRow').style.display = (l.type==='text') ? '' : 'none';
  document.getElementById('layVertical').checked = !!l.vertical;
  // Fit-to-shape turns Width/Height into +/- adjustments off the badge size.
  const canFit = l.type==='shape' && (l.shapeType==='rectangle' || isRounded);
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
  // `border` is reused per type: stroke for text, connector length for the
  // keychain, corner radius for a rounded rectangle.
  document.getElementById('borderRow').style.display = (l.type==='text' || isKeychain || isRounded) ? '' : 'none';
  document.getElementById('borderLabel').textContent =
    isKeychain ? 'Connector length (mm)' : isRounded ? 'Corner radius (mm)' : 'Stroke / border (mm)';
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
  buildBindingUI(l, isBacking || l.negative);
  wrapSpinners(editor);
}

// "Order" block: which PrintDesk option shows this layer / recolours it.
// Selects list the linked category's real options so nothing is free-typed.
function buildBindingUI(l, isCutter){
  const hint = document.getElementById('bindHint');
  const rows = document.getElementById('bindRows');
  if(!currentModel?.category_id){
    hint.textContent = 'Link a category (left panel) to bind this layer to order options.';
    rows.style.display = 'none'; return;
  }
  rows.style.display = '';
  hint.textContent = '';
  const dd = dropdownOptions();
  const showSel = document.getElementById('layShowWhenOpt');
  showSel.innerHTML = '<option value="">Always</option>' + dd.map(o=>`<option value="${esc(o.name)}">${esc(o.name)}</option>`).join('')
    + (l.showWhenOption && !dd.some(o=>o.name===l.showWhenOption) ? `<option value="${esc(l.showWhenOption)}">${esc(l.showWhenOption)} (missing)</option>` : '');
  showSel.value = l.showWhenOption || '';
  const valRow = document.getElementById('showWhenValRow');
  valRow.style.display = l.showWhenOption ? '' : 'none';
  if(l.showWhenOption){
    const vals = optionValues(l.showWhenOption);
    const valSel = document.getElementById('layShowWhenVal');
    valSel.innerHTML = vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')
      + (l.showWhenValue && !vals.includes(l.showWhenValue) ? `<option value="${esc(l.showWhenValue)}">${esc(l.showWhenValue)} (missing)</option>` : '');
    valSel.value = l.showWhenValue || vals[0] || '';
  }
  const colRow = document.getElementById('colourFromRow');
  colRow.style.display = isCutter ? 'none' : '';
  const colSel = document.getElementById('layColourFrom');
  const cur = l.colourFromOption ? `${l.colourFromOption}|${l.colourFromIndex||1}` : '';
  let opts = '<option value="">Template colour</option>';
  for(const o of colourOptions()){
    const n = Math.max(1, o.num_colours||4);
    for(let k=1;k<=n;k++) opts += `<option value="${esc(o.name)}|${k}">${esc(o.name)} #${k}</option>`;
  }
  if(cur && !colourOptions().some(o=>o.name===l.colourFromOption)) opts += `<option value="${esc(cur)}">${esc(l.colourFromOption)} #${l.colourFromIndex||1} (missing)</option>`;
  colSel.innerHTML = opts;
  colSel.value = cur;
}
function onShowWhenChange(optName){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l.showWhenOption = optName || null;
  l.showWhenValue = optName ? (optionValues(optName)[0] || null) : null;
  markDirty(l._key);
  normaliseLayerGroups();
  buildLayerListUI(); buildLayerEditorUI();
}
function onColourFromChange(v){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  const [name, idx] = v ? v.split('|') : [null, null];
  l.colourFromOption = name || null;
  l.colourFromIndex = name ? (parseInt(idx)||1) : null;
  markDirty(l._key);
  normaliseLayerGroups();
  buildLayerListUI(); buildLayerEditorUI();
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

// One X nudge per line, shown only when there's more than one line to nudge.
// Vertical text stacks characters, so there are no lines to offset.
function syncLineOffsetRows(){
  const wrap = document.getElementById('lineOffsetRows');
  if(!wrap) return;
  const l = layerConfig[selectedLayerIndex];
  const lines = (l && l.type==='text' && !l.vertical) ? resolveLayerText(l).split('\n') : [];
  wrap.innerHTML = lines.length > 1 ? lines.map((t,i)=>
    `<div class="adv-row"><label title="${esc(t)}">Line ${i+1} X (mm)</label>`
    + `<input type="number" class="adv-input" step="0.5" value="${(l.lineOffsets&&l.lineOffsets[i])||0}" onchange="onLineOffsetChange(${i}, +this.value)"></div>`).join('') : '';
  wrapSpinners(wrap);
}

function onLineOffsetChange(i, value){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  // Copied, not mutated — duplicated layers share the array until one changes.
  const arr = Array.isArray(l.lineOffsets) ? l.lineOffsets.slice() : [];
  while(arr.length <= i) arr.push(0);
  arr[i] = value || 0;
  onLayerFieldChange('lineOffsets', arr);
}

function onLayerFieldChange(field, value){
  const l = layerConfig[selectedLayerIndex];
  if(!l) return;
  l[field]=value;
  if(field==='type' && value==='shape' && !['rectangle','roundedrect','circle'].includes(l.shapeType)) l.shapeType='rectangle';
  if(field==='type' && value==='backing') applyBackingPreset(l, BACKING_PRESETS[l.shapeType] ? l.shapeType : 'magnet');
  if(field==='type' && value==='keychain'){
    // Defaults match the original generator's ring: 10mm hole, 2.5mm wall, 4mm deep.
    if(!KEYCHAIN_SIDES.includes(l.shapeType)) l.shapeType='right';
    l.fontSize=10; l.height=2.5; l.border=3; l.depth=4; l.negative=false;
  }
  markDirty(l._key);
  if(field==='content'||field==='type'||field==='shapeType'||field==='inputId'||field==='negative'||field==='negAboveOnly'||field==='showWhenValue') buildLayerListUI();
  if(field==='type'||field==='shapeType'||field==='inputId'||field==='negative'||field==='negAboveOnly'||field==='repeatThreshold'||field==='vertical') buildLayerEditorUI();
  // Typing a newline changes how many lines there are, but rebuilding the whole
  // editor mid-keystroke would steal focus from the textarea — just the rows.
  else if(field==='content') syncLineOffsetRows();
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
