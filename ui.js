// ── Custom status dropdown ─────────────────────────────────
function toggleStatusDd(rowId, btn){
  // Close all other open dropdowns
  document.querySelectorAll('.status-dd-list.open').forEach(el=>{
    if(el.id !== 'sdd-'+rowId) el.classList.remove('open');
  });
  const list = document.getElementById('sdd-'+rowId);
  if(!list) return;
  if(list.classList.contains('open')){
    list.classList.remove('open');
    return;
  }
  // Position using fixed coords relative to the button
  const rect = btn.getBoundingClientRect();
  list.style.top  = (rect.bottom + 4) + 'px';
  list.style.left = (rect.left + rect.width/2) + 'px';
  list.style.transform = 'translateX(-50%)';
  list.classList.add('open');
}

function selectStatus(orderId, rowId, newStatus, optEl){
  // Close the dropdown
  const list = document.getElementById('sdd-'+rowId);
  if(list) list.classList.remove('open');
  // Update button appearance
  const wrap = list?.closest('.status-dd-wrap');
  const btn  = wrap?.querySelector('.status-dd-btn');
  if(btn){
    btn.className = 'status-dd-btn b-'+newStatus.toLowerCase().replace(' ','-');
    btn.innerHTML = newStatus + ' <i class="ti ti-chevron-down"></i>';
  }
  // Update active dot
  list?.querySelectorAll('.status-dd-opt').forEach(o=>{
    o.classList.toggle('active', o.textContent.trim()===newStatus);
  });
  // Update data and save
  updateStatus(orderId, rowId, newStatus, btn);
}

// Close dropdowns when clicking outside
document.addEventListener('click', e=>{
  if(!e.target.closest('.status-dd-wrap')){
    document.querySelectorAll('.status-dd-list.open').forEach(el=>el.classList.remove('open'));
  }
});

async function selectOrderStatus(orderId, newStatus, optEl){
  const list = document.getElementById('sdd-order-'+orderId);
  if(list) list.classList.remove('open');
  const btn = list?.closest('.status-dd-wrap')?.querySelector('.status-dd-btn');
  if(btn){ btn.className='status-dd-btn order-status-dd b-'+newStatus.toLowerCase().replace(' ','-'); btn.innerHTML='<span>'+newStatus+'</span><i class="ti ti-chevron-down"></i>'; }
  list?.querySelectorAll('.status-dd-opt').forEach(o=>o.classList.toggle('active',o.textContent.trim()===newStatus));
  const rows = orders.filter(r=>String(r.orderId)===String(orderId));
  for(const row of rows){ row.status=newStatus; }
  renderTable();
  try{
    await sbUpsert('orders', rows.map(row=>({id:row.id,order_id:row.orderId,customer:row.customer,customer_id:row.customer_id||null,address:row.address,delivery:row.delivery,payment:row.payment,cat_id:row.catId,qty:row.qty,price:row.price,total:row.total,status:newStatus,date:row.date,notes:row.notes,options:row.options})));
    if(newStatus==='Complete') await _consumeInventoryForOrder(rows);
    setStatus('ok','All items updated');
  }catch(e){ setStatus('err','Save failed'); }
}

// ── Status breadcrumb (read-only Detail view) ───────────────
// On Hold / Cancelled aren't part of the forward flow — they're only
// set/cleared from the Edit Order form, and show as a plain badge here.
const STATUS_FLOW = ['Pending','Confirmed','Printed','Complete'];
const STATUS_FLOW_VAR = {Pending:'--amber',Confirmed:'--blue',Printed:'--teal',Complete:'--green'};

function _buildStatusBreadcrumb(orderId, status){
  if(status==='On Hold' || status==='Cancelled'){
    return '<div class="status-badge-plain b-' + status.toLowerCase().replace(' ','-') + '">' + status + '</div>';
  }
  const currentIdx = STATUS_FLOW.indexOf(status);
  return '<div class="status-breadcrumb">' + STATUS_FLOW.map((s, i) => {
    const role = i < currentIdx ? 'sbc-previous' : (i === currentIdx ? 'sbc-current' : 'sbc-future');
    return '<div class="status-breadcrumb-step ' + role + '" style="--sbc-color:var(' + STATUS_FLOW_VAR[s] + ')"'
      + ' onclick="confirmStatusStep(\'' + esc(String(orderId)) + '\',\'' + s + '\')">' + s + '</div>';
  }).join('') + '</div>';
}

function confirmStatusStep(orderId, newStatus){
  const rows = orders.filter(r=>String(r.orderId)===String(orderId));
  if(!rows.length || rows[0].status===newStatus) return;
  showConfirm('Set this order to "' + newStatus + '"? This applies to all items in the order.', function(){
    selectOrderStatus(orderId, newStatus);
  }, {confirmLabel:'Set to '+newStatus, isDanger:false});
}

// ── Render table ───────────────────────────────────────────

function uniqueOrderCount(){return new Set(orders.map(o=>o.orderId)).size;}

function orderNumFromId(orderId) {
  // Strip O prefix and leading zeros: O0000000007 → #7, O0000000042 → #42
  // Falls back to showing the raw id if format doesn't match
  const m = String(orderId).match(/^O?0*(\d+)$/);
  return m ? '#' + m[1] : '#' + orderId;
}

