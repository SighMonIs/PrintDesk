// ── Sidebar ────────────────────────────────────────────────
// modes: 'hover' (default), 'expanded' (pinned open), 'collapsed' (always closed)
let sidebarMode = 'hover';

function initSidebar(){
  applySidebarMode(sidebarMode);
}

function applySidebarMode(mode){
  sidebarMode = mode;
  const sidebar = document.getElementById('sidebar');
  const app     = document.getElementById('mainApp');

  sidebar.classList.remove('pinned','force-collapsed');
  app.classList.remove('sidebar-pinned');

  if(mode === 'expanded'){
    sidebar.classList.add('pinned');
    app.classList.add('sidebar-pinned');
  } else if(mode === 'collapsed'){
    sidebar.classList.add('force-collapsed');
  }
}

function setSidebarMode(mode){
  applySidebarMode(mode);
  savePreferences();
}

// Mobile sidebar
function openMobileSidebar(){
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebarOverlay').classList.add('mobile-open');
}
function closeMobileSidebar(){
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebarOverlay').classList.remove('mobile-open');
}
// Close mobile sidebar on outside click
document.addEventListener('click', e=>{
  if(window.innerWidth<=640 && e.target.closest('.sidebar-item')){
    closeMobileSidebar();
  }
});


// ── Confirm dialog ─────────────────────────────────────────
let _confirmCallback = null;

function showConfirm(msg, onConfirm, { confirmLabel = 'Delete', isDanger = true } = {}) {
  document.getElementById('confirmMsg').textContent = msg;
  const okBtn = document.getElementById('confirmOk');
  okBtn.textContent = confirmLabel;
  okBtn.className = 'btn' + (isDanger ? ' danger' : ' primary');
  _confirmCallback = onConfirm;
  okBtn.onclick = () => { const cb = _confirmCallback; closeConfirm(); cb && cb(); };
  document.getElementById('confirmDialog').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirmDialog').classList.remove('open');
  _confirmCallback = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ closeConfirm(); if(typeof closeTypeConfirm==='function') closeTypeConfirm(); }
});

// ── Invite / Set password flow ─────────────────────────────
// When an invited user clicks their email link, Supabase redirects to
// simonreid.space with #access_token=...&type=invite in the URL hash
async function checkInviteToken(){
  const hash = window.location.hash;
  if(!hash) return false;
  const params = new URLSearchParams(hash.slice(1));
  const type   = params.get('type');
  const token  = params.get('access_token');
  if((type === 'invite' || type === 'recovery') && token){
    // Store token temporarily for use when setting password
    sessionStorage.setItem('invite_token', token);
    // Clear the hash from URL
    history.replaceState(null, '', window.location.pathname);
    // Show set password screen
    document.getElementById('setPasswordScreen').style.display = 'flex';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'none';
    return true;
  }
  return false;
}

