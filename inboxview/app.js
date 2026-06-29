// ── Payment options config ────────────────────────────────
// Edit via Settings modal. Stored in localStorage for now.
let paymentOptions = JSON.parse(localStorage.getItem('pd_payment_opts')||'null') || [
  {name:'No',   archived:false, showRevenue:false},
  {name:'Free', archived:false, showRevenue:false},
  {name:'Simon',archived:false, showRevenue:true},
  {name:'Wade', archived:false, showRevenue:true}
];

function savePaymentOptions(){
  localStorage.setItem('pd_payment_opts', JSON.stringify(paymentOptions));
}

function getActivePaymentOptions(){
  return paymentOptions.filter(p=>!p.archived);
}

function openCatModal(){
  // Sync checkbox state
  const cb = document.getElementById('showArchivedCb');
  if(cb) cb.checked = showArchivedCats;
  renderCatBlocks();
  document.getElementById('catModal').classList.add('open');
}
function closeCatModal(){document.getElementById('catModal').classList.remove('open');}

function getCatOpts_byCatId(catId){
  return opts.filter(o=>String(o.catId)===String(catId));
}

function renderCatBlocks(){
  const list=document.getElementById('catFlatList');
  // Preserve current expanded states
  const expanded={};
  list.querySelectorAll('.cat-block').forEach(el=>{
    const ci=el.dataset.ci;
    expanded[ci]=!el.querySelector('.cat-opts-area')?.classList.contains('collapsed');
  });
  // Build set of used cat/opt IDs from completed orders
  const usedCatIds=new Set(orders.filter(o=>o.status==='Complete').map(o=>o.catId));
  const usedOptKeys=new Set();
  orders.filter(o=>o.status==='Complete').forEach(o=>{
    if(o.options) o.options.split('||').forEach(p=>{
      const name=p.split(':')[0]?.trim();
      if(name) usedOptKeys.add(o.catId+'|'+name);
    });
  });

  const visibleCats = showArchivedCats ? cats : cats.filter(c=>!c.archived);

  list.innerHTML=visibleCats.map((c,ci)=>{
    const realCi=cats.indexOf(c);
    const catOpts=getCatOpts_byCatId(c.id).filter(o=>showArchivedCats||!o.archived);
    const isExpanded=expanded[realCi]||false;
    const isUsed=usedCatIds.has(c.id);
    const canDelete=!isUsed&&!c.archived;
    return `<div class="cat-block${c.archived?' cat-archived':''}" data-ci="${realCi}">
      <div class="cat-block-hdr" onclick="toggleCatBlock(${realCi})" style="cursor:pointer">
        <i class="ti ti-chevron-right cat-chevron${isExpanded?' expanded':''}" style="font-size:14px;color:var(--muted);flex-shrink:0;transition:transform 0.15s"></i>
        <input type="text" value="${esc(c.name)}" placeholder="Category name" oninput="cats[${realCi}].name=this.value" onclick="event.stopPropagation()" ${c.archived?'disabled':''}>
        <div class="cat-price-wrap">
          <span>$</span>
          <input type="number" value="${c.price}" step="0.01" min="0" oninput="cats[${realCi}].price=parseFloat(this.value)||0" onclick="event.stopPropagation()" ${c.archived?'disabled':''}>
        </div>
        ${c.archived
          ? `<button class="icon-btn" onclick="event.stopPropagation();unarchiveCat(${realCi})" title="Unarchive"><i class="ti ti-archive-off"></i></button>`
          : canDelete
            ? `<button class="icon-btn del" onclick="event.stopPropagation();removeCat(${realCi})"><i class="ti ti-trash"></i></button>`
            : `<button class="icon-btn" onclick="event.stopPropagation();archiveCat(${realCi})" title="Archive — used in completed orders"><i class="ti ti-archive"></i></button>`
        }
      </div>
      <div class="cat-opts-area${isExpanded?'':' collapsed'}" id="cat-opts-${ci}">
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
            <div class="opt-type-wrap">
              <select onchange="opts[${globalIdx}].display=this.value;renderCatBlocks()">
                <option${o.display==='text'?' selected':''}>text</option>
                <option${o.display==='dropdown'?' selected':''}>dropdown</option>
                <option value="colour" ${o.display==='colour'?' selected':''}>colour selector</option>
              </select>
              ${o.display==='colour'?`<div class="opt-type-extra">
                <label class="opt-extra-label">Layers:</label>
                <input type="number" class="opt-num-input" min="1" max="8" value="${o.num_colours||4}"
                  oninput="opts[${globalIdx}].num_colours=parseInt(this.value)||4">
              </div>`:''}
              ${o.display==='text'?`<div class="opt-type-extra">
                <label class="opt-extra-label" title="Force all caps">
                  <input type="checkbox" ${o.force_caps?'checked':''} onchange="opts[${globalIdx}].force_caps=this.checked"
                    style="width:13px;height:13px;accent-color:var(--accent);cursor:pointer;margin:0">
                  Caps
                </label>
                <label class="opt-extra-label" title="Comma-separated values create multiple order items">
                  <input type="checkbox" ${o.multi_item?'checked':''} onchange="opts[${globalIdx}].multi_item=this.checked"
                    style="width:13px;height:13px;accent-color:var(--accent);cursor:pointer;margin:0">
                  Multi
                </label>
              </div>`:''}
            </div>
            ${o.archived
              ? `<button class="icon-btn" onclick="unarchiveOpt(${globalIdx})" title="Unarchive"><i class="ti ti-archive-off"></i></button>`
              : usedOptKeys.has('${esc(c.id)}|'+o.name)
                ? `<button class="icon-btn" onclick="archiveOpt(${globalIdx})" title="Archive — used in completed orders"><i class="ti ti-archive"></i></button>`
                : `<button class="icon-btn del" onclick="removeOpt(${globalIdx})"><i class="ti ti-trash"></i></button>`
            }
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


function archiveCat(ci){ cats[ci].archived=true; renderCatBlocks(); }
function unarchiveCat(ci){ cats[ci].archived=false; renderCatBlocks(); }
function archiveOpt(i){ opts[i].archived=true; renderCatBlocks(); }
function unarchiveOpt(i){ opts[i].archived=false; renderCatBlocks(); }
function toggleShowArchived(cb){ showArchivedCats=cb.checked; renderCatBlocks(); }

function toggleCatBlock(ci){
  const block  = document.querySelector(`.cat-block[data-ci="${ci}"]`);
  const area   = block?.querySelector('.cat-opts-area');
  const chev   = block?.querySelector('.cat-chevron');
  if(!area) return;
  const isCollapsed = area.classList.contains('collapsed');
  area.classList.toggle('collapsed', !isCollapsed);
  if(chev) chev.classList.toggle('expanded', isCollapsed);
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
  opts.push({id:nextOptId(),catId,name:'',display:'text',options:'',sort_order:opts.length,num_colours:4,force_caps:false,multi_item:false,archived:false});
  renderCatBlocks();
}

async function saveCatsAndOpts(){
  setStatus('spin','Saving…');closeCatModal();populateCatFilter();
  try{
    await sbReplace('categories', cats.map(c=>({id:c.id,name:c.name,price:c.price,archived:c.archived||false})));
    await sbReplace('options', opts.map((o,i)=>({id:o.id,cat_id:o.catId,name:o.name,display:o.display,options:o.options,sort_order:i,num_colours:o.num_colours||4,force_caps:o.force_caps||false,multi_item:o.multi_item||false,archived:o.archived||false})));
    setStatus('ok','Saved');setTimeout(loadAll,500);
  }catch(e){setStatus('err','Failed: '+e.message);}
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
      // Match colour opts by field name (legacy) or just take pipe-separated values
      const fieldName=part.split(':')[0].trim();
      const isColField=opts.some(o=>(o.display==='colour'||o.name.toLowerCase().includes('colour')||o.name.toLowerCase().includes('color'))&&o.name===fieldName);
      if(!isColField) return;
      const m=part.match(/^[^:]+:(.*)/);  // any field
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


// ── Users modal ────────────────────────────────────────────
let editingUserId = null;

function openUsersModal(){
  editingUserId = null;
  document.getElementById('userForm').style.display = 'none';
  document.getElementById('usersModal').classList.add('open');
  loadUsers();
}
function closeUsersModal(){ document.getElementById('usersModal').classList.remove('open'); }

async function loadUsers(){
  const el = document.getElementById('usersList');
  // Warn if service key not set
  if(!getCfg('SUPABASE_SERVICE_KEY')){
    el.innerHTML = `<div class="empty" style="color:var(--amber)">
      <i class="ti ti-alert-triangle"></i>
      <div style="margin-top:8px;font-size:12px;line-height:1.6">
        Service key not set. Run this in your browser console once:<br>
        <code style="font-size:11px;background:var(--surface2);padding:4px 8px;border-radius:4px;display:inline-block;margin-top:6px">
          localStorage.setItem('pd_SUPABASE_SERVICE_KEY', 'your-key')
        </code>
      </div>
    </div>`;
    return;
  }
  el.innerHTML = '<div class="empty"><i class="ti ti-loader-2"></i> Loading…</div>';
  try{
    // Uses Supabase admin API via service role — but we only have anon key
    // So we use the auth admin endpoint with the user's JWT
    const token = getAccessToken();
    const res = await fetch(getCfg('SUPABASE_URL') + '/auth/v1/admin/users', {
      headers: SB_ADMIN_HEADERS()
    });
    if(!res.ok){
      // Fallback — just show current user if admin endpoint not available
      el.innerHTML = renderUserCard(currentUser, true);
      return;
    }
    const data = await res.json();
    const users = data.users || [];
    if(!users.length){ el.innerHTML = '<div class="empty">No users found.</div>'; return; }
    el.innerHTML = users.map(u=>renderUserCard(u, u.id===currentUser?.id)).join('');
  }catch(e){
    // Fallback to showing current user
    el.innerHTML = renderUserCard(currentUser, true);
  }
}

function renderUserCard(u, isCurrentUser){
  if(!u) return '';
  const name  = u.user_metadata?.display_name || u.email?.split('@')[0] || 'Unknown';
  const email = u.email || '—';
  const hasSignedIn = !!u.last_sign_in_at;
  const dateLabel = hasSignedIn ? 'Joined' : 'Invited';
  const dateVal   = hasSignedIn
    ? new Date(u.created_at).toLocaleDateString('en-AU')
    : u.invited_at
      ? new Date(u.invited_at).toLocaleDateString('en-AU')
      : new Date(u.created_at).toLocaleDateString('en-AU');
  const dateColour = hasSignedIn ? '' : 'color:var(--amber)';
  return `<div style="display:flex;align-items:center;justify-content:space-between;
    padding:10px 12px;background:var(--surface2);border:1px solid var(--border);
    border-radius:var(--radius-lg);margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;border-radius:50%;background:rgba(232,213,163,0.15);
        border:1px solid var(--accent);display:flex;align-items:center;justify-content:center;
        font-size:14px;font-weight:600;color:var(--accent);flex-shrink:0">
        ${esc(name[0].toUpperCase())}
      </div>
      <div>
        <div style="font-size:13px;font-weight:500">${esc(name)}${isCurrentUser?' <span style="font-size:10px;color:var(--muted)">(you)</span>':''}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(email)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:1px;${dateColour}">${dateLabel} ${dateVal}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px">
      ${!hasSignedIn?`<button class="icon-btn" onclick="resendInvite('${esc(email)}',this)" title="Resend invite email"><i class="ti ti-mail-forward"></i></button>`:''}
      <button class="icon-btn" onclick="openEditUserForm('${esc(u.id)}','${esc(email)}','${esc(name)}')" title="Edit"><i class="ti ti-edit"></i></button>
      ${!isCurrentUser?`<button class="icon-btn del" onclick="deleteUser('${esc(u.id)}','${esc(name)}')" title="Delete"><i class="ti ti-trash"></i></button>`:''}
    </div>
  </div>`;
}

async function resendInvite(email, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i>';
  try {
    const res = await fetch(getCfg('SUPABASE_URL') + '/auth/v1/invite', {
      method: 'POST',
      headers: SB_ADMIN_HEADERS(),
      body: JSON.stringify({ email, redirect_to: 'https://simonreid.space' })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.msg || d.message || 'Failed'); }
    btn.innerHTML = '<i class="ti ti-check"></i>';
    btn.title = 'Invite resent!';
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; btn.title = 'Resend invite email'; }, 2000);
  } catch(e) {
    alert('Could not resend invite: ' + e.message);
    btn.innerHTML = orig; btn.disabled = false;
  }
}

function openAddUserForm(){
  editingUserId = null;
  document.getElementById('uf-email').value = '';
  document.getElementById('uf-name').value = '';
  document.getElementById('uf-email').disabled = false;
  document.getElementById('uf-password-row').style.display = 'none';
  document.getElementById('uf-error').style.display = 'none';
  document.getElementById('uf-save').innerHTML = '<i class="ti ti-mail"></i> Send invite';
  document.getElementById('userForm').style.display = '';
  document.getElementById('uf-name').focus();
}

function openEditUserForm(id, email, name){
  editingUserId = id;
  document.getElementById('uf-email').value = email;
  document.getElementById('uf-password').value = '';
  document.getElementById('uf-name').value = name;
  document.getElementById('uf-email').disabled = true;
  document.getElementById('uf-password-row').style.display = '';
  document.getElementById('uf-password').placeholder = 'Leave blank to keep current';
  document.getElementById('uf-error').style.display = 'none';
  document.getElementById('uf-save').innerHTML = '<i class="ti ti-check"></i> Save changes';
  document.getElementById('userForm').style.display = '';
  document.getElementById('uf-name').focus();
}

function closeUserForm(){
  document.getElementById('userForm').style.display = 'none';
  editingUserId = null;
}

async function saveUser(){
  const email    = document.getElementById('uf-email').value.trim();
  const password = document.getElementById('uf-password').value;
  const name     = document.getElementById('uf-name').value.trim();
  const errEl    = document.getElementById('uf-error');
  const btn      = document.getElementById('uf-save');
  errEl.style.display = 'none';

  if(!editingUserId && !email){ errEl.textContent='Email is required.'; errEl.style.display=''; return; }
  if(editingUserId && password && password.length < 6){ errEl.textContent='Password must be at least 6 characters.'; errEl.style.display=''; return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Saving…';

  try{
    const token = getAccessToken();
    let res, data;

    if(editingUserId){
      // Update existing user
      const body = { data: { display_name: name } };
      if(password) body.password = password;
      res = await fetch(getCfg('SUPABASE_URL') + '/auth/v1/admin/users/' + editingUserId, {
        method: 'PUT',
        headers: SB_ADMIN_HEADERS(),
        body: JSON.stringify(body)
      });
    } else {
      // Invite new user — Supabase sends email with link to simonreid.space
      res = await fetch(getCfg('SUPABASE_URL') + '/auth/v1/invite', {
        method: 'POST',
        headers: SB_ADMIN_HEADERS(),
        body: JSON.stringify({
          email,
          data: { display_name: name },
          redirect_to: 'https://simonreid.space'
        })
      });
    }

    const text = await res.text();
    data = {};
    try{ data = JSON.parse(text); }catch(e){ throw new Error('Unexpected response: ' + text.slice(0, 100)); }
    if(!res.ok) throw new Error(data.msg || data.error_description || data.message || 'Failed');

    closeUserForm();
    if(!editingUserId){
      // Show success message briefly before reloading list
      const el = document.getElementById('usersList');
      el.innerHTML = '<div class="empty" style="color:var(--green)"><i class="ti ti-mail"></i> Invite sent to '+esc(email)+'</div>';
      setTimeout(loadUsers, 2000);
    } else {
      loadUsers();
    }
  }catch(e){
    errEl.textContent = e.message;
    errEl.style.display = '';
  }finally{
    btn.disabled = false;
    btn.innerHTML = editingUserId ? '<i class="ti ti-check"></i> Save changes' : '<i class="ti ti-check"></i> Create user';
  }
}

async function deleteUser(id, name){
  showConfirm(`Delete user "${name}"? This cannot be undone.`, async () => {
    try{
      const res = await fetch(getCfg('SUPABASE_URL') + '/auth/v1/admin/users/' + id, {
        method: 'DELETE',
        headers: SB_ADMIN_HEADERS()
      });
      if(!res.ok){ const d=await res.json(); throw new Error(d.msg||'Delete failed'); }
      loadUsers();
    }catch(e){
      alert('Could not delete user: ' + e.message);
    }
  });
}


// ── Customers modal ────────────────────────────────────────
let editingCustomerId = null;

function openCustomersModal(){
  renderCustomerList();
  document.getElementById('customersModal').classList.add('open');
}

function viewCustomer(id){
  renderCustomerList();
  document.getElementById('customersModal').classList.add('open');
  setTimeout(()=>{
    const cards = document.querySelectorAll('#customersList .customer-card');
    const idx = customers.findIndex(c=>String(c.id)===String(id));
    if(idx>=0 && cards[idx]){
      cards[idx].scrollIntoView({block:'center',behavior:'smooth'});
      cards[idx].style.transition='box-shadow 0.3s';
      cards[idx].style.boxShadow='0 0 0 2px var(--accent)';
      setTimeout(()=>cards[idx].style.boxShadow='',1800);
    }
  }, 50);
}
function closeCustomersModal(){ document.getElementById('customersModal').classList.remove('open'); }

function renderCustomerList(filter=''){
  const el = document.getElementById('customersList');
  const filtered = filter
    ? customers.filter(c=>c.name.toLowerCase().includes(filter.toLowerCase())||c.email.toLowerCase().includes(filter.toLowerCase()))
    : customers;
  if(!filtered.length){
    el.innerHTML='<div class="empty"><i class="ti ti-users"></i> No customers yet.</div>';
    return;
  }
  // Build set of customer_ids that have orders
  const usedIds = new Set(orders.map(o=>o.customer_id).filter(Boolean));
  el.innerHTML = filtered.map(c=>{
    const hasOrders = usedIds.has(c.id);
    return `
    <div class="customer-card">
      <div class="customer-avatar">${esc(c.name[0]?.toUpperCase()||'?')}</div>
      <div class="customer-info">
        <div class="customer-name">${esc(c.name)}</div>
        <div class="customer-meta">
          ${c.email?`<span><i class="ti ti-mail"></i> ${esc(c.email)}</span>`:''}
          ${c.phone?`<span><i class="ti ti-phone"></i> ${esc(c.phone)}</span>`:''}
        </div>
        ${c.address?`<div class="customer-address"><i class="ti ti-map-pin"></i> ${esc(c.address)}</div>`:''}
      </div>
      <div class="customer-actions">
        <button class="icon-btn" onclick="openEditCustomer('${esc(c.id)}')" title="Edit"><i class="ti ti-edit"></i></button>
        ${!hasOrders?`<button class="icon-btn del" onclick="deleteCustomer('${esc(c.id)}','${esc(c.name)}')" title="Delete"><i class="ti ti-trash"></i></button>`:''}
      </div>
    </div>`;
  }).join('');
}

function openAddCustomer(){
  editingCustomerId = null;
  document.getElementById('cf-name').value='';
  document.getElementById('cf-email').value='';
  document.getElementById('cf-phone').value='';
  document.getElementById('cf-address').value='';
  document.getElementById('cf-notes').value='';
  document.getElementById('cf-error').style.display='none';
  document.getElementById('cf-title').textContent='Add customer';
  document.getElementById('customerForm').style.display='';
  document.getElementById('cf-name').focus();
  setTimeout(()=>attachGooglePlaces(document.getElementById('cf-address'), null), 50);
}

function openEditCustomer(id){
  const c = customers.find(c=>c.id===id);
  if(!c) return;
  editingCustomerId = id;
  document.getElementById('cf-name').value=c.name;
  document.getElementById('cf-email').value=c.email;
  document.getElementById('cf-phone').value=c.phone;
  document.getElementById('cf-address').value=c.address;
  document.getElementById('cf-notes').value=c.notes;
  document.getElementById('cf-error').style.display='none';
  document.getElementById('cf-title').textContent='Edit customer';
  document.getElementById('customerForm').style.display='';
  document.getElementById('cf-name').focus();
  setTimeout(()=>attachGooglePlaces(document.getElementById('cf-address'), null), 50);
}

function closeCustomerForm(){
  document.getElementById('customerForm').style.display='none';
  editingCustomerId=null;
}

async function saveCustomer(){
  const name    = document.getElementById('cf-name').value.trim();
  const email   = document.getElementById('cf-email').value.trim();
  const phone   = document.getElementById('cf-phone').value.trim();
  const address = document.getElementById('cf-address').value.trim();
  const notes   = document.getElementById('cf-notes').value.trim();
  const errEl   = document.getElementById('cf-error');
  const btn     = document.getElementById('cf-save');
  errEl.style.display='none';
  if(!name){ errEl.textContent='Name is required.'; errEl.style.display=''; return; }
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Saving…';
  try{
    const row = {
      id:      editingCustomerId||nextCustomerId(),
      name, email, phone, address, notes
    };
    await sbUpsert('customers', row);
    if(editingCustomerId){
      const idx=customers.findIndex(c=>c.id===editingCustomerId);
      if(idx>=0) customers[idx]=row;
    } else {
      customers.push(row);
      customers.sort((a,b)=>a.name.localeCompare(b.name));
    }
    closeCustomerForm();
    renderCustomerList(document.getElementById('customerSearch').value);
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='';
  }finally{
    btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i> Save';
  }
}

function deleteCustomer(id, name){
  showConfirm(`Delete customer "${name}"?`, async () => {
    try{
      await sbDelete('customers','id=eq.'+encodeURIComponent(id));
      customers=customers.filter(c=>c.id!==id);
      renderCustomerList(document.getElementById('customerSearch').value);
    }catch(e){
      const msg = e.message&&e.message.includes('409')
        ? 'This customer is linked to orders and cannot be deleted.'
        : 'Delete failed: '+e.message;
      alert(msg);
    }
  });
}

// ── Customer autocomplete in order modal ───────────────────
function initCustomerAutocomplete(){
  const input = document.getElementById('f-customer');
  const list  = document.getElementById('customerSuggestions');
  if(!input||!list) return;

  let acMatches=[], acIdx=-1;

  function acHighlight(idx){
    acIdx=idx;
    list.querySelectorAll('.customer-suggestion').forEach((el,i)=>{
      el.classList.toggle('ac-active', i===acIdx);
      if(i===acIdx) el.scrollIntoView({block:'nearest'});
    });
  }

  input.addEventListener('input', ()=>{
    acIdx=-1;
    const q = input.value.trim().toLowerCase();
    document.getElementById('f-customer-id').value='';
    const panel = document.getElementById('newCustomerPanel');
    if(q.length<1){
      list.style.display='none';
      if(panel) panel.style.display='none';
      updateCustomerBorder();
      acMatches=[];
      return;
    }
    acMatches = customers.filter(c=>c.name.toLowerCase().includes(q)).slice(0,6);
    if(!acMatches.length){ list.style.display='none'; return; }
    list.innerHTML = acMatches.map(c=>`
      <div class="cp-option customer-suggestion" onmousedown="selectCustomer('${esc(c.id)}','${esc(c.name)}','${esc(c.address)}')">
        <div class="customer-avatar" style="width:24px;height:24px;font-size:11px;flex-shrink:0">${esc(c.name[0]?.toUpperCase()||'?')}</div>
        <div>
          <div style="font-size:12px">${esc(c.name)}</div>
          ${c.email?`<div style="font-size:10px;color:var(--muted)">${esc(c.email)}</div>`:''}
        </div>
      </div>`).join('');
    list.style.display='';
  });

  input.addEventListener('keydown', e=>{
    if(list.style.display==='none'||!acMatches.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); acHighlight(Math.min(acIdx+1,acMatches.length-1)); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); acHighlight(Math.max(acIdx-1,0)); }
    else if(e.key==='Enter' && acIdx>=0){
      e.preventDefault();
      const c=acMatches[acIdx];
      selectCustomer(c.id, c.name, c.address);
    }
    else if(e.key==='Escape'){ list.style.display='none'; acIdx=-1; }
  });

  input.addEventListener('blur', ()=>setTimeout(()=>{
    list.style.display='none';
    acIdx=-1;
    const name = input.value.trim();
    const customerId = document.getElementById('f-customer-id').value;
    const panel = document.getElementById('newCustomerPanel');
    if(panel) panel.style.display = (name && !customerId) ? '' : 'none';
    updateCustomerBorder();
  }, 150));
}

function updateCustomerBorder(){
  const input = document.getElementById('f-customer');
  const id    = document.getElementById('f-customer-id')?.value;
  const name  = input?.value.trim();
  if(!input) return;
  input.classList.remove('cust-linked','cust-new');
  if(!name) return;
  input.classList.add(id ? 'cust-linked' : 'cust-new');
}

function selectCustomer(id, name, address){
  document.getElementById('f-customer').value=name;
  document.getElementById('f-customer-id').value=id;
  document.getElementById('customerSuggestions').style.display='none';
  if(address && !document.getElementById('f-address').value){
    document.getElementById('f-address').value=address;
  }
  updateAddrRefreshBtn();
  updateCustomerBorder();
  const panel = document.getElementById('newCustomerPanel');
  if(panel) panel.style.display='none';
}

function showNewCustomerPanel(){
  const panel = document.getElementById('newCustomerPanel');
  if(!panel) return;
  panel.style.display = '';
  const addr = document.getElementById('f-address')?.value.trim();
  const notesEl = document.getElementById('nc-notes');
  if(addr && notesEl && !notesEl.value) notesEl.placeholder = 'Address will be copied from order…';
}

async function createCustomerInline(){
  const name    = document.getElementById('f-customer').value.trim();
  const email   = document.getElementById('nc-email')?.value.trim()||'';
  const phone   = document.getElementById('nc-phone')?.value.trim()||'';
  const address = document.getElementById('f-address')?.value.trim()||'';
  const notes   = document.getElementById('nc-notes')?.value.trim()||'';
  if(!name){ alert('Enter a customer name first.'); return; }
  const existing = customers.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(existing){
    selectCustomer(existing.id, existing.name, existing.address);
    return;
  }
  try{
    const row = { id:nextCustomerId(), name, email, phone, address, notes };
    await sbUpsert('customers', row);
    customers.push(row);
    customers.sort((a,b)=>a.name.localeCompare(b.name));
    selectCustomer(row.id, row.name, address);
    updateCustomerBorder();
    setStatus('ok','Customer created');
    document.getElementById('newCustomerPanel').style.display='none';
  }catch(e){ alert('Failed to create customer: '+e.message); }
}


function updateAddrRefreshBtn(){
  const customerId = document.getElementById('f-customer-id')?.value||'';
  const btn = document.getElementById('addrRefreshBtn');
  if(!btn) return;
  const c = customers.find(c=>c.id===customerId);
  const hasAddr = c && c.address;
  btn.disabled = !hasAddr;
  btn.style.opacity = hasAddr ? '1' : '0.4';
  btn.style.cursor  = hasAddr ? 'pointer' : 'not-allowed';
  btn.title = hasAddr ? 'Revert to customer address' : 'No address saved for this customer';
}

function revertToCustomerAddress(){
  const customerId = document.getElementById('f-customer-id')?.value||'';
  const c = customers.find(c=>c.id===customerId);
  if(!c||!c.address) return;
  document.getElementById('f-address').value = c.address;
}

// ── Badge helpers ───────────────────────────────────────────────
let _badge3mfReady  = false;
let _badgeAssetCache = null;
let _badgeFont       = null;
let _opentypeLoading = null;

// Load opentype.js + font without loading the full Three/Clipper stack
async function _ensureBadgeFont() {
  if (_badgeFont) return;
  if (!_opentypeLoading) {
    _opentypeLoading = (async () => {
      if (typeof opentype === 'undefined') {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js';
          s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      const fontPath = _badgeAssetCache?.fontPath || '/badge/LEGO.TTF';
      _badgeFont = await new Promise((res, rej) =>
        opentype.load(fontPath, (err, f) => err ? rej(err) : res(f))
      );
    })();
  }
  await _opentypeLoading;
}

// Returns the minimum badge width (mm) needed for a given backing name
function _badgeBackingMinWidth(backingName) {
  const n = (backingName || '').toLowerCase();
  if (n.includes('round'))  return _badgeAssetCache?.rndDiam ?? 17.15;
  if (n.includes('magnet')) return 46;
  if (n.includes('pin'))    return 32;
  return 0;
}

// Build backing config object from a backing name string
function _badgeBuildBacking(backingStr) {
  const n = (backingStr || '').toLowerCase();
  if (n.includes('round')) return {
    type: 'round',
    diameter:  _badgeAssetCache?.rndDiam      ?? 17.15,
    depth:     _badgeAssetCache?.rndDepth     ?? 2,
    threshold: _badgeAssetCache?.rndThreshold ?? 60,
    name: 'round_magnet',
  };
  if (n.includes('keychain')) return { type: 'keychain' };
  if (n.includes('pin'))    return { w: 32, h: 7,  d: 2, name: 'pin' };
  if (n.includes('magnet')) return { w: 46, h: 14, d: 2, name: 'magnet' };
  return null;
}

// Validate badge name width against available backings — called from order modal
async function badgeWidthCheck(idx) {
  const catId = document.getElementById('mc-' + idx)?.value;
  if (!catId) return;
  const cat = cats.find(c => String(c.id) === String(catId));
  if (!cat?.name?.toLowerCase().includes('name badge')) return;

  const catOpts   = opts.filter(o => String(o.catId) === String(catId));
  const textOpt   = catOpts.find(o => o.display === 'text');
  const backingOpt = catOpts.find(o => o.name.toLowerCase().includes('backing'));
  if (!textOpt) return;

  const textEl    = document.getElementById(`ov-${idx}-${textOpt.id}`);
  const backingEl = backingOpt ? document.getElementById(`ov-${idx}-${backingOpt.id}`) : null;
  if (!textEl) return;

  const warnEl = document.getElementById(`bww-${idx}`);
  const rawVal = textEl.value.trim();
  if (!rawVal) {
    textEl.style.outline = '';
    delete textEl.dataset.badgeWidth;
    if (warnEl) warnEl.style.display = 'none';
    if (backingEl) Array.from(backingEl.options).forEach(o => { o.disabled = false; o.style.color = ''; });
    return;
  }

  try { await _ensureBadgeFont(); } catch(e) { return; }

  const fsize = _badgeAssetCache?.fsize || 49;
  const isMulti = textOpt.multi_item;
  const names = isMulti
    ? rawVal.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [rawVal.trim().toUpperCase()];

  // Width of widest name (drives backing restrictions)
  const widths = names.map(n => {
    const bb = _badgeFont.getPath(n, 0, 0, fsize).getBoundingBox();
    return { name: n, w: bb.x2 - bb.x1 };
  });
  const maxWidth = Math.max(...widths.map(x => x.w));
  textEl.dataset.badgeWidth = maxWidth.toFixed(4);

  let anyDisabled = false;
  let currentInvalid = false;
  const selectedMinW = backingEl ? _badgeBackingMinWidth(backingEl.value) : 0;

  if (backingEl) {
    Array.from(backingEl.options).forEach(opt => {
      if (!opt.value) return;
      const minW = _badgeBackingMinWidth(opt.value);
      const fits = maxWidth >= minW;
      opt.disabled = !fits;
      opt.style.color = fits ? '' : 'var(--muted)';
      if (!fits) anyDisabled = true;
      if (opt.selected && !fits) currentInvalid = true;
    });
    if (currentInvalid) {
      const first = Array.from(backingEl.options).find(o => o.value && !o.disabled);
      if (first) { backingEl.value = first.value; collectOpts(idx); }
    }
  }

  if (anyDisabled || (isMulti && widths.some(x => x.w < selectedMinW))) {
    const tooNarrow = widths.filter(x => x.w < selectedMinW);
    let msg;
    if (isMulti && tooNarrow.length) {
      msg = `Too short for selected backing: ${tooNarrow.map(x => x.name).join(', ')}`;
    } else {
      msg = `Name width (${maxWidth.toFixed(1)}mm) — some backing options are not available`;
    }
    textEl.style.outline = '2px solid var(--red,#e55)';
    if (warnEl) { warnEl.textContent = msg; warnEl.style.display = ''; }
  } else {
    textEl.style.outline = '';
    if (warnEl) warnEl.style.display = 'none';
  }
}

// ── Badge generation (inline — uses badge/3mf.js) ──────────────

async function _loadBadge3mfDeps() {
  if (_badge3mfReady) return;
  const load = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  await load('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js');
  await load('https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js');
  await load('https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js');
  await load('/badge/3mf.js');
  _badge3mfReady = true;
}

async function _loadBadgeAssets() {
  if (_badgeAssetCache) return _badgeAssetCache;
  const [models, tmpl] = await Promise.all([
    sbGet('badge_models', '?archived=eq.false&order=name&limit=1'),
    fetch('/badge/project_settings_template.json').then(r => r.json()).catch(() => null),
  ]);
  if (!models || !models.length) throw new Error('No badge model found');
  const model = models[0];
  const [layers, settings] = await Promise.all([
    sbGet('badge_model_layers', `?model_id=eq.${model.id}&order=layer_order`),
    sbGet('badge_model_settings', `?model_id=eq.${model.id}`),
  ]);
  const layerConfig = layers.map((l, i) => ({
    id: l.id, hex: l.colour_hex, colourId: l.colour_id,
    border: l.border_mm, depth: l.thickness_mm,
    hasSlot: i === 0, isText: !l.filled,
  }));
  const s = settings[0] || {};
  _badgeAssetCache = {
    layerConfig,
    fsize:     model.font_size || 49,
    spacing:   s.letter_spacing || 0,
    fontPath:  model.font_path || '/badge/LEGO.TTF',
    rndDiam:      s.round_magnet_diameter  ?? 17.15,
    rndDepth:     s.round_magnet_depth     ?? 2,
    rndThreshold: s.round_magnet_threshold ?? 60,
    projectSettingsTemplate: tmpl,
  };
  return _badgeAssetCache;
}

let _batchItems = null;
let _batchCustomer = 'badges';

function openBadgeBatchModal(items, customer) {
  _batchItems = items;
  _batchCustomer = (customer || 'badges').trim();
  document.getElementById('badgeBatchCount').textContent = `${items.length} badges found in this order`;
  document.getElementById('badgeBatchCountA').textContent = items.length;
  document.getElementById('badgeBatchChoose').style.display = '';
  document.getElementById('badgeBatchProgress').style.display = 'none';
  document.getElementById('badgeBatchDone').style.display = 'none';
  document.getElementById('badgeBatchModal').classList.add('open');
}

function closeBadgeBatchModal() {
  document.getElementById('badgeBatchModal').classList.remove('open');
}

function _batchShowProgress(label) {
  document.getElementById('badgeBatchChoose').style.display = 'none';
  document.getElementById('badgeBatchDone').style.display = 'none';
  document.getElementById('badgeBatchProgress').style.display = '';
  document.getElementById('badgeBatchProgressLabel').textContent = label;
  document.getElementById('badgeBatchProgressSub').textContent = '';
  document.getElementById('badgeBatchBar').style.width = '0%';
}

function _batchUpdateProgress(current, total, sub) {
  document.getElementById('badgeBatchBar').style.width = `${Math.round(current / total * 100)}%`;
  document.getElementById('badgeBatchProgressSub').textContent = sub || '';
}

function _batchShowDone(msg, skipped) {
  document.getElementById('badgeBatchProgress').style.display = 'none';
  document.getElementById('badgeBatchDone').style.display = '';
  document.getElementById('badgeBatchDoneMsg').textContent = msg;
  document.getElementById('badgeBatchDoneSub').textContent = skipped.length ? `Skipped (too narrow): ${skipped.join(', ')}` : '';
}

function _batchShowError(msg) {
  document.getElementById('badgeBatchProgress').style.display = 'none';
  document.getElementById('badgeBatchDone').style.display = '';
  document.getElementById('badgeBatchDoneMsg').textContent = `Error: ${msg}`;
  document.getElementById('badgeBatchDoneSub').textContent = '';
}

function _buildOuterZip(entries) {
  const enc = new TextEncoder();
  const crc32 = d => { let c=0xFFFFFFFF; for(let i=0;i<d.length;i++){c^=d[i];for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xEDB88320:0);} return(c^0xFFFFFFFF)>>>0; };
  const parts = [], cd = []; let off = 0;
  for (const { name, data } of entries) {
    const nb = enc.encode(name), crc = crc32(data);
    const loc = new Uint8Array(30 + nb.length + data.length), dv = new DataView(loc.buffer);
    dv.setUint32(0,0x04034b50,true); dv.setUint16(4,20,true); dv.setUint16(6,0,true); dv.setUint16(8,0,true); dv.setUint16(10,0,true); dv.setUint16(12,0,true); dv.setUint32(14,crc,true); dv.setUint32(18,data.length,true); dv.setUint32(22,data.length,true); dv.setUint16(26,nb.length,true); dv.setUint16(28,0,true);
    loc.set(nb,30); loc.set(data,30+nb.length); parts.push(loc);
    const ce = new Uint8Array(46 + nb.length), cv = new DataView(ce.buffer);
    cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0,true); cv.setUint16(10,0,true); cv.setUint16(12,0,true); cv.setUint16(14,0,true); cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,nb.length,true); cv.setUint16(30,0,true); cv.setUint16(32,0,true); cv.setUint16(34,0,true); cv.setUint16(36,0,true); cv.setUint32(38,0,true); cv.setUint32(42,off,true);
    ce.set(nb,46); cd.push(ce); off += loc.length;
  }
  const cdSize = cd.reduce((s,c) => s+c.length, 0);
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true); ev.setUint16(4,0,true); ev.setUint16(6,0,true); ev.setUint16(8,entries.length,true); ev.setUint16(10,entries.length,true); ev.setUint32(12,cdSize,true); ev.setUint32(16,off,true); ev.setUint16(20,0,true);
  const all = [...parts,...cd,eocd]; const res = new Uint8Array(all.reduce((s,p)=>s+p.length,0)); let p=0; for(const a of all){res.set(a,p);p+=a.length;} return res;
}

function _batchBuildFilenameMap(items) {
  const totals = {}, counters = {};
  for (const { name: rawName, backing } of items) {
    const n = (rawName || 'NAME').toUpperCase();
    const b = (backing || '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
    const key = b ? `${n} ${b}` : n;
    totals[key] = (totals[key] || 0) + 1;
  }
  return {
    next(rawName, backing) {
      const n = (rawName || 'NAME').toUpperCase();
      const b = (backing || '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
      const key = b ? `${n} ${b}` : n;
      counters[key] = (counters[key] || 0) + 1;
      return totals[key] > 1 ? `${key} ${counters[key]}.3mf` : `${key}.3mf`;
    }
  };
}

async function _runBadgeLoop(items, assets, onProgress) {
  const entries = [], skipped = [], fnMap = _batchBuildFilenameMap(items);
  for (let i = 0; i < items.length; i++) {
    const { name: rawName, backing: backingStr, colours: colourStr } = items[i];
    const name = (rawName || 'NAME').toUpperCase();
    onProgress(i, items.length, name);
    await new Promise(r => setTimeout(r, 0));
    const layerConfig = assets.layerConfig.map(l => ({ ...l }));
    if (colourStr) {
      colourStr.split('|').map(s => s.trim()).forEach((colName, idx) => {
        if (idx >= layerConfig.length) return;
        const c = colours.find(c => c.name.toLowerCase() === colName.toLowerCase());
        if (c) { layerConfig[idx].hex = c.code; layerConfig[idx].colourId = c.id; }
      });
    }
    const backing = _badgeBuildBacking(backingStr);
    if (backing) {
      const bb = _badgeFont.getPath(name, 0, 0, assets.fsize).getBoundingBox();
      if (bb.x2 - bb.x1 < (backing.type === 'round' ? backing.diameter : (backing.w || 0))) {
        skipped.push(name); continue;
      }
    }
    const _kc = backing?.type === 'keychain';
    const result = generate3MF({ name, layerConfig, backing: _kc ? null : backing, font: _badgeFont, fsize: assets.fsize, spacing: assets.spacing, projectSettingsTemplate: assets.projectSettingsTemplate, keychain: _kc });
    entries.push({ name: fnMap.next(rawName, backingStr), data: result.zip });
  }
  return { entries, skipped };
}

async function _ensureBadgeDeps(assets) {
  await _loadBadge3mfDeps();
  if (!_badgeFont) {
    _badgeFont = await new Promise((res, rej) =>
      opentype.load(assets.fontPath, (err, f) => err ? rej(err) : res(f))
    );
  }
}

async function generateAllBadgesZip(items) {
  if (!items || !items.length) return;
  const total = items.length;
  _batchShowProgress(`Generating ${total} badges…`);
  try {
    const assets = await _loadBadgeAssets();
    await _ensureBadgeDeps(assets);
    const { entries, skipped } = await _runBadgeLoop(items, assets, (i, n, name) => _batchUpdateProgress(i, n, name));
    _batchUpdateProgress(total, total, 'Building ZIP…');
    await new Promise(r => setTimeout(r, 0));
    const zipData = _buildOuterZip(entries);
    const b = new Blob([zipData], { type: 'application/zip' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    const zipName = (_batchCustomer.replace(/[^a-z0-9 _-]/gi, '').trim() || 'badges') + '.zip';
    a.href = u; a.download = zipName; a.click(); URL.revokeObjectURL(u);
    _batchShowDone(`${entries.length} of ${total} badges downloaded as ${zipName}`, skipped);
  } catch(e) {
    console.error('Generate badges ZIP error:', e);
    _batchShowError(e.message);
  }
}

async function generateAllBadges(items) {
  if (!items || !items.length) return;
  const total = items.length;
  _batchShowProgress(`Generating ${total} badges…`);
  try {
    const assets = await _loadBadgeAssets();
    await _ensureBadgeDeps(assets);
    const { entries, skipped } = await _runBadgeLoop(items, assets, (i, n, name) => _batchUpdateProgress(i, n * 2, name));
    for (let i = 0; i < entries.length; i++) {
      _batchUpdateProgress(total + i, total * 2, `Downloading ${entries[i].name}…`);
      const b = new Blob([entries[i].data], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = entries[i].name; a.click();
      URL.revokeObjectURL(u);
      await new Promise(r => setTimeout(r, 250));
    }
    _batchShowDone(`${entries.length} of ${total} badges downloaded`, skipped);
  } catch(e) {
    console.error('Generate all badges error:', e);
    _batchShowError(e.message);
  }
}

async function generateBadge(url) {
  setStatus('spin', 'Generating badge&hellip;');
  try {
    const params     = new URLSearchParams(url.includes('?') ? url.split('?')[1] : url);
    const name       = (params.get('name') || 'NAME').toUpperCase();
    const backingStr = params.get('backing') || 'Magnet';
    const colourStr  = params.get('colours') || '';

    const assets = await _loadBadgeAssets();
    await _ensureBadgeDeps(assets);

    const layerConfig = assets.layerConfig.map(l => ({ ...l }));
    if (colourStr) {
      colourStr.split('|').map(s => s.trim()).forEach((colName, i) => {
        if (i >= layerConfig.length) return;
        const c = colours.find(c => c.name.toLowerCase() === colName.toLowerCase());
        if (c) { layerConfig[i].hex = c.code; layerConfig[i].colourId = c.id; }
      });
    }

    const backing = _badgeBuildBacking(backingStr);

    // Validate text width vs backing minimum
    if (backing) {
      const bb = _badgeFont.getPath(name, 0, 0, assets.fsize).getBoundingBox();
      const textWidth = bb.x2 - bb.x1;
      const minW = backing.type === 'round' ? backing.diameter : (backing.w || 0);
      if (textWidth < minW) {
        setStatus('err', `"${name}" is too narrow (${textWidth.toFixed(1)}mm) for ${backingStr} — needs ${minW}mm+`);
        return;
      }
    }

    const _kc3 = backing?.type === 'keychain';
    const result = generate3MF({
      name, layerConfig, backing: _kc3 ? null : backing, font: _badgeFont,
      fsize: assets.fsize, spacing: assets.spacing,
      projectSettingsTemplate: assets.projectSettingsTemplate,
      keychain: _kc3,
    });

    const b = new Blob([result.zip], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = result.filename; a.click();
    URL.revokeObjectURL(u);
    setStatus('ok', 'Badge downloaded: ' + result.filename);
  } catch(e) {
    console.error('Badge generation error:', e);
    setStatus('err', 'Badge failed: ' + e.message);
  }
}

// ── Stats modal ────────────────────────────────────────────
function openStatsModal(){
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
  const payBreak={};
  const payRev={};
  paymentOptions.forEach(p=>{ payBreak[p.name]=0; if(p.showRevenue) payRev[p.name]=0; });
  Object.values(seenPay).forEach(({payment,total})=>{
    if(payment in payBreak) payBreak[payment]++;
    if(payment in payRev) payRev[payment]+=total;
  });

  // Name badge breakdown
  const badgeCat=cats.find(c=>c.name.toLowerCase().includes('name badge'));
  let pins=0, mags=0;
  if(badgeCat){
    const badges=completed.filter(o=>String(o.catId)===String(badgeCat.id));
    pins=badges.filter(o=>o.options&&o.options.toLowerCase().includes('pin')).length;
    mags=badges.filter(o=>o.options&&o.options.toLowerCase().includes('magnet')).length;
  }

  grid.innerHTML=`
    <div class="stats-card">
      <div class="stats-card-title">Order Status</div>
      ${[['Pending',pending.length,'var(--amber)'],['Printing',printing.length,'var(--blue)'],['Completed',completed.length,'var(--green)'],['Cancelled',cancelled.length,'var(--red)']].map(([l,v,c])=>`
        <div class="stat-break-row"><span class="stat-break-label">${l}</span><span class="stat-break-val" style="color:${c}">${v}</span></div>`).join('')}
    </div>
    <div class="stats-card">
      <div class="stats-card-title">Revenue (Completed)</div>
      ${paymentOptions.filter(p=>p.showRevenue&&!p.archived).map(p=>`
        <div class="stat-break-row"><span class="stat-break-label">${esc(p.name)}</span><span class="stat-break-val" style="color:var(--green)">$${(payRev[p.name]||0).toFixed(2)}</span></div>`).join('')}
      ${paymentOptions.filter(p=>!p.showRevenue&&!p.archived).map(p=>`
        <div class="stat-break-row"><span class="stat-break-label">${esc(p.name)}</span><span class="stat-break-val">${payBreak[p.name]||0}</span></div>`).join('')}
      <div class="stat-break-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">
        <span class="stat-break-label" style="font-weight:600;color:var(--text)">Total</span>
        <span class="stat-break-val" style="color:var(--accent);font-weight:600">$${Object.values(payRev).reduce((s,v)=>s+v,0).toFixed(2)}</span>
      </div>
    </div>
    <div class="stats-card">
      <div class="stats-card-title">Items by Category</div>
      ${Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>{
        const isBadge = badgeCat && name.toLowerCase()===badgeCat.name.toLowerCase();
        return `<div class="stat-break-row"><span class="stat-break-label">${esc(name)}</span><span class="stat-break-val">${count}</span></div>`+
          (isBadge && (pins||mags) ? `
            <div class="stat-break-row" style="padding-left:12px"><span class="stat-break-label" style="font-size:10px;color:var(--muted)">↳ Pin</span><span class="stat-break-val" style="font-size:11px">${pins}</span></div>
            <div class="stat-break-row" style="padding-left:12px"><span class="stat-break-label" style="font-size:10px;color:var(--muted)">↳ Magnet</span><span class="stat-break-val" style="font-size:11px">${mags}</span></div>` : '');
      }).join('')}
    </div>
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
  try{
    await sbReplace('colours', colours.map(c=>({id:c.id,name:c.name,code:c.code,available:c.available})));
    setStatus('ok','Colours saved · '+colours.length+' colours');
    closeColourModal();
  }catch(e){
    setStatus('err','Save failed: '+e.message);
  }
}

// ── Settings ───────────────────────────────────────────────
function loadAccent(){
  const s=localStorage.getItem('pd_accent');
  if(s){try{const p=JSON.parse(s);applyAccent(p.a,p.a2,false);}catch(e){}}
}
function applyAccent(a,a2,save=true){
  document.documentElement.style.setProperty('--accent',a);
  document.documentElement.style.setProperty('--accent2',a2);
  if(save){
    localStorage.setItem('pd_accent',JSON.stringify({a,a2}));
    savePreferences();
  }
}
function previewAccent(hex){
  const a2=darken(hex,0.18);
  applyAccent(hex,a2);
  // Deselect all swatches
  document.querySelectorAll('.accent-swatch-circle').forEach(s=>s.classList.remove('active'));
}
function darken(hex,amt){
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  r=Math.max(0,Math.round(r*(1-amt)));g=Math.max(0,Math.round(g*(1-amt)));b=Math.max(0,Math.round(b*(1-amt)));
  return'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function buildAccentSwatches(){
  const list = document.getElementById('cpl-accent-sel');
  if(!list) return;
  const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  // Clear existing options (keep the "none" entry)
  while(list.children.length > 1) list.removeChild(list.lastChild);
  const avail = colours.filter(c=>c.available);
  avail.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'cp-option' + (c.code.toLowerCase()===currentAccent.toLowerCase()?' selected':'');
    div.onclick = ()=>selectAccentColour(c.code, c.name, div);
    div.innerHTML = `<div class="cp-swatch" style="background:${esc(c.code)}"></div><span>${esc(c.name)}</span>`;
    list.appendChild(div);
  });
  // Update button label to show current selection
  const match = avail.find(c=>c.code.toLowerCase()===currentAccent.toLowerCase());
  const btn = document.getElementById('cpb-accent-sel');
  const swatch = document.getElementById('accent-sel-swatch');
  const label = document.getElementById('accent-sel-label');
  if(match){
    if(swatch) swatch.style.background = match.code;
    if(label) label.textContent = match.name;
  } else {
    if(swatch) swatch.style.background = currentAccent;
    if(label) label.textContent = 'Custom';
  }
}

