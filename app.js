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

// ── Delivery options config ──────────────────────────────
let deliveryOptions = JSON.parse(localStorage.getItem('pd_delivery_opts')||'null') || [
  {name:'Post',    archived:false, price:0, icon:'ti-mail'},
  {name:'Pick Up', archived:false, price:0, icon:'ti-hand-stop'}
];

const DELIVERY_ICON_PACK = [
  'ti-mail','ti-hand-stop','ti-truck-delivery','ti-package','ti-box',
  'ti-walk','ti-bike','ti-car','ti-plane','ti-ship','ti-train','ti-rocket',
  'ti-building-store','ti-home','ti-map-pin','ti-send','ti-forklift',
  'ti-parking','ti-door','ti-gift','ti-shopping-bag','ti-clock','ti-calendar-event'
];

function saveDeliveryOptions(){
  localStorage.setItem('pd_delivery_opts', JSON.stringify(deliveryOptions));
}

function getActiveDeliveryOptions(){
  return deliveryOptions.filter(d=>!d.archived);
}

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
      <div class="cat-block-hdr" onclick="toggleCatBlock(${realCi})">
        <i class="ti ti-chevron-right cat-chevron${isExpanded?' expanded':''}"></i>
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
                    class="opt-checkbox-sm">
                  Caps
                </label>
                <label class="opt-extra-label" title="Comma-separated values create multiple order items">
                  <input type="checkbox" ${o.multi_item?'checked':''} onchange="opts[${globalIdx}].multi_item=this.checked"
                    class="opt-checkbox-sm">
                  Multi
                </label>
              </div>`:''}
            </div>
            <label class="opt-extra-label" title="Show this option in the item sort menu">
              <input type="checkbox" ${o.sortable?'checked':''} onchange="opts[${globalIdx}].sortable=this.checked"
                class="opt-checkbox-sm">
              Sort
            </label>
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
          <i class="ti ti-plus icon-11"></i> Add option
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
  setStatus('spin','Saving…');populateCatFilter();
  try{
    await sbReplace('categories', cats.map(c=>({id:c.id,name:c.name,price:c.price,archived:c.archived||false})));
    await sbReplace('options', opts.map((o,i)=>({id:o.id,cat_id:o.catId,name:o.name,display:o.display,options:o.options,sort_order:i,num_colours:o.num_colours||4,force_caps:o.force_caps||false,multi_item:o.multi_item||false,sortable:o.sortable||false,archived:o.archived||false})));
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

async function loadUsers(){
  const el = document.getElementById('usersList');
  // Warn if service key not set
  if(!getCfg('SUPABASE_SERVICE_KEY')){
    el.innerHTML = `<div class="empty empty-warn">
      <i class="ti ti-alert-triangle"></i>
      <div class="service-key-hint">
        Service key not set. Run this in your browser console once:<br>
        <code class="service-key-code">
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
  return `<div class="user-row">
    <div class="user-row-main">
      <div class="user-avatar-circle">
        ${esc(name[0].toUpperCase())}
      </div>
      <div>
        <div class="user-row-name">${esc(name)}${isCurrentUser?' <span class="text-muted-10">(you)</span>':''}</div>
        <div class="text-muted-11">${esc(email)}</div>
        <div class="user-row-date${hasSignedIn?'':' text-amber'}">${dateLabel} ${dateVal}</div>
      </div>
    </div>
    <div class="user-row-actions">
      ${!hasSignedIn?`<button class="icon-btn" onclick="resendInvite('${escJsAttr(email)}',this)" title="Resend invite email"><i class="ti ti-mail-forward"></i></button>`:''}
      <button class="icon-btn" onclick="openEditUserForm('${esc(u.id)}','${escJsAttr(email)}','${escJsAttr(name)}')" title="Edit"><i class="ti ti-edit"></i></button>
      ${!isCurrentUser?`<button class="icon-btn del" onclick="deleteUser('${esc(u.id)}','${escJsAttr(name)}')" title="Delete"><i class="ti ti-trash"></i></button>`:''}
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
      el.innerHTML = '<div class="empty empty-success"><i class="ti ti-mail"></i> Invite sent to '+esc(email)+'</div>';
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


// ── Customer add/edit form (inline in the detail column) ────
let editingCustomerId = null;

function _customerFormHtml(){
  return '<div class="inbox-detail">'
    + '<div class="modal-title-row">'
    + '<div class="modal-title" id="cf-title">Add customer</div>'
    + '<div class="modal-title-actions">'
    + '<button class="btn" onclick="closeCustomerForm()">Cancel</button>'
    + '<button class="btn success" id="cf-save" onclick="saveCustomer()"><i class="ti ti-check"></i> Save</button>'
    + '</div>'
    + '</div>'
    + '<div class="field-row">'
    + '<div class="field"><label>Name *</label><input type="text" id="cf-name" placeholder="Full name"></div>'
    + '<div class="field"><label>Email</label><input type="email" id="cf-email" placeholder="optional"></div>'
    + '</div>'
    + '<div class="field-row">'
    + '<div class="field"><label>Phone</label><input type="tel" id="cf-phone" placeholder="optional"></div>'
    + '<div class="field"><label>Default address</label><input type="text" id="cf-address" placeholder="optional"></div>'
    + '</div>'
    + '<div class="field"><label>Notes</label><input type="text" id="cf-notes" placeholder="Any notes about this customer&hellip;"></div>'
    + '<div id="cf-error" class="field-error-text" style="display:none"></div>'
    + '</div>';
}

function openAddCustomer(){
  editingCustomerId = null;
  document.getElementById('inboxDetail').innerHTML = _customerFormHtml();
  document.getElementById('cf-name').focus();
  setTimeout(()=>attachGooglePlaces(document.getElementById('cf-address'), null), 50);
}

function openEditCustomer(id){
  const c = customers.find(c=>c.id===id);
  if(!c) return;
  editingCustomerId = id;
  document.getElementById('inboxDetail').innerHTML = _customerFormHtml();
  document.getElementById('cf-title').textContent='Edit customer';
  document.getElementById('cf-name').value=c.name;
  document.getElementById('cf-email').value=c.email;
  document.getElementById('cf-phone').value=c.phone;
  document.getElementById('cf-address').value=c.address;
  document.getElementById('cf-notes').value=c.notes;
  document.getElementById('cf-name').focus();
  setTimeout(()=>attachGooglePlaces(document.getElementById('cf-address'), null), 50);
}

function closeCustomerForm(){
  const id = editingCustomerId;
  editingCustomerId = null;
  if(id) _showCustomerDetail(id);
  else if(_selectedCustomerId) _showCustomerDetail(_selectedCustomerId);
  else document.getElementById('inboxDetail').innerHTML = '<div class="inbox-no-selection"><i class="ti ti-address-book"></i><p>Select a customer</p></div>';
}

function _refreshCustomersView(){
  if (typeof _sidebarView !== 'undefined' && _sidebarView === 'customers') {
    const filterEl = document.getElementById('customerViewSearch');
    _renderViewCustomers(filterEl ? filterEl.value : '');
    if (_selectedCustomerId) _showCustomerDetail(_selectedCustomerId);
  }
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
    const existing = editingCustomerId && customers.find(c=>c.id===editingCustomerId);
    const row = {
      id:      editingCustomerId||nextCustomerId(),
      name, email, phone, address, notes,
      archived: existing ? existing.archived : false
    };
    await sbUpsert('customers', row);
    if(editingCustomerId){
      const idx=customers.findIndex(c=>c.id===editingCustomerId);
      if(idx>=0) customers[idx]=row;
    } else {
      customers.push(row);
      customers.sort((a,b)=>a.name.localeCompare(b.name));
    }
    editingCustomerId = null;
    _selectedCustomerId = row.id;
    const filterEl = document.getElementById('customerViewSearch');
    _renderViewCustomers(filterEl ? filterEl.value : '');
    _showCustomerDetail(row.id);
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
      if (String(_selectedCustomerId) === String(id)) {
        _selectedCustomerId = null;
        const d = document.getElementById('inboxDetail');
        if (d) d.innerHTML = '<div class="inbox-no-selection"><i class="ti ti-address-book"></i><p>Select a customer</p></div>';
      }
      _refreshCustomersView();
    }catch(e){
      const msg = e.message&&e.message.includes('409')
        ? 'This customer is linked to orders and cannot be deleted.'
        : 'Delete failed: '+e.message;
      alert(msg);
    }
  });
}

async function archiveCustomer(id, name){
  showConfirm(`Archive customer "${name}"? They have existing orders, so they'll be moved to the bottom of the list instead of deleted.`, async () => {
    try{
      await sbPatch('customers', 'id=eq.'+encodeURIComponent(id), {archived:true});
      const c = customers.find(c=>c.id===id);
      if(c) c.archived = true;
      _refreshCustomersView();
    }catch(e){ alert('Archive failed: '+e.message); }
  }, {confirmLabel:'Archive', isDanger:false});
}

