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
      if(p.sort_key){ sortKey=p.sort_key; sortDir=p.sort_dir||1; updateSortUI(); }
      if(p.sidebar_pinned !== undefined){ sidebarMode = p.sidebar_pinned === true ? 'expanded' : (p.sidebar_mode||'hover'); applySidebarMode(sidebarMode); }
    }
  } catch(e) { console.warn('Could not load preferences:', e); }
}

async function savePreferences(){
  if(!currentUser) return;
  const prefs = {
    user_id:        currentUser.id,
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
let inventoryItems       = [];   // [{id,name,notes,archived}]
let inventoryReceipts    = [];   // [{id,itemId,qty,cost,date}] — dated log of stock received
let inventoryConsumption = [];   // [{id,itemId,orderId,qty,date}] — dated log of stock used by completed orders
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
function todayISO(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
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
function nextInventoryItemId(){
  const nums=inventoryItems.map(i=>i.id).filter(id=>/^INV\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(3)));
  return 'INV'+padN((nums.length?Math.max(...nums):0)+1,4);
}
function nextInventoryReceiptId(){
  const nums=inventoryReceipts.map(r=>r.id).filter(id=>/^RCPT\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(4)));
  return 'RCPT'+padN((nums.length?Math.max(...nums):0)+1,4);
}
function nextInventoryConsumptionId(){
  const nums=inventoryConsumption.map(c=>c.id).filter(id=>/^CONS\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(4)));
  return 'CONS'+padN((nums.length?Math.max(...nums):0)+1,4);
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
  if(DEV_MODE) return Array.isArray(row)?row:[row]; // in-memory fixtures only — no real backend to write to
  const res = await sbFetch(sbUrl(table), {
    method: 'POST',
    headers: { ...SB_HEADERS(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
  if(!res.ok){ const t=await res.text(); throw new Error('Upsert failed: '+t.slice(0,200)); }
  return res.json();
}

// For toggling a few columns on row(s) we know already exist — a real UPDATE
// (PostgREST PATCH) can never fall through to an INSERT the way upsert can,
// so it can't trip a NOT NULL violation on columns the partial payload omits.
async function sbPatch(table, filter, fields){
  if(DEV_MODE) return [fields];
  const res = await sbFetch(sbUrl(table, '?'+filter), {
    method: 'PATCH',
    headers: { ...SB_HEADERS(), 'Prefer': 'return=representation' },
    body: JSON.stringify(fields)
  });
  if(!res.ok){ const t=await res.text(); throw new Error('Update failed: '+t.slice(0,200)); }
  return res.json();
}

async function sbDelete(table, filter){
  if(DEV_MODE) return true; // in-memory fixtures only — no real backend to write to
  const res = await sbFetch(sbUrl(table, '?'+filter), {
    method: 'DELETE',
    headers: SB_HEADERS()
  });
  if(!res.ok) throw new Error('DELETE '+table+' failed: '+res.status);
  return true;
}

async function sbReplace(table, rows){
  if(DEV_MODE) return rows; // in-memory fixtures only — no real backend to write to
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

// ── Dev mode (localhost only): skip login + Supabase, use fixture data ──
const DEV_MODE = ['localhost','127.0.0.1'].includes(location.hostname);

const DEV_FIXTURES = {
  categories: [
    {id:'C0001', name:'Name Badge',    price:8},
    {id:'C0002', name:'Keychain',      price:10},
    {id:'C0003', name:'Coaster',       price:12},
    {id:'C0004', name:'Fridge Magnet', price:6}
  ],
  options: [
    {id:'O0001', cat_id:'C0001', name:'Text',    display:'text'},
    {id:'O0002', cat_id:'C0001', name:'Backing', display:'text'},
    {id:'O0003', cat_id:'C0001', name:'Colours', display:'colour'},
    {id:'O0004', cat_id:'C0002', name:'Text',    display:'text'},
    {id:'O0005', cat_id:'C0002', name:'Backing', display:'text'},
    {id:'O0006', cat_id:'C0002', name:'Colours', display:'colour'},
    {id:'O0007', cat_id:'C0003', name:'Colour',  display:'colour'},
    {id:'O0008', cat_id:'C0004', name:'Colour',  display:'colour'}
  ],
  colours: [
    {id:'COL0001', name:'Red',   code:'#e05c5c', available:true},
    {id:'COL0002', name:'Blue',  code:'#5b9cf6', available:true},
    {id:'COL0003', name:'Black', code:'#1a1a1a', available:true},
    {id:'COL0004', name:'White', code:'#f2f2f2', available:true},
    {id:'COL0005', name:'Gold',  code:'#e8d5a3', available:true},
    {id:'COL0006', name:'Green', code:'#5cb87a', available:true}
  ],
  customers: [
    {id:'CUST0001', name:'Kevin Evans',  email:'kevin@example.com',  phone:'0400 111 222', address:'12 Example St, Sydney NSW'},
    {id:'CUST0002', name:'Mel Hutchin',  email:'mel@example.com',    phone:'0400 222 333', address:'8 Sample Ave, Melbourne VIC'},
    {id:'CUST0003', name:'Donna Mee',    email:'donna@example.com',  phone:'0400 333 444', address:'21 Demo Rd, Brisbane QLD'},
    {id:'CUST0004', name:'Alex Chen',    email:'alex@example.com',   phone:'0400 444 555', address:'5 Test Ct, Perth WA'},
    {id:'CUST0005', name:'Priya Singh',  email:'priya@example.com',  phone:'0400 555 666', address:'40 Mock Ln, Adelaide SA', archived:true}
  ],
  orders: [
    {id:'1', order_id:'O0000000001', customer:'Kevin Evans', customer_id:'CUST0001', address:'12 Example St, Sydney NSW', delivery:'Express Post', payment:'Card', cat_id:'C0001', qty:42, price:8,  total:336, status:'Complete', date:'2026-07-01', options:'Text:Kevin||Backing:Pin||Colours:Gold', printed:true, paid:true, inv_consumed:true},
    {id:'2', order_id:'O0000000001', customer:'Kevin Evans', customer_id:'CUST0001', address:'12 Example St, Sydney NSW', delivery:'Express Post', payment:'Card', cat_id:'C0002', qty:1,  price:10, total:10,  status:'Complete', date:'2026-07-01', options:'Text:Kevin||Backing:Keychain||Colours:Black', printed:true, paid:true, inv_consumed:true},
    {id:'3', order_id:'O0000000002', customer:'Mel Hutchin',  customer_id:'CUST0002', address:'8 Sample Ave, Melbourne VIC', delivery:'Pick Up', payment:'Cash', cat_id:'C0001', qty:2,  price:10, total:20,  status:'Complete', date:'2026-07-02', options:'Text:Mel||Backing:Magnet||Colours:Blue', printed:true, paid:true, inv_consumed:true},
    {id:'4', order_id:'O0000000003', customer:'Donna Mee',    customer_id:'CUST0003', address:'21 Demo Rd, Brisbane QLD', delivery:'Post', payment:'No', cat_id:'C0001', qty:20, price:10, total:200, status:'Pending', date:'2026-07-03', notes:'Call before delivery', options:'Text:Donna||Backing:Pin||Colours:Red', printed:false, paid:false},
    {id:'5', order_id:'O0000000004', customer:'Alex Chen',    customer_id:'CUST0004', address:'5 Test Ct, Perth WA', delivery:'Post', payment:'Card', cat_id:'C0003', qty:4,  price:12, total:48,  status:'Confirmed', date:'2026-07-04', options:'Colour:Red', printed:false, paid:false},
    {id:'6', order_id:'O0000000005', customer:'Priya Singh',  customer_id:'CUST0005', address:'40 Mock Ln, Adelaide SA', delivery:'Pick Up', payment:'Card', cat_id:'C0004', qty:6,  price:6,  total:36,  status:'On Hold', date:'2026-07-04', options:'Colour:Green', printed:false, paid:false},
    {id:'7', order_id:'O0000000005', customer:'Priya Singh',  customer_id:'CUST0005', address:'40 Mock Ln, Adelaide SA', delivery:'Pick Up', payment:'Card', cat_id:'C0003', qty:2,  price:12, total:24,  status:'On Hold', date:'2026-07-04', options:'Colour:White', printed:false, paid:false},
    {id:'8', order_id:'O0000000006', customer:'Kevin Evans', customer_id:'CUST0001', address:'12 Example St, Sydney NSW', delivery:'Post', payment:'Card', cat_id:'C0002', qty:3,  price:10, total:30,  status:'Cancelled', date:'2026-06-28', options:'Text:Test||Backing:Keychain||Colours:Black', printed:false, paid:false}
  ],
  inventoryItems: [
    {id:'INV0001', name:'Pin',    notes:'Standard pin backing', archived:false},
    {id:'INV0002', name:'Magnet', notes:'Standard magnet backing', archived:false}
  ],
  inventoryReceipts: [
    {id:'RCPT0001', item_id:'INV0001', qty:100, cost:0.10, date:'2026-06-15'},
    {id:'RCPT0002', item_id:'INV0001', qty:50,  cost:0.12, date:'2026-06-25'},
    {id:'RCPT0003', item_id:'INV0002', qty:50,  cost:0.25, date:'2026-06-20'}
  ],
  inventoryConsumption: [
    {id:'CONS0001', item_id:'INV0001', order_id:'O0000000001', qty:42, date:'2026-07-01'},
    {id:'CONS0002', item_id:'INV0002', order_id:'O0000000002', qty:2,  date:'2026-07-02'}
  ]
};

// ── Load ───────────────────────────────────────────────────
async function loadAll(){
  if(DEV_MODE){
    cats      = DEV_FIXTURES.categories.map(normaliseCat);
    opts      = DEV_FIXTURES.options.map(normaliseOpt);
    colours   = DEV_FIXTURES.colours.map(normaliseColour);
    customers = DEV_FIXTURES.customers.map(normaliseCustomer);
    orders    = DEV_FIXTURES.orders.map(normalise);
    inventoryItems       = DEV_FIXTURES.inventoryItems.map(normaliseInventoryItem);
    inventoryReceipts    = DEV_FIXTURES.inventoryReceipts.map(normaliseInventoryReceipt);
    inventoryConsumption = DEV_FIXTURES.inventoryConsumption.map(normaliseInventoryConsumption);
    populateCatFilter();
    renderTable();
    setStatus('ok','Connected (dev fixtures)');
    return;
  }
  const sbUrl2 = getCfg('SUPABASE_URL');
  const sbKey  = getCfg('SUPABASE_KEY');
  if(!sbUrl2||!sbKey){
    document.getElementById('setupBanner').style.display='';
    setStatus('err','Not connected — enter Supabase credentials');
    renderTable();return;
  }
  setStatus('spin','Loading…');
  try{
    const [ordersRaw, catsRaw, optsRaw, coloursRaw, customersRaw, invItemsRaw, invReceiptsRaw, invConsumptionRaw] = await Promise.all([
      sbGet('orders', '?order=order_id.asc&limit=10000'),
      sbGet('categories', '?order=id.asc'),
      sbGet('options', '?order=sort_order.asc,id.asc'),
      sbGet('colours', '?order=id.asc'),
      sbGet('customers', '?order=name.asc'),
      sbGet('inventory_items', '?order=name.asc'),
      sbGet('inventory_receipts', '?order=date.asc'),
      sbGet('inventory_consumption', '?order=date.asc')
    ]);
    orders    = ordersRaw.map(normalise);
    cats      = catsRaw.map(normaliseCat);
    opts      = optsRaw.map(normaliseOpt);
    colours   = coloursRaw.map(normaliseColour);
    customers = customersRaw.map(normaliseCustomer);
    inventoryItems       = invItemsRaw.map(normaliseInventoryItem);
    inventoryReceipts    = invReceiptsRaw.map(normaliseInventoryReceipt);
    inventoryConsumption = invConsumptionRaw.map(normaliseInventoryConsumption);
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
    customer_id: String(o.customer_id                  ||''),
    printed:  o.printed===true||String(o.printed).toLowerCase()==='true',
    paid:     o.paid===true||String(o.paid).toLowerCase()==='true',
    inv_consumed: o.inv_consumed===true||String(o.inv_consumed).toLowerCase()==='true'
  };
}

function normaliseCustomer(c){
  return{
    id:       String(c.id||''),
    name:     String(c.name||''),
    email:    String(c.email||''),
    phone:    String(c.phone||''),
    address:  String(c.address||''),
    notes:    String(c.notes||''),
    archived: Boolean(c.archived||false)
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
    sortable:    Boolean(o.sortable||false),
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
function normaliseInventoryItem(i){
  return{
    id:       String(i.id||''),
    name:     String(i.name||''),
    notes:    String(i.notes||''),
    archived: Boolean(i.archived||false)
  };
}
function normaliseInventoryReceipt(r){
  return{
    id:     String(r.id||''),
    itemId: String(r.item_id||r.itemId||''),
    qty:    Number(r.qty||0),
    cost:   Number(r.cost||0),
    date:   String(r.date||'')
  };
}
function normaliseInventoryConsumption(c){
  return{
    id:      String(c.id||''),
    itemId:  String(c.item_id||c.itemId||''),
    orderId: String(c.order_id||c.orderId||''),
    qty:     Number(c.qty||0),
    date:    String(c.date||'')
  };
}
