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
      if(p.sort_key)       { sortKey=p.sort_key; sortDir=p.sort_dir||1; }
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

function sbUrl(table, query){
  return getCfg('SUPABASE_URL') + '/rest/v1/' + table + (query||'');
}

// ── State ──────────────────────────────────────────────────
let GAS_URL = ''; // kept for legacy refs, not used
let orders    = [];
let cats      = [];   // [{id,name,price}]
let opts      = [];   // [{id,catId,name,display,options}]
let colours   = [];   // [{id,name,code,available}]
let editOId   = null;
let sortKey   = 'orderId';
let sortDir   = -1;
let mCounter  = 0;
let acInst    = null;
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
function nextRowId(){
  // Legacy numeric IDs — kept for reference only, not used for new rows
  const nums=orders.map(o=>o.id).filter(id=>/^\d+$/.test(String(id))).map(id=>parseInt(id));
  return padN((nums.length?Math.max(...nums):0)+1,10);
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
function nextColourId(){
  const nums=colours.map(c=>c.id).filter(id=>/^COL\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(3)));
  return 'COL'+padN((nums.length?Math.max(...nums):0)+1,4);
}
function nextOptId(){
  const nums=opts.map(o=>o.id).filter(id=>/^O\d+$/.test(String(id))).map(id=>parseInt(String(id).slice(1)));
  return 'O'+padN((nums.length?Math.max(...nums):0)+1,4);
}

// ── Supabase API ──────────────────────────────────────────
async function sbGet(table, query){
  const res = await fetch(sbUrl(table, query), { headers: SB_HEADERS() });
  if(!res.ok) throw new Error('GET '+table+' failed: '+res.status);
  return res.json();
}