async function unarchiveCustomer(id){
  try{
    await sbPatch('customers', 'id=eq.'+encodeURIComponent(id), {archived:false});
    const c = customers.find(c=>c.id===id);
    if(c) c.archived = false;
    _refreshCustomersView();
  }catch(e){ alert('Restore failed: '+e.message); }
}

// ── Inventory item add/edit form (inline in the detail column) ──
let editingInventoryItemId = null;

// Suggests values already used on the "Backing" option field (e.g. Backing:Magnet)
// that don't yet have a matching inventory item — that's the field inventory actually
// consumes against, so it's the only one worth suggesting (skips Text/Colours noise).
function _inventoryCandidateNames(){
  const backingOptIds = new Set(opts.filter(o=>o.name.trim().toLowerCase()==='backing').map(o=>o.id));
  const existing = new Set(inventoryItems.map(i=>i.name.toLowerCase()));
  const candidates = new Set();
  orders.forEach(o=>{
    if(!o.options) return;
    o.options.split('||').forEach(part=>{
      const idx = part.indexOf(':');
      if(idx<0 || part.slice(0,idx).trim().toLowerCase()!=='backing') return;
      const val = part.slice(idx+1).trim();
      if(val && !existing.has(val.toLowerCase())) candidates.add(val);
    });
  });
  opts.forEach(o=>{
    if(!backingOptIds.has(o.id) || o.display!=='dropdown' || !o.options) return;
    o.options.split(',').forEach(v=>{
      v=v.trim();
      if(v && !existing.has(v.toLowerCase())) candidates.add(v);
    });
  });
  return Array.from(candidates).sort((a,b)=>a.localeCompare(b));
}