function selectAccentColour(hex, name, el){
  if(!hex){ return; } // none selected — let custom picker handle it
  const a2=darken(hex,0.18);
  applyAccent(hex,a2);
  // Update picker button
  const swatch = document.getElementById('accent-sel-swatch');
  const label  = document.getElementById('accent-sel-label');
  if(swatch) swatch.style.background = hex;
  if(label)  label.textContent = name||hex;
  // Close dropdown
  const list = document.getElementById('cpl-accent-sel');
  if(list){ list.classList.remove('open'); list.style.display='none'; }
  // Update active state
  list?.querySelectorAll('.cp-option').forEach(o=>o.classList.remove('selected'));
  if(el) el.classList.add('selected');
  document.getElementById('customColour').value = hex;
}

// ── Notification settings ──────────────────────────────────
async function loadNotificationSettings(){
  try{
    const rows = await sbGet('app_settings', '?key=in.(notify_email,notify_daily_enabled,notify_threshold_enabled,notify_threshold_count)');
    const cfg = Object.fromEntries(rows.map(r=>[r.key, r.value]));
    document.getElementById('settingsNotifyEmail').value   = cfg.notify_email            || '';
    document.getElementById('settingsNotifyDaily').checked = cfg.notify_daily_enabled    === 'true';
    document.getElementById('settingsNotifyThreshold').checked = cfg.notify_threshold_enabled === 'true';
    document.getElementById('settingsNotifyCount').value   = cfg.notify_threshold_count  || '5';
  }catch(e){ console.warn('Could not load notification settings:', e); }
}