async function sbUpsert(table, row){
  const res = await fetch(sbUrl(table), {
    method: 'POST',
    headers: { ...SB_HEADERS(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
  if(!res.ok){ const t=await res.text(); throw new Error('Upsert failed: '+t.slice(0,200)); }
  return res.json();
}

async function sbDelete(table, filter){
  const res = await fetch(sbUrl(table, '?'+filter), {
    method: 'DELETE',
    headers: SB_HEADERS()
  });
  if(!res.ok) throw new Error('DELETE '+table+' failed: '+res.status);
  return true;
}

async function sbReplace(table, rows){
  // Delete all then insert fresh — used for cats/options/colours
  await fetch(sbUrl(table, '?id=neq.NONE'), {
    method: 'DELETE', headers: SB_HEADERS()
  });
  if(!rows.length) return;
  const res = await fetch(sbUrl(table), {
    method: 'POST',
    headers: { ...SB_HEADERS(), 'Prefer': 'return=representation' },
    body: JSON.stringify(rows)
  });
  if(!res.ok){ const t=await res.text(); throw new Error('Insert failed: '+t.slice(0,200)); }
  return res.json();
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
    const [ordersRaw, catsRaw, optsRaw, coloursRaw] = await Promise.all([
      sbGet('orders', '?order=order_id.asc'),
      sbGet('categories', '?order=id.asc'),
      sbGet('options', '?order=sort_order.asc,id.asc'),
      sbGet('colours', '?order=id.asc')
    ]);
    orders  = ordersRaw.map(normalise);
    cats    = catsRaw.map(normaliseCat);
    opts    = optsRaw.map(normaliseOpt);
    colours = coloursRaw.map(normaliseColour);
    if(!cats.length) cats = defaultCats();
    populateCatFilter();
    renderTable();
    setStatus('ok','Connected · '+uniqueOrderCount()+' orders');
    await loadPreferences();
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
    date:     toDisplay(String(o.date              ||'')),
    notes:    String(o.notes                       ||''),
    options:  String(o.options                     ||'')
  };
}

function defaultCats(){
  return[
    {id:'C0001',name:'Miniatures',price:12},
    {id:'C0002',name:'Functional Parts',price:18},
    {id:'C0003',name:'Cosplay Props',price:35},
    {id:'C0004',name:'Decorative',price:15},
    {id:'C0005',name:'Custom',price:25}
  ];
}


function normaliseCat(c){
  return{id:String(c.id||''),name:String(c.name||''),price:Number(c.price||0)};
}
function normaliseOpt(o){
  return{
    id:         String(o.id||''),
    catId:      String(o.cat_id||o.catId||''),
    name:       String(o.name||''),
    display:    String(o.display||'text'),
    options:    String(o.options||''),
    sort_order: Number(o.sort_order||0)
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

// ── Previously made check ─────────────────────────────────
// A signature is catId + normalised options string
// An order row counts as "made" if ANY order row with the same
// catId + options has status === 'Complete'
function buildMadeSet(){
  const made = new Set();
  orders.forEach(o=>{
    if(o.status==='Complete' && o.catId){
      made.add(o.catId + '|' + normaliseOpts(o.options));
    }
  });
  return made;
}

function normaliseOpts(opts){
  // Sort pipe-separated key:value pairs so order doesn't matter
  // Lowercase everything for case-insensitive matching
  if(!opts)return'';
  return opts.split('|').map(s=>s.trim().toLowerCase()).filter(Boolean).sort().join('|');
}

function wasPreviouslyMade(o, madeSet){
  // Show tick on ANY row whose catId + options matches a Complete row
  // including the completed row itself
  const sig = o.catId + '|' + normaliseOpts(o.options);
  return madeSet.has(sig);
}

// ── Render table ───────────────────────────────────────────

function updateStats(){
  // ── Box 1: Total items by category ──────────────────────
  document.getElementById('s-total').textContent = orders.length;
  const catCounts={};
  orders.forEach(o=>{
    const cat=cats.find(c=>String(c.id)===String(o.catId));
    const name=cat?cat.name:'Unknown';
    catCounts[name]=(catCounts[name]||0)+1;
  });
  document.getElementById('s-cat-breakdown').innerHTML =
    Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>
      `<div class="stat-break-row"><span class="stat-break-label">${esc(name)}</span><span class="stat-break-val">${count}</span></div>`
    ).join('');

  // ── Box 2: Pending / Printing ────────────────────────────
  document.getElementById('s-pending').textContent  = orders.filter(o=>o.status==='Pending').length;
  document.getElementById('s-printing').textContent = orders.filter(o=>o.status==='Printing').length;

  // ── Box 3: Completed + Name Badge breakdown ──────────────
  const completed=orders.filter(o=>o.status==='Complete');
  document.getElementById('s-completed').textContent = completed.length;
  // Find Name Badge category
  const badgeCat=cats.find(c=>c.name.toLowerCase().includes('name badge'));
  if(badgeCat){
    const badgeOrders=completed.filter(o=>String(o.catId)===String(badgeCat.id));
    const pinCount=badgeOrders.filter(o=>o.options&&o.options.toLowerCase().includes('pin')).length;
    const magCount=badgeOrders.filter(o=>o.options&&o.options.toLowerCase().includes('magnet')).length;
    document.getElementById('s-badge-breakdown').innerHTML =
      `<div class="stat-break-row"><span class="stat-break-label">Pin</span><span class="stat-break-val">${pinCount}</span></div>`+
      `<div class="stat-break-row"><span class="stat-break-label">Magnet</span><span class="stat-break-val">${magCount}</span></div>`;
  } else {
    document.getElementById('s-badge-breakdown').innerHTML='';
  }

  // ── Box 4: Payment breakdown ─────────────────────────────
  // Use unique orderIds for per-order payment (payment is per order not per item)
  const seenOrders={};
  completed.forEach(o=>{
    if(!seenOrders[o.orderId]){
      const pay=(o.payment&&o.payment.trim())?o.payment.trim():'No';
      seenOrders[o.orderId]={payment:pay,total:0};
    }
    seenOrders[o.orderId].total+=o.total;
  });
  const payBreakdown={No:0,Free:0,Simon:0,Wade:0};
  const payRevenue={Simon:0,Wade:0};
  Object.values(seenOrders).forEach(({payment,total})=>{
    const p=payment||'No';
    if(p==='No') payBreakdown.No++;
    else if(p==='Free') payBreakdown.Free++;
    else if(p==='Simon'){payBreakdown.Simon++;payRevenue.Simon+=total;}
    else if(p==='Wade'){payBreakdown.Wade++;payRevenue.Wade+=total;}
  });
  document.getElementById('s-payment-breakdown').innerHTML =
    `<div class="stat-break-row"><span class="stat-break-label">No</span><span class="stat-break-val">${payBreakdown.No}</span></div>`+
    `<div class="stat-break-row"><span class="stat-break-label">Free</span><span class="stat-break-val">${payBreakdown.Free}</span></div>`+
    `<div class="stat-break-row"><span class="stat-break-label">Simon</span><span class="stat-break-val">$${payRevenue.Simon.toFixed(2)}</span></div>`+
    `<div class="stat-break-row"><span class="stat-break-label">Wade</span><span class="stat-break-val">$${payRevenue.Wade.toFixed(2)}</span></div>`;
}

function uniqueOrderCount(){return new Set(orders.map(o=>o.orderId)).size;}

function orderNumFromId(orderId) {
  // Strip O prefix and leading zeros: O0000000007 → #7, O0000000042 → #42
  // Falls back to showing the raw id if format doesn't match
  const m = String(orderId).match(/^O?0*(\d+)$/);
  return m ? '#' + m[1] : '#' + orderId;
}

function renderTable(){
  const q =document.getElementById('search').value.toLowerCase();
  const fs=document.getElementById('filterStatus').value;
  const fc=document.getElementById('filterCat').value;
  const hc=document.getElementById('hideCompleted').checked;
  const madeSet=buildMadeSet();

  let list=orders.filter(o=>{
    if(hc&&(o.status==='Complete'||o.status==='Cancelled'))return false;
    if(fs&&o.status!==fs)return false;
    if(fc&&o.catId!==fc)return false;
    if(q&&!([o.customer,o.model,o.notes,o.address].join(' ').toLowerCase().includes(q)))return false;
    return true;
  });

  list.sort((a,b)=>{
    if(sortKey==='orderId'||!sortKey){
      // Sort by order number numerically then item index within order
      const aNum=parseInt(String(a.orderId).replace(/^O0*/,''))||0;
      const bNum=parseInt(String(b.orderId).replace(/^O0*/,''))||0;
      if(aNum!==bNum) return (aNum-bNum)*sortDir;
      const aItem=parseInt(String(a.id).split('-').pop())||0;
      const bItem=parseInt(String(b.id).split('-').pop())||0;
      return aItem-bItem;
    }
    // Sort by chosen column
    let av=a[sortKey]||'', bv=b[sortKey]||'';
    if(['qty','total','price'].includes(sortKey)){av=+av;bv=+bv;}
    if(av<bv) return -sortDir;
    if(av>bv) return sortDir;
    // Tiebreak: keep order groups together
    const aNum=parseInt(String(a.orderId).replace(/^O0*/,''))||0;
    const bNum=parseInt(String(b.orderId).replace(/^O0*/,''))||0;
    return aNum-bNum;
  });

  updateStats();

  const tbody=document.getElementById('tbody');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="11" data-label=""><div class="empty"><i class="ti ti-inbox"></i>No orders yet.</div></td></tr>`;return;}

  const seen=new Set();

  tbody.innerHTML=list.map(o=>{
    const isFirst=!seen.has(o.orderId);seen.add(o.orderId);
    const cat=cats.find(c=>String(c.id)===String(o.catId));
    const bc='b-'+(o.status||'pending').toLowerCase();
    const addrShort=o.address?o.address.split(',').slice(0,2).join(','):'—';
    const orderNum=orderNumFromId(o.orderId);
    const hasNote=!!o.notes.trim();
    const prevMade=wasPreviouslyMade(o, madeSet);
    const catHtml=cat
      ?`<span class="cat-path">${esc(cat.name)}</span>${prevMade?'<span class="made-tick" title="Model previously made"><i class="ti ti-circle-check-filled"></i></span>':''}`
      :'—';
    const noteHtml=`<button class="note-btn ${hasNote?'has-note':'no-note'}" onclick="showNote(${JSON.stringify(esc(o.model))},${JSON.stringify(esc(o.notes))})" title="${hasNote?'View note':'No note'}"><i class="ti ti-notes"></i></button>`;
    const deliveryIcon=isFirst?(o.delivery==='Pick Up'
      ?'<i class="ti ti-hand-stop" title="Pick Up" style="font-size:13px;color:var(--muted);margin-right:5px;flex-shrink:0"></i>'
      :'<i class="ti ti-mail" title="Post" style="font-size:13px;color:var(--muted);margin-right:5px;flex-shrink:0"></i>'):'';
    // Render options in sort_order — iterate through opts for this category
    const parsedOpts={};
    if(o.options){o.options.split('||').forEach(p=>{const idx=p.indexOf(':');if(idx>=0)parsedOpts[p.slice(0,idx).trim()]=p.slice(idx+1).trim();});}
    const catOpts=opts.filter(opt=>String(opt.catId)===String(o.catId));
    const optLines=catOpts.map(opt=>{
      const val=parsedOpts[opt.name];
      if(!val) return null;
      const isColOpt=opt.name.toLowerCase().includes('colour')||opt.name.toLowerCase().includes('color');
      if(isColOpt){
        // Show swatches for each colour name
        const names=val.split('|').map(s=>s.trim()).filter(Boolean);
        const swatches=names.map(name=>{
          const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());
          const code=c?c.code:'#cccccc';
          return`<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${esc(code)};border:1px solid rgba(255,255,255,0.15);margin-right:2px;cursor:default;flex-shrink:0" title="${esc(name)}"></span>`;
        }).join('');
        return`<span style="color:var(--muted)">${esc(opt.name)}:</span> <span style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:1px">${swatches}</span>`;
      }
      return`<span style="color:var(--muted)">${esc(opt.name)}:</span> ${esc(val)}`;
    }).filter(Boolean);
    const optHtml=optLines.length
      ?optLines.map(l=>`<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px">${l}</div>`).join('')
      :'';
    return`<tr class="${isFirst?'group-first':''}">
      <td class="card-order-num" style="padding:7px 8px">${isFirst?`<span class="order-id-badge">${orderNum}</span>`:''}</td>
      <td data-label="Customer" style="padding:7px 8px" title="${esc(o.customer)}">${isFirst?esc(o.customer)||'—':''}</td>
      <td data-label="Address" style="padding:7px 8px;white-space:normal;word-break:break-word;font-size:11px;color:var(--muted)">${isFirst?`<span style="display:flex;align-items:flex-start;gap:4px">${deliveryIcon}<span title="${esc(o.address)}">${esc(o.address)||'—'}</span></span>`:''}
      </td>
      <td data-label="Category" style="padding:7px 8px">${catHtml}</td>
      <td data-label="Options" style="padding:7px 8px;font-size:11px;overflow:visible;white-space:normal;line-height:1.6">${optHtml}</td>
      <td data-label="Qty" class="mono" style="padding:7px 8px">${o.qty}</td>
      <td data-label="Total" class="mono" style="padding:7px 8px">$${o.total.toFixed(2)}</td>
      <td data-label="Status" style="padding:7px 6px;text-align:center"><select class="status-select b-${(o.status||'pending').toLowerCase()}" data-prev="${o.status||'Pending'}" onchange="updateStatus('${o.orderId}','${o.id}',this.value,this)" onclick="event.stopPropagation()">
        <option${o.status==='Pending'?' selected':''}>Pending</option>
        <option${o.status==='Printing'?' selected':''}>Printing</option>
        <option${o.status==='Complete'?' selected':''}>Complete</option>
        <option${o.status==='Cancelled'?' selected':''}>Cancelled</option>
      </select></td>
      <td data-label="$" style="padding:7px 6px;text-align:center">${isFirst?`<span class="pay-${(o.payment||'N')[0].toUpperCase()}">${(o.payment||'No')[0].toUpperCase()}</span>`:''}</td>
      <td data-label="Note" style="padding:7px 6px">${noteHtml}</td>
      <td class="card-actions" style="display:flex;gap:3px;padding:5px 6px;justify-content:flex-end">
        ${isFirst?`<button class="icon-btn" onclick="openEdit('${esc(o.orderId)}')" title="Edit"><i class="ti ti-edit"></i></button>
        <button class="icon-btn del" onclick="deleteOrder('${esc(o.orderId)}')" title="Delete"><i class="ti ti-trash"></i></button>`:''}
      </td>
    </tr>`;
  }).join('');
}