function _inventoryItemFormHtml(){
  return '<div class="inbox-detail">'
    + '<div class="modal-title-row">'
    + '<div class="modal-title" id="inv-title">Add inventory item</div>'
    + '<div class="modal-title-actions">'
    + '<button class="sort-btn-main" onclick="closeInventoryItemForm()">Cancel</button>'
    + '<button class="btn success" id="inv-save" onclick="saveInventoryItem()"><i class="ti ti-check"></i> Save</button>'
    + '</div>'
    + '</div>'
    + '<div class="field"><label>Name *</label><input type="text" id="inv-name" list="inv-name-suggestions" placeholder="e.g. Magnet">'
    + '<datalist id="inv-name-suggestions">' + _inventoryCandidateNames().map(function(n){return '<option value="'+esc(n)+'">';}).join('') + '</datalist>'
    + '</div>'
    + '<div class="field"><label>Notes</label><input type="text" id="inv-notes" placeholder="Any notes about this item&hellip;"></div>'
    + '<div id="inv-error" class="field-error-text" style="display:none"></div>'
    + '</div>';
}

function openAddInventoryItem(){
  editingInventoryItemId = null;
  document.getElementById('inboxDetail').innerHTML = _inventoryItemFormHtml();
  document.getElementById('inv-name').focus();
}

function openEditInventoryItem(id){
  const i = inventoryItems.find(x=>x.id===id);
  if(!i) return;
  editingInventoryItemId = id;
  document.getElementById('inboxDetail').innerHTML = _inventoryItemFormHtml();
  document.getElementById('inv-title').textContent = 'Edit inventory item';
  document.getElementById('inv-name').value = i.name;
  document.getElementById('inv-notes').value = i.notes;
  document.getElementById('inv-name').focus();
}

function closeInventoryItemForm(){
  const id = editingInventoryItemId;
  editingInventoryItemId = null;
  if(id) _showInventoryDetail(id);
  else if(_selectedInventoryItemId) _showInventoryDetail(_selectedInventoryItemId);
  else document.getElementById('inboxDetail').innerHTML = '<div class="inbox-no-selection"><i class="ti ti-package"></i><p>Select an inventory item</p></div>';
}

function _refreshInventoryView(){
  if (typeof _sidebarView !== 'undefined' && _sidebarView === 'inventory') {
    const filterEl = document.getElementById('inventoryViewSearch');
    _renderViewInventory(filterEl ? filterEl.value : '');
    if (_selectedInventoryItemId) _showInventoryDetail(_selectedInventoryItemId);
  }
}