async function saveNotificationSettings(){
  const rows = [
    {key:'notify_email',              value: document.getElementById('settingsNotifyEmail').value.trim()},
    {key:'notify_daily_enabled',      value: String(document.getElementById('settingsNotifyDaily').checked)},
    {key:'notify_threshold_enabled',  value: String(document.getElementById('settingsNotifyThreshold').checked)},
    {key:'notify_threshold_count',    value: document.getElementById('settingsNotifyCount').value||'5'}
  ];
  for(const row of rows){
    await sbUpsert('app_settings', row);
  }
}

function openSettings(){
  if(currentUser){
    document.getElementById('settingsEmail').value=currentUser.email||'';
    document.getElementById('settingsName').value=currentUser.user_metadata?.display_name||'';
  }
  document.getElementById('settingsPassword').value='';
  document.getElementById('settingsPasswordConfirm').value='';
  document.getElementById('settingsPasswordError').style.display='none';
  buildAccentSwatches();
  const s=localStorage.getItem('pd_accent');
  if(s){try{document.getElementById('customColour').value=JSON.parse(s).a;}catch(e){}}
  renderPaymentSettings();
  loadNotificationSettings();
  document.getElementById('settingsModal').classList.add('open');
}

function renderPaymentSettings(){
  const el = document.getElementById('paymentOptionsList');
  if(!el) return;
  const usedNames = new Set(orders.map(o=>o.payment).filter(Boolean));
  el.innerHTML = paymentOptions.map((p,i)=>`
    <div class="payment-opt-row ${p.archived?'cat-archived':''}">
      <span class="payment-opt-name">${esc(p.name)}</span>
      ${p.showRevenue?'<span class="payment-opt-tag">Revenue</span>':''}
      <div style="display:flex;gap:4px;margin-left:auto">
        <button class="icon-btn" onclick="editPaymentOption(${i})" title="Edit"><i class="ti ti-edit"></i></button>
        ${usedNames.has(p.name)
          ? (p.archived
            ? `<button class="icon-btn" onclick="togglePaymentArchive(${i})" title="Unarchive"><i class="ti ti-archive-off"></i></button>`
            : `<button class="icon-btn" onclick="togglePaymentArchive(${i})" title="Archive"><i class="ti ti-archive"></i></button>`)
          : `<button class="icon-btn del" onclick="removePaymentOption(${i})" title="Delete"><i class="ti ti-trash"></i></button>`}
      </div>
    </div>`).join('');
}