function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sortBy(k){
  if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=-1;}
  savePreferences();
  // Update header classes and arrows
  document.querySelectorAll('thead th').forEach(t=>t.classList.remove('sort-active'));
  document.querySelectorAll('.sort-arrow').forEach(a=>{a.textContent='';});
  const th=document.querySelector(`th[data-key="${k}"]`);
  if(th){
    th.classList.add('sort-active');
    const arrow=th.querySelector('.sort-arrow');
    if(arrow)arrow.textContent=sortDir===1?' ↑':' ↓';
  }
  renderTable();
}
function showNote(m,n){document.getElementById('noteModalTitle').textContent=m?'Note — '+m:'Note';document.getElementById('noteModalBody').textContent=n||'(No note recorded)';document.getElementById('noteModal').classList.add('open');}
function closeNoteModal(){document.getElementById('noteModal').classList.remove('open');}

// ── Address autocomplete ───────────────────────────────────
function initAutocomplete(){
  const input=document.getElementById('f-address');
  if(acInst)return;
  acInst=new google.maps.places.Autocomplete(input,{types:['address']});
  acInst.addListener('place_changed',()=>{
    const place=acInst.getPlace();
    if(place&&place.formatted_address){
      input.value=place.formatted_address;
      input.classList.add('validated');
      document.getElementById('addrTick').style.display='';
    }
  });
}

// ── Model rows ─────────────────────────────────────────────
function catOptions(selId){
  let html='<option value="">— select —</option>';
  cats.forEach(c=>{html+=`<option value="${c.id}" ${String(c.id)===String(selId)?'selected':''}>${esc(c.name)}</option>`;});
  return html;
}

// Get options for a given catId
function getCatOpts(catId){return opts.filter(o=>String(o.catId)===String(catId));}

// Render option fields for a model row
function renderModelOpts(idx, catId, savedOpts){
  const catOpts=getCatOpts(catId);
  const container=document.getElementById('mo-'+idx);
  if(!container)return;
  if(!catOpts.length){container.innerHTML='';return;}
  // Parse saved options: "FieldName:value||FieldName:value" (double pipe separates fields)
  const saved={};
  if(savedOpts){savedOpts.split('||').forEach(p=>{const[k,...v]=p.split(':');if(k)saved[k.trim()]=v.join(':').trim();});}
  container.innerHTML=catOpts.map(opt=>{
    const val=saved[opt.name]||'';
    if(opt.display==='text'){
      return`<div class="opt-row"><label>${esc(opt.name)}</label><input type="text" id="ov-${idx}-${opt.id}" value="${esc(val)}" placeholder="Enter ${esc(opt.name).toLowerCase()}…" oninput="collectOpts(${idx})"></div>`;
    } else {
      // dropdown
      const items=opt.options.split(',').map(s=>s.trim()).filter(Boolean);
      const isCustom=val==='Custom'||(!items.includes(val)&&val!=='');
      const ddVal=isCustom?'Custom':(val||'');
      const customVal=isCustom?val:'';
      const opts_html=items.map(it=>`<option${ddVal===it?' selected':''}>${esc(it)}</option>`).join('');
      const isColourOpt=opt.name.toLowerCase().includes('colour')||opt.name.toLowerCase().includes('color');
      if(isColourOpt){
        const savedCombos=getSavedColourCombos();
        // Use a native <select> — reliable, no overflow issues
        // Custom first, then saved combos as optgroup
        const comboOptions=savedCombos.map(combo=>{
          const label=combo.layers.map(l=>l.name).join(' / ');
          const key=combo.key;
          return `<option value="${esc(key)}" ${ddVal===key?'selected':''}>${esc(label)}</option>`;
        }).join('');
        const selectHtml=`<select id="ov-${idx}-${opt.id}" onchange="colourOptChanged(${idx},'${opt.id}',this.value)">
          <option value="">— select —</option>
          <option value="Custom" ${ddVal==='Custom'?'selected':''}>✦ Custom (choose 4 colours)</option>
          ${savedCombos.length?`<optgroup label="── Saved combinations ──">${comboOptions}</optgroup>`:''}
        </select>`;
        const rowHtml=`<div class="opt-row"><label>${esc(opt.name)}</label>${selectHtml}</div>`+
          `<div class="opt-custom" id="ovc-${idx}-${opt.id}" data-iscolour="1" style="${ddVal==='Custom'?'':'display:none'}"></div>`;
        if(ddVal==='Custom') setTimeout(()=>renderLayerSelectors(idx,opt.id,customVal),0);
        else if(ddVal&&ddVal!=='Custom') setTimeout(()=>applyComboToLayers(idx,opt.id,ddVal),0);
        return rowHtml;
      }
      const customContent=`<input type="text" id="ovt-${idx}-${opt.id}" value="${esc(customVal)}" placeholder="Describe your custom option…" oninput="collectOpts(${idx})">`;
      const rowHtml=`<div class="opt-row"><label>${esc(opt.name)}</label><select id="ov-${idx}-${opt.id}" onchange="ddChanged(${idx},'${opt.id}')"><option value="">— select —</option>${opts_html}</select></div>`+
        `<div class="opt-custom" id="ovc-${idx}-${opt.id}" data-iscolour="0" style="${ddVal==='Custom'?'':'display:none'}">${customContent}</div>`;
      return rowHtml;
    }
  }).join('');
}

function colourOptChanged(idx, optId, value){
  const container=document.getElementById('ovc-'+idx+'-'+optId);
  if(!container) return;
  if(value==='Custom'){
    container.style.display='';
    renderLayerSelectors(idx, optId, '');
  } else if(value){
    container.style.display='none';
    applyComboToLayers(idx, optId, value);
  } else {
    container.style.display='none';
  }
  collectOpts(idx);
}