async function saveInventoryItem(){
  const name  = document.getElementById('inv-name').value.trim();
  const notes = document.getElementById('inv-notes').value.trim();
  const errEl = document.getElementById('inv-error');
  const btn   = document.getElementById('inv-save');
  errEl.style.display='none';
  if(!name){ errEl.textContent='Name is required.'; errEl.style.display=''; return; }
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Saving…';
  try{
    const existing = editingInventoryItemId && inventoryItems.find(i=>i.id===editingInventoryItemId);
    const row = { id: editingInventoryItemId||nextInventoryItemId(), name, notes, archived: existing ? existing.archived : false };
    await sbUpsert('inventory_items', row);
    if(editingInventoryItemId){
      const idx=inventoryItems.findIndex(i=>i.id===editingInventoryItemId);
      if(idx>=0) inventoryItems[idx]=row;
    } else {
      inventoryItems.push(row);
      inventoryItems.sort((a,b)=>a.name.localeCompare(b.name));
    }
    editingInventoryItemId = null;
    _selectedInventoryItemId = row.id;
    const filterEl = document.getElementById('inventoryViewSearch');
    _renderViewInventory(filterEl ? filterEl.value : '');
    _showInventoryDetail(row.id);
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='';
  }finally{
    btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i> Save';
  }
}

function deleteInventoryItem(id, name){
  showConfirm(`Delete inventory item "${name}"?`, async () => {
    try{
      await sbDelete('inventory_items','id=eq.'+encodeURIComponent(id));
      inventoryItems=inventoryItems.filter(i=>i.id!==id);
      if (String(_selectedInventoryItemId) === String(id)) {
        _selectedInventoryItemId = null;
        const d = document.getElementById('inboxDetail');
        if (d) d.innerHTML = '<div class="inbox-no-selection"><i class="ti ti-package"></i><p>Select an inventory item</p></div>';
      }
      _refreshInventoryView();
    }catch(e){
      const msg = e.message&&e.message.includes('409')
        ? 'This item has stock history and cannot be deleted.'
        : 'Delete failed: '+e.message;
      alert(msg);
    }
  });
}

async function archiveInventoryItem(id, name){
  showConfirm(`Archive inventory item "${name}"? It has stock history, so it'll be moved to the bottom of the list instead of deleted.`, async () => {
    try{
      await sbPatch('inventory_items', 'id=eq.'+encodeURIComponent(id), {archived:true});
      const i = inventoryItems.find(i=>i.id===id);
      if(i) i.archived = true;
      _refreshInventoryView();
    }catch(e){ alert('Archive failed: '+e.message); }
  }, {confirmLabel:'Archive', isDanger:false});
}

async function unarchiveInventoryItem(id){
  try{
    await sbPatch('inventory_items', 'id=eq.'+encodeURIComponent(id), {archived:false});
    const i = inventoryItems.find(i=>i.id===id);
    if(i) i.archived = false;
    _refreshInventoryView();
  }catch(e){ alert('Restore failed: '+e.message); }
}

// ── Inventory stock receiving (inline log entry form) ────────
let _editingReceiptId = null;

function showReceiptForm(){
  _editingReceiptId = null;
  const panel = document.getElementById('inv-receipt-form');
  if(!panel) return;
  panel.style.display = '';
  document.getElementById('rcpt-date').value = todayISO();
  document.getElementById('rcpt-qty').value = '';
  document.getElementById('rcpt-cost').value = '';
  document.getElementById('rcpt-save').innerHTML = '<i class="ti ti-check"></i> Log receipt';
  document.getElementById('rcpt-qty').focus();
}

function openEditReceiptForm(receiptId){
  const r = inventoryReceipts.find(x=>x.id===receiptId);
  if(!r) return;
  _editingReceiptId = receiptId;
  const panel = document.getElementById('inv-receipt-form');
  if(!panel) return;
  panel.style.display = '';
  document.getElementById('rcpt-date').value = r.date;
  document.getElementById('rcpt-qty').value = r.qty;
  document.getElementById('rcpt-cost').value = r.cost || '';
  document.getElementById('rcpt-save').innerHTML = '<i class="ti ti-check"></i> Save changes';
  document.getElementById('rcpt-qty').focus();
}

function hideReceiptForm(){
  _editingReceiptId = null;
  const panel = document.getElementById('inv-receipt-form');
  if(panel) panel.style.display = 'none';
}