function editPaymentOption(i){
  const p = paymentOptions[i];
  const name = prompt('Payment option name:', p.name);
  if(name===null) return;
  paymentOptions[i].name = name.trim()||p.name;
  savePaymentOptions();
  renderPaymentSettings();
  rebuildPaymentDropdowns();
}

function togglePaymentArchive(i){
  paymentOptions[i].archived = !paymentOptions[i].archived;
  savePaymentOptions();
  renderPaymentSettings();
}

function removePaymentOption(i){
  showConfirm('Delete this payment option?', () => {
    paymentOptions.splice(i,1);
    savePaymentOptions();
    renderPaymentSettings();
  });
}

function addPaymentOption(){
  const name = document.getElementById('newPaymentName').value.trim();
  if(!name){ alert('Enter a name.'); return; }
  const isRevenue = document.getElementById('newPaymentRevenue').checked;
  paymentOptions.push({name, archived:false, showRevenue:isRevenue});
  savePaymentOptions();
  document.getElementById('newPaymentName').value='';
  document.getElementById('newPaymentRevenue').checked=false;
  renderPaymentSettings();
  rebuildPaymentDropdowns();
}

function rebuildPaymentDropdowns(){
  const sel = document.getElementById('f-payment');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = getActivePaymentOptions()
    .map(p=>`<option value="${esc(p.name)}" ${p.name===cur?'selected':''}>${esc(p.name)}</option>`)
    .join('');
}