function toggleSearchClear(){
  const el = document.getElementById('searchClear');
  if(el) el.style.display = document.getElementById('search').value ? 'flex' : 'none';
}
function renderTable(){
  const q = document.getElementById('search').value.toLowerCase();
  const fStatuses = getFilterValues('status');
  const fCats     = getFilterValues('cat');
  const fPays     = getFilterValues('pay');

  let list=orders.filter(o=>{
    if(fStatuses.length&&!fStatuses.includes(o.status||'Pending'))return false;
    if(fCats.length&&!fCats.includes(String(o.catId)))return false;
    if(fPays.length&&!fPays.includes(o.payment||''))return false;
    if(q){
      // Search: customer name, notes, and text option values only
      const textOptVals = o.options ? o.options.split('||')
        .filter(p=>{ const name=p.split(':')[0]?.trim();
          const opt=opts.find(opt=>opt.name===name&&opt.display==='text');
          return !!opt; })
        .map(p=>p.split(':').slice(1).join(':').trim())
        .join(' ') : '';
      const searchable = [o.customer, o.notes, textOptVals].join(' ').toLowerCase();
      if(!searchable.includes(q)) return false;
    }
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

  if(!list.length){renderInboxList([]);return;}

  renderInboxList(list);
}

function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// ponytail: for free-text passed as a '...'-quoted JS argument inside an onclick="" attribute —
// esc() alone isn't enough there since a raw apostrophe (e.g. "O'Brien") terminates the JS string early.
function escJsAttr(s){return esc(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"));}
function sortBy(k){
  if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=-1;}
  savePreferences();
  updateSortUI();
  renderTable();
}
// ── Address autocomplete (Google Maps Places) ─────────────
function initAutocomplete(){
  const input = document.getElementById('f-address');
  if(acInst) return;
  acInst = true;
  attachGooglePlaces(input, document.getElementById('addrTick'));
}

function attachGooglePlaces(input, tickEl){
  if(!input || input.dataset.gmaps) return;
  if(typeof google === 'undefined' || !google.maps?.places){
    // Google Maps not loaded yet — retry after delay
    setTimeout(()=>attachGooglePlaces(input, tickEl), 500);
    return;
  }
  input.dataset.gmaps = '1';
  const ac = new google.maps.places.Autocomplete(input, {
    types: ['address'],
    componentRestrictions: { country: 'au' }
  });
  ac.addListener('place_changed', ()=>{
    const place = ac.getPlace();
    if(place && place.formatted_address){
      input.value = place.formatted_address;
      if(tickEl){ input.classList.add('validated'); tickEl.style.display=''; }
    }
  });
}


// ── Model rows ─────────────────────────────────────────────
function catOptions(selId){
  let html='<option value="">— select —</option>';
  cats.filter(c=>!c.archived).forEach(c=>{html+=`<option value="${c.id}" ${String(c.id)===String(selId)?'selected':''}>${esc(c.name)}</option>`;});
  return html;
}

// Get options for a given catId
function getCatOpts(catId){return opts.filter(o=>String(o.catId)===String(catId)&&!o.archived);}

// Render option fields for a model row
function renderModelOpts(idx, catId, savedOpts){
  const catOpts=getCatOpts(catId);
  const container=document.getElementById('mo-'+idx);
  if(!container)return;
  if(!catOpts.length){container.innerHTML='';return;}
  // Parse saved options: "FieldName:value||FieldName:value" (double pipe separates fields)
  const saved={};
  if(savedOpts){savedOpts.split('||').forEach(p=>{const[k,...v]=p.split(':');if(k)saved[k.trim()]=v.join(':').trim();});}
  const isBadgeCat=!!(cats.find(c=>String(c.id)===String(catId))?.name?.toLowerCase().includes('name badge'));
  container.innerHTML=catOpts.map(opt=>{
    const val=saved[opt.name]||'';
    if(opt.display==='text'){
      const capsStyle=opt.force_caps?'text-transform:uppercase':'';
      const badgeCheck=isBadgeCat?`;badgeWidthCheck(${idx})`:'';
      const multiCheck=opt.multi_item?`;updateMultiBadge('ov-${idx}-${opt.id}','mb-${idx}-${opt.id}')`:''
      const capsHandler=opt.force_caps?`this.value=this.value.toUpperCase();collectOpts(${idx})${badgeCheck}${multiCheck}`:`collectOpts(${idx})${badgeCheck}${multiCheck}`;
      const warnDiv=isBadgeCat?`<div class="badge-width-warn" id="bww-${idx}" style="display:none"></div>`:'';
      const multiBadge=opt.multi_item?`<span class="multi-item-badge" id="mb-${idx}-${opt.id}" style="display:none"></span>`:'';
      const inputVal=esc(opt.force_caps&&val?val.toUpperCase():val);
      const capsClass=opt.force_caps?' opt-text-uppercase':'';
      return`<div class="opt-row"><label>${esc(opt.name)}</label><div class="opt-text-input-wrap"><input type="text" class="opt-text-input${capsClass}" id="ov-${idx}-${opt.id}" value="${inputVal}" placeholder="Enter ${esc(opt.name).toLowerCase()}… or comma-separate for multiple" oninput="${capsHandler}">${multiBadge}</div></div>${warnDiv}`;
    } else {
      // dropdown
      const items=opt.options.split(',').map(s=>s.trim()).filter(Boolean);
      const isColourOpt = opt.display==='colour' ||
        opt.name.toLowerCase().includes('colour') ||
        opt.name.toLowerCase().includes('color');
      const numColours = opt.num_colours || 4;

      // For colour opts: pipe-separated value = saved combo key (not Custom)
      let isCustom, ddVal, customVal;
      if(isColourOpt && val && val.includes('|') && !val.startsWith('Custom:')){
        // Pipe-separated colour names — treat as saved combo
        isCustom  = false;
        ddVal     = val;   // the key is the pipe-separated names
        customVal = '';
      } else {
        isCustom  = val==='Custom'||(!items.includes(val)&&val!==''&&!isColourOpt);
        ddVal     = isCustom?'Custom':(val||'');
        customVal = isCustom?val:'';
      }

      const opts_html=items.map(it=>`<option${ddVal===it?' selected':''}>${esc(it)}</option>`).join('');
      if(isColourOpt){
        const savedCombos=getSavedColourCombos();
        const comboOptions=savedCombos.map(combo=>{
          const label=combo.layers.map(l=>l.name).join(' / ');
          const key=combo.key;
          return `<option value="${esc(key)}" ${ddVal===key?'selected':''}>${esc(label)}</option>`;
        }).join('');
        const selectHtml=`<select class="flex-fill-input" id="ov-${idx}-${opt.id}" onchange="colourOptChanged(${idx},'${opt.id}',this.value)">
          <option value="">— select —</option>
          <option value="Custom" ${ddVal==='Custom'?'selected':''}>✦ Custom (choose ${numColours} colours)</option>
          ${savedCombos.length?`<optgroup label="── Saved combinations ──">${comboOptions}</optgroup>`:''}
        </select>`;
        const rowHtml=`<div class="opt-row"><label>${esc(opt.name)}</label>`+
          `<div class="opt-row-colour-inline">${selectHtml}`+
          `<div class="opt-custom" id="ovc-${idx}-${opt.id}" data-iscolour="1" style="${ddVal==='Custom'?'':'display:none'}"></div>`+
          `</div></div>`;
        if(ddVal==='Custom') setTimeout(()=>renderLayerSelectors(idx,opt.id,customVal),0);
        else if(ddVal&&ddVal!=='Custom') setTimeout(()=>applyComboToLayers(idx,opt.id,ddVal),0);
        return rowHtml;
      }
      const customContent=`<input type="text" id="ovt-${idx}-${opt.id}" value="${esc(customVal)}" placeholder="Describe your custom option…" oninput="collectOpts(${idx})">`;
      const isBacking=isBadgeCat&&opt.name.toLowerCase()==='backing';
      const ddOnChange=isBacking?`ddChanged(${idx},'${opt.id}');badgeWidthCheck(${idx})`:`ddChanged(${idx},'${opt.id}')`;
      const rowHtml=`<div class="opt-row"><label>${esc(opt.name)}</label><select id="ov-${idx}-${opt.id}" onchange="${ddOnChange}"><option value="">— select —</option>${opts_html}</select></div>`+
        `<div class="opt-custom" id="ovc-${idx}-${opt.id}" data-iscolour="0" style="${ddVal==='Custom'?'':'display:none'}">${customContent}</div>`;
      return rowHtml;
    }
  }).join('');
  // Run width check immediately when editing an existing badge order
  if(isBadgeCat && savedOpts) setTimeout(()=>badgeWidthCheck(idx), 100);
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
  return colours.filter(c=>c.available);
}

function buildColourPicker(id, selectedName, onChangeFn){
  const avail = availableColours();
  const sel   = avail.find(c=>c.name===selectedName);
  const swatchBg = sel ? sel.code : 'transparent';
  const label    = sel ? sel.name : '— none —';
  return `<div class="colour-picker-wrap" id="cpw-${id}">
    <div class="colour-picker-btn" onclick="toggleColourPicker('${id}')" id="cpb-${id}">
      <div class="cp-swatch" style="--sw:${swatchBg}"></div>
      <span class="cp-label">${esc(label)}</span>
      <i class="ti ti-chevron-down cp-arrow"></i>
    </div>
    <div class="colour-picker-list" id="cpl-${id}" style="display:none">
      <div class="cp-none" onclick="selectColour('${id}','',${onChangeFn})" >— none —</div>
      ${avail.map(c=>`
        <div class="cp-option ${c.name===selectedName?'selected':''}" onclick="selectColour('${id}','${escJsAttr(c.name)}',${onChangeFn})">
          <div class="cp-swatch" style="--sw:${esc(c.code)}"></div>
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
  const opt = opts.find(o=>String(o.id)===String(optId));
  const numLayers = opt?.num_colours || 4;
  container.innerHTML = Array.from({length:numLayers},(_,i)=>i+1).map(n=>{
    const pickerId=`lp-${idx}-${optId}-${n}`;
    const savedName=saved['Layer '+n]||'';
    const onChangeFn=`function(v){collectOpts(${idx});}`;
    return buildLayerSwatch(pickerId, savedName, n, onChangeFn);
  }).join('');
}

function buildLayerSwatch(id, selectedName, layerNum, onChangeFn){
  const avail = availableColours();
  const sel   = avail.find(c=>c.name===selectedName);
  const swatchBg = sel ? sel.code : 'transparent';
  const label    = sel ? sel.name : '— none —';
  return `<div class="layer-swatch-wrap" id="cpw-${id}" data-value="${esc(selectedName||'')}">
    <button type="button" class="layer-swatch-btn" style="--sw:${swatchBg}" data-tt="Layer ${layerNum}: ${esc(label)}" onclick="event.stopPropagation();toggleLayerSwatchPicker('${id}',this)"></button>
    <div class="layer-swatch-picker" id="lsp-${id}" style="display:none">
      <button type="button" class="layer-swatch-opt layer-swatch-opt-none" data-name="" data-tt="— none —" onclick="selectLayerSwatch('${id}','',${onChangeFn})"></button>
      ${avail.map(c=>`<button type="button" class="layer-swatch-opt${c.name===selectedName?' selected':''}" style="--sw:${esc(c.code)}" data-name="${esc(c.name)}" data-tt="${esc(c.name)}" onclick="selectLayerSwatch('${id}','${escJsAttr(c.name)}',${onChangeFn})"></button>`).join('')}
    </div>
  </div>`;
}

function toggleLayerSwatchPicker(id, btn){
  document.querySelectorAll('.layer-swatch-picker').forEach(el=>{ if(el.id!=='lsp-'+id) el.style.display='none'; });
  const list=document.getElementById('lsp-'+id);
  if(!list) return;
  if(list.style.display!=='none'){ list.style.display='none'; return; }
  const rect=btn.getBoundingClientRect();
  const listWidth=6*28+12;
  list.style.left=Math.min(rect.left, window.innerWidth-listWidth-8)+'px';
  list.style.top=(rect.bottom+4)+'px';
  list.style.display='grid';
}

function selectLayerSwatch(id, name, onChangeFn){
  const avail=availableColours();
  const c=avail.find(c=>c.name===name);
  const wrap=document.getElementById('cpw-'+id);
  const btn=wrap?wrap.querySelector('.layer-swatch-btn'):null;
  if(btn){ btn.style.background=c?c.code:'transparent'; btn.dataset.tt=c?('Layer: '+c.name):'Layer: — none —'; }
  const list=document.getElementById('lsp-'+id);
  if(list){
    list.querySelectorAll('.layer-swatch-opt').forEach(el=>el.classList.toggle('selected', el.dataset.name===name));
    list.style.display='none';
  }
  if(wrap) wrap.dataset.value=name;
  if(typeof onChangeFn==='function') onChangeFn(name);
}

function getColourCode(name){
  if(!name)return'transparent';
  const c=colours.find(c=>c.name===name);
  return c?c.code:'transparent';
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
    // Apply force_caps for text fields
    if(opt.display==='text' && opt.force_caps && val) val=val.toUpperCase();

    if(isColOpt){
      // For colour opts: read from the native select
      if(val==='Custom'){
        // Collect layer values as simple pipe-separated colour names
        const container=document.getElementById('ovc-'+idx+'-'+opt.id);
        if(container&&container.dataset.iscolour==='1'){
          const numLayers=opt.num_colours||4;
          const layers=Array.from({length:numLayers},(_,i)=>i+1).map(n=>{
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
    <button type="button" class="rm-btn-corner" onclick="removeModel(this)" title="Remove Item"><i class="ti ti-trash"></i></button>
    <div class="model-row-top">
      <div class="opt-row"><label>Category</label><select id="mc-${idx}" onchange="catChanged(${idx})">${catOptions(d.catId)}</select></div>
      <div class="prefix-input-wrap"><span>×</span><input type="number" class="ns-init" id="mq-${idx}" value="${d.qty||1}" min="1" oninput="calcTotal()"></div>
      <div class="prefix-input-wrap"><span>$</span><input type="number" class="ns-init" id="mp-${idx}" value="${d.price?Number(d.price).toFixed(2):''}" step="0.01" min="0" placeholder="0.00" oninput="calcTotal()"></div>
    </div>
    <div class="model-options" id="mo-${idx}"></div>
    <div class="opt-row opt-row-notes">
      <label>Notes</label>
      <div class="opt-row-notes-inner">
        <input type="text" class="flex-fill-input" id="mn-${idx}" value="${esc(d.notes||'')}" placeholder="Item notes (colour, material, special requests…)">
        <span class="total-label">Total</span>
        <div class="total-val" id="mt-${idx}">—</div>
      </div>
    </div>
    <input type="hidden" id="mm-${idx}" value="${esc(d.model||'')}">
    <input type="hidden" id="opts-${idx}" value="${esc(d.options||'')}">`;
  const container=document.getElementById('modelRows');
  if(d.catId) container.appendChild(el); else container.prepend(el);
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

function filterModelRows(q){
  const lower=(q||'').toLowerCase().trim();
  document.querySelectorAll('#modelRows .model-row').forEach(row=>{
    if(!lower){row.style.display='';return;}
    // Match against category name, text input values, notes
    const catSel=row.querySelector('select[id^="mc-"]');
    const catText=catSel?catSel.options[catSel.selectedIndex]?.text||'':'';
    const textInputs=Array.from(row.querySelectorAll('input[type=text],input[type=number][id^="mq-"]'));
    const allText=(catText+' '+textInputs.map(i=>i.value).join(' ')+' '+row.querySelector('input[id^="mn-"]')?.value||'').toLowerCase();
    row.style.display=allText.includes(lower)?'':'none';
  });
}

function _updateItemFilter(){
  const count=document.querySelectorAll('#modelRows .model-row').length;
  const wrap=document.getElementById('itemFilterWrap');
  const f=document.getElementById('itemFilter');
  if(!wrap||!f)return;
  if(count>5){wrap.style.display='';} else {wrap.style.display='none';f.value='';filterModelRows('');}
}

function calcTotal(){
  let t=0;
  document.querySelectorAll('.model-row').forEach(r=>{
    const i=r.dataset.idx;
    const qty=parseFloat(document.getElementById('mq-'+i)?.value)||0;
    const price=parseFloat(document.getElementById('mp-'+i)?.value)||0;
    const rowTotal=qty*price;
    t+=rowTotal;
    const rowTotalEl=document.getElementById('mt-'+i);
    if(rowTotalEl) rowTotalEl.textContent=price?'$'+rowTotal.toFixed(2):'—';
  });
  const deliveryName=document.getElementById('f-delivery')?.value;
  const deliveryOpt=deliveryOptions.find(d=>d.name===deliveryName);
  if(deliveryOpt) t+=deliveryOpt.price;
  document.getElementById('orderTotal').textContent='$'+t.toFixed(2);
  _updateItemFilter();
}
function removeModel(btn){
  if(document.querySelectorAll('.model-row').length<=1){
    if(!editOId){closeModal();return;}
    const customer=document.getElementById('f-customer').value.trim()||'this order';
    showConfirm(`This is the last item. Delete the entire order for "${customer}"?`,()=>{
      showTypeConfirm(
        `Type the customer name to confirm permanently deleting this order:\n\n"${customer}"`,
        customer,
        ()=>{
          const orderId=editOId;
          closeModal();
          _deleteOrderWithUndo(orderId);
        }
      );
    },{confirmLabel:'Delete Order',isDanger:true});
    return;
  }
  const row=btn.closest('.model-row');
  showConfirm('Remove this item from the order?',()=>{row.remove();calcTotal();},{confirmLabel:'Remove',isDanger:true});
}

let _typeConfirmCallback=null,_typeConfirmExpected='';
function showTypeConfirm(msg,expected,onConfirm){
  _typeConfirmCallback=onConfirm;
  _typeConfirmExpected=expected.trim().toLowerCase();
  document.getElementById('typeConfirmMsg').textContent=msg;
  document.getElementById('typeConfirmInput').value='';
  document.getElementById('typeConfirmInput').placeholder=expected;
  document.getElementById('typeConfirmOk').disabled=true;
  document.getElementById('typeConfirmDialog').classList.add('open');
  setTimeout(()=>document.getElementById('typeConfirmInput').focus(),80);
}
function typeConfirmCheck(){
  const val=document.getElementById('typeConfirmInput').value.trim().toLowerCase();
  document.getElementById('typeConfirmOk').disabled=(val!==_typeConfirmExpected);
}
function typeConfirmSubmit(){
  const cb=_typeConfirmCallback;
  closeTypeConfirm();
  cb&&cb();
}
function closeTypeConfirm(){
  document.getElementById('typeConfirmDialog').classList.remove('open');
  _typeConfirmCallback=null;_typeConfirmExpected='';
}
function updateMultiBadge(inputId, badgeId){
  const input=document.getElementById(inputId);
  const badge=document.getElementById(badgeId);
  if(!input||!badge)return;
  const parts=input.value.split(',').map(s=>s.trim()).filter(Boolean);
  if(parts.length>1){
    badge.textContent='× '+parts.length+' items';
    badge.style.display='inline-block';
  } else {
    badge.style.display='none';
  }
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

// ── Order edit form (inline in the detail pane) ─────────────
function _orderFormHtml(){
  return '<div class="inbox-detail">'
    + '<div class="modal-title-row">'
    + '<div class="modal-title" id="modalTitle">New Order</div>'
    + '<div class="modal-title-actions">'
    + '<button class="btn" onclick="closeModal()">Cancel</button>'
    + '<button class="btn success" id="saveBtn" onclick="saveOrder()"><i class="ti ti-check"></i> Save Order</button>'
    + '</div>'
    + '<input type="hidden" id="f-date">'
    + '</div>'
    + '<div class="field-row">'
    + '<div class="field">'
    + '<label>Customer name</label>'
    + '<div class="field-pos-relative">'
    + '<input id="f-customer" type="text" placeholder="Search existing or type a new name&hellip;" autocomplete="off" oninput="this.closest(\'.field\').classList.remove(\'field-error\');this.closest(\'.field\').querySelector(\'.field-error-msg\')?.remove()">'
    + '<div id="customerSuggestions" class="colour-picker-list customer-suggestions-pos" style="display:none"></div>'
    + '</div>'
    + '<input type="hidden" id="f-customer-id">'
    + '</div>'
    + '<div class="field"><label>Delivery type</label><select id="f-delivery" onchange="calcTotal()"></select></div>'
    + '</div>'
    + '<div id="newCustomerPanel" class="new-customer-panel" style="display:none">'
    + '<div class="new-customer-panel-title"><i class="ti ti-user-plus"></i>New customer — add details</div>'
    + '<div class="field-row">'
    + '<div class="field"><label>Email</label><input type="email" id="nc-email" placeholder="optional"></div>'
    + '<div class="field"><label>Phone</label><input type="tel" id="nc-phone" placeholder="optional"></div>'
    + '</div>'
    + '<div class="field"><label>Notes</label><input type="text" id="nc-notes" placeholder="Any notes about this customer&hellip;"></div>'
    + '</div>'
    + '<div class="field-row">'
    + '<div class="field">'
    + '<label>Address / Location</label>'
    + '<div class="addr-wrap">'
    + '<div class="field-pos-relative field-flex-1">'
    + '<input id="f-address" type="text" placeholder="Address or location note&hellip;" autocomplete="off" oninput="this.closest(\'.field\').classList.remove(\'field-error\');this.closest(\'.field\').querySelector(\'.field-error-msg\')?.remove()">'
    + '<i class="ti ti-map-pin-check addr-tick" id="addrTick"></i>'
    + '</div>'
    + '<button class="btn icon-only addr-refresh-btn" id="addrRefreshBtn" onclick="revertToCustomerAddress()" title=""><i class="ti ti-refresh"></i></button>'
    + '</div>'
    + '<div class="field-hint">Select a suggestion for a validated address, or type any location note freely.</div>'
    + '</div>'
    + '<div class="field"><label>Payment</label><select id="f-payment"></select></div>'
    + '</div>'
    + '<div class="field-row" id="f-holdstatus-row" style="display:none">'
    + '<div class="field"><label>Order status override</label>'
    + '<select id="f-holdstatus"><option value="">Normal workflow (Pending → Complete)</option><option value="On Hold">On Hold</option><option value="Cancelled">Cancelled</option></select>'
    + '</div>'
    + '</div>'
    + '<div class="modal-actions">'
    + '<div class="order-total-inline"><span class="order-total-lbl">Total</span><span class="order-total-val" id="orderTotal">$0.00</span></div>'
    + '<div class="flex-1"></div>'
    + '<div class="order-date-plain"><label>Order Date</label><div class="order-date-val" id="f-date-display"></div></div>'
    + '</div>'
    + '<div class="models-section">'
    + '<div class="models-hdr">'
    + '<span class="models-label">Items</span>'
    + '<div class="inbox-search-row item-filter-wrap-pos" id="itemFilterWrap" style="display:none">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" id="itemFilter" placeholder="Filter items…" oninput="filterModelRows(this.value)">'
    + '</div>'
    + '<button class="btn success sm" onclick="addModelRow()"><i class="ti ti-plus"></i> Add item</button>'
    + '</div>'
    + '<div class="model-rows" id="modelRows"></div>'
    + '</div>'
    + '</div>';
}

function openAddModal(){
  editOId=null;acInst=null;
  document.getElementById('inboxDetail').innerHTML=_orderFormHtml();
  document.getElementById('modalTitle').textContent='New Order';
  document.getElementById('f-customer').value='';
  document.getElementById('f-customer-id').value='';
  document.getElementById('f-address').value='';
  document.getElementById('f-address').classList.remove('validated');
  document.getElementById('addrTick').style.display='none';
  // Build delivery dropdown from config
  const fDelivery = document.getElementById('f-delivery');
  fDelivery.innerHTML = getActiveDeliveryOptions().map(d=>`<option value="${esc(d.name)}">${esc(d.name)} - $${d.price.toFixed(2)}</option>`).join('');
  fDelivery.value = getActiveDeliveryOptions()[0]?.name||'Post';
  // Build payment dropdown from config
  const fPayment = document.getElementById('f-payment');
  fPayment.innerHTML = getActivePaymentOptions().map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  fPayment.value = getActivePaymentOptions()[0]?.name||'No';
  document.getElementById('newCustomerPanel').style.display='none';
  document.getElementById('f-holdstatus-row').style.display='none';
  updateAddrRefreshBtn();
  const today=todayDMY();
  document.getElementById('f-date').value=today;
  document.getElementById('f-date-display').textContent=today;
  document.getElementById('modelRows').innerHTML='';mCounter=0;
  const _if=document.getElementById('itemFilter');if(_if)_if.value='';
  const _ifw=document.getElementById('itemFilterWrap');if(_ifw)_ifw.style.display='none';
  addModelRow();
  setTimeout(()=>{document.getElementById('f-customer').focus();initAutocomplete();initCustomerAutocomplete();},80);
}

function openEdit(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);if(!rows.length)return;
  editOId=orderId;acInst=null;const first=rows[0];
  document.getElementById('inboxDetail').innerHTML=_orderFormHtml();
  document.getElementById('modalTitle').textContent='Edit Order';
  document.getElementById('f-customer').value=first.customer;
  document.getElementById('f-customer-id').value=first.customer_id||'';
  // Auto-show new customer panel for orders not yet linked to a customer record
  document.getElementById('newCustomerPanel').style.display = first.customer_id ? 'none' : '';
  document.getElementById('f-holdstatus-row').style.display='';
  document.getElementById('f-holdstatus').value = (first.status==='On Hold'||first.status==='Cancelled') ? first.status : '';
  updateAddrRefreshBtn();
  updateCustomerBorder();
  document.getElementById('f-address').value=first.address||'';
  if(first.address){document.getElementById('f-address').classList.add('validated');document.getElementById('addrTick').style.display='';}
  else{document.getElementById('f-address').classList.remove('validated');document.getElementById('addrTick').style.display='none';}
  const fDelivery2 = document.getElementById('f-delivery');
  fDelivery2.innerHTML = getActiveDeliveryOptions().map(d=>`<option value="${esc(d.name)}">${esc(d.name)} - $${d.price.toFixed(2)}</option>`).join('');
  fDelivery2.value = first.delivery||getActiveDeliveryOptions()[0]?.name||'Post';
  const fPayment2 = document.getElementById('f-payment');
  fPayment2.innerHTML = getActivePaymentOptions().map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  fPayment2.value = first.payment||getActivePaymentOptions()[0]?.name||'No';
  const d=toDisplay(first.date);
  document.getElementById('f-date').value=d;
  document.getElementById('f-date-display').textContent=d;
  document.getElementById('modelRows').innerHTML='';mCounter=0;
  const _if2=document.getElementById('itemFilter');if(_if2)_if2.value='';
  const _ifw2=document.getElementById('itemFilterWrap');if(_ifw2)_ifw2.style.display='none';
  rows.forEach(r=>addModelRow({model:r.model,catId:r.catId,qty:r.qty,price:r.price,notes:r.notes,options:r.options}));
  setTimeout(()=>{initAutocomplete();initCustomerAutocomplete();},80);
}

function closeModal(){
  if(editOId){
    showInboxDetail(editOId);
  } else if(_inboxSelectedOrderId){
    showInboxDetail(_inboxSelectedOrderId);
  } else {
    document.getElementById('inboxDetail').innerHTML='<div class="inbox-no-selection"><i class="ti ti-inbox"></i><p>Select an order to view its details</p></div>';
  }
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
      catSel&&catSel.closest('.opt-row')&&catSel.closest('.opt-row').classList.add('field-error');
      rowHasError=true;errors.push('cat-'+idx);
    }

    // Qty > 0
    const qtyEl=document.getElementById('mq-'+idx);
    const qty=parseInt(qtyEl?.value)||0;
    if(qty<=0){
      qtyEl&&qtyEl.closest('.prefix-input-wrap')&&qtyEl.closest('.prefix-input-wrap').classList.add('field-error');
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
          const numC2=opt.num_colours||4;
          Array.from({length:numC2},(_,i)=>i+1).forEach(n=>{
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
  // If new customer panel is open, create the customer first
  if(document.getElementById('newCustomerPanel')?.style.display!=='none'){
    await createCustomerInline();
  }
  const errors=validateOrder();
  if(errors.length){
    // Scroll to first error
    const firstErr=document.querySelector('.field-error,.row-error');
    if(firstErr)firstErr.scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  if(busy)return;
  // If new customer panel is open, create the customer first
  if(document.getElementById('newCustomerPanel')?.style.display!=='none'){
    await createCustomerInline();
  }
  const customer=document.getElementById('f-customer').value.trim();
  const rawModels=getModelData();
  // Expand multi-item rows (pairwise on comma-separated values)
  const models=[];
  for(const m of rawModels){
    const catOpts=getCatOpts(m.catId).filter(o=>o.multi_item&&o.display==='text');
    if(!catOpts.length){models.push(m);continue;}
    const parts=m.options?m.options.split('||'):[];
    const splits=catOpts.map(o=>{
      const part=parts.find(p=>p.startsWith(o.name+':'));
      const val=part?part.slice(o.name.length+1).trim():'';
      return{name:o.name,values:val.split(',').map(s=>s.trim()).filter(Boolean)};
    });
    const count=Math.max(...splits.map(s=>s.values.length),1);
    for(let j=0;j<count;j++){
      const newParts=parts.map(p=>{
        const colon=p.indexOf(':');
        const k=colon>=0?p.slice(0,colon):'';
        const sp=splits.find(s=>s.name===k.trim());
        if(sp&&sp.values.length){return k+':'+sp.values[Math.min(j,sp.values.length-1)];}
        return p;
      });
      models.push({...m,options:newParts.join('||')});
    }
  }
  const orderId=editOId||nextOrderId();
  const date=document.getElementById('f-date').value;
  const delivery=document.getElementById('f-delivery').value;
  const payment=document.getElementById('f-payment').value;
  // Save whatever is in the address box — validated or not
  const address=document.getElementById('f-address').value.trim();
  const customerId = document.getElementById('f-customer-id').value||'';
  const newRows=models.map((m,i)=>({
    id:makeRowId(orderId, i),orderId,customer,customer_id:customerId,address,delivery,payment,
    model:m.model,catId:m.catId,qty:m.qty,price:m.price,
    total:parseFloat((m.qty*m.price).toFixed(2)),
    status:'Pending',date,notes:m.notes,options:m.options,
    printed:false,paid:false,inv_consumed:false
  }));
  // When editing preserve the existing status/printed/inv_consumed (per item) and paid (per order)
  const holdStatus = document.getElementById('f-holdstatus')?.value || '';
  if(editOId){
    const existingPaid = orders.find(o=>o.orderId===editOId)?.paid||false;
    newRows.forEach(nr=>{
      nr.paid = existingPaid;
      const existing=orders.find(o=>o.orderId===editOId&&o.model===nr.model);
      if(existing){ nr.status=existing.status; nr.printed=existing.printed; nr.inv_consumed=existing.inv_consumed; }
    });
    if(holdStatus){
      newRows.forEach(nr=>{ nr.status = holdStatus; });
    } else {
      // Reverting away from On Hold/Cancelled back to normal workflow
      newRows.forEach(nr=>{ if(nr.status==='On Hold'||nr.status==='Cancelled') nr.status='Pending'; });
    }
  }
  busy=true;
  const btn=document.getElementById('saveBtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2"></i> Saving…';
  setStatus('spin','Saving…');_inboxSelectedOrderId=orderId;
  orders=orders.filter(o=>o.orderId!==orderId);
  orders.unshift(...newRows);renderTable();
  try{
    if(editOId) await sbDelete('orders', 'order_id=eq.'+encodeURIComponent(editOId));
    for(const row of newRows){
      await sbUpsert('orders', {
        id: row.id, order_id: row.orderId, customer: row.customer,
        customer_id: row.customer_id||null,
        address: row.address, delivery: row.delivery, payment: row.payment,
        cat_id: row.catId, qty: row.qty,
        price: row.price, total: row.total, status: row.status,
        date: row.date, notes: row.notes, options: row.options,
        printed: row.printed, paid: row.paid, inv_consumed: row.inv_consumed
      });
    }
    if(editOId && !holdStatus) await _maybeAdvanceStatus(orderId);
    setStatus('ok','Saved · '+uniqueOrderCount()+' orders');
  }catch(e){setStatus('err','Save failed: '+e.message);}
  finally{busy=false;btn.disabled=false;btn.innerHTML='<i class="ti ti-check"></i> Save Order';}
}

async function updateStatus(orderId,rowId,newStatus,sel){
  // sel may be the custom btn or legacy select — disable during save
  if(sel) sel.disabled=true;
  // Find row by id
  const row=orders.find(o=>String(o.id)===String(rowId));
  if(!row){sel.disabled=false;return;}
  const prevStatus=row.status;
  // Update local state
  row.status=newStatus;
  try{
    // Update status via Supabase upsert
    await sbUpsert('orders', {
      id: row.id, order_id: row.orderId, customer: row.customer,
      customer_id: row.customer_id||null,
      address: row.address, delivery: row.delivery, payment: row.payment,
      cat_id: row.catId, qty: row.qty,
      price: row.price, total: row.total, status: newStatus,
      date: row.date, notes: row.notes, options: row.options
    });
    setStatus('ok','Status updated');
    renderTable();
  }catch(e){
    // Revert on failure
    row.status=prevStatus;
    if(sel){ sel.className=(sel.classList.contains('status-dd-btn')?'status-dd-btn':'status-select')+' b-'+prevStatus.toLowerCase().replace(' ','-'); }
    setStatus('err','Update failed: '+e.message);
    alert('Status save failed: '+e.message);
  }finally{
    sel.disabled=false;
    sel.dataset.prev=newStatus;
  }
}

// ── Printed / Paid tracking ─────────────────────────────────
async function toggleItemPrinted(rowId, checked){
  const row = orders.find(o=>String(o.id)===String(rowId));
  if(!row) return;
  row.printed = checked;
  try{
    await sbPatch('orders', 'id=eq.'+encodeURIComponent(row.id), {printed: checked});
  }catch(e){
    row.printed = !checked;
    setStatus('err','Save failed: '+e.message);
    renderTable();
    return;
  }
  await _maybeAdvanceStatus(row.orderId);
  renderTable();
}

async function toggleOrderPaid(orderId, checked){
  const rows = orders.filter(r=>String(r.orderId)===String(orderId));
  if(!rows.length) return;
  rows.forEach(r=>r.paid=checked);
  try{
    await sbPatch('orders', 'order_id=eq.'+encodeURIComponent(orderId), {paid: checked});
  }catch(e){
    rows.forEach(r=>r.paid=!checked);
    setStatus('err','Save failed: '+e.message);
    renderTable();
    return;
  }
  await _maybeAdvanceStatus(orderId);
  renderTable();
}

// Matches each row's option values (e.g. "Backing:Magnet") against inventory item
// names by exact text — no explicit linking needed, just name the item to match.
// Guarded by row.inv_consumed so re-processing an already-Complete order never
// double-counts stock usage.
async function _consumeInventoryForOrder(rows){
  for(const row of rows){
    if(row.inv_consumed || !row.options) continue;
    const values = row.options.split('||').map(p=>p.includes(':')?p.split(':').slice(1).join(':').trim():'').filter(Boolean);
    for(const value of values){
      const item = inventoryItems.find(i=>i.name.toLowerCase()===value.toLowerCase());
      if(!item) continue;
      const rec = {id: nextInventoryConsumptionId(), item_id: item.id, order_id: row.orderId, qty: row.qty, date: todayISO()};
      try{
        await sbUpsert('inventory_consumption', rec);
        inventoryConsumption.push(normaliseInventoryConsumption(rec));
      }catch(e){ /* non-fatal — don't block the status update over a logging failure */ }
    }
    row.inv_consumed = true;
    try{ await sbPatch('orders', 'id=eq.'+encodeURIComponent(row.id), {inv_consumed:true}); }catch(e){}
  }
}

// Forward-only auto-advance: Pending/Confirmed -> Printed -> Complete, once every
// item is printed and/or the order is paid. Never auto-downgrades — On Hold,
// Cancelled and Complete are left alone, and any correction is a manual status change.
async function _maybeAdvanceStatus(orderId){
  const rows = orders.filter(r=>String(r.orderId)===String(orderId));
  if(!rows.length) return;
  const status = rows[0].status;
  if(['On Hold','Cancelled','Complete'].includes(status)) return;
  const allPrinted = rows.every(r=>r.printed);
  const paid = rows[0].paid;
  let next=null;
  if(status==='Printed' && paid) next='Complete';
  else if((status==='Pending'||status==='Confirmed') && allPrinted) next = paid?'Complete':'Printed';
  if(!next) return;
  rows.forEach(r=>r.status=next);
  try{
    await sbPatch('orders', 'order_id=eq.'+encodeURIComponent(orderId), {status: next});
    if(next==='Complete') await _consumeInventoryForOrder(rows);
    setStatus('ok', 'Status advanced to '+next);
  }catch(e){
    setStatus('err','Save failed: '+e.message);
  }
}

function printShippingLabel(customer, address, orderId){
  const lines = address.split(/,\s*|\n/).map(s=>s.trim()).filter(Boolean);
  const addrHtml = lines.map(l=>`<div>${l}</div>`).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Shipping Label</title>
<style>
  @page{size:100mm 150mm;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;width:100mm;height:150mm;padding:6mm;display:flex;flex-direction:column;gap:4mm}
  .from-block{border:1.5px solid #000;padding:3mm 4mm;font-size:9pt}
  .from-label{font-size:7pt;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#555;margin-bottom:1mm}
  .from-name{font-weight:700;font-size:10pt}
  .divider{border:none;border-top:2px solid #000}
  .to-block{flex:1;border:1.5px solid #000;padding:3mm 4mm;display:flex;flex-direction:column;justify-content:center}
  .to-label{font-size:7pt;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#555;margin-bottom:2mm}
  .to-name{font-size:15pt;font-weight:700;margin-bottom:2mm}
  .to-addr{font-size:11pt;line-height:1.5}
  .order-ref{text-align:right;font-size:7.5pt;color:#555;margin-top:auto;padding-top:2mm}
</style>
</head><body>
  <div class="from-block">
    <div class="from-label">From</div>
    <div class="from-name">PrintDesk</div>
  </div>
  <div class="to-block">
    <div class="to-label">To</div>
    <div class="to-name">${customer}</div>
    <div class="to-addr">${addrHtml}</div>
    <div class="order-ref">Order ${orderId}</div>
  </div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;
  const w=window.open('','_blank','width=400,height=600');
  if(w){w.document.write(html);w.document.close();}
}

function deleteOrder(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);
  if(!rows.length)return;
  const customer=rows[0].customer||'this order';
  showTypeConfirm(
    `Type the customer name to confirm permanently deleting this order:\n\n"${customer}"`,
    customer,
    ()=>_deleteOrderWithUndo(orderId)
  );
}

// ── Soft delete: optimistic remove + a few seconds to undo before the
// actual DELETE call fires. Shared by the header Delete button and the
// remove-last-item flow.
const UNDO_GRACE_MS=7000;
let _pendingOrderDeletes={};

function _deleteOrderWithUndo(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);
  if(!rows.length)return;
  const customer=rows[0].customer||'Order';
  orders=orders.filter(o=>o.orderId!==orderId);
  if(String(_inboxSelectedOrderId)===String(orderId)){
    _inboxSelectedOrderId=null;
    const detail=document.getElementById('inboxDetail');
    if(detail)detail.innerHTML='<div class="inbox-no-selection"><i class="ti ti-inbox"></i><p>Select an order to view its details</p></div>';
  }
  renderTable();
  const timeoutId=setTimeout(async()=>{
    delete _pendingOrderDeletes[orderId];
    setStatus('spin','Deleting…');
    try{
      await sbDelete('orders','order_id=eq.'+encodeURIComponent(orderId));
      setStatus('ok','Deleted · '+uniqueOrderCount()+' orders');
    }catch(e){setStatus('err','Delete failed: '+e.message);}
  },UNDO_GRACE_MS);
  _pendingOrderDeletes[orderId]={timeoutId,rows};
  _showUndoToast(customer+' deleted',()=>_undoOrderDelete(orderId));
}

function _undoOrderDelete(orderId){
  const pending=_pendingOrderDeletes[orderId];
  if(!pending)return;
  clearTimeout(pending.timeoutId);
  delete _pendingOrderDeletes[orderId];
  orders.push(...pending.rows);
  renderTable();
  setStatus('ok','Restored · '+uniqueOrderCount()+' orders');
}

let _undoToastFn=null,_undoToastHideTimer=null;
function _showUndoToast(msg,undoFn){
  _undoToastFn=undoFn;
  const toast=document.getElementById('undoToast');
  if(!toast)return;
  document.getElementById('undoToastMsg').textContent=msg;
  toast.style.display='flex';
  clearTimeout(_undoToastHideTimer);
  _undoToastHideTimer=setTimeout(()=>{toast.style.display='none';},UNDO_GRACE_MS);
}
function _undoToastAction(){
  if(_undoToastFn)_undoToastFn();
  _undoToastFn=null;
  clearTimeout(_undoToastHideTimer);
  const toast=document.getElementById('undoToast');
  if(toast)toast.style.display='none';
}

// ── Categories modal ───────────────────────────────────────
// ── Combined Categories + Options modal ──────────────────

// ── Filter panel ───────────────────────────────────────────
function populateCatFilter(){
  const catEl = document.getElementById('filterCatChecks');
  if(catEl){
    catEl.innerHTML = cats.filter(c=>!c.archived).map(c=>`
      <label class="filter-check">
        <input type="checkbox" data-filter="cat" value="${esc(c.id)}" checked onchange="renderTable();updateFilterCount()">
        ${esc(c.name)}
      </label>`).join('');
  }
  const payEl = document.getElementById('filterPayChecks');
  if(payEl){
    payEl.innerHTML = paymentOptions.filter(p=>!p.archived).map(p=>`
      <label class="filter-check">
        <input type="checkbox" data-filter="pay" value="${esc(p.name)}" checked onchange="renderTable();updateFilterCount()">
        ${esc(p.name)}
      </label>`).join('');
  }
}

function getFilterValues(filter){
  const all   = document.querySelectorAll(`[data-filter="${filter}"]`);
  const checked = document.querySelectorAll(`[data-filter="${filter}"]:checked`);
  // If all ticked or none exist — no filter applied (show all)
  if(all.length === 0 || all.length === checked.length) return [];
  return Array.from(checked).map(el=>el.value);
}

function updateFilterCount(){
  // Count only groups where not everything is ticked (i.e. something is filtered out)
  let count = 0;
  ['status','cat','pay'].forEach(filter=>{
    const all     = document.querySelectorAll(`[data-filter="${filter}"]`);
    const checked = document.querySelectorAll(`[data-filter="${filter}"]:checked`);
    if(all.length > 0 && all.length !== checked.length) count++;
  });
  const badge = document.getElementById('filterCount');
  const btn   = document.getElementById('filterBtn');
  if(badge){ badge.textContent=count; badge.style.display=count?'':'none'; }
  if(btn) btn.style.borderColor = count ? 'var(--accent)' : '';
}

function toggleFilterPanel(e){
  e.stopPropagation();
  const panel = document.getElementById('filterPanel');
  const btn   = document.getElementById('filterBtn');
  if(!panel) return;
  if(panel.style.display !== 'none'){
    panel.style.display = 'none';
    return;
  }
  // Close sort panel if open
  const sortPanel = document.getElementById('sortPanel');
  if(sortPanel) sortPanel.style.display = 'none';
  const rect = btn.getBoundingClientRect();
  panel.style.top  = (rect.bottom + 6) + 'px';
  panel.style.left = rect.left + 'px';
  panel.style.display = '';
}

document.addEventListener('click', e=>{
  if(!e.target.closest('#filterWrap')){
    const panel = document.getElementById('filterPanel');
    if(panel) panel.style.display = 'none';
  }
});

// ── Sort panel ─────────────────────────────────────────────
const SORT_OPTIONS = [
  {key:'orderId',  label:'Order #'},
  {key:'customer', label:'Customer'},
  {key:'catId',    label:'Category'},
  {key:'status',   label:'Status'},
];

function buildSortPanel(){
  const panel = document.getElementById('sortPanel');
  if(!panel) return;
  const optHtml = SORT_OPTIONS.map(o=>`
    <div class="sort-option${sortKey===o.key?' active':''}" onclick="setSortKey('${o.key}')">
      ${o.label}
    </div>`).join('');
  panel.innerHTML = '<div class="filter-section-title">Sort by</div>' + optHtml;
}

function toggleSortPanel(e){
  e.stopPropagation();
  const panel = document.getElementById('sortPanel');
  const btn   = document.getElementById('sortBtn');
  if(!panel) return;
  if(panel.style.display !== 'none'){ panel.style.display='none'; return; }
  // Close filter panel if open
  const filterPanel = document.getElementById('filterPanel');
  if(filterPanel) filterPanel.style.display = 'none';
  buildSortPanel();
  const rect = document.getElementById('sortWrap').getBoundingClientRect();
  panel.style.top  = (rect.bottom + 6) + 'px';
  panel.style.left = Math.max(8, rect.right - 190) + 'px';
  panel.style.display = '';
}

function setSortKey(key){
  sortKey = key;
  savePreferences();
  updateSortUI();
  renderTable();
  document.getElementById('sortPanel').style.display = 'none';
}

function toggleSortDir(){
  sortDir *= -1;
  savePreferences();
  updateSortUI();
  renderTable();
}

function updateSortUI(){
  const icon  = document.getElementById('sortDirIcon');
  const group = document.querySelector('.sort-btn-group');
  const btn   = document.getElementById('sortBtn');
  if(icon) icon.className = sortDir === 1 ? 'ti ti-arrow-up' : 'ti ti-arrow-down';
  // Update sort button label to show current sort
  const opt = SORT_OPTIONS.find(o=>o.key===sortKey);
  if(btn && opt) btn.innerHTML = `<i class="ti ti-arrows-sort"></i> ${opt.label}`;
}

document.addEventListener('click', e=>{
  if(!e.target.closest('#sortWrap')){
    const panel = document.getElementById('sortPanel');
    if(panel) panel.style.display = 'none';
  }
});


// -- Inbox view -----------------------------------------------------
let _inboxSelectedOrderId = null;
let _inboxTab = 'all';

function setInboxTab(tab) {
  _inboxTab = tab;
  document.querySelectorAll('.inbox-tab-pill').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  renderTable();
}

function _avatarColor(name) {
  const stock = (typeof colours!=='undefined' ? colours : []).filter(c=>c.available).map(c=>c.code);
  const palette = stock.length ? stock : ['#5b9cf6','#5cb87a','#e8a93a','#e07c3a','#9b8af6','#e05c5c','#3ab8b8','#c47ab8'];
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function _initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[p.length-1][0]).toUpperCase() : name[0].toUpperCase();
}

function renderInboxList(list) {
  if (_sidebarView !== 'orders') return;
  const el = document.getElementById('inboxList');
  if (!el) return;

  const orderIds = [];
  const orderMap = new Map();
  list.forEach(row => {
    const oid = String(row.orderId);
    if (!orderMap.has(oid)) { orderIds.push(oid); orderMap.set(oid, []); }
    orderMap.get(oid).push(row);
  });

  if (!orderIds.length) {
    el.innerHTML = '<div class="inbox-empty-state"><i class="ti ti-inbox"></i>No orders</div>';
    _inboxClearDetailIfGone(orderIds);
    return;
  }

  el.innerHTML = orderIds.map(oid => {
    const rows = orderMap.get(oid);
    const first = rows[0];
    const deliveryCost = deliveryOptions.find(d => d.name === first.delivery)?.price || 0;
    const total = rows.reduce((s, r) => s + r.total, 0) + deliveryCost;
    const status = first.status || 'Pending';
    const blClass = 'bl-' + status.toLowerCase().replace(' ', '-');
    const bClass = 'b-' + status.toLowerCase().replace(' ', '-');
    const isSelected = oid === String(_inboxSelectedOrderId);
    const itemQtys = new Map();
    rows.forEach(r => {
      const cat = cats.find(c => String(c.id) === String(r.catId));
      const name = cat ? cat.name : '?';
      itemQtys.set(name, (itemQtys.get(name) || 0) + (r.qty || 1));
    });
    const paidLabel = '<span class="inbox-card-paid ' + (first.paid ? 'text-green' : 'text-red') + '">' + (first.paid ? 'Paid' : 'Unpaid') + '</span>';
    const itemLines = [...itemQtys.entries()].map(([name, qty], i) =>
      '<div class="inbox-card-item-line"><span class="inbox-card-item-name">' + esc(name) + '</span><span class="inbox-card-item-qty">x ' + qty + '</span>' + (i===0 ? paidLabel : '') + '</div>'
    ).join('');
    return '<div class="inbox-card ' + blClass + (isSelected ? ' selected' : '') + '" onclick="showInboxDetail(\'' + esc(oid) + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1">'
      + '<span class="inbox-card-customer">' + (esc(first.customer) || '?') + '</span>'
      + '<span class="inbox-card-status ' + bClass + '">' + status + '</span>'
      + '</div>'
      + '<div class="inbox-card-items">' + itemLines + '</div>'
      + '<div class="inbox-card-footer">'
      + '<span>' + esc(first.delivery || 'Post') + '</span>'
      + '<span class="inbox-card-total">$' + total.toFixed(2) + '</span>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  _inboxClearDetailIfGone(orderIds);

  if (_inboxSelectedOrderId && orderIds.includes(String(_inboxSelectedOrderId))) {
    _showInboxDetailFromData(String(_inboxSelectedOrderId), orderMap.get(String(_inboxSelectedOrderId)));
  }
}

function _inboxEmptyStateHtml() {
  return '<div class="inbox-no-selection"><i class="ti ti-inbox"></i><p>Select an order to view its details</p></div>';
}

function _inboxClearDetailIfGone(orderIds) {
  if (_inboxSelectedOrderId && !orderIds.includes(String(_inboxSelectedOrderId))) {
    _inboxSelectedOrderId = null;
  }
  if (!_inboxSelectedOrderId) {
    const d = document.getElementById('inboxDetail');
    if (d) d.innerHTML = _inboxEmptyStateHtml();
  }
}

function showInboxDetail(orderId) {
  _inboxSelectedOrderId = orderId;
  document.querySelectorAll('.inbox-card').forEach(el => {
    const onclick = el.getAttribute('onclick') || '';
    el.classList.toggle('selected', onclick.indexOf(orderId) !== -1);
  });
  const rows = orders.filter(r => String(r.orderId) === String(orderId));
  _showInboxDetailFromData(orderId, rows);
}

function _showInboxDetailFromData(orderId, rows) {
  const detailEl = document.getElementById('inboxDetail');
  if (!detailEl || !rows || !rows.length) return;

  const first = rows[0];
  const status = first.status || 'Pending';
  const deliveryCost = deliveryOptions.find(d => d.name === first.delivery)?.price || 0;
  const total = rows.reduce((s, r) => s + r.total, 0) + deliveryCost;
  const orderNum = orderNumFromId(orderId);

  const statusDd = _buildStatusBreadcrumb(orderId, status);

  const paidToggle = '<button class="paid-btn ' + (first.paid ? 'paid-btn-yes' : 'paid-btn-no') + '"'
    + ' onclick="toggleOrderPaid(\'' + esc(String(orderId)) + '\',' + (!first.paid) + ')">'
    + (first.paid ? 'Paid' : 'Unpaid')
    + '</button>';

  const deliveryOpt = deliveryOptions.find(d => d.name === first.delivery);
  const deliveryIcon = '<i class="ti ' + ((deliveryOpt && deliveryOpt.icon) || 'ti-mail') + '"></i>';

  // Compute unique categories in this order for the filter panel
  const _detailCatNames = [...new Set(rows.map(r => { const c = cats.find(x => String(x.id) === String(r.catId)); return c ? c.name : '?'; }))].sort();
  window._itemSearch = '';
  window._itemSort = 'default';
  window._itemSortDir = 1;

  const catFilterOpts = _detailCatNames.length > 1
    ? _detailCatNames.map(name => '<label class="filter-check"><input type="checkbox" data-detail-cat="' + esc(name) + '" checked onchange="_applyDetailFilters()"> ' + esc(name) + '</label>').join('')
    : '';

  const _detailCatIds = [...new Set(rows.map(r => String(r.catId)))];
  const _sortableOptNames = [...new Set(
    opts.filter(o => _detailCatIds.includes(String(o.catId)) && o.sortable && !o.archived).map(o => o.name)
  )];
  const sortPanelOpts = '<div class="filter-section-title">Sort by</div>'
    + [{f:'cat', l:'Category'}, {f:'qty', l:'Qty'}, {f:'price', l:'Price'}].map(s =>
        '<div class="sort-option' + (window._itemSort === s.f ? ' active' : '') + '" data-detail-sort="' + s.f + '" onclick="_setDetailSort(\'' + s.f + '\',\'' + s.l + '\')">' + s.l + '</div>'
      ).join('')
    + (_sortableOptNames.length
        ? '<div class="filter-section-title filter-section-title-mt">Option</div>'
          + _sortableOptNames.map(name => {
              const key = 'opt:' + name;
              return '<div class="sort-option indented' + (window._itemSort === key ? ' active' : '') + '" data-detail-sort="' + esc(key) + '" onclick="_setDetailSort(\'' + escJsAttr(key) + '\',\'' + escJsAttr(name) + '\')">' + esc(name) + '</div>';
            }).join('')
        : '');

  const itemsHtml = rows.map((row, _idx) => {
    const cat = cats.find(c => String(c.id) === String(row.catId));
    const parsedOpts = {};
    if (row.options) row.options.split('||').forEach(p => {
      const idx = p.indexOf(':'); if (idx >= 0) parsedOpts[p.slice(0,idx).trim()] = p.slice(idx+1).trim();
    });
    const catOpts = opts.filter(o => String(o.catId) === String(row.catId));
    // Any category with a "Backing" option can generate a 3MF — the generator
    // itself (badge/render.js) already supports Pin/Magnet/Keychain backings,
    // this isn't specific to the "Name Badge" category.
    const isBadge = catOpts.some(o => o.name.trim().toLowerCase() === 'backing');

    const optLines = catOpts.map(opt => {
      const val = parsedOpts[opt.name];
      if (!val) return '';
      const isColour = opt.display === 'colour' || opt.name.toLowerCase().indexOf('colour') !== -1;
      if (isColour) {
        const swatches = val.split('|').map(name => {
          const c = colours.find(c => c.name.toLowerCase() === name.toLowerCase());
          return '<span class="inbox-item-swatch" style="--sw:' + (c ? c.code : '#ccc') + '" title="' + esc(name) + '"></span>';
        }).join('');
        return '<div class="inbox-item-opt">'
          + '<span class="inbox-item-opt-label">' + esc(opt.name) + ':</span>'
          + '<div class="inbox-item-swatches">' + swatches + '</div>'
          + '<span class="inbox-item-opt-val">' + esc(val.replace(/\|/g, ', ')) + '</span>'
          + '</div>';
      }
      return '<div class="inbox-item-opt">'
        + '<span class="inbox-item-opt-label">' + esc(opt.name) + ':</span>'
        + '<span class="inbox-item-opt-val">' + esc(val) + '</span>'
        + '</div>';
    }).filter(Boolean).join('');

    const badgeParams = new URLSearchParams({name:parsedOpts['Text']||'',backing:parsedOpts['Backing']||'',colours:parsedOpts['Colours']||''});
    const badgeBtn = isBadge
      ? '<button class="sort-btn-main" title="Generate Badge" onclick="generateBadge(\'/badge/?' + badgeParams + '\')"><i class="ti ti-badge"></i> Download 3MF</button>'
      : '';

    const searchText = [cat ? cat.name : '', Object.values(parsedOpts).join(' '), row.notes || ''].join(' ').toLowerCase();

    const printedBtn = '<button class="paid-btn sm ' + (row.printed ? 'paid-btn-yes' : 'paid-btn-no') + '"'
      + ' onclick="toggleItemPrinted(\'' + esc(String(row.id)) + '\',' + (!row.printed) + ')">'
      + (row.printed ? 'Printed' : 'Not Printed')
      + '</button>';

    return '<div class="inbox-item-card"'
      + ' data-search="' + esc(searchText) + '"'
      + ' data-catname="' + esc(cat ? cat.name : '') + '"'
      + ' data-price="' + row.total + '"'
      + ' data-qty="' + row.qty + '"'
      + ' data-textval="' + esc(parsedOpts['Text'] || '') + '"'
      + ' data-optstr="' + esc(row.options || '') + '"'
      + ' data-idx="' + _idx + '">'
      + '<div class="inbox-item-left">'
      + '<div class="inbox-item-unit-price">$' + row.price.toFixed(2) + '</div>'
      + '<div class="inbox-item-qty"><span class="inbox-item-qty-x">x</span> ' + row.qty + '</div>'
      + '<div class="inbox-item-price">$' + row.total.toFixed(2) + '</div>'
      + '</div>'
      + '<div class="inbox-item-divider"></div>'
      + '<div class="inbox-item-right">'
      + '<div class="inbox-item-cat">' + (cat ? esc(cat.name) : '?') + '</div>'
      + optLines
      + (row.notes ? '<div class="inbox-item-opt inbox-item-notes"><i class="ti ti-notes"></i> <em>' + esc(row.notes) + '</em></div>' : '')
      + '</div>'
      + '<div class="inbox-item-actions">' + printedBtn + badgeBtn + '</div>'
      + '</div>';
  }).join('');

  const badgeRows = rows.filter(r => {
    const rowCatOpts = opts.filter(o => String(o.catId) === String(r.catId));
    return rowCatOpts.some(o => o.name.trim().toLowerCase() === 'backing');
  });
  const batchItems = badgeRows.map(r => {
    const p = {};
    if (r.options) r.options.split('||').forEach(s => { const i = s.indexOf(':'); if (i >= 0) p[s.slice(0,i).trim()] = s.slice(i+1).trim(); });
    return {name: p['Text']||'', backing: p['Backing']||'', colours: p['Colours']||''};
  });
  const bulkBadgeBtn = badgeRows.length
    ? '<button class="sort-btn-main ml-auto" onclick="openBadgeBatchModal(' + esc(JSON.stringify(batchItems)) + ',\'' + escJsAttr(first.customer) + '\')"><i class="ti ti-badges"></i> Download All 3MF</button>'
    : '';

  const printBtn = first.address
    ? '<button class="sort-btn-main" onclick="printShippingLabel(\'' + escJsAttr(first.customer) + '\',\'' + escJsAttr(first.address) + '\',\'' + esc(String(orderId)) + '\')" title="Print label"><i class="ti ti-printer"></i> Shipping Label</button>'
    : '';

  detailEl.innerHTML = '<div class="inbox-detail">'
    + '<div class="inbox-detail-header">'
    + '<div class="inbox-detail-header-top">'
    + '<div class="inbox-detail-customer">' + (esc(first.customer) || '?') + '</div>'
    + '<button class="sort-btn-main" onclick="openEdit(\'' + esc(String(orderId)) + '\')"><i class="ti ti-edit"></i> Edit</button>'
    + '<button class="sort-btn-main text-red" onclick="deleteOrder(\'' + esc(String(orderId)) + '\')" title="Delete order"><i class="ti ti-trash"></i></button>'
    + '</div>'
    + '</div>'

    + '<div class="inbox-detail-meta">'
    + '<div class="inbox-detail-meta-item"><i class="ti ti-hash"></i><strong>' + orderNum.replace(/^#/, '') + '</strong></div>'
    + '<div class="inbox-detail-meta-item">' + deliveryIcon + '<strong>' + esc(first.delivery || 'Post') + '</strong></div>'
    + (first.payment ? '<div class="inbox-detail-meta-item"><i class="ti ti-credit-card"></i><strong>' + esc(first.payment) + '</strong></div>' : '')
    + (first.address ? '<div class="inbox-detail-meta-item"><i class="ti ti-map-pin"></i><strong>' + esc(first.address) + '</strong></div>' : '')
    + '</div>'

    + '<div class="status-row-wrap">' + statusDd + paidToggle + '</div>'

    + '<div class="inbox-items-panel">'
    + '<div class="inbox-detail-items-hdr">'
    + printBtn
    + bulkBadgeBtn
    + '</div>'
    + '<div class="detail-toolbar-row">'
    + '<div class="inbox-search-row inbox-search-row-detail">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" id="detailItemsSearch" placeholder="Search…" oninput="window._itemSearch=this.value;_applyDetailFilters()">'
    + '<button id="detailItemsClear" class="search-clear-btn" onclick="document.getElementById(\'detailItemsSearch\').value=\'\';window._itemSearch=\'\';_applyDetailFilters()" style="display:none"><i class="ti ti-x"></i></button>'
    + '</div>'
    + '<div class="flex-1"></div>'
    + '<div class="filter-wrap" id="detailFilterWrap">'
    + '<button class="sort-btn-main detail-filter-btn" onclick="toggleDetailFilterPanel(event)"><i class="ti ti-filter"></i> Filter<span id="detailFilterCount" class="filter-count-badge" style="display:none"></span></button>'
    + '<div class="filter-panel" id="detailFilterPanel" style="display:none" onclick="event.stopPropagation()">' + catFilterOpts + '</div>'
    + '</div>'
    + '<div class="sort-btn-wrap" id="detailSortWrap">'
    + '<div class="sort-btn-group">'
    + '<button class="sort-btn-main" id="detailSortBtn" onclick="toggleDetailSortPanel(event)"><i class="ti ti-arrows-sort"></i> Sort</button>'
    + '<button class="sort-btn-dir" id="detailSortDirBtn" onclick="window._itemSortDir*=-1;_applyDetailFilters()" title="Toggle sort direction"><i class="ti ti-arrow-up" id="detailSortDirIcon"></i></button>'
    + '</div>'
    + '<div class="sort-panel" id="detailSortPanel" style="display:none" onclick="event.stopPropagation()">' + sortPanelOpts + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="inbox-items-list">' + itemsHtml + '</div>'
    + (deliveryCost > 0
      ? '<div class="inbox-detail-delivery-line"><span>' + deliveryIcon + ' ' + esc(first.delivery) + '</span><span>$' + deliveryCost.toFixed(2) + '</span></div>'
      : '')
    + '<div class="inbox-detail-total">'
    + '<span class="inbox-detail-total-label">Order total</span>'
    + '<span class="inbox-detail-total-val">$' + total.toFixed(2) + '</span>'
    + '</div>'
    + '</div>';
}

// -- Multi-view sidebar system ------------------------------------
let _sidebarView = 'orders';
let _selectedCustomerId = null;
let _selectedInventoryItemId = null;

function setSidebarView(view) {
  _sidebarView = view;
  document.querySelectorAll('.topbar-item[data-view]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.view === view);
  });
  _inboxSelectedOrderId = null;
  _selectedCustomerId = null;
  _selectedInventoryItemId = null;
  var detail = document.getElementById('inboxDetail');
  if (detail) detail.innerHTML = '<div class="inbox-no-selection"><i class="ti ti-inbox"></i><p>Select an item</p></div>';
  if (view === 'orders') _renderViewOrders();
  else if (view === 'customers') _renderViewCustomers('');
  else if (view === 'inventory') _renderViewInventory('');
  else if (view === 'categories') _renderViewCategories();
  else if (view === 'stats') _renderViewStats();
  else if (view === 'settings') _renderViewSettings();
}

function _setListPane(headerHtml) {
  var col = document.querySelector('.inbox-list-col');
  var footer = col.querySelector('.inbox-list-footer').outerHTML;
  col.innerHTML = '<div class="inbox-list-header inbox-list-header-flat">' + headerHtml + '</div>'
    + '<div class="inbox-list" id="inboxList"></div>'
    + footer;
}

// Orders view: restore the full orders header + renderTable
function _renderViewOrders() {
  var col = document.querySelector('.inbox-list-col');
  var footer = col.querySelector('.inbox-list-footer').outerHTML;
  col.innerHTML = '<div class="inbox-list-header">'
    + '<div class="view-search-row">'
    + '<div class="inbox-search-row inbox-search-row-flex">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" id="search" placeholder="Search…" oninput="renderTable();toggleSearchClear()">'
    + '<button id="searchClear" class="search-clear-btn" onclick="document.getElementById(\'search\').value=\'\';renderTable();toggleSearchClear()" style="display:none"><i class="ti ti-x"></i></button>'
    + '</div>'
    + '<button class="btn success flex-shrink-0" onclick="openAddModal()"><i class="ti ti-plus"></i> New Order</button>'
    + '</div>'
    + '<div class="inbox-sort-row">'
    + '<div class="filter-wrap" id="filterWrap">'
    + '<button class="sort-btn-main" id="filterBtn" onclick="toggleFilterPanel(event)">'
    + '<i class="ti ti-filter"></i> Filter <span id="filterCount" class="filter-count-badge" style="display:none"></span>'
    + '</button>'
    + '<div class="filter-panel" id="filterPanel" style="display:none">'
    + '<div class="filter-section-title">Status</div>'
    + ['Pending','Confirmed','Printed','Complete','On Hold','Cancelled'].map(function(s){
        return '<label class="filter-check"><input type="checkbox" data-filter="status" value="' + s + '" checked onchange="renderTable();updateFilterCount()"> ' + s + '</label>';
      }).join('')
    + '<div class="filter-section-title filter-section-title-mt10">Category</div>'
    + '<div id="filterCatChecks"></div>'
    + '<div class="filter-section-title filter-section-title-mt10">Payment</div>'
    + '<div id="filterPayChecks"></div>'
    + '</div>'
    + '</div>'
    + '<div class="sort-btn-wrap" id="sortWrap">'
    + '<div class="sort-btn-group">'
    + '<button class="sort-btn-main" id="sortBtn" onclick="toggleSortPanel(event)"><i class="ti ti-arrows-sort"></i></button>'
    + '<button class="sort-btn-dir" id="sortDirBtn" onclick="toggleSortDir()" title="Toggle sort direction"><i class="ti ti-arrow-up" id="sortDirIcon"></i></button>'
    + '</div>'
    + '<div class="sort-panel" id="sortPanel" style="display:none"></div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="inbox-list" id="inboxList"></div>'
    + footer;
  populateCatFilter();
  updateFilterCount();
  updateSortUI();
  renderTable();
}

// Customers view
function _renderViewCustomers(filter) {
  filter = filter || '';
  _setListPane(
    '<div class="view-search-row">'
    + '<div class="inbox-search-row inbox-search-row-flex">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" id="customerViewSearch" placeholder="Search customers…" value="' + esc(filter) + '" oninput="_renderViewCustomers(this.value)">'
    + '</div>'
    + '<button class="btn success flex-shrink-0" onclick="openAddCustomer()"><i class="ti ti-plus"></i> New</button>'
    + '</div>'
  );
  var list = document.getElementById('inboxList');
  var q = filter.toLowerCase();
  var shown = customers.filter(function(c) {
    return !q || c.name.toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q);
  });
  if (!shown.length) { list.innerHTML = '<div class="inbox-empty-state"><i class="ti ti-users"></i> No customers</div>'; return; }
  shown.sort(function(a,b){ return (a.archived?1:0) - (b.archived?1:0); });
  list.innerHTML = shown.map(function(c) {
    var isSelected = String(c.id) === String(_selectedCustomerId);
    if (c.archived) {
      return '<div class="inbox-card' + (isSelected?' selected':'') + '" onclick="_showCustomerDetail(\'' + esc(String(c.id)) + '\')">'
        + '<div class="inbox-card-content"><span class="text-muted strikethrough">' + esc(c.name) + '</span></div></div>';
    }
    var ordSet = new Set(orders.filter(function(r) { return String(r.customer_id)===String(c.id)||r.customer===c.name; }).map(function(r){return r.orderId;}));
    var ordCount = ordSet.size;
    var av = _avatarColor(c.name);
    var ini = _initials(c.name);
    return '<div class="inbox-card' + (isSelected?' selected':'') + '" onclick="_showCustomerDetail(\'' + esc(String(c.id)) + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer">' + esc(c.name) + '</span>'
      + (ordCount ? '<span class="inbox-card-num">' + ordCount + ' order' + (ordCount!==1?'s':'') + '</span>' : '')
      + '</div>'
      + '<div class="inbox-card-subject">' + (esc(c.email) || '<em class="text-faint">No email</em>') + '</div>'
      + '<div class="inbox-card-footer"><span class="text-muted-sm">' + (esc(c.phone)||'') + '</span></div>'
      + '</div></div>';
  }).join('');
}

function _showCustomerDetail(customerId) {
  _selectedCustomerId = customerId;
  document.querySelectorAll('#inboxList .inbox-card').forEach(function(el) {
    el.classList.toggle('selected', (el.getAttribute('onclick')||'').includes(customerId));
  });
  var c = customers.find(function(x){return String(x.id)===String(customerId);});
  if (!c) return;
  var detail = document.getElementById('inboxDetail');
  if (!detail) return;
  var custOrders = orders.filter(function(r){return String(r.customer_id)===String(customerId)||r.customer===c.name;});
  var orderIds = [...new Set(custOrders.map(function(r){return r.orderId;}))];
  var orderMap = new Map();
  custOrders.forEach(function(r){if(!orderMap.has(r.orderId))orderMap.set(r.orderId,[]);orderMap.get(r.orderId).push(r);});
  var av = _avatarColor(c.name);
  var ini = _initials(c.name);
  var orderTotals = new Map();
  orderIds.forEach(function(oid){
    var rows = orderMap.get(oid);
    var deliveryCost = deliveryOptions.find(function(d){return d.name===rows[0].delivery;})?.price||0;
    orderTotals.set(oid, rows.reduce(function(s,r){return s+r.total;},0) + deliveryCost);
  });
  var totalSpend = [...orderTotals.values()].reduce(function(s,t){return s+t;},0);
  var html = '<div class="inbox-detail">'
    + '<div class="inbox-detail-header">'
    + '<div class="inbox-detail-header-top">'
    + '<div class="flex-fill-input">'
    + '<div class="inbox-detail-customer">' + esc(c.name) + '</div>'
    + (c.email?'<div class="customer-email-sub">'+esc(c.email)+'</div>':'')
    + '</div>'
    + '<button class="sort-btn-main" onclick="openEditCustomer(\''+esc(String(c.id))+'\')"><i class="ti ti-edit"></i> Edit</button>'
    + (orderIds.length
        ? '<button class="sort-btn-main" onclick="'+(c.archived?'unarchiveCustomer(\''+esc(String(c.id))+'\')':'archiveCustomer(\''+esc(String(c.id))+'\',\''+escJsAttr(c.name)+'\')')+'" title="'+(c.archived?'Restore customer':'Archive customer')+'"><i class="ti ti-'+(c.archived?'archive-off':'archive')+'"></i></button>'
        : '<button class="sort-btn-main text-red" onclick="deleteCustomer(\''+esc(String(c.id))+'\',\''+escJsAttr(c.name)+'\')" title="Delete customer"><i class="ti ti-trash"></i></button>')
    + '</div></div>'
    + '<div class="inbox-detail-meta">'
    + (c.phone?'<div class="inbox-detail-meta-item"><i class="ti ti-phone"></i><strong>'+esc(c.phone)+'</strong></div>':'')
    + (c.address?'<div class="inbox-detail-meta-item"><i class="ti ti-map-pin"></i><strong>'+esc(c.address)+'</strong></div>':'')
    + (c.notes?'<div class="inbox-detail-meta-item"><i class="ti ti-notes"></i><em>'+esc(c.notes)+'</em></div>':'')
    + '<div class="inbox-detail-meta-item"><i class="ti ti-shopping-cart"></i><strong>'+orderIds.length+' order'+(orderIds.length!==1?'s':'')+'</strong></div>'
    + '<div class="inbox-detail-meta-item"><i class="ti ti-currency-dollar"></i><strong>$'+totalSpend.toFixed(2)+' total</strong></div>'
    + '</div>';
  if (orderIds.length) {
    html += '<div><div class="inbox-detail-items-hdr"><div class="inbox-detail-items-label">Orders ('+orderIds.length+')</div></div>'
      + '<div class="related-orders-list">';
    orderIds.forEach(function(oid){
      var rows = orderMap.get(oid);
      var first = rows[0];
      var total = orderTotals.get(oid);
      var status = first.status||'Pending';
      var bc = 'b-'+status.toLowerCase().replace(' ','-');
      var orderNum = orderNumFromId(oid);
      var catNames = [...new Set(rows.map(function(r){var cat=cats.find(function(c){return String(c.id)===String(r.catId);});return cat?cat.name:null;}).filter(Boolean))].join(', ');
      html += '<div class="inbox-item-card inbox-item-card-clickable" onclick="_switchToOrder(\''+esc(String(oid))+'\')">'
        + '<div class="inbox-item-left"><div class="inbox-item-qty">'+rows.length+'</div><div class="inbox-item-qty-label">items</div><div class="inbox-item-price">$'+total.toFixed(2)+'</div></div>'
        + '<div class="inbox-item-divider"></div>'
        + '<div class="inbox-item-right"><div class="inbox-item-cat">'+orderNum+' &mdash; '+esc(catNames)+'</div>'
        + '<div class="related-order-status-wrap"><span class="'+bc+' related-order-status-badge">'+status+'</span></div>'
        + '</div></div>';
    });
    html += '</div></div>';
  } else {
    html += '<div class="inbox-empty-state"><i class="ti ti-shopping-cart-off"></i> No orders yet</div>';
  }
  html += '</div>';
  detail.innerHTML = html;
}

function _switchToOrder(orderId) {
  setSidebarView('orders');
  setTimeout(function(){showInboxDetail(orderId);}, 80);
}

// Inventory view
function _inventoryReceived(itemId){
  return inventoryReceipts.filter(function(r){return r.itemId===itemId;}).reduce(function(s,r){return s+r.qty;},0);
}
function _inventoryConsumed(itemId){
  return inventoryConsumption.filter(function(c){return c.itemId===itemId;}).reduce(function(s,c){return s+c.qty;},0);
}
function _inventoryAvailable(itemId){
  return _inventoryReceived(itemId) - _inventoryConsumed(itemId);
}

function _renderViewInventory(filter) {
  filter = filter || '';
  _setListPane(
    '<div class="view-search-row">'
    + '<div class="inbox-search-row inbox-search-row-flex">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" id="inventoryViewSearch" placeholder="Search inventory…" value="' + esc(filter) + '" oninput="_renderViewInventory(this.value)">'
    + '</div>'
    + '<button class="btn success flex-shrink-0" onclick="openAddInventoryItem()"><i class="ti ti-plus"></i> New</button>'
    + '</div>'
  );
  var list = document.getElementById('inboxList');
  var q = filter.toLowerCase();
  var shown = inventoryItems.filter(function(i) {
    return !q || i.name.toLowerCase().includes(q);
  });
  if (!shown.length) { list.innerHTML = '<div class="inbox-empty-state"><i class="ti ti-package"></i> No inventory items</div>'; return; }
  list.innerHTML = shown.map(function(i) {
    var isSelected = String(i.id) === String(_selectedInventoryItemId);
    var available = _inventoryAvailable(i.id);
    return '<div class="inbox-card' + (isSelected?' selected':'') + '" onclick="_showInventoryDetail(\'' + esc(String(i.id)) + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer">' + esc(i.name) + '</span>'
      + '<span class="inbox-card-num">' + available + ' available</span>'
      + '</div>'
      + '<div class="inbox-card-subject">' + (esc(i.notes) || '<em class="text-faint">No notes</em>') + '</div>'
      + '</div></div>';
  }).join('');
}

function _showInventoryDetail(itemId) {
  _selectedInventoryItemId = itemId;
  document.querySelectorAll('#inboxList .inbox-card').forEach(function(el) {
    el.classList.toggle('selected', (el.getAttribute('onclick')||'').includes(itemId));
  });
  var i = inventoryItems.find(function(x){return String(x.id)===String(itemId);});
  if (!i) return;
  var detail = document.getElementById('inboxDetail');
  if (!detail) return;
  var received = _inventoryReceived(itemId);
  var consumed = _inventoryConsumed(itemId);
  var available = received - consumed;
  var receipts = inventoryReceipts.filter(function(r){return r.itemId===itemId;}).slice().sort(function(a,b){return b.date.localeCompare(a.date);});
  var consumption = inventoryConsumption.filter(function(c){return c.itemId===itemId;}).slice().sort(function(a,b){return b.date.localeCompare(a.date);});
  var html = '<div class="inbox-detail">'
    + '<div class="inbox-detail-header">'
    + '<div class="inbox-detail-header-top">'
    + '<div class="flex-fill-input">'
    + '<div class="inbox-detail-customer">' + esc(i.name) + '</div>'
    + '</div>'
    + '<button class="sort-btn-main" onclick="openEditInventoryItem(\''+esc(String(i.id))+'\')"><i class="ti ti-edit"></i> Edit</button>'
    + '<button class="sort-btn-main text-red" onclick="deleteInventoryItem(\''+esc(String(i.id))+'\',\''+escJsAttr(i.name)+'\')" title="Delete item"><i class="ti ti-trash"></i></button>'
    + '</div></div>'
    + '<div class="inbox-detail-meta">'
    + '<div class="inbox-detail-meta-item"><i class="ti ti-package"></i><strong>' + available + ' available</strong></div>'
    + '<div class="inbox-detail-meta-item"><i class="ti ti-arrow-down"></i><strong>' + received + ' received</strong></div>'
    + '<div class="inbox-detail-meta-item"><i class="ti ti-arrow-up"></i><strong>' + consumed + ' used</strong></div>'
    + (i.notes?'<div class="inbox-detail-meta-item"><i class="ti ti-notes"></i><em>'+esc(i.notes)+'</em></div>':'')
    + '</div>'

    + '<div class="inbox-detail-items-hdr">'
    + '<div class="inbox-detail-items-label">Receiving Log</div>'
    + '<button class="sort-btn-main" onclick="showReceiptForm()"><i class="ti ti-plus"></i> Log Receipt</button>'
    + '</div>'
    + '<div id="inv-receipt-form" class="new-customer-panel" style="display:none">'
    + '<div class="field-row">'
    + '<div class="field"><label>Quantity received *</label><input type="number" id="rcpt-qty" min="1" step="1"></div>'
    + '<div class="field"><label>Cost per unit</label><input type="number" id="rcpt-cost" min="0" step="0.01" placeholder="0.00"></div>'
    + '</div>'
    + '<div class="field"><label>Date</label><input type="date" id="rcpt-date"></div>'
    + '<div id="rcpt-error" class="field-error-text" style="display:none"></div>'
    + '<div class="modal-actions">'
    + '<button class="btn" onclick="hideReceiptForm()">Cancel</button>'
    + '<button class="btn success" id="rcpt-save" onclick="saveInventoryReceipt(\''+esc(String(i.id))+'\')"><i class="ti ti-check"></i> Log receipt</button>'
    + '</div></div>'
    + (receipts.length
      ? '<div class="related-orders-list">' + receipts.map(function(r){
          return '<div class="inbox-item-card">'
            + '<div class="inbox-item-left"><div class="inbox-item-qty">+'+r.qty+'</div><div class="inbox-item-qty-label">units</div>'
            + (r.cost?'<div class="inbox-item-price">$'+r.cost.toFixed(2)+'/ea</div>':'')
            + '</div>'
            + '<div class="inbox-item-divider"></div>'
            + '<div class="inbox-item-right"><div class="inbox-item-cat">Received</div>'
            + '<div class="related-order-status-wrap"><span class="text-muted-sm">'+toDisplay(r.date)+'</span></div></div>'
            + '<div class="inbox-item-actions"><button class="icon-btn" title="Edit" onclick="openEditReceiptForm(\''+esc(String(r.id))+'\')"><i class="ti ti-edit"></i></button></div>'
            + '</div>';
        }).join('') + '</div>'
      : '<div class="inbox-empty-state"><i class="ti ti-truck-delivery"></i> No stock received yet</div>')

    + '<div class="inbox-detail-items-hdr">'
    + '<div class="inbox-detail-items-label">Usage Log</div>'
    + '</div>'
    + (consumption.length
      ? '<div class="related-orders-list">' + consumption.map(function(c){
          var orderNum = orderNumFromId(c.orderId);
          return '<div class="inbox-item-card inbox-item-card-clickable" onclick="_switchToOrder(\''+esc(String(c.orderId))+'\')">'
            + '<div class="inbox-item-left"><div class="inbox-item-qty">-'+c.qty+'</div><div class="inbox-item-qty-label">units</div></div>'
            + '<div class="inbox-item-divider"></div>'
            + '<div class="inbox-item-right"><div class="inbox-item-cat">Order '+orderNum+'</div>'
            + '<div class="related-order-status-wrap"><span class="text-muted-sm">'+toDisplay(c.date)+'</span></div></div>'
            + '</div>';
        }).join('') + '</div>'
      : '<div class="inbox-empty-state"><i class="ti ti-package-off"></i> Not used by any completed order yet</div>')
    + '</div>';
  detail.innerHTML = html;
}

// Categories view
function _renderViewCategories() {
  _setListPane('<div class="inbox-view-header"><span class="inbox-view-title">Categories</span><span class="inbox-view-count">'+cats.filter(function(c){return !c.archived;}).length+'</span></div>');
  var list = document.getElementById('inboxList');
  var active = cats.filter(function(c){return !c.archived;});
  if (!active.length) { list.innerHTML = '<div class="inbox-empty-state"><i class="ti ti-category"></i> No categories</div>'; return; }
  list.innerHTML = active.map(function(c){
    var catOpts = opts.filter(function(o){return String(o.catId)===String(c.id)&&!o.archived;});
    var ordCount = new Set(orders.filter(function(r){return String(r.catId)===String(c.id);}).map(function(r){return r.orderId;})).size;
    return '<div class="inbox-card">'
      + '<div class="inbox-card-avatar inbox-card-avatar-icon"><i class="ti ti-category"></i></div>'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer">'+esc(c.name)+'</span><span class="inbox-card-num">$'+c.price.toFixed(2)+'</span></div>'
      + '<div class="inbox-card-subject">'+catOpts.length+' option'+(catOpts.length!==1?'s':'')+'</div>'
      + '<div class="inbox-card-footer"><span class="inbox-card-num">'+ordCount+' order'+(ordCount!==1?'s':'')+'</span></div>'
      + '</div></div>';
  }).join('');
}

// Stats view
function _renderViewStats() {
  _setListPane('<div class="inbox-view-header"><span class="inbox-view-title">Stats</span></div>');
  var pending = orders.filter(function(r){return (r.status||'Pending')==='Pending';});
  var confirmed = orders.filter(function(r){return r.status==='Confirmed';});
  var printed = orders.filter(function(r){return r.status==='Printed';});
  var complete = orders.filter(function(r){return r.status==='Complete';});
  var revenueOrderIds = new Set();
  var revenue = orders.filter(function(r){var p=paymentOptions.find(function(p){return p.name===r.payment;});return p&&p.showRevenue;}).reduce(function(s,r){
    var deliveryCost = 0;
    if(!revenueOrderIds.has(r.orderId)){
      revenueOrderIds.add(r.orderId);
      deliveryCost = deliveryOptions.find(function(d){return d.name===r.delivery;})?.price||0;
    }
    return s+r.total+deliveryCost;
  },0);
  var uniqueOrders = new Set(orders.map(function(r){return r.orderId;})).size;
  var detail = document.getElementById('inboxDetail');
  if (detail) detail.innerHTML = '<div class="inbox-detail inbox-detail-narrow-600">'
    + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Stats</div></div></div>'
    + '<div class="stats-grid-2col">'
    + _statCard('Orders', uniqueOrders, 'ti-shopping-cart', '')
    + _statCard('Pending', new Set(pending.map(function(r){return r.orderId;})).size, 'ti-clock', 'var(--amber)')
    + _statCard('Confirmed', new Set(confirmed.map(function(r){return r.orderId;})).size, 'ti-circle-check', 'var(--blue)')
    + _statCard('Printed', new Set(printed.map(function(r){return r.orderId;})).size, 'ti-printer', 'var(--teal)')
    + _statCard('Complete', new Set(complete.map(function(r){return r.orderId;})).size, 'ti-check', 'var(--green)')
    + _statCard('Revenue', '$'+revenue.toFixed(2), 'ti-currency-dollar', 'var(--green)')
    + _statCard('Customers', customers.length, 'ti-users', '')
    + '</div></div>';
  var catBreakdown = cats.filter(function(c){return !c.archived;}).map(function(c){
    var n = new Set(orders.filter(function(r){return String(r.catId)===String(c.id);}).map(function(r){return r.orderId;})).size;
    return {name:c.name, n:n};
  }).filter(function(x){return x.n>0;}).sort(function(a,b){return b.n-a.n;});
  var list = document.getElementById('inboxList');
  var max = catBreakdown.length ? catBreakdown[0].n : 1;
  list.innerHTML = catBreakdown.map(function(x){
    return '<div class="inbox-card">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer">'+esc(x.name)+'</span><span class="inbox-card-num">'+x.n+'</span></div>'
      + '<div class="stat-bar-track">'
      + '<div class="stat-bar-fill" style="width:'+Math.round(x.n/max*100)+'%"></div>'
      + '</div></div></div>';
  }).join('') || '<div class="inbox-empty-state"><i class="ti ti-chart-bar"></i> No data</div>';
}

function _statCard(label, val, icon, color) {
  return '<div class="stat-card">'
    + '<div class="stat-card-icon-row" style="--sc:'+(color||'var(--muted)')+'">'
    + '<i class="ti '+icon+' stat-card-icon"></i>'
    + '<span class="stat-card-label">'+label+'</span>'
    + '</div>'
    + '<div class="stat-card-value">'+val+'</div>'
    + '</div>';
}

// Settings view
var _selectedSettingsCat = null;
var _deliveryReorderMode = false;
var _paymentReorderMode = false;
var _showArchivedDelivery = false;
var _showArchivedPayment = false;
var _SETTINGS_CATS = [
  {id:'payment',  icon:'ti-credit-card', title:'Post & Pay',           desc:'Manage delivery methods and payment methods'},
  {id:'cats',     icon:'ti-category',    title:'Categories & Options',  desc:'Product categories and their options'},
  {id:'colours',  icon:'ti-brush',       title:'Colour Library',        desc:'Available colour swatches'},
  {id:'users',    icon:'ti-users',       title:'Users',                 desc:'Invite and manage app users'},
  {id:'app',      icon:'ti-settings',    title:'App Settings',          desc:'Profile, password and notifications'},
];

function _renderViewSettings() {
  _setListPane('<div class="inbox-view-header"><span class="inbox-detail-customer">Settings</span></div>');
  var list = document.getElementById('inboxList');
  list.innerHTML = _SETTINGS_CATS.map(function(cat) {
    var sel = cat.id === _selectedSettingsCat;
    return '<div class="inbox-card' + (sel?' selected':'') + '" onclick="_showSettingsDetail(\'' + cat.id + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer"><i class="ti ' + cat.icon + ' settings-cat-icon"></i>' + cat.title + '</span></div>'
      + '<div class="inbox-card-subject">' + cat.desc + '</div>'
      + '</div></div>';
  }).join('');
  _showSettingsDetail(_selectedSettingsCat || _SETTINGS_CATS[0].id);
}

function _showSettingsDetail(catId) {
  _selectedSettingsCat = catId;
  document.querySelectorAll('#inboxList .inbox-card').forEach(function(el) {
    el.classList.toggle('selected', (el.getAttribute('onclick')||'').includes("'" + catId + "'"));
  });
  var detail = document.getElementById('inboxDetail');
  if (!detail) return;

  if (catId === 'cats') {
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Categories &amp; Options</div></div></div>'
      + '<p class="settings-desc-text">Each category can have options — extra fields shown when adding an item. Drag <i class="ti ti-grip-vertical icon-sm"></i> to reorder options.</p>'
      + '<div class="cats-toolbar-row">'
      + '<label class="show-archived-label">'
      + '<input type="checkbox" id="showArchivedCb" onchange="toggleShowArchived(this)"> Show archived'
      + '</label>'
      + '<button class="btn success sm ml-auto" onclick="addCat()"><i class="ti ti-plus"></i> Add category</button>'
      + '</div>'
      + '<div id="catFlatList"></div>'
      + '<div class="settings-actions-row">'
      + '<button class="btn success" onclick="saveCatsAndOpts()"><i class="ti ti-cloud-upload"></i> Save</button>'
      + '</div></div>';
    if(typeof renderCatBlocks === 'function') {
      var cb = document.getElementById('showArchivedCb');
      if(cb) cb.checked = window.showArchivedCats || false;
      renderCatBlocks();
    }
  } else if (catId === 'colours') {
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Colour Library</div></div></div>'
      + '<p class="settings-desc-text">Manage your available filament colours. Tick <strong class="text-emphasis">Available</strong> if you currently have that colour in stock.</p>'
      + '<div class="settings-toolbar-row-end">'
      + '<button class="btn success sm" onclick="addColour()"><i class="ti ti-plus"></i> Add colour</button>'
      + '</div>'
      + '<div class="colour-mgr-hdr"><span>Swatch</span><span>Name</span><span>Hex code</span><span>Available</span><span></span></div>'
      + '<div id="colourList"></div>'
      + '<div class="settings-actions-row">'
      + '<button class="btn success" onclick="saveColours()"><i class="ti ti-cloud-upload"></i> Save</button>'
      + '</div></div>';
    if(typeof renderColourList === 'function') renderColourList();
  } else if (catId === 'users') {
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Users</div></div></div>'
      + '<p class="settings-desc-text">Invite team members to PrintDesk. They will receive an email to set their password.</p>'
      + '<div class="settings-toolbar-row-end">'
      + '<button class="btn success sm" onclick="openAddUserForm()"><i class="ti ti-plus"></i> Add user</button>'
      + '</div>'
      + '<div id="userForm" style="display:none">'
      + '<div class="user-form-inner">'
      + '<div class="field-row">'
      + '<div class="field"><label>Display name</label><input type="text" id="uf-name" placeholder="Their name"></div>'
      + '<div class="field"><label>Email</label><input type="email" id="uf-email" placeholder="user@example.com"></div>'
      + '</div>'
      + '<div class="field-row" id="uf-password-row" style="display:none">'
      + '<div class="field"><label>New password</label><input type="password" id="uf-password" placeholder="Leave blank to keep current"></div>'
      + '</div>'
      + '<div id="uf-error" class="field-error-text" style="display:none"></div>'
      + '<div class="user-form-actions">'
      + '<button class="btn" onclick="closeUserForm()">Cancel</button>'
      + '<button class="btn success" id="uf-save" onclick="saveUser()"><i class="ti ti-mail"></i> Send invite</button>'
      + '</div></div></div>'
      + '<div id="usersList"><div class="users-loading-placeholder"><i class="ti ti-loader-2"></i> Loading users…</div></div>'
      + '</div>';
    if(typeof loadUsers === 'function') { window.editingUserId = null; loadUsers(); }
  } else if (catId === 'payment') {
    var visibleDelivery = _showArchivedDelivery ? deliveryOptions : deliveryOptions.filter(function(d){return !d.archived;});
    var deliveryRows = visibleDelivery.map(function(d) {
      var i = deliveryOptions.indexOf(d);
      return '<div' + (_deliveryReorderMode ? ' draggable="true" ondragstart="_reorderDragStart(event,\'delivery\',' + i + ')" ondragover="_reorderDragOver(event,\'delivery\',' + i + ')" ondrop="_reorderDrop(event,\'delivery\',' + i + ')" ondragleave="_reorderDragLeave(event)" ondragend="_reorderDragEnd(event)"' : '')
        + ' class="settings-list-row">'
        + (_deliveryReorderMode ? '<span class="opt-drag"><i class="ti ti-grip-vertical"></i></span>' : '')
        + '<div class="icon-picker-wrap">'
        + '<button class="icon-picker-btn" onclick="event.stopPropagation();toggleDeliveryIconPicker(' + i + ',this)" title="Change icon" ' + (d.archived?'disabled':'') + '><i class="ti ' + (d.icon||'ti-truck-delivery') + '"></i></button>'
        + '<div class="icon-picker-list" id="dip-' + i + '" style="display:none">'
        + DELIVERY_ICON_PACK.map(function(ic){
            return '<button class="icon-picker-opt' + (ic===d.icon?' selected':'') + '" onclick="_settingsSetDeliveryIcon(' + i + ',\'' + ic + '\')" title="' + ic + '"><i class="ti ' + ic + '"></i></button>';
          }).join('')
        + '</div>'
        + '</div>'
        + '<span class="settings-list-name' + (_deliveryReorderMode?' reorder-indent':'') + (d.archived?' text-muted strikethrough':'') + '">' + esc(d.name) + '</span>'
        + '<div class="cat-price-wrap"><span>$</span><input type="number" class="ns-init" value="' + d.price.toFixed(2) + '" step="0.01" min="0" ' + (d.archived?'disabled':'') + ' onchange="_settingsSetDeliveryPrice(' + i + ',this.value)"></div>'
        + '<button class="btn sm" onclick="_settingsToggleDeliveryArchive(' + i + ')" title="' + (d.archived?'Restore':'Archive') + '"><i class="ti ti-' + (d.archived?'archive-off':'archive') + '"></i></button>'
        + '</div>';
    }).join('');
    var visiblePayment = _showArchivedPayment ? paymentOptions : paymentOptions.filter(function(p){return !p.archived;});
    var rows = visiblePayment.map(function(p) {
      var i = paymentOptions.indexOf(p);
      return '<div' + (_paymentReorderMode ? ' draggable="true" ondragstart="_reorderDragStart(event,\'payment\',' + i + ')" ondragover="_reorderDragOver(event,\'payment\',' + i + ')" ondrop="_reorderDrop(event,\'payment\',' + i + ')" ondragleave="_reorderDragLeave(event)" ondragend="_reorderDragEnd(event)"' : '')
        + ' class="settings-list-row">'
        + (_paymentReorderMode ? '<span class="opt-drag"><i class="ti ti-grip-vertical"></i></span>' : '')
        + '<span class="settings-list-name' + (_paymentReorderMode?' reorder-indent':'') + (p.archived?' text-muted strikethrough':'') + '">' + esc(p.name) + '</span>'
        + '<span class="revenue-badge">' + (p.showRevenue?'revenue':'no revenue') + '</span>'
        + '<button class="btn sm" onclick="_settingsToggleRevenue(' + i + ')" title="Toggle revenue tracking"><i class="ti ti-currency-dollar"></i></button>'
        + '<button class="btn sm" onclick="_settingsToggleArchive(' + i + ')" title="' + (p.archived?'Restore':'Archive') + '"><i class="ti ti-' + (p.archived?'archive-off':'archive') + '"></i></button>'
        + '</div>';
    }).join('');
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Post &amp; Pay</div></div></div>'
      + '<div class="settings-section-title settings-section-title-tight">Delivery Methods</div>'
      + '<p class="settings-desc-text">Manage how orders are delivered, and the price for each method.</p>'
      + '<div class="settings-section-header-row">'
      + '<button class="btn sm' + (_deliveryReorderMode?' primary':'') + '" onclick="_toggleDeliveryReorder()"><i class="ti ti-arrows-sort"></i> ' + (_deliveryReorderMode?'Done':'Reorder') + '</button>'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn sm' + (_showArchivedDelivery?' primary':'') + '" onclick="_toggleShowArchivedDelivery()"><i class="ti ti-' + (_showArchivedDelivery?'eye-off':'eye') + '"></i> ' + (_showArchivedDelivery?'Hide archived':'Show archived') + '</button>'
      + '<button class="btn success sm" onclick="_settingsAddDelivery()"><i class="ti ti-plus"></i> Add Method</button>'
      + '</div></div>'
      + '<div id="deliveryAddForm" class="settings-add-form-row" style="display:none">'
      + '<div class="icon-picker-wrap">'
      + '<button class="icon-picker-btn" id="da-icon-btn" onclick="event.stopPropagation();toggleDeliveryIconPicker(\'new\',this)" title="Change icon"><i class="ti ' + _daNewIcon + '"></i></button>'
      + '<div class="icon-picker-list" id="dip-new" style="display:none">'
      + DELIVERY_ICON_PACK.map(function(ic){
          return '<button class="icon-picker-opt' + (ic===_daNewIcon?' selected':'') + '" onclick="_settingsSetDeliveryIcon(\'new\',\'' + ic + '\')" title="' + ic + '"><i class="ti ' + ic + '"></i></button>';
        }).join('')
      + '</div>'
      + '</div>'
      + '<input type="text" id="da-name" placeholder="Delivery method name&hellip;" onkeydown="if(event.key===\'Enter\')_settingsSaveDelivery()" class="settings-add-input">'
      + '<div class="cat-price-wrap"><span>$</span><input type="number" id="da-price" class="ns-init" value="0.00" step="0.01" min="0" onkeydown="if(event.key===\'Enter\')_settingsSaveDelivery()"></div>'
      + '<button class="btn sm" onclick="_settingsCancelAddDelivery()">Cancel</button>'
      + '<button class="btn sm primary" onclick="_settingsSaveDelivery()"><i class="ti ti-check"></i> Add</button>'
      + '</div>'
      + '<div class="settings-list-box mb-20">' + deliveryRows + '</div>'
      + '<div class="settings-section-title settings-section-title-tight">Payment</div>'
      + '<p class="settings-desc-text">Manage how customers pay. Enable <strong class="text-emphasis">revenue</strong> on a method to include it in sales totals.</p>'
      + '<div class="settings-section-header-row">'
      + '<button class="btn sm' + (_paymentReorderMode?' primary':'') + '" onclick="_togglePaymentReorder()"><i class="ti ti-arrows-sort"></i> ' + (_paymentReorderMode?'Done':'Reorder') + '</button>'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn sm' + (_showArchivedPayment?' primary':'') + '" onclick="_toggleShowArchivedPayment()"><i class="ti ti-' + (_showArchivedPayment?'eye-off':'eye') + '"></i> ' + (_showArchivedPayment?'Hide archived':'Show archived') + '</button>'
      + '<button class="btn success sm" onclick="_settingsAddPayment()"><i class="ti ti-plus"></i> Add Option</button>'
      + '</div></div>'
      + '<div id="paymentAddForm" class="settings-add-form-row" style="display:none">'
      + '<input type="text" id="pa-name" placeholder="Payment option name&hellip;" onkeydown="if(event.key===\'Enter\')_settingsSavePayment()" class="settings-add-input">'
      + '<label class="revenue-checkbox-label"><input type="checkbox" id="pa-revenue" class="accent-checkbox"> Revenue</label>'
      + '<button class="btn sm" onclick="_settingsCancelAddPayment()">Cancel</button>'
      + '<button class="btn sm primary" onclick="_settingsSavePayment()"><i class="ti ti-check"></i> Add</button>'
      + '</div>'
      + '<div class="settings-list-box">' + rows + '</div>'
      + '</div>';
  } else if (catId === 'app') {
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">App Settings</div></div></div>'
      + '<p class="settings-desc-text">Manage your account details and notification preferences.</p>'

      + '<div class="settings-section"><div class="settings-section-title">Profile</div>'
      + '<div class="field-row">'
      + '<div class="field"><label>Display name</label><input type="text" id="settingsName" placeholder="Your name"></div>'
      + '<div class="field"><label>Email</label><input type="email" id="settingsEmail" placeholder="you@example.com"></div>'
      + '</div></div>'

      + '<div class="settings-section"><div class="settings-section-title">Change password</div>'
      + '<div class="field-row">'
      + '<div class="field"><label>New password</label><input type="password" id="settingsPassword" placeholder="Leave blank to keep current"></div>'
      + '<div class="field"><label>Confirm password</label><input type="password" id="settingsPasswordConfirm" placeholder="Repeat new password"></div>'
      + '</div>'
      + '<div id="settingsPasswordError" class="field-error-text" style="display:none"></div>'
      + '</div>'

      + '<div class="settings-section"><div class="settings-section-title">Notifications</div>'
      + '<p class="settings-desc-text">Email alerts for new orders. Requires a free <strong class="text-emphasis">Resend</strong> account.</p>'
      + '<div class="field field-mb-12"><label>Notification email</label><input type="email" id="settingsNotifyEmail" placeholder="you@example.com"></div>'
      + '<div class="settings-toggle-stack">'
      + '<div class="settings-toggle-box">'
      + '<label class="settings-toggle-label">'
      + '<input type="checkbox" id="settingsNotifyDaily" class="settings-checkbox">'
      + '<span class="settings-toggle-title">Daily badge digest — 4PM Melbourne</span>'
      + '</label>'
      + '<div class="settings-toggle-hint">Sends a summary email if any badge orders were added that day.</div>'
      + '</div>'
      + '<div class="settings-toggle-box">'
      + '<label class="settings-toggle-label settings-toggle-label-wrap">'
      + '<input type="checkbox" id="settingsNotifyThreshold" class="settings-checkbox">'
      + '<span class="settings-toggle-title">Urgent alert when</span>'
      + '<input type="number" id="settingsNotifyCount" value="5" min="1" max="99" class="notify-count-input">'
      + '<span class="settings-toggle-title">or more items added</span>'
      + '</label>'
      + '<div class="settings-toggle-hint">Checks every 15 minutes.</div>'
      + '</div>'
      + '<div class="last-alert-row">'
      + '<span class="text-muted-12">Last alert sent</span>'
      + '<span id="settingsNotifyLastSent" class="text-emphasis-12">—</span>'
      + '</div>'
      + '</div></div>'

      + '<div class="settings-actions-row settings-actions-row-tight">'
      + '<button class="btn success" id="settingsSaveBtn" onclick="applySettings()"><i class="ti ti-cloud-upload"></i> Save</button>'
      + '</div>'
      + '</div>';

    if(window.currentUser){
      document.getElementById('settingsEmail').value = window.currentUser.email||'';
      document.getElementById('settingsName').value = (window.currentUser.user_metadata||{}).display_name||'';
    }
    document.getElementById('settingsPassword').value = '';
    document.getElementById('settingsPasswordConfirm').value = '';
    document.getElementById('settingsPasswordError').style.display = 'none';
    loadNotificationSettings();
  }
}

function _settingsToggleRevenue(i) {
  paymentOptions[i].showRevenue = !paymentOptions[i].showRevenue;
  savePaymentOptions();
  _showSettingsDetail('payment');
}
function _settingsToggleArchive(i) {
  paymentOptions[i].archived = !paymentOptions[i].archived;
  savePaymentOptions();
  _showSettingsDetail('payment');
}
function _settingsAddPayment() {
  document.getElementById('pa-name').value = '';
  document.getElementById('pa-revenue').checked = false;
  document.getElementById('paymentAddForm').style.display = 'flex';
  document.getElementById('pa-name').focus();
}
function _settingsCancelAddPayment() {
  document.getElementById('paymentAddForm').style.display = 'none';
}
function _settingsSavePayment() {
  var name = document.getElementById('pa-name').value.trim();
  if (!name) return;
  var isRevenue = document.getElementById('pa-revenue').checked;
  paymentOptions.push({name:name, archived:false, showRevenue:isRevenue});
  savePaymentOptions();
  _showSettingsDetail('payment');
}

function _settingsToggleDeliveryArchive(i) {
  deliveryOptions[i].archived = !deliveryOptions[i].archived;
  saveDeliveryOptions();
  _showSettingsDetail('payment');
}
function _settingsSetDeliveryPrice(i, val) {
  deliveryOptions[i].price = parseFloat(val) || 0;
  saveDeliveryOptions();
}
var _daNewIcon = 'ti-truck-delivery';
function toggleDeliveryIconPicker(key, btn) {
  var list = document.getElementById('dip-' + key);
  if (!list) return;
  var isOpen = list.style.display !== 'none';
  document.querySelectorAll('.icon-picker-list').forEach(function(el){ el.style.display = 'none'; });
  if (isOpen) return;
  var rect = btn.getBoundingClientRect();
  var listWidth = 6 * 32 + 12;
  list.style.left = Math.min(rect.left, window.innerWidth - listWidth - 8) + 'px';
  list.style.top = (rect.bottom + 4) + 'px';
  list.style.display = 'grid';
}
function _settingsSetDeliveryIcon(key, icon) {
  document.querySelectorAll('.icon-picker-list').forEach(function(el){ el.style.display = 'none'; });
  if (key === 'new') {
    _daNewIcon = icon;
    document.getElementById('da-icon-btn').innerHTML = '<i class="ti ' + icon + '"></i>';
    return;
  }
  deliveryOptions[key].icon = icon;
  saveDeliveryOptions();
  _showSettingsDetail('payment');
}
function _settingsAddDelivery() {
  document.getElementById('da-name').value = '';
  document.getElementById('da-price').value = '0.00';
  _daNewIcon = 'ti-truck-delivery';
  document.getElementById('da-icon-btn').innerHTML = '<i class="ti ' + _daNewIcon + '"></i>';
  document.getElementById('deliveryAddForm').style.display = 'flex';
  document.getElementById('da-name').focus();
}
function _settingsCancelAddDelivery() {
  document.getElementById('deliveryAddForm').style.display = 'none';
}
function _settingsSaveDelivery() {
  var name = document.getElementById('da-name').value.trim();
  if (!name) return;
  var price = parseFloat(document.getElementById('da-price').value) || 0;
  deliveryOptions.push({name:name, archived:false, price:price, icon:_daNewIcon});
  saveDeliveryOptions();
  _showSettingsDetail('payment');
}

function _toggleDeliveryReorder() { _deliveryReorderMode = !_deliveryReorderMode; _showSettingsDetail('payment'); }
function _togglePaymentReorder() { _paymentReorderMode = !_paymentReorderMode; _showSettingsDetail('payment'); }
function _toggleShowArchivedDelivery() { _showArchivedDelivery = !_showArchivedDelivery; _showSettingsDetail('payment'); }
function _toggleShowArchivedPayment() { _showArchivedPayment = !_showArchivedPayment; _showSettingsDetail('payment'); }

var _reorderDragArr = null, _reorderDragIdx = null;
function _reorderDragStart(e, arrName, idx) {
  _reorderDragArr = arrName; _reorderDragIdx = idx;
  e.currentTarget.classList.add('dragging');
}
function _reorderDragOver(e, arrName, idx) {
  e.preventDefault();
  if (arrName === _reorderDragArr && idx !== _reorderDragIdx) e.currentTarget.classList.add('drag-over');
}
function _reorderDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function _reorderDragEnd(e) { e.currentTarget.classList.remove('dragging'); _reorderDragArr = null; _reorderDragIdx = null; }
function _reorderDrop(e, arrName, idx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (arrName !== _reorderDragArr || _reorderDragIdx === null || _reorderDragIdx === idx) return;
  var arr = arrName === 'delivery' ? deliveryOptions : paymentOptions;
  var moved = arr.splice(_reorderDragIdx, 1)[0];
  arr.splice(idx, 0, moved);
  if (arrName === 'delivery') saveDeliveryOptions(); else savePaymentOptions();
  _showSettingsDetail('payment');
}

// Users view
function _applyDetailFilters() {
  var q = (window._itemSearch || '').toLowerCase().trim();
  var sort = window._itemSort || 'default';
  var dir = window._itemSortDir || 1;
  var catCheckboxes = document.querySelectorAll('[data-detail-cat]');
  var unchecked = new Set(Array.from(catCheckboxes).filter(function(c){return !c.checked;}).map(function(c){return c.dataset.detailCat;}));
  var list = document.querySelector('.inbox-items-list');
  if (!list) return;
  var cards = Array.from(list.querySelectorAll('.inbox-item-card'));
  cards.forEach(function(card) {
    var vis = (!q || (card.dataset.search||'').includes(q)) && (!unchecked.size || !unchecked.has(card.dataset.catname));
    card.style.display = vis ? '' : 'none';
  });
  var sorted = sort === 'default'
    ? cards.slice().sort(function(a,b){return parseInt(a.dataset.idx||0)-parseInt(b.dataset.idx||0);})
    : cards.filter(function(c){return c.style.display!=='none';}).sort(function(a,b){
        if(sort==='textval') return (a.dataset.textval||'').localeCompare(b.dataset.textval||'')*dir;
        if(sort==='cat') return (a.dataset.catname||'').localeCompare(b.dataset.catname||'')*dir;
        if(sort==='price') return (parseFloat(a.dataset.price||0)-parseFloat(b.dataset.price||0))*dir;
        if(sort==='qty') return (parseInt(a.dataset.qty||0)-parseInt(b.dataset.qty||0))*dir;
        if(sort.indexOf('opt:')===0) return _optValFromCard(a,sort.slice(4)).localeCompare(_optValFromCard(b,sort.slice(4)))*dir;
        return 0;
      });
  sorted.forEach(function(c){list.appendChild(c);});
  var clr = document.getElementById('detailItemsClear');
  if (clr) clr.style.display = q ? 'block' : 'none';
  var fc = document.getElementById('detailFilterCount');
  if (fc) { fc.style.display = unchecked.size ? 'inline' : 'none'; if (unchecked.size) fc.textContent = unchecked.size; }
  var icon = document.getElementById('detailSortDirIcon');
  if (icon) icon.className = dir > 0 ? 'ti ti-arrow-up' : 'ti ti-arrow-down';
}

function _positionDetailPanel(btn, panel) {
  var r = btn.getBoundingClientRect();
  panel.style.top = (r.bottom + 6) + 'px';
  panel.style.right = (window.innerWidth - r.right) + 'px';
  panel.style.left = 'auto';
}

function toggleDetailFilterPanel(e) {
  e.stopPropagation();
  var p = document.getElementById('detailFilterPanel');
  var sp = document.getElementById('detailSortPanel');
  if (sp) sp.style.display = 'none';
  if (!p) return;
  if (p.style.display !== 'none') { p.style.display = 'none'; return; }
  _positionDetailPanel(e.currentTarget, p);
  p.style.display = '';
}

function toggleDetailSortPanel(e) {
  e.stopPropagation();
  var p = document.getElementById('detailSortPanel');
  var fp = document.getElementById('detailFilterPanel');
  if (fp) fp.style.display = 'none';
  if (!p) return;
  if (p.style.display !== 'none') { p.style.display = 'none'; return; }
  _positionDetailPanel(e.currentTarget, p);
  p.style.display = '';
}

function _optValFromCard(card, optName) {
  var str = card.dataset.optstr || '';
  var parts = str.split('||');
  for (var i = 0; i < parts.length; i++) {
    var idx = parts[i].indexOf(':');
    if (idx >= 0 && parts[i].slice(0, idx).trim() === optName) return parts[i].slice(idx + 1).trim().toLowerCase();
  }
  return '';
}

function _setDetailSort(field, label) {
  window._itemSort = field;
  document.querySelectorAll('[data-detail-sort]').forEach(function(el){el.classList.toggle('active', el.dataset.detailSort === field);});
  var btn = document.getElementById('detailSortBtn');
  if (btn) btn.innerHTML = '<i class="ti ti-arrows-sort"></i> ' + (label || 'Sort');
  var sp = document.getElementById('detailSortPanel');
  if (sp) sp.style.display = 'none';
  _applyDetailFilters();
}

function updateSidebarBadges() {}

function initSteppers(root) {
  (root || document).querySelectorAll('input[type=number]:not(.ns-init)').forEach(function(input) {
    if (input.closest('.stepper') || input.closest('.num-stepper')) return;
    input.classList.add('ns-init');
    var wrap = document.createElement('div');
    wrap.className = 'num-stepper';
    var w = input.style.width;
    if (w) { wrap.style.width = w; input.style.width = ''; } else { wrap.style.width = '100%'; }
    input.parentNode.insertBefore(wrap, input);
    function fire() { input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); }
    var dec = document.createElement('button');
    dec.type = 'button'; dec.className = 'ns-btn'; dec.textContent = '−';
    dec.addEventListener('click', function(){ input.stepDown(); fire(); });
    var inc = document.createElement('button');
    inc.type = 'button'; inc.className = 'ns-btn'; inc.textContent = '+';
    inc.addEventListener('click', function(){ input.stepUp(); fire(); });
    wrap.appendChild(dec); wrap.appendChild(input); wrap.appendChild(inc);
  });
}

(function() {
  var obs = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        initSteppers(node.matches && node.matches('input[type=number]') ? node.parentNode : node);
      });
    });
  });
  document.addEventListener('DOMContentLoaded', function() {
    initSteppers(document.body);
    obs.observe(document.body, {childList:true, subtree:true});
  });
})();