async function saveInventoryReceipt(itemId){
  const qty  = parseFloat(document.getElementById('rcpt-qty').value)||0;
  const cost = parseFloat(document.getElementById('rcpt-cost').value)||0;
  const date = document.getElementById('rcpt-date').value || todayISO();
  const errEl = document.getElementById('rcpt-error');
  if(qty<=0){ errEl.textContent='Enter a quantity received.'; errEl.style.display=''; return; }
  errEl.style.display='none';
  const btn = document.getElementById('rcpt-save');
  const editingId = _editingReceiptId;
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Saving…';
  try{
    const row = { id: editingId || nextInventoryReceiptId(), item_id: itemId, qty, cost, date };
    await sbUpsert('inventory_receipts', row);
    if(editingId){
      const idx = inventoryReceipts.findIndex(r=>r.id===editingId);
      if(idx>=0) inventoryReceipts[idx] = normaliseInventoryReceipt(row);
    } else {
      inventoryReceipts.push(normaliseInventoryReceipt(row));
    }
    _editingReceiptId = null;
    _showInventoryDetail(itemId);
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='';
  }finally{
    btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i> Log receipt';
  }
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
        <div class="customer-avatar customer-avatar-sm">${esc(c.name[0]?.toUpperCase()||'?')}</div>
        <div>
          <div class="text-12">${esc(c.name)}</div>
          ${c.email?`<div class="text-muted-10">${esc(c.email)}</div>`:''}
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
      const fontPath = _badgeAssetCache?.fontPath || 'badge/LEGO.TTF';
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
    s.onload = res; s.onerror = () => rej(new Error('Failed to load script: ' + src)); document.head.appendChild(s);
  });
  await load('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js');
  await load('https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js');
  await load('https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js');
  await load('badge/3mf.js');
  _badge3mfReady = true;
}

async function _loadBadgeAssets() {
  if (_badgeAssetCache) return _badgeAssetCache;
  const [models, tmpl] = await Promise.all([
    sbGet('badge_models', '?archived=eq.false&order=name&limit=1'),
    fetch('badge/project_settings_template.json').then(r => r.json()).catch(() => null),
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
    wordSpacing: s.word_spacing || 0,
    fontPath:  model.font_path || 'badge/LEGO.TTF',
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
    const result = generate3MF({ name, layerConfig, backing: _kc ? null : backing, font: _badgeFont, fsize: assets.fsize, spacing: assets.spacing, wordSpacing: assets.wordSpacing, projectSettingsTemplate: assets.projectSettingsTemplate, keychain: _kc });
    entries.push({ name: fnMap.next(rawName, backingStr), data: result.zip });
  }
  return { entries, skipped };
}

// opentype.js and script-load failures don't always reject with a real Error
// (sometimes a bare string or Event) — normalise so error UI never shows "undefined".
function _errMsg(e) { return (e && e.message) || String(e) || 'Unknown error'; }

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
    _batchShowError(_errMsg(e));
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
    _batchShowError(_errMsg(e));
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
      fsize: assets.fsize, spacing: assets.spacing, wordSpacing: assets.wordSpacing,
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
    setStatus('err', 'Badge failed: ' + _errMsg(e));
  }
}

// ── Colours modal ─────────────────────────────────────────
// Colour names referenced by any completed order's colour-type option
// values — used to block permanently deleting a colour that's part of
// historical order data (offer Archive instead, same pattern as categories).
function usedColourNames(){
  const used=new Set();
  orders.filter(o=>o.status==='Complete').forEach(o=>{
    if(!o.options) return;
    o.options.split('||').forEach(part=>{
      const idx=part.indexOf(':'); if(idx<0) return;
      const fieldName=part.slice(0,idx).trim();
      const opt=opts.find(op=>op.name===fieldName && (op.display==='colour'||op.name.toLowerCase().includes('colour')||op.name.toLowerCase().includes('color')));
      if(!opt) return;
      part.slice(idx+1).split('|').map(s=>s.trim()).filter(Boolean).forEach(name=>used.add(name.toLowerCase()));
    });
  });
  return used;
}