function ddChanged(idx,optId){
  const sel=document.getElementById('ov-'+idx+'-'+optId);
  const custom=document.getElementById('ovc-'+idx+'-'+optId);
  if(sel&&custom){
    const isCustom=sel.value==='Custom';
    custom.style.display=isCustom?'':'none';
    if(!isCustom){const t=document.getElementById('ovt-'+idx+'-'+optId);if(t)t.value='';}
    if(isCustom && document.getElementById('ovc-'+idx+'-'+optId).dataset.iscolour==='1'){
      renderLayerSelectors(idx, optId, '');
    }
  }
  collectOpts(idx);
}

function availableColours(){
  // Only show colours marked as available
  return colours.filter(c=>c.available===true||String(c.available).toLowerCase()==='true'||c.available==='TRUE');
}

function buildColourPicker(id, selectedName, onChangeFn){
  const avail = availableColours();
  const sel   = avail.find(c=>c.name===selectedName);
  const swatchBg = sel ? sel.code : 'transparent';
  const label    = sel ? sel.name : '— none —';
  return `<div class="colour-picker-wrap" id="cpw-${id}">
    <div class="colour-picker-btn" onclick="toggleColourPicker('${id}')" id="cpb-${id}">
      <div class="cp-swatch" style="background:${swatchBg}"></div>
      <span class="cp-label">${esc(label)}</span>
      <i class="ti ti-chevron-down cp-arrow"></i>
    </div>
    <div class="colour-picker-list" id="cpl-${id}" style="display:none">
      <div class="cp-none" onclick="selectColour('${id}','',${onChangeFn})" >— none —</div>
      ${avail.map(c=>`
        <div class="cp-option ${c.name===selectedName?'selected':''}" onclick="selectColour('${id}','${esc(c.name)}',${onChangeFn})">
          <div class="cp-swatch" style="background:${esc(c.code)}"></div>
          <span>${esc(c.name)}</span>
        </div>`).join('')}
    </div>
  </div>`;
}

function toggleColourPicker(id){
  // Close all other open pickers first
  document.querySelectorAll('.colour-picker-list').forEach(el=>{
    if(el.id!=='cpl-'+id && el.id!=='cpl2-'+id) el.style.display='none';
  });
  // Try both ID patterns
  const list=document.getElementById('cpl-'+id)||document.getElementById('cpl2-'+id);
  if(list) list.style.display=list.style.display==='none'?'':'none';
}

function selectColour(id, name, onChangeFn){
  const avail=availableColours();
  const c=avail.find(c=>c.name===name);
  const btn=document.getElementById('cpb-'+id);
  if(btn){
    btn.querySelector('.cp-swatch').style.background=c?c.code:'transparent';
    btn.querySelector('.cp-label').textContent=c?c.name:'— none —';
  }
  // Mark selected
  const list=document.getElementById('cpl-'+id);
  if(list){
    list.querySelectorAll('.cp-option').forEach(el=>el.classList.toggle('selected',el.querySelector('span').textContent===name));
    list.style.display='none';
  }
  // Store value and trigger callback
  const wrap=document.getElementById('cpw-'+id);
  if(wrap) wrap.dataset.value=name;
  if(typeof onChangeFn==='function') onChangeFn(name);
}

function getColourPickerValue(id){
  const wrap=document.getElementById('cpw-'+id);
  return wrap?wrap.dataset.value||'':'';
}

function renderLayerSelectors(idx, optId, savedVal){
  const container=document.getElementById('ovc-'+idx+'-'+optId);
  if(!container)return;
  // savedVal can be:
  // "Layer 1:Red|Layer 2:Blue|..." (legacy layer format)
  // "Red|Yellow|Black|Jade White" (simple pipe format)
  const saved={};
  if(savedVal){
    if(savedVal.includes('Layer ')){
      // Legacy format
      savedVal.split('|').forEach(p=>{const[k,...v]=p.split(':');if(k)saved[k.trim()]=v.join(':').trim();});
    } else {
      // Simple format — assign to layers in order
      savedVal.split('|').forEach((name,i)=>{if(name.trim())saved['Layer '+(i+1)]=name.trim();});
    }
  }
  container.innerHTML=`<div class="layer-selectors">
    ${[1,2,3,4].map(n=>{
      const pickerId=`lp-${idx}-${optId}-${n}`;
      const savedName=saved['Layer '+n]||'';
      const onChangeFn=`function(v){collectOpts(${idx});}`;
      return`<div class="layer-sel-row">
        <label>Layer ${n}</label>
        ${buildColourPicker(pickerId, savedName, onChangeFn)}
      </div>`;
    }).join('')}
  </div>`;
}

function getColourCode(name){
  if(!name)return'transparent';
  const c=colours.find(c=>c.name===name);
  return c?c.code:'transparent';
}

function layerChanged(idx,optId,layerNum,val){
  collectOpts(idx);
}

// Collect all option values for a model row into a pipe-separated string
function collectOpts(idx){
  const catId=document.getElementById('mc-'+idx)?.value||'';
  const catOpts=getCatOpts(catId);
  const parts=catOpts.map(opt=>{
    const isColOpt=opt.name.toLowerCase().includes('colour')||opt.name.toLowerCase().includes('color');
    const el=document.getElementById('ov-'+idx+'-'+opt.id);
    if(!el) return '';
    let val=el.value;

    if(isColOpt){
      // For colour opts: read from the native select
      if(val==='Custom'){
        // Collect layer values as simple pipe-separated colour names
        const container=document.getElementById('ovc-'+idx+'-'+opt.id);
        if(container&&container.dataset.iscolour==='1'){
          const layers=[1,2,3,4].map(n=>{
            return getColourPickerValue('lp-'+idx+'-'+opt.id+'-'+n)||'';
          });
          val=layers.filter(Boolean).join('|');
        }
      }
      // If val is a saved combo key (pipe-separated names) store as-is
    } else if(val==='Custom'){
      // Non-colour custom text field
      const t=document.getElementById('ovt-'+idx+'-'+opt.id);
      val=t?t.value:'';
    }

    return val?`${opt.name}:${val}`:'';
  }).filter(Boolean);
  const hidden=document.getElementById('opts-'+idx);
  if(hidden)hidden.value=parts.join('||');
}

function addModelRow(d){
  d=d||{};const idx=mCounter++;
  const el=document.createElement('div');
  el.className='model-row';el.dataset.idx=idx;
  el.innerHTML=`
    <div class="model-row-top">
      <div class="mf"><label>Category</label><select id="mc-${idx}" onchange="catChanged(${idx})">${catOptions(d.catId)}</select></div>
      <div class="mf"><label>Qty</label><input type="number" id="mq-${idx}" value="${d.qty||1}" min="1" oninput="calcTotal()"></div>
      <div class="mf"><label>Price ($)</label><input type="number" id="mp-${idx}" value="${d.price||''}" step="0.01" min="0" placeholder="0.00" oninput="calcTotal()"></div>
      <button class="rm-btn" onclick="removeModel(this)" title="Remove item"><i class="ti ti-x"></i></button>
    </div>
    <div class="model-options" id="mo-${idx}"></div>
    <div class="model-notes"><input type="text" id="mn-${idx}" value="${esc(d.notes||'')}" placeholder="Item notes (colour, material, special requests…)"></div>
    <input type="hidden" id="mm-${idx}" value="${esc(d.model||'')}">
    <input type="hidden" id="opts-${idx}" value="${esc(d.options||'')}">`;
  document.getElementById('modelRows').appendChild(el);
  if(d.catId)renderModelOpts(idx,d.catId,d.options||'');
  calcTotal();
}