async function doSetPassword(){
  const password = document.getElementById('setPasswordInput').value;
  const confirm  = document.getElementById('setPasswordConfirm').value;
  const errEl    = document.getElementById('setPasswordError');
  const btn      = document.getElementById('setPasswordBtn');
  errEl.style.display = 'none';

  if(password.length < 6){ errEl.textContent='Password must be at least 6 characters.'; errEl.style.display=''; return; }
  if(password !== confirm){ errEl.textContent='Passwords do not match.'; errEl.style.display=''; return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Setting password…';

  try{
    const inviteToken = sessionStorage.getItem('invite_token');
    // Update password using the invite token
    const res = await fetch(sbAuthUrl('/user'), {
      method: 'PUT',
      headers: { ...sbAuthHeaders(), 'Authorization': 'Bearer ' + inviteToken },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.msg || data.error_description || 'Failed to set password');

    // Now log them in properly
    currentUser = data;
    localStorage.setItem('pd_access_token', inviteToken);
    sessionStorage.removeItem('invite_token');
    document.getElementById('setPasswordScreen').style.display = 'none';
    showApp();
  } catch(e){
    errEl.textContent = e.message;
    errEl.style.display = '';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Set password & sign in';
  }
}

// ── Auth ──────────────────────────────────────────────────
let currentUser = null;

function sbAuthUrl(path){
  return getCfg('SUPABASE_URL') + '/auth/v1' + path;
}

function sbAuthHeaders(){
  return {
    'apikey':       getCfg('SUPABASE_KEY'),
    'Content-Type': 'application/json'
  };
}

async function doLogin(){
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errEl    = document.getElementById('loginError');
  errEl.style.display = 'none';
  if(!email||!password){ showLoginError('Please enter your email and password.'); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Signing in…';
  try {
    const res = await fetch(sbAuthUrl('/token?grant_type=password'), {
      method: 'POST',
      headers: sbAuthHeaders(),
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');
    currentUser = data.user;
    localStorage.setItem('pd_access_token',  data.access_token);
    localStorage.setItem('pd_refresh_token', data.refresh_token);
    showApp();
  } catch(e) {
    showLoginError(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-login"></i> Sign in';
  }
}

function showLoginError(msg){
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = '';
}

async function restoreSession(){
  const token = localStorage.getItem('pd_access_token');
  if(!token) return false;
  // Verify token is still valid
  try {
    const res = await fetch(sbAuthUrl('/user'), {
      headers: { ...sbAuthHeaders(), 'Authorization': 'Bearer ' + token }
    });
    if(!res.ok) {
      // Try refresh
      const refreshed = await refreshSession();
      return refreshed;
    }
    currentUser = await res.json();
    return true;
  } catch(e) {
    return false;
  }
}

async function refreshSession(){
  const refresh = localStorage.getItem('pd_refresh_token');
  if(!refresh) return false;
  try {
    const res = await fetch(sbAuthUrl('/token?grant_type=refresh_token'), {
      method: 'POST',
      headers: sbAuthHeaders(),
      body: JSON.stringify({ refresh_token: refresh })
    });
    if(!res.ok) return false;
    const data = await res.json();
    currentUser = data.user;
    localStorage.setItem('pd_access_token',  data.access_token);
    localStorage.setItem('pd_refresh_token', data.refresh_token);
    return true;
  } catch(e) {
    return false;
  }
}

function getAccessToken(){
  return localStorage.getItem('pd_access_token') || '';
}

async function doLogout(){
  try {
    await fetch(sbAuthUrl('/logout'), {
      method: 'POST',
      headers: { ...sbAuthHeaders(), 'Authorization': 'Bearer ' + getAccessToken() }
    });
  } catch(e) {}
  localStorage.removeItem('pd_access_token');
  localStorage.removeItem('pd_refresh_token');
  currentUser = null;
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}

function showApp(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = '';
  initSidebar();
  setTimeout(updateSortUI, 100);
  loadAll();
}

// ── User Preferences ──────────────────────────────────────
async function loadPreferences(){
  if(!currentUser) return;
  try {
    const token = getAccessToken();
    const res = await fetch(
      getCfg('SUPABASE_URL') + '/rest/v1/user_preferences?user_id=eq.' + currentUser.id,
      { headers: { ...SB_HEADERS(), 'Authorization': 'Bearer ' + token } }
    );
    const rows = await res.json();
    if(rows.length){
      const p = rows[0];
      if(p.accent_colour)  applyAccent(p.accent_colour, p.accent_colour2||darken(p.accent_colour,0.18), false);
      if(p.sort_key){ sortKey=p.sort_key; sortDir=p.sort_dir||1; updateSortUI(); }
      if(p.sidebar_pinned !== undefined){ sidebarMode = p.sidebar_pinned === true ? 'expanded' : (p.sidebar_mode||'hover'); applySidebarMode(sidebarMode); }
    }
  } catch(e) { console.warn('Could not load preferences:', e); }
}

async function savePreferences(){
  if(!currentUser) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const accent2= getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim();
  const prefs = {
    user_id:        currentUser.id,
    accent_colour:  accent,
    accent_colour2: accent2,
    sort_key:       sortKey,
    sort_dir:       sortDir,
    sidebar_pinned: sidebarMode==='expanded',
    sidebar_mode:   sidebarMode,
    updated_at:     new Date().toISOString()
  };
  try {
    const token = getAccessToken();
    await fetch(getCfg('SUPABASE_URL') + '/rest/v1/user_preferences', {
      method: 'POST',
      headers: {
        ...SB_HEADERS(),
        'Authorization': 'Bearer ' + token,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(prefs)
    });
  } catch(e) { console.warn('Could not save preferences:', e); }
}

// ── Config ────────────────────────────────────────────────
// ── Supabase config ───────────────────────────────────────
function getCfg(key){
  return localStorage.getItem('pd_'+key) ||
         (typeof window.CONFIG!=='undefined'&&window.CONFIG[key]) || '';
}

const SB_HEADERS = () => ({
  'apikey':        getCfg('SUPABASE_KEY'),
  'Authorization': 'Bearer ' + (getAccessToken() || getCfg('SUPABASE_KEY')),
  'Content-Type':  'application/json',
  'Prefer':        'return=representation'
});

// Admin headers use service role key — for user management only
const SB_ADMIN_HEADERS = () => ({
  'apikey':        getCfg('SUPABASE_SERVICE_KEY') || getCfg('SUPABASE_KEY'),
  'Authorization': 'Bearer ' + (getCfg('SUPABASE_SERVICE_KEY') || getAccessToken()),
  'Content-Type':  'application/json'
});

function sbUrl(table, query){
  return getCfg('SUPABASE_URL') + '/rest/v1/' + table + (query||'');
}

// ── State ──────────────────────────────────────────────────
let orders    = [];
let cats      = [];   // [{id,name,price}]
let opts      = [];   // [{id,catId,name,display,options}]
let colours   = [];   // [{id,name,code,available}]
let customers  = [];   // [{id,name,email,phone,address,notes}]
let showArchivedCats = false;
let editOId   = null;
let sortKey   = 'orderId';  // default: order # descending
let sortDir   = -1;
let mCounter  = 0;
let acInst    = null;  // true = autocomplete initialised, prevents double-init
let busy      = false;

// ── Date helpers ───────────────────────────────────────────
function toDisplay(v){
  if(!v)return'';
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(String(v)))return String(v);
  const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return m[3]+'/'+m[2]+'/'+m[1];
  return String(v);
}
function todayDMY(){
  const d=new Date();
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
}

// ── ID generators ──────────────────────────────────────────
function padN(n,l){return String(n).padStart(l,'0');}
function nextOrderId(){
  const nums=orders.map(o=>o.orderId).filter(id=>/^O\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(1)));
  return 'O'+padN((nums.length?Math.max(...nums):0)+1,10);
}
function makeRowId(orderId, itemIndex){
  // Format: O0001-1, O0001-2 etc — ties each row to its order
  const shortOrder = String(orderId).replace(/^O0*/, 'O');
  return shortOrder + '-' + (itemIndex + 1);
}
function nextCatId(){
  const nums=cats.map(c=>c.id).filter(id=>/^C\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(1)));
  return 'C'+padN((nums.length?Math.max(...nums):0)+1,4);
}
function nextCustomerId(){
  const nums=customers.map(c=>c.id).filter(id=>/^CUST\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(4)));
  return 'CUST'+padN((nums.length?Math.max(...nums):0)+1,4);
}
function nextColourId(){
  const nums=colours.map(c=>c.id).filter(id=>/^COL\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(3)));
  return 'COL'+padN((nums.length?Math.max(...nums):0)+1,4);
}
function nextOptId(){
  const nums=opts.map(o=>o.id).filter(id=>/^O\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(1)));
  return 'O'+padN((nums.length?Math.max(...nums):0)+1,4);
}

// ── Supabase API ──────────────────────────────────────────
async function sbFetch(url, options, retry=true){
  const res = await fetch(url, options);
  if(res.status === 401 && retry){
    // Token expired — try to refresh then retry once
    const refreshed = await refreshSession();
    if(refreshed){
      // Rebuild options with new token
      const newOpts = {...options, headers: {...options.headers, ...SB_HEADERS()}};
      return sbFetch(url, newOpts, false);
    }
    // Refresh failed — send to login
    doLogout();
    throw new Error('Session expired — please log in again');
  }
  return res;
}

async function sbGet(table, query){
  const res = await sbFetch(sbUrl(table, query), { headers: SB_HEADERS() });
  if(!res.ok) throw new Error('GET '+table+' failed: '+res.status);
  return res.json();
}

async function sbUpsert(table, row){
  const res = await sbFetch(sbUrl(table), {
    method: 'POST',
    headers: { ...SB_HEADERS(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
  if(!res.ok){ const t=await res.text(); throw new Error('Upsert failed: '+t.slice(0,200)); }
  return res.json();
}

async function sbDelete(table, filter){
  const res = await sbFetch(sbUrl(table, '?'+filter), {
    method: 'DELETE',
    headers: SB_HEADERS()
  });
  if(!res.ok) throw new Error('DELETE '+table+' failed: '+res.status);
  return true;
}

async function sbReplace(table, rows){
  // Safe replace: upsert all rows first, then delete any that are no longer present
  // This avoids data loss if the insert fails after a delete
  if(rows.length){
    const upsertRes = await fetch(sbUrl(table), {
      method: 'POST',
      headers: { ...SB_HEADERS(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows)
    });
    if(!upsertRes.ok){ const t=await upsertRes.text(); throw new Error('Upsert failed: '+t.slice(0,200)); }
  }
  // Delete rows not in the new set
  const ids = rows.map(r=>r.id).filter(Boolean);
  if(ids.length){
    const notIn = ids.map(id=>`"${id}"`).join(',');
    await fetch(sbUrl(table, `?id=not.in.(${notIn})`), {
      method: 'DELETE', headers: SB_HEADERS()
    });
  } else {
    // No rows — delete all
    await fetch(sbUrl(table, '?id=neq.NONE'), {
      method: 'DELETE', headers: SB_HEADERS()
    });
  }
}

// ── Setup ──────────────────────────────────────────────────
function saveSupabaseConfig(){
  const url=document.getElementById('gasUrlInput').value.trim();
  const key=document.getElementById('sbKeyInput').value.trim();
  if(url) localStorage.setItem('pd_SUPABASE_URL', url);
  if(key) localStorage.setItem('pd_SUPABASE_KEY', key);
  document.getElementById('setupBanner').style.display='none';
  loadAll();
}

// ── Load ───────────────────────────────────────────────────
async function loadAll(){
  const sbUrl2 = getCfg('SUPABASE_URL');
  const sbKey  = getCfg('SUPABASE_KEY');
  if(!sbUrl2||!sbKey){
    document.getElementById('setupBanner').style.display='';
    setStatus('err','Not connected — enter Supabase credentials');
    renderTable();return;
  }
  setStatus('spin','Loading…');
  try{
    const [ordersRaw, catsRaw, optsRaw, coloursRaw, customersRaw] = await Promise.all([
      sbGet('orders', '?order=order_id.asc&limit=10000'),
      sbGet('categories', '?order=id.asc'),
      sbGet('options', '?order=sort_order.asc,id.asc'),
      sbGet('colours', '?order=id.asc'),
      sbGet('customers', '?order=name.asc')
    ]);
    orders    = ordersRaw.map(normalise);
    cats      = catsRaw.map(normaliseCat);
    opts      = optsRaw.map(normaliseOpt);
    colours   = coloursRaw.map(normaliseColour);
    customers = customersRaw.map(normaliseCustomer);
    if(!cats.length) setStatus('warn','No categories found — add some in Categories');
    populateCatFilter();
    await loadPreferences();  // load sort prefs before rendering
    renderTable();
    setStatus('ok','Connected');
  }catch(e){setStatus('err','Load failed: '+e.message);}
}

function normalise(o){
  // Supabase returns snake_case — map to camelCase with fallbacks
  return{
    id:       String(o.id                          ||''),
    orderId:  String(o.order_id  ||o.orderId       ||''),
    customer: String(o.customer                    ||''),
    address:  String(o.address                     ||''),
    delivery: String(o.delivery                    ||'Post'),
    payment:  String(o.payment&&o.payment.trim()?o.payment.trim():'No'),
    model:    String(o.model                       ||''),
    catId:    String(o.cat_id    ||o.catId         ||''),
    qty:      Number(o.qty                         ||0),
    price:    Number(o.price                       ||0),
    total:    Number(o.total                       ||0),
    status:   String(o.status                      ||'Pending'),
    date:     String(o.date||''),  // stored as ISO or dd/mm/yyyy, displayed via toDisplay()
    notes:    String(o.notes                       ||''),
    options:     String(o.options                     ||''),
    customer_id: String(o.customer_id                  ||'')
  };
}

function normaliseCustomer(c){
  return{
    id:      String(c.id||''),
    name:    String(c.name||''),
    email:   String(c.email||''),
    phone:   String(c.phone||''),
    address: String(c.address||''),
    notes:   String(c.notes||'')
  };
}
function normaliseCat(c){
  return{id:String(c.id||''),name:String(c.name||''),price:Number(c.price||0),archived:Boolean(c.archived||false)};
}
function normaliseOpt(o){
  return{
    id:          String(o.id||''),
    catId:       String(o.cat_id||o.catId||''),
    name:        String(o.name||''),
    display:     String(o.display||'text'),
    options:     String(o.options||''),
    sort_order:  Number(o.sort_order||0),
    num_colours: Number(o.num_colours||4),
    force_caps:  Boolean(o.force_caps||false),
    multi_item:  Boolean(o.multi_item||false),
    archived:    Boolean(o.archived||false)
  };
}
function normaliseColour(c){
  return{
    id:        String(c.id||''),
    name:      String(c.name||''),
    code:      String(c.code||'#cccccc'),
    available: c.available===true||String(c.available).toLowerCase()==='true'
  };
}