function renderColourList(){
  const used=usedColourNames();
  document.getElementById('colourList').innerHTML=colours.map((c,i)=>{
    const isUsed=used.has((c.name||'').toLowerCase());
    const delBtn = c.archived
      ? `<button class="icon-btn" onclick="unarchiveColour(${i})" title="Unarchive"><i class="ti ti-archive-off"></i></button>`
      : isUsed
        ? `<button class="icon-btn" onclick="archiveColour(${i})" title="Archive — used in completed orders"><i class="ti ti-archive"></i></button>`
        : `<button class="icon-btn del" onclick="removeColour(${i})"><i class="ti ti-trash"></i></button>`;
    return `
    <div class="colour-row${c.archived?' colour-archived':''}">
      <div class="colour-swatch" style="background:${esc(c.code||'#cccccc')}"></div>
      <input type="text" value="${esc(c.name)}" placeholder="Colour name" oninput="colours[${i}].name=this.value" ${c.archived?'disabled':''}>
      <div class="colour-hex-wrap">
        <input type="text" value="${esc(c.code||'#cccccc')}" placeholder="#000000" maxlength="7"
          oninput="colours[${i}].code=this.value;updateSwatch(${i},this.value)" ${c.archived?'disabled':''}>
        <button class="copy-hex-btn" onclick="copyHex('${esc(c.code||'')}',this)" title="Copy hex code"><i class="ti ti-copy"></i></button>
      </div>
      <div class="avail-check"><input type="checkbox" ${(c.available===true||String(c.available).toLowerCase()==='true'||c.available==='TRUE'||c.available===1)?'checked':''} onchange="colours[${i}].available=this.checked" title="Available" ${c.archived?'disabled':''}></div>
      ${delBtn}
    </div>`;
  }).join('');
}

function archiveColour(i){colours[i].archived=true;renderColourList();}
function unarchiveColour(i){colours[i].archived=false;renderColourList();}

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
  colours.push({id:nextColourId(),name:'',code:'#cccccc',available:true,archived:false});
  renderColourList();
}
function removeColour(i){colours.splice(i,1);renderColourList();}

async function saveColours(){
  setStatus('spin','Saving colours…');
  try{
    await sbReplace('colours', colours.map(c=>({id:c.id,name:c.name,code:c.code,available:c.available,archived:c.archived||false})));
    setStatus('ok','Colours saved · '+colours.length+' colours');
  }catch(e){
    setStatus('err','Save failed: '+e.message);
  }
}

// ── Notification settings ──────────────────────────────────
async function loadNotificationSettings(){
  try{
    const rows = await sbGet('app_settings', '?key=in.(notify_email,notify_daily_enabled,notify_threshold_enabled,notify_threshold_count,notify_threshold_last_sent)');
    const cfg = Object.fromEntries(rows.map(r=>[r.key, r.value]));
    document.getElementById('settingsNotifyEmail').value   = cfg.notify_email            || '';
    document.getElementById('settingsNotifyDaily').checked = cfg.notify_daily_enabled    === 'true';
    document.getElementById('settingsNotifyThreshold').checked = cfg.notify_threshold_enabled === 'true';
    document.getElementById('settingsNotifyCount').value   = cfg.notify_threshold_count  || '5';
    var lastSentEl = document.getElementById('settingsNotifyLastSent');
    if (lastSentEl) {
      var ts = cfg.notify_threshold_last_sent;
      lastSentEl.textContent = ts ? new Date(ts).toLocaleString('en-AU', {dateStyle:'medium',timeStyle:'short'}) : 'Never';
    }
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
  if(!e.target.closest('.icon-picker-wrap')){
    document.querySelectorAll('.icon-picker-list').forEach(el=>el.style.display='none');
  }
  if(!e.target.closest('.layer-swatch-wrap')){
    document.querySelectorAll('.layer-swatch-picker').forEach(el=>el.style.display='none');
  }
  if(!e.target.closest('#detailFilterWrap')){const p=document.getElementById('detailFilterPanel');if(p)p.style.display='none';}
  if(!e.target.closest('#detailSortWrap')){const p=document.getElementById('detailSortPanel');if(p)p.style.display='none';}
});

// ── Boot ───────────────────────────────────────────────────
document.getElementById('setupBanner').style.display='none';
if(DEV_MODE){
  currentUser = {id:'dev-user', email:'dev@example.com', user_metadata:{display_name:'Dev User'}};
  showApp();
} else {
  // Check for existing session
  restoreSession().then(ok=>{
    if(ok){ showApp(); }
    else{
      document.getElementById('loginScreen').style.display='flex';
      document.getElementById('mainApp').style.display='none';
    }
  });
}