function catChanged(idx){
  const catId=document.getElementById('mc-'+idx).value;
  const cat=cats.find(c=>String(c.id)===catId);
  if(cat){
    if(cat.price)document.getElementById('mp-'+idx).value=cat.price;
    // Store category name as model name
    const mm=document.getElementById('mm-'+idx);
    if(mm)mm.value=cat.name;
    calcTotal();
  }
  document.getElementById('opts-'+idx).value='';
  renderModelOpts(idx,catId,'');
}

function calcTotal(){
  let t=0;
  document.querySelectorAll('.model-row').forEach(r=>{
    const i=r.dataset.idx;
    t+=(parseFloat(document.getElementById('mq-'+i)?.value)||0)*(parseFloat(document.getElementById('mp-'+i)?.value)||0);
  });
  document.getElementById('orderTotal').textContent='$'+t.toFixed(2);
}
function removeModel(btn){
  if(document.querySelectorAll('.model-row').length<=1){alert('Need at least one item.');return;}
  btn.closest('.model-row').remove();calcTotal();
}
function getModelData(){
  return Array.from(document.querySelectorAll('.model-row')).map(r=>{
    const i=r.dataset.idx;
    // Collect opts before reading
    collectOpts(i);
    return{
      model:   document.getElementById('mm-'+i)?.value.trim()||'',
      catId:   document.getElementById('mc-'+i)?.value||'',
      qty:     parseInt(document.getElementById('mq-'+i)?.value)||1,
      price:   parseFloat(document.getElementById('mp-'+i)?.value)||0,
      notes:   document.getElementById('mn-'+i)?.value.trim()||'',
      options: document.getElementById('opts-'+i)?.value||''
    };
  });
}

// ── Order modals ───────────────────────────────────────────
function openAddModal(){
  editOId=null;acInst=null;
  document.getElementById('modalTitle').textContent='New Order';
  document.getElementById('f-customer').value='';
  document.getElementById('f-address').value='';
  document.getElementById('f-address').classList.remove('validated');
  document.getElementById('addrTick').style.display='none';
  document.getElementById('f-delivery').value='Post';
  document.getElementById('f-payment').value='No';
  const today=todayDMY();
  document.getElementById('f-date').value=today;
  document.getElementById('f-date-display').textContent=today;
  document.getElementById('modelRows').innerHTML='';mCounter=0;addModelRow();
  document.getElementById('orderModal').classList.add('open');
  setTimeout(()=>{document.getElementById('f-customer').focus();initAutocomplete();},80);
}

function openEdit(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);if(!rows.length)return;
  editOId=orderId;acInst=null;const first=rows[0];
  document.getElementById('modalTitle').textContent='Edit Order';
  document.getElementById('f-customer').value=first.customer;
  document.getElementById('f-address').value=first.address||'';
  if(first.address){document.getElementById('f-address').classList.add('validated');document.getElementById('addrTick').style.display='';}
  else{document.getElementById('f-address').classList.remove('validated');document.getElementById('addrTick').style.display='none';}
  document.getElementById('f-delivery').value=first.delivery||'Post';
  document.getElementById('f-payment').value=first.payment||'No';
  const d=toDisplay(first.date);
  document.getElementById('f-date').value=d;
  document.getElementById('f-date-display').textContent=d;
  document.getElementById('modelRows').innerHTML='';mCounter=0;
  rows.forEach(r=>addModelRow({model:r.model,catId:r.catId,qty:r.qty,price:r.price,notes:r.notes,options:r.options}));
  document.getElementById('orderModal').classList.add('open');
  setTimeout(()=>initAutocomplete(),80);
}

function closeModal(){
  document.getElementById('orderModal').classList.remove('open');
  // Clear validation state
  document.querySelectorAll('.field-error').forEach(el=>el.classList.remove('field-error'));
  document.querySelectorAll('.field-error-msg').forEach(el=>el.remove());
  document.querySelectorAll('.model-row.row-error').forEach(el=>el.classList.remove('row-error'));
  document.querySelectorAll('.opt-row.opt-error').forEach(el=>el.classList.remove('opt-error'));
  document.querySelectorAll('.colour-picker-wrap.cp-error').forEach(el=>el.classList.remove('cp-error'));
}

function validateOrder(){
  const errors=[];
  // Clear previous error states
  document.querySelectorAll('.field-error').forEach(el=>el.classList.remove('field-error'));
  document.querySelectorAll('.field-error-msg').forEach(el=>el.remove());
  document.querySelectorAll('.model-row.row-error').forEach(el=>el.classList.remove('row-error'));
  document.querySelectorAll('.opt-row.opt-error').forEach(el=>el.classList.remove('opt-error'));
  document.querySelectorAll('.colour-picker-wrap.cp-error').forEach(el=>el.classList.remove('cp-error'));

  // Customer name
  const customer=document.getElementById('f-customer').value.trim();
  if(!customer){
    const f=document.getElementById('f-customer').closest('.field');
    f.classList.add('field-error');
    const msg=document.createElement('div');msg.className='field-error-msg';
    msg.innerHTML='<i class="ti ti-alert-circle"></i> Required';
    f.appendChild(msg);errors.push('customer');
  }

  // Address
  const address=document.getElementById('f-address').value.trim();
  if(!address){
    const f=document.getElementById('f-address').closest('.field');
    f.classList.add('field-error');
    const msg=document.createElement('div');msg.className='field-error-msg';
    msg.innerHTML='<i class="ti ti-alert-circle"></i> Required';
    f.appendChild(msg);errors.push('address');
  }

  // Items
  const itemRows=document.querySelectorAll('.model-row');
  if(!itemRows.length){errors.push('no-items');return errors;}

  itemRows.forEach(row=>{
    const idx=row.dataset.idx;
    let rowHasError=false;

    // Category required
    const catSel=document.getElementById('mc-'+idx);
    if(!catSel||!catSel.value){
      catSel&&catSel.closest('.mf')&&catSel.closest('.mf').classList.add('field-error');
      rowHasError=true;errors.push('cat-'+idx);
    }

    // Qty > 0
    const qtyEl=document.getElementById('mq-'+idx);
    const qty=parseInt(qtyEl?.value)||0;
    if(qty<=0){
      qtyEl&&qtyEl.closest('.mf')&&qtyEl.closest('.mf').classList.add('field-error');
      rowHasError=true;errors.push('qty-'+idx);
    }

    // Options — validate each option for this category
    const catId=catSel?catSel.value:'';
    const catOpts=getCatOpts(catId);
    catOpts.forEach(opt=>{
      const el=document.getElementById('ov-'+idx+'-'+opt.id);
      if(!el)return;
      const val=el.value;
      if(!val){
        // Required: option not selected
        const optRow=el.closest('.opt-row');
        if(optRow)optRow.classList.add('opt-error');
        rowHasError=true;errors.push('opt-'+idx+'-'+opt.id);
        return;
      }
      if(val==='Custom'){
        const container=document.getElementById('ovc-'+idx+'-'+opt.id);
        if(container&&container.dataset.iscolour==='1'){
          // Custom colour — all 4 layers must be selected
          [1,2,3,4].forEach(n=>{
            const pickerId='lp-'+idx+'-'+opt.id+'-'+n;
            const layerVal=getColourPickerValue(pickerId);
            if(!layerVal){
              const wrap=document.getElementById('cpw-'+pickerId);
              if(wrap)wrap.classList.add('cp-error');
              rowHasError=true;errors.push('layer-'+idx+'-'+opt.id+'-'+n);
            }
          });
        } else {
          // Custom text — must have content
          const t=document.getElementById('ovt-'+idx+'-'+opt.id);
          if(!t||!t.value.trim()){
            if(t)t.style.borderColor='var(--red)';
            rowHasError=true;errors.push('opt-custom-'+idx+'-'+opt.id);
          }
        }
      }
    });

    if(rowHasError)row.classList.add('row-error');
  });

  return errors;
}