function closeSettings(){document.getElementById('settingsModal').classList.remove('open');}

async function applySettings(){
  const name     = document.getElementById('settingsName').value.trim();
  const email    = document.getElementById('settingsEmail').value.trim();
  const password = document.getElementById('settingsPassword').value;
  const confirm  = document.getElementById('settingsPasswordConfirm').value;
  const errEl    = document.getElementById('settingsPasswordError');
  errEl.style.display='none';

  if(password && password !== confirm){
    errEl.textContent='Passwords do not match.';
    errEl.style.display='';
    return;
  }
  if(password && password.length < 6){
    errEl.textContent='Password must be at least 6 characters.';
    errEl.style.display='';
    return;
  }

  const btn=document.getElementById('settingsSaveBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2"></i> Saving…';

  try{
    const token=getAccessToken();
    const updates={};
    if(email && email!==currentUser.email) updates.email=email;
    if(password) updates.password=password;
    if(name) updates.data={display_name:name};

    if(Object.keys(updates).length){
      const res=await fetch(sbAuthUrl('/user'),{
        method:'PUT',
        headers:{...sbAuthHeaders(),'Authorization':'Bearer '+token},
        body:JSON.stringify(updates)
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.msg||data.error_description||'Update failed');
      currentUser=data;
    }

    savePreferences();
    await saveNotificationSettings();
    closeSettings();
  }catch(e){
    errEl.textContent=e.message;
    errEl.style.display='';
  }finally{
    btn.disabled=false;btn.innerHTML='<i class="ti ti-check"></i> Save settings';
  }
}

// ── Status ─────────────────────────────────────────────────
function setStatus(state,msg){
  const el = document.getElementById('statusMsg');
  if(!el) return;
  el.textContent = msg;
  el.className = 'footer-status'+(state==='err'?' footer-status-err':state==='spin'?' footer-status-spin':'');
}

// ── Mobile detection ───────────────────────────────────────
// Mobile layout handled via CSS @media (max-width: 640px)

// Close colour picker dropdowns when clicking outside
document.addEventListener('click', e=>{
  if(!e.target.closest('.colour-picker-wrap')&&!e.target.closest('.colour-combo-option')){
    document.querySelectorAll('.colour-picker-list').forEach(el=>el.style.display='none');
  }
});

// ── Boot ───────────────────────────────────────────────────
loadAccent();

document.getElementById('setupBanner').style.display='none';
// Check for existing session
restoreSession().then(ok=>{
  if(ok){ showApp(); }
  else{
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('mainApp').style.display='none';
  }
});