async function saveOrder(){
  const errors=validateOrder();
  if(errors.length){
    // Scroll to first error
    const firstErr=document.querySelector('.field-error,.row-error');
    if(firstErr)firstErr.scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  if(busy)return;
  const customer=document.getElementById('f-customer').value.trim();
  const models=getModelData();
  const orderId=editOId||nextOrderId();
  const date=document.getElementById('f-date').value;
  const delivery=document.getElementById('f-delivery').value;
  const payment=document.getElementById('f-payment').value;
  // Save whatever is in the address box — validated or not
  const address=document.getElementById('f-address').value.trim();
  const newRows=models.map((m,i)=>({
    id:makeRowId(orderId, i),orderId,customer,address,delivery,payment,
    model:m.model,catId:m.catId,qty:m.qty,price:m.price,
    total:parseFloat((m.qty*m.price).toFixed(2)),
    status:'Pending',date,notes:m.notes,options:m.options
  }));
  // When editing preserve the existing status for each matching row
  if(editOId){
    newRows.forEach(nr=>{
      const existing=orders.find(o=>o.orderId===editOId&&o.model===nr.model);
      if(existing)nr.status=existing.status;
    });
  }
  busy=true;
  const btn=document.getElementById('saveBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2"></i> Saving…';
  setStatus('spin','Saving…');closeModal();
  orders=orders.filter(o=>o.orderId!==orderId);
  orders.unshift(...newRows);renderTable();
  try{
    if(editOId) await sbDelete('orders', 'order_id=eq.'+encodeURIComponent(editOId));
    for(const row of newRows){
      await sbUpsert('orders', {
        id: row.id, order_id: row.orderId, customer: row.customer,
        address: row.address, delivery: row.delivery, payment: row.payment,
        model: row.model, cat_id: row.catId, qty: row.qty,
        price: row.price, total: row.total, status: row.status,
        date: row.date, notes: row.notes, options: row.options
      });
    }
    setStatus('ok','Saved · '+uniqueOrderCount()+' orders');
  }catch(e){setStatus('err','Save failed: '+e.message);}
  finally{busy=false;btn.disabled=false;btn.innerHTML='<i class="ti ti-check"></i> Save Order';}
}

async function updateStatus(orderId,rowId,newStatus,sel){
  // Update the select appearance immediately
  sel.className='status-select b-'+newStatus.toLowerCase();
  sel.disabled=true;
  // Find row by id
  const row=orders.find(o=>String(o.id)===String(rowId));
  if(!row){sel.disabled=false;return;}
  const prevStatus=row.status;
  // Update local state
  row.status=newStatus;
  updateStats();
  try{
    // Update status via Supabase upsert
    await sbUpsert('orders', {
      id: row.id, order_id: row.orderId, customer: row.customer,
      address: row.address, delivery: row.delivery, payment: row.payment,
      model: row.model, cat_id: row.catId, qty: row.qty,
      price: row.price, total: row.total, status: newStatus,
      date: row.date, notes: row.notes, options: row.options
    });
    setStatus('ok','Status updated');
    renderTable();
  }catch(e){
    // Revert on failure
    row.status=prevStatus;
    sel.className='status-select b-'+prevStatus.toLowerCase();
    setStatus('err','Update failed: '+e.message);
    alert('Status save failed: '+e.message);
  }finally{
    sel.disabled=false;
    sel.dataset.prev=newStatus;
  }
}

async function deleteOrder(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);
  if(!confirm(rows.length>1?`Delete this order (${rows.length} models)?`:'Delete this order?'))return;
  setStatus('spin','Deleting…');
  orders=orders.filter(o=>o.orderId!==orderId);renderTable();
  try{
    await sbDelete('orders', 'order_id=eq.'+encodeURIComponent(orderId));
    setStatus('ok','Deleted · '+uniqueOrderCount()+' orders');
  }catch(e){setStatus('err','Delete failed: '+e.message);}
}

// ── Categories modal ───────────────────────────────────────
// ── Combined Categories + Options modal ──────────────────
function openCatModal(){renderCatBlocks();document.getElementById('catModal').classList.add('open');}
function closeCatModal(){document.getElementById('catModal').classList.remove('open');}

function getCatOpts_byCatId(catId){
  return opts.filter(o=>String(o.catId)===String(catId));
}

function renderCatBlocks(){
  const list=document.getElementById('catFlatList');
  list.innerHTML=cats.map((c,ci)=>{
    const catOpts=getCatOpts_byCatId(c.id);
    return `<div class="cat-block" data-ci="${ci}">
      <div class="cat-block-hdr">
        <span class="id-label">${esc(c.id)}</span>
        <input type="text" value="${esc(c.name)}" placeholder="Category name" oninput="cats[${ci}].name=this.value">
        <div class="cat-price-wrap"><span>$ default</span>
          <input type="number" value="${c.price}" step="0.01" min="0" oninput="cats[${ci}].price=parseFloat(this.value)||0">
        </div>
        <button class="icon-btn del" onclick="removeCat(${ci})"><i class="ti ti-trash"></i></button>
      </div>
      <div class="cat-opts-area" id="cat-opts-${ci}">
        ${catOpts.length===0?'<div class="cat-opts-area-empty">No options — add one below</div>':''}
        ${catOpts.map((o,oi)=>{
          const globalIdx=opts.indexOf(o);
          return `<div class="opt-item" draggable="true"
            ondragstart="optDragStart(event,${globalIdx})"
            ondragover="optDragOver(event,${globalIdx})"
            ondrop="optDrop(event,${globalIdx})"
            ondragleave="optDragLeave(event)"
            ondragend="optDragEnd(event)">
            <span class="opt-drag"><i class="ti ti-grip-vertical"></i></span>
            <input type="text" value="${esc(o.name)}" placeholder="Field name" oninput="opts[${globalIdx}].name=this.value">
            <select onchange="opts[${globalIdx}].display=this.value;renderCatBlocks()">
              <option${o.display==='text'?' selected':''}>text</option>
              <option${o.display==='dropdown'?' selected':''}>dropdown</option>
            </select>
            <button class="icon-btn del" onclick="removeOpt(${globalIdx})"><i class="ti ti-trash"></i></button>
            ${o.display==='dropdown'?`<div class="opt-dropdown-vals">
              <input type="text" value="${esc(o.options)}" placeholder="Comma-separated values, add Custom for free text"
                oninput="opts[${globalIdx}].options=this.value">
            </div>`:''}
          </div>`;
        }).join('')}
        <button class="add-opt-btn" onclick="addOptToCat('${esc(c.id)}')">
          <i class="ti ti-plus" style="font-size:11px"></i> Add option
        </button>
      </div>
    </div>`;
  }).join('');
}

// Drag and drop reordering for options
let dragIdx=null;
function optDragStart(e,idx){dragIdx=idx;e.currentTarget.classList.add('dragging');}
function optDragOver(e,idx){e.preventDefault();if(idx!==dragIdx)e.currentTarget.classList.add('drag-over');}
function optDragLeave(e){e.currentTarget.classList.remove('drag-over');}
function optDragEnd(e){e.currentTarget.classList.remove('dragging');dragIdx=null;}
function optDrop(e,idx){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if(dragIdx===null||dragIdx===idx) return;
  const moved=opts.splice(dragIdx,1)[0];
  opts.splice(idx,0,moved);
  renderCatBlocks();
}

function addCat(){cats.push({id:nextCatId(),name:'',price:0});renderCatBlocks();}
function removeCat(i){cats.splice(i,1);renderCatBlocks();}
function removeOpt(i){opts.splice(i,1);renderCatBlocks();}
function addOptToCat(catId){
  opts.push({id:nextOptId(),catId,name:'',display:'text',options:''});
  renderCatBlocks();
}

async function saveCatsAndOpts(){
  setStatus('spin','Saving…');closeCatModal();populateCatFilter();
  try{
    await sbReplace('categories', cats.map(c=>({id:c.id,name:c.name,price:c.price})));
    await sbReplace('options', opts.map((o,i)=>({id:o.id,cat_id:o.catId,name:o.name,display:o.display,options:o.options,sort_order:i})));
    setStatus('ok','Saved');setTimeout(loadAll,500);
  }catch(e){setStatus('err','Failed: '+e.message);}
}

function populateCatFilter(){
  const el=document.getElementById('filterCat');const cur=el.value;
  while(el.options.length>1)el.remove(1);
  cats.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;el.appendChild(o);});
  el.value=cur;
}




// ── Saved colour combinations ──────────────────────────────
function getSavedColourCombos(){
  // Extract unique colour combos from all orders
  // Format in options: "Colours:Red|Yellow|Black|Jade White" (pipe-separated names)
  const seen=new Set();
  const combos=[];
  orders.forEach(o=>{
    if(!o.options) return;
    // Split by || to get each option field
    const parts=o.options.split('||');
    parts.forEach(part=>{
      // Match "Colours:name1|name2|name3|name4" or similar colour field
      const m=part.match(/^Colou?rs?:(.*)/i);
      if(!m) return;
      const colourStr=m[1].trim();
      if(!colourStr) return;
      // Skip if it looks like old "Custom:Layer..." format
      if(colourStr.startsWith('Custom:')) return;
      // Split by pipe to get individual colour names
      const names=colourStr.split('|').map(s=>s.trim()).filter(Boolean);
      if(!names.length) return;
      const key=names.join('|');
      if(seen.has(key)) return;
      seen.add(key);
      // Resolve each name to a colour object
      const resolved=names.map(name=>{
        const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());
        return{name, code:c?c.code:'#cccccc'};
      });
      combos.push({key, layers:resolved});
    });
  });
  return combos;
}

function selectColourOpt(pickerId, value, idx, optId){
  const list=document.getElementById('cpl2-'+pickerId);
  if(list) list.style.display='none';
  const lbl=document.getElementById('cpl-'+pickerId);
  const sw=document.getElementById('cps-'+pickerId);
  if(value==='Custom'){
    if(lbl) lbl.textContent='Custom';
    if(sw){sw.style.background='transparent';}
    const container=document.getElementById('ovc-'+idx+'-'+optId);
    if(container) container.style.display='';
    renderLayerSelectors(idx,optId,'');
  } else if(!value){
    if(lbl) lbl.textContent='— select —';
    if(sw) sw.style.background='transparent';
    const container=document.getElementById('ovc-'+idx+'-'+optId);
    if(container) container.style.display='none';
  } else {
    // Saved combo selected
    if(lbl) lbl.textContent=value.replace(/\|/g,' / ');
    if(sw){
      // Show first colour as swatch
      const firstColour=value.split('|')[0];
      const c=colours.find(c=>c.name.toLowerCase()===firstColour.toLowerCase());
      sw.style.background=c?c.code:'transparent';
    }
    const container=document.getElementById('ovc-'+idx+'-'+optId);
    if(container) container.style.display='none';
    // Store the combo value
    const hidden=document.getElementById('opts-'+idx);
    // Will be collected by collectOpts
  }
  // Store selected value on wrapper
  const wrap=document.getElementById('cpw-col-'+idx+'-'+optId);
  if(wrap) wrap.dataset.colourval=value;
  collectOpts(idx);
}

function applyComboToLayers(idx, optId, comboKey){
  // comboKey is "Red|Yellow|Black|Jade White" — show layer pickers pre-filled
  const names=comboKey.split('|');
  const container=document.getElementById('ovc-'+idx+'-'+optId);
  if(!container) return;
  container.style.display='';
  container.dataset.iscolour='1';
  // Build layer string format expected by renderLayerSelectors
  const layerStr=names.map((n,i)=>'Layer '+(i+1)+':'+n).join('|');
  renderLayerSelectors(idx, optId, layerStr);
}

// ── Stats modal ────────────────────────────────────────────
function openStatsModal(){
  updateStats();
  const grid = document.getElementById('statsGrid');

  // Collect data
  const completed = orders.filter(o=>o.status==='Complete');
  const pending   = orders.filter(o=>o.status==='Pending');
  const printing  = orders.filter(o=>o.status==='Printing');
  const cancelled = orders.filter(o=>o.status==='Cancelled');

  // Category breakdown
  const catCounts={};
  orders.forEach(o=>{
    const cat=cats.find(c=>String(c.id)===String(o.catId));
    const name=cat?cat.name:'Unknown';
    catCounts[name]=(catCounts[name]||0)+1;
  });

  // Payment breakdown (completed orders only, per order)
  const seenPay={};
  completed.forEach(o=>{
    if(!seenPay[o.orderId]) seenPay[o.orderId]={payment:o.payment||'No',total:0};
    seenPay[o.orderId].total+=o.total;
  });
  const payBreak={No:0,Free:0,Simon:0,Wade:0};
  const payRev={Simon:0,Wade:0};
  Object.values(seenPay).forEach(({payment,total})=>{
    if(payBreak[payment]!==undefined) payBreak[payment]++;
    if(payRev[payment]!==undefined) payRev[payment]+=total;
  });

  // Name badge breakdown
  const badgeCat=cats.find(c=>c.name.toLowerCase().includes('name badge'));
  let badgeHtml='';
  if(badgeCat){
    const badges=completed.filter(o=>String(o.catId)===String(badgeCat.id));
    const pins=badges.filter(o=>o.options&&o.options.toLowerCase().includes('pin')).length;
    const mags=badges.filter(o=>o.options&&o.options.toLowerCase().includes('magnet')).length;
    badgeHtml=`<div class="stats-card">
      <div class="stats-card-title">Name Badge Types (Completed)</div>
      ${[['Pin',pins],['Magnet',mags]].map(([l,v])=>`
        <div class="stat-break-row"><span class="stat-break-label">${l}</span><span class="stat-break-val">${v}</span></div>`).join('')}
    </div>`;
  }

  grid.innerHTML=`
    <div class="stats-card">
      <div class="stats-card-title">Order Status</div>
      ${[['Pending',pending.length,'var(--amber)'],['Printing',printing.length,'var(--blue)'],['Completed',completed.length,'var(--green)'],['Cancelled',cancelled.length,'var(--red)']].map(([l,v,c])=>`
        <div class="stat-break-row"><span class="stat-break-label">${l}</span><span class="stat-break-val" style="color:${c}">${v}</span></div>`).join('')}
    </div>
    <div class="stats-card">
      <div class="stats-card-title">Revenue (Completed)</div>
      <div class="stats-card-val">$${completed.reduce((s,o)=>s+o.total,0).toFixed(2)}</div>
      ${[['Simon','var(--green)'],['Wade','#2e7d32']].map(([n,c])=>`
        <div class="stat-break-row"><span class="stat-break-label">${n}</span><span class="stat-break-val" style="color:${c}">$${payRev[n].toFixed(2)}</span></div>`).join('')}
      ${[['No','var(--red)'],['Free','var(--blue)']].map(([n,c])=>`
        <div class="stat-break-row"><span class="stat-break-label">${n}</span><span class="stat-break-val" style="color:${c}">${payBreak[n]}</span></div>`).join('')}
    </div>
    <div class="stats-card full">
      <div class="stats-card-title">Items by Category (All Orders)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">
        ${Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>`
          <div class="stat-break-row"><span class="stat-break-label">${esc(name)}</span><span class="stat-break-val">${count}</span></div>`).join('')}
      </div>
    </div>
    ${badgeHtml}
  `;
  document.getElementById('statsModal').classList.add('open');
}
function closeStatsModal(){ document.getElementById('statsModal').classList.remove('open'); }

// ── Colours modal ─────────────────────────────────────────
function openColourModal(){renderColourList();document.getElementById('colourModal').classList.add('open');}
function closeColourModal(){document.getElementById('colourModal').classList.remove('open');}

function renderColourList(){
  document.getElementById('colourList').innerHTML=colours.map((c,i)=>`
    <div class="colour-row">
      <div class="colour-swatch" style="background:${esc(c.code||'#cccccc')}"></div>
      <input type="text" value="${esc(c.name)}" placeholder="Colour name" oninput="colours[${i}].name=this.value">
      <div class="colour-hex-wrap">
        <input type="text" value="${esc(c.code||'#cccccc')}" placeholder="#000000" maxlength="7"
          oninput="colours[${i}].code=this.value;updateSwatch(${i},this.value)">
        <button class="copy-hex-btn" onclick="copyHex('${esc(c.code||'')}',this)" title="Copy hex code"><i class="ti ti-copy"></i></button>
      </div>
      <div class="avail-check"><input type="checkbox" ${(c.available===true||String(c.available).toLowerCase()==='true'||c.available==='TRUE'||c.available===1)?'checked':''} onchange="colours[${i}].available=this.checked" title="Available"></div>
      <button class="icon-btn del" onclick="removeColour(${i})"><i class="ti ti-trash"></i></button>
    </div>`).join('');
}

function updateSwatch(i, code){
  // Update the swatch colour live as hex is typed, without full re-render
  const rows = document.querySelectorAll('.colour-row');
  if(rows[i]){
    const swatch = rows[i].querySelector('.colour-swatch');
    if(swatch && /^#[0-9A-Fa-f]{6}$/.test(code)) swatch.style.background = code;
  }
}

function copyHex(code, btn){
  if(!code) return;
  navigator.clipboard.writeText(code).then(()=>{
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ti ti-check"></i>';
    btn.style.color = 'var(--green)';
    setTimeout(()=>{ btn.innerHTML = orig; btn.style.color = ''; }, 1500);
  }).catch(()=>{
    // Fallback for browsers without clipboard API
    const ta = document.createElement('textarea');
    ta.value = code; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ti ti-check"></i>';
    setTimeout(()=>{ btn.innerHTML = orig; }, 1500);
  });
}

function addColour(){
  colours.push({id:nextColourId(),name:'',code:'#cccccc',available:true});
  renderColourList();
}
function removeColour(i){colours.splice(i,1);renderColourList();}

async function saveColours(){
  setStatus('spin','Saving colours…');
  console.log('Saving colours:', colours);
  try{
    const result=await apiPayload({action:'saveColours',colours});
    console.log('Save result:', result);
    setStatus('ok','Colours saved · '+colours.length+' colours');
    closeColourModal();
  }catch(e){
    setStatus('err','Save failed: '+e.message);
    alert('Save failed: '+e.message);
  }
}

// ── Settings ───────────────────────────────────────────────
const ACCENT_PRESETS=[
  {label:'Gold',a:'#e8d5a3',a2:'#c4a96b'},{label:'Coral',a:'#f4a27a',a2:'#d97a4a'},
  {label:'Mint',a:'#7dd8b0',a2:'#4db88a'},{label:'Lavender',a:'#b8a4f0',a2:'#8f74d8'},
  {label:'Sky',a:'#7ec8f4',a2:'#4aa8d8'},{label:'Rose',a:'#f4a0b0',a2:'#d87080'},
];
function loadAccent(){const s=localStorage.getItem('pd_accent');if(s){try{const p=JSON.parse(s);applyAccent(p.a,p.a2,false);}catch(e){}}}
function applyAccent(a,a2,save=true){
  document.documentElement.style.setProperty('--accent',a);
  document.documentElement.style.setProperty('--accent2',a2);
  if(save){
    localStorage.setItem('pd_accent',JSON.stringify({a,a2}));
    savePreferences();
  }
}
function previewAccent(hex){const a2=darken(hex,0.18);applyAccent(hex,a2);document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active'));}
function darken(hex,amt){let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);r=Math.max(0,Math.round(r*(1-amt)));g=Math.max(0,Math.round(g*(1-amt)));b=Math.max(0,Math.round(b*(1-amt)));return'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function buildSwatches(){const row=document.getElementById('swatchRow');row.innerHTML='';ACCENT_PRESETS.forEach(p=>{const d=document.createElement('div');d.className='swatch';d.style.background=p.a;d.title=p.label;d.onclick=()=>{applyAccent(p.a,p.a2);document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active'));d.classList.add('active');document.getElementById('customColour').value=p.a;};row.appendChild(d);});}
function openSettings(){
  buildSwatches();
  document.getElementById('settingsGasUrl').value=getCfg('SUPABASE_URL');
  const su=getCfg('SHEET_URL');
  document.getElementById('settingsSheetUrl').value=su;updateSheetLink(su);
  const s=localStorage.getItem('pd_accent');if(s){try{document.getElementById('customColour').value=JSON.parse(s).a;}catch(e){}}
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettings(){document.getElementById('settingsModal').classList.remove('open');}
function applySettings(){
  const g=document.getElementById('settingsGasUrl').value.trim();
  const s=document.getElementById('settingsSheetUrl').value.trim();
  if(g) localStorage.setItem('pd_SUPABASE_URL', g);
  if(s){ localStorage.setItem('pd_sheet_url',s); updateSheetLink(s); }
  closeSettings();
  savePreferences();
  if(g) loadAll();
}
function updateSheetLink(url){const l=document.getElementById('sheetLink');if(url){l.href=url;l.style.opacity='1';}else{l.href='#';l.style.opacity='0.4';}}

// ── Status ─────────────────────────────────────────────────
function setStatus(state,msg){
  document.getElementById('dot').className='dot'+(state==='err'?' err':state==='spin'?' spin':'');
  document.getElementById('statusMsg').textContent=msg;
}

// ── Mobile detection ───────────────────────────────────────
function checkMobile(){if(window.innerWidth<=640)document.body.classList.add('mobile');else document.body.classList.remove('mobile');}
checkMobile();window.addEventListener('resize',checkMobile);

// Close colour picker dropdowns when clicking outside
document.addEventListener('click', e=>{
  if(!e.target.closest('.colour-picker-wrap')&&!e.target.closest('.colour-combo-option')){
    document.querySelectorAll('.colour-picker-list').forEach(el=>el.style.display='none');
  }
});

// ── Boot ───────────────────────────────────────────────────
loadAccent();
updateSheetLink(getCfg('SHEET_URL'));
document.getElementById('setupBanner').style.display='none';
// Check for existing session
restoreSession().then(ok=>{
  if(ok){ showApp(); }
  else{
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('mainApp').style.display='none';
  }
});
