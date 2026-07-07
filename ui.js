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
    setStatus('ok','All items updated');
  }catch(e){ setStatus('err','Save failed'); }
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

function normaliseOpts(optsStr){
  // Split by || (field separator), extract values, sort for order-independent matching
  if(!optsStr) return '';
  return optsStr.split('||')
    .map(p=>{ const idx=p.indexOf(':'); return idx>=0?p.slice(idx+1).trim().toLowerCase():p.trim().toLowerCase(); })
    .filter(Boolean).sort().join('|');
}

function wasPreviouslyMade(o, madeSet){
  // Show tick on ANY row whose catId + options matches a Complete row
  // including the completed row itself
  const sig = o.catId + '|' + normaliseOpts(o.options);
  return madeSet.has(sig);
}

// ── Render table ───────────────────────────────────────────

function uniqueOrderCount(){return new Set(orders.map(o=>o.orderId)).size;}

function orderNumFromId(orderId) {
  // Strip O prefix and leading zeros: O0000000007 → #7, O0000000042 → #42
  // Falls back to showing the raw id if format doesn't match
  const m = String(orderId).match(/^O?0*(\d+)$/);
  return m ? '#' + m[1] : '#' + orderId;
}

function renderTable(){
  const q = document.getElementById('search').value.toLowerCase();
  const fStatuses = getFilterValues('status');
  const fCats     = getFilterValues('cat');
  const fPays     = getFilterValues('pay');
  const madeSet=buildMadeSet();

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

  const tbody=document.getElementById('tbody');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="11" data-label=""><div class="empty"><i class="ti ti-inbox"></i>No orders yet.</div></td></tr>`;renderInboxList([]);return;}

  const seen=new Set();
  let groupIdx=0;
  const isMobile = window.innerWidth <= 640;
  const orderItemCount={};
  list.forEach(o=>{orderItemCount[o.orderId]=(orderItemCount[o.orderId]||0)+1;});

  renderInboxList(list);
  tbody.innerHTML=list.map(o=>{
    const isFirst=!seen.has(o.orderId);
    if(isFirst){ if(seen.size>0) groupIdx++; seen.add(o.orderId); }
    const altClass=groupIdx%2===1?'row-alt':'';
    const cat=cats.find(c=>String(c.id)===String(o.catId));
    const bc='b-'+(o.status||'pending').toLowerCase().replace(' ','-');
    const orderNum=orderNumFromId(o.orderId);
    const hasNote=!!o.notes.trim();
    const prevMade=wasPreviouslyMade(o, madeSet);

    // Parse options
    const parsedOpts={};
    if(o.options){o.options.split('||').forEach(p=>{const idx=p.indexOf(':');if(idx>=0)parsedOpts[p.slice(0,idx).trim()]=p.slice(idx+1).trim();});}
    const catOpts=opts.filter(opt=>String(opt.catId)===String(o.catId));

    const colourSwatches = catOpts.filter(opt=>opt.display==='colour'||opt.name.toLowerCase().includes('colour')).map(opt=>{
      const val=parsedOpts[opt.name];
      if(!val) return '';
      return val.split('|').map(name=>{
        const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());
        return`<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${c?c.code:'#ccc'};border:1px solid rgba(255,255,255,0.15)" title="${esc(name)}"></span>`;
      }).join('');
    }).join('');

    const textOpts = catOpts.filter(opt=>opt.display!=='colour'&&!opt.name.toLowerCase().includes('colour')).map(opt=>{
      const val=parsedOpts[opt.name];
      return val?esc(val):'';
    }).filter(Boolean).join(' · ');

    const statusDd=`<div class="status-dd-wrap" onclick="event.stopPropagation()">
      <button class="status-dd-btn b-${(o.status||'pending').toLowerCase().replace(' ','-')}" onclick="toggleStatusDd('${o.id}',this)">
        <span>${o.status||'Pending'}</span><i class="ti ti-chevron-down"></i>
      </button>
      <div class="status-dd-list" id="sdd-${o.id}">
        ${['Pending','Printing','Complete','On Hold','Cancelled'].map(s=>`
          <div class="status-dd-opt b-${s.toLowerCase().replace(' ','-')}${o.status===s?' active':''}"
            onclick="selectStatus('${esc(o.orderId)}','${esc(o.id)}','${s}',this)">${s}</div>`).join('')}
      </div>
    </div>`;

    if(isMobile){
      if(!isFirst) return ''; // Whole order rendered as one card
      const orderRows = list.filter(r=>r.orderId===o.orderId);
      const totalAmt  = orderRows.reduce((s,r)=>s+r.total,0);

      // Build each item row
      const itemRows = orderRows.map(r=>{
        const rCat = cats.find(c=>String(c.id)===String(r.catId));
        const rParsedOpts={};
        if(r.options){r.options.split('||').forEach(p=>{const idx=p.indexOf(':');if(idx>=0)rParsedOpts[p.slice(0,idx).trim()]=p.slice(idx+1).trim();});}
        const rCatOpts = opts.filter(opt=>String(opt.catId)===String(r.catId));
        const rSwatches = rCatOpts.filter(opt=>opt.display==='colour'||opt.name.toLowerCase().includes('colour')).map(opt=>{
          const val=rParsedOpts[opt.name];
          if(!val) return '';
          return val.split('|').map(name=>{
            const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());
            return`<span class="mc-swatch" style="background:${c?c.code:'#ccc'}" title="${esc(name)}"></span>`;
          }).join('');
        }).join('');
        const rTextOpts = rCatOpts.filter(opt=>opt.display!=='colour'&&!opt.name.toLowerCase().includes('colour')).map(opt=>{
          const val=rParsedOpts[opt.name];
          return val?esc(val):'';
        }).filter(Boolean).join(' · ');
        const rPrevMade = wasPreviouslyMade(r, madeSet);
        // Build labelled option lines
        const rLabelledOpts = rCatOpts.filter(opt=>opt.display!=='colour'&&!opt.name.toLowerCase().includes('colour')).map(opt=>{
          const val=rParsedOpts[opt.name];
          return val?`<span style="color:var(--muted)">${esc(opt.name)}:</span> ${esc(val)}`:'';
        }).filter(Boolean);
        const rColourOpts = rCatOpts.filter(opt=>opt.display==='colour'||opt.name.toLowerCase().includes('colour')).map(opt=>{
          const val=rParsedOpts[opt.name];
          if(!val) return '';
          const swatchHtml = val.split('|').map(name=>{
            const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());
            return`<span class="mc-swatch" style="background:${c?c.code:'#ccc'}" title="${esc(name)}"></span>`;
          }).join('');
          return`<div style="display:flex;align-items:center;gap:4px"><span style="color:var(--muted);font-size:10px">${esc(opt.name)}:</span>${swatchHtml}</div>`;
        }).filter(Boolean);

        return`<div class="mc-item">
          <div class="mc-item-left">
            <div class="mc-item-qty">×${r.qty}</div>
            <div class="mc-item-price">$${r.total.toFixed(2)}</div>
          </div>
          <div class="mc-item-divider"></div>
          <div class="mc-item-right">
            <div class="mc-item-cat">${rCat?esc(rCat.name):'—'}${rPrevMade?' <span class="made-tick"><i class="ti ti-circle-check-filled"></i></span>':''}</div>
            ${rLabelledOpts.map(l=>`<div class="mc-item-opt-row">${l}</div>`).join('')}
            ${rColourOpts.join('')}
          </div>
        </div>`;
      }).join('<div class="mc-item-sep"></div>');

      return`<tr class="mobile-card">
        <td colspan="11" style="padding:0;border:none!important;background:transparent!important">
          <div class="mc-card">
            <!-- Header: order# left | customer right | status fixed right -->
            <div class="mc-header">
              <div class="mc-header-left">
                <span class="mc-order-num">${orderNum}</span>
              </div>
              <div class="mc-header-divider"></div>
              <div class="mc-header-right">
                <div class="mc-customer">${esc(o.customer)||'—'}</div>
              </div>
              <div class="mc-header-status">${statusDd}</div>
            </div>
            <!-- Items -->
            <div class="mc-items">
              ${itemRows}
            </div>
            <!-- Footer -->
            <div class="mc-footer">
              <div class="mc-stat">
                <span class="mc-stat-label">Items</span>
                <span class="mc-stat-val">${orderRows.length}</span>
              </div>
              <div class="mc-stat-sep"></div>
              <div class="mc-stat">
                <span class="mc-stat-label">Total</span>
                <span class="mc-stat-val">$${totalAmt.toFixed(2)}</span>
              </div>
              <div class="mc-stat-sep"></div>
              <div class="mc-stat">
                <span class="mc-stat-label">Payment</span>
                <span class="mc-stat-val">${esc(o.payment||'—')}</span>
              </div>
              <div style="margin-left:auto;display:flex;gap:4px;align-items:center">
                ${hasNote?`<button class="icon-btn has-note" onclick="showNote('',${JSON.stringify(esc(o.notes))})" title="Note"><i class="ti ti-notes"></i></button>`:''}
                <button class="icon-btn" onclick="openEdit('${esc(o.orderId)}')" title="Edit"><i class="ti ti-edit"></i></button>
                <button class="icon-btn del" onclick="deleteOrder('${esc(o.orderId)}')" title="Delete"><i class="ti ti-trash"></i></button>
              </div>
            </div>
          </div>
        </td>
      </tr>`;
    }

    // ── Desktop row ──────────────────────────────────────────
    const catHtml=cat
      ?`<span class="cat-path">${esc(cat.name)}</span>${prevMade?'<span class="made-tick" title="Model previously made"><i class="ti ti-circle-check-filled"></i></span>':''}`
      :'—';
    const noteHtml=`<button class="note-btn ${hasNote?'has-note':'no-note'}" onclick="showNote(${JSON.stringify(esc(o.model))},${JSON.stringify(esc(o.notes))})" title="${hasNote?'View note':'No note'}"><i class="ti ti-notes"></i></button>`;
    const deliveryIcon=isFirst?(o.delivery==='Pick Up'
      ?'<i class="ti ti-hand-stop" title="Pick Up" style="font-size:13px;color:var(--muted);margin-right:5px;flex-shrink:0"></i>'
      :'<i class="ti ti-mail" title="Post" style="font-size:13px;color:var(--muted);margin-right:5px;flex-shrink:0"></i>'):'';
    const optLines=catOpts.map(opt=>{
      const val=parsedOpts[opt.name];
      if(!val) return null;
      const isColOpt=opt.display==='colour'||opt.name.toLowerCase().includes('colour')||opt.name.toLowerCase().includes('color');
      if(isColOpt){
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
    const isBadgeCat=cat&&cat.name.toLowerCase().includes('name badge');
    const isKeychainCat=cat&&cat.name.toLowerCase().includes('keychain');
    const _genBacking=isKeychainCat?(parsedOpts['Backing']||'Keychain'):(parsedOpts['Backing']||'');
    const badgeBtn=(isBadgeCat||isKeychainCat)?`<button class="icon-btn" title="Generate ${isKeychainCat?'Keychain':'Badge'}" onclick="generateBadge('/badge/?${new URLSearchParams({name:parsedOpts['Text']||'',backing:_genBacking,colours:parsedOpts['Colours']||''})}')"><i class="ti ${isKeychainCat?'ti-key':'ti-badge'}"></i></button>`:'';
    const optHtml=optLines.length?optLines.map(l=>`<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px">${l}</div>`).join(''):'';
    const isMulti=orderItemCount[o.orderId]>1;
    const noteRow=hasNote?`<tr class="note-inline-row ${altClass}">
      <td colspan="3"></td>
      <td colspan="6" class="note-inline-cell"><div class="note-inline-cell-inner"><i class="ti ti-notes" style="font-size:12px;margin-right:5px;opacity:0.5;flex-shrink:0"></i>${esc(o.notes)}</div></td>
      <td colspan="2"></td>
    </tr>`:'';

    // Item cells (category → status) reused for both single and multi-item rows
    const itemCells=`
      <td data-label="Category" style="padding:7px 8px">${catHtml}</td>
      <td data-label="Options" style="padding:7px 8px;font-size:11px;overflow:visible;white-space:normal;line-height:1.6">${optHtml}</td>
      <td style="padding:4px 4px;text-align:center;vertical-align:middle">${badgeBtn}</td>
      <td data-label="Qty" class="mono" style="padding:7px 8px">${o.qty}</td>
      <td data-label="Total" class="mono" style="padding:7px 8px">$${o.total.toFixed(2)}</td>
      <td data-label="Status" style="padding:7px 6px;text-align:center">${statusDd}</td>`;

    if(isMulti && isFirst){
      // Summary row: customer info + order-level status dropdown
      const orderRows=list.filter(r=>r.orderId===o.orderId);
      // Collect badge params for all badge-category items in this order
      const badgeItems=orderRows.reduce((acc,r)=>{
        const rCat=cats.find(c=>c.id===r.catId);
        if(!rCat) return acc;
        const rIsKeychain=rCat.name.toLowerCase().includes('keychain');
        if(!rCat.name.toLowerCase().includes('name badge')&&!rIsKeychain) return acc;
        const rOpts={};
        if(r.options) r.options.split('||').forEach(p=>{const idx=p.indexOf(':');if(idx>=0)rOpts[p.slice(0,idx).trim()]=p.slice(idx+1).trim();});
        const qty=r.qty||1;
        const backing=rIsKeychain?(rOpts['Backing']||'Keychain'):(rOpts['Backing']||'');
        for(let q=0;q<qty;q++) acc.push({name:rOpts['Text']||'',backing,colours:rOpts['Colours']||''});
        return acc;
      },[]);
      const allBadgesBtn=badgeItems.length>1?`<button class="icon-btn" title="Generate all ${badgeItems.length} badges" onclick="openBadgeBatchModal(${esc(JSON.stringify(badgeItems))},${esc(JSON.stringify(o.customer||'badges'))})"><i class="ti ti-badges"></i></button>`:'';
      const catTotals={};
      const seenColours=new Set();
      orderRows.forEach(r=>{
        const name=(cats.find(c=>c.id===r.catId)||{}).name||'Unknown';
        catTotals[name]=(catTotals[name]||0)+(r.qty||1);
        if(r.options){
          r.options.split('||').forEach(p=>{
            const idx=p.indexOf(':');
            if(idx<0) return;
            const key=p.slice(0,idx).trim().toLowerCase();
            if(key.includes('colour')||key.includes('color')){
              p.slice(idx+1).trim().split('|').forEach(cn=>{if(cn.trim())seenColours.add(cn.trim());});
            }
          });
        }
      });
      const itemSummaryHtml=Object.entries(catTotals).map(([name,qty])=>
        `<div style="font-size:10px;color:var(--muted);line-height:1.6">${qty}× ${name}</div>`
      ).join('');
      const colourSwatchSummary=seenColours.size?`<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;margin-top:2px">${[...seenColours].map(name=>{
        const c=colours.find(c=>c.name.toLowerCase()===name.toLowerCase());
        return`<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${c?c.code:'#ccc'};border:1px solid rgba(255,255,255,0.15)" title="${esc(name)}"></span>`;
      }).join('')}</div>`:'';
      const orderStat=o.status||'Pending';
      const orderStatusDd=`<div class="status-dd-wrap" onclick="event.stopPropagation()">
        <button class="status-dd-btn order-status-dd b-${orderStat.toLowerCase().replace(' ','-')}" onclick="toggleStatusDd('order-${esc(o.orderId)}',this)">
          <span>${orderStat}</span><i class="ti ti-chevron-down"></i>
        </button>
        <div class="status-dd-list" id="sdd-order-${esc(o.orderId)}">
          ${['Pending','Printing','Complete','On Hold','Cancelled'].map(s=>`
            <div class="status-dd-opt b-${s.toLowerCase().replace(' ','-')}${orderStat===s?' active':''}"
              onclick="selectOrderStatus('${esc(o.orderId)}','${s}',this)">${s}</div>`).join('')}
        </div>
      </div>`;
      const summaryRow=`<tr class="group-first order-summary-row ${altClass}">
        <td class="card-order-num" style="padding:7px 8px"><span class="order-id-badge">${orderNum}</span></td>
        <td data-label="Customer" style="padding:7px 8px" title="${esc(o.customer)}">${o.customer_id?`<a href="#" onclick="viewCustomer('${esc(o.customer_id)}');return false;" style="color:inherit;text-decoration:none;border-bottom:1px solid var(--border2)">${esc(o.customer)}</a>`:esc(o.customer)||'—'}</td>
        <td data-label="Address" style="padding:7px 8px;white-space:normal;word-break:break-word;font-size:11px;color:var(--muted)"><span style="display:flex;align-items:flex-start;gap:4px">${deliveryIcon}<span title="${esc(o.address)}">${esc(o.address)||'—'}</span>${o.address?`<button class="icon-btn" style="flex-shrink:0;margin-left:2px" onclick="printShippingLabel('${esc(o.customer)}','${esc(o.address)}','${esc(o.orderId)}')" title="Print shipping label"><i class="ti ti-printer"></i></button>`:''}</span></td>
        <td style="padding:7px 8px;vertical-align:middle">${itemSummaryHtml}</td>
        <td style="padding:7px 8px;vertical-align:middle">${colourSwatchSummary}</td>
        <td style="padding:4px 4px;text-align:center;vertical-align:middle">${allBadgesBtn}</td>
        <td colspan="2" style="padding:4px 8px;text-align:right;font-size:10px;color:var(--muted);white-space:nowrap;vertical-align:middle">Applies to entire order</td>
        <td data-label="Status" style="padding:4px 6px;text-align:center">${orderStatusDd}</td>
        <td data-label="$" style="padding:7px 6px;text-align:center"><span class="pay-${(o.payment||'N')[0].toUpperCase()}">${(o.payment||'No')[0].toUpperCase()}</span></td>
        <td class="card-actions" style="padding:5px 6px"><div style="display:flex;gap:3px;justify-content:flex-end">
          <button class="icon-btn" onclick="openEdit('${esc(o.orderId)}')" title="Edit"><i class="ti ti-edit"></i></button>
          <button class="icon-btn del" onclick="deleteOrder('${esc(o.orderId)}')" title="Delete"><i class="ti ti-trash"></i></button>
        </div></td>
      </tr>`;
      const itemRow=`<tr class="inner-row ${altClass} ${hasNote?'has-note':''}">
        <td></td><td></td><td class="item-connector"></td>${itemCells}
        <td></td><td class="card-actions" style="padding:5px 6px"></td>
      </tr>${noteRow}`;
      return summaryRow+itemRow;
    }

    if(isMulti && !isFirst){
      return`<tr class="inner-row ${altClass} ${hasNote?'has-note':''}">
        <td></td><td></td><td class="item-connector"></td>${itemCells}
        <td></td><td class="card-actions" style="padding:5px 6px"></td>
      </tr>${noteRow}`;
    }

    // Single-item order — original layout
    return`<tr class="group-first ${altClass} ${hasNote?'has-note':''}">
      <td class="card-order-num" style="padding:7px 8px"><span class="order-id-badge">${orderNum}</span></td>
      <td data-label="Customer" style="padding:7px 8px" title="${esc(o.customer)}">${o.customer_id?`<a href="#" onclick="viewCustomer('${esc(o.customer_id)}');return false;" style="color:inherit;text-decoration:none;border-bottom:1px solid var(--border2)">${esc(o.customer)}</a>`:esc(o.customer)||'—'}</td>
      <td data-label="Address" style="padding:7px 8px;white-space:normal;word-break:break-word;font-size:11px;color:var(--muted)"><span style="display:flex;align-items:flex-start;gap:4px">${deliveryIcon}<span title="${esc(o.address)}">${esc(o.address)||'—'}</span>${o.address?`<button class="icon-btn" style="flex-shrink:0;margin-left:2px" onclick="printShippingLabel('${esc(o.customer)}','${esc(o.address)}','${esc(o.orderId)}')" title="Print shipping label"><i class="ti ti-printer"></i></button>`:''}</span></td>
      ${itemCells}
      <td data-label="$" style="padding:7px 6px;text-align:center"><span class="pay-${(o.payment||'N')[0].toUpperCase()}">${(o.payment||'No')[0].toUpperCase()}</span></td>
      <td class="card-actions" style="padding:5px 6px"><div style="display:flex;gap:3px;justify-content:flex-end">
        <button class="icon-btn" onclick="openEdit('${esc(o.orderId)}')" title="Edit"><i class="ti ti-edit"></i></button>
        <button class="icon-btn del" onclick="deleteOrder('${esc(o.orderId)}')" title="Delete"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>${noteRow}`;
  }).join('');
}

function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sortBy(k){
  if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=-1;}
  savePreferences();
  updateSortUI();
  renderTable();
}
function showNote(m,n){document.getElementById('noteModalTitle').textContent=m?'Note — '+m:'Note';document.getElementById('noteModalBody').textContent=n||'(No note recorded)';document.getElementById('noteModal').classList.add('open');}
function closeNoteModal(){document.getElementById('noteModal').classList.remove('open');}

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
      return`<div class="opt-row"><label>${esc(opt.name)}</label><div style="display:flex;align-items:center;gap:6px;flex:1"><input type="text" id="ov-${idx}-${opt.id}" value="${inputVal}" placeholder="Enter ${esc(opt.name).toLowerCase()}… or comma-separate for multiple" style="${capsStyle}flex:1" oninput="${capsHandler}">${multiBadge}</div></div>${warnDiv}`;
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
  const opt = opts.find(o=>String(o.id)===String(optId));
  const numLayers = opt?.num_colours || 4;
  container.innerHTML=`<div class="layer-selectors">
    ${Array.from({length:numLayers},(_,i)=>i+1).map(n=>{
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
      <div class="mf"><label>Qty</label><div class="stepper"><button type="button" class="step-btn" onclick="stepVal('mq-${idx}',-1,1,1)">−</button><input type="number" id="mq-${idx}" value="${d.qty||1}" min="1" oninput="calcTotal()"><button type="button" class="step-btn" onclick="stepVal('mq-${idx}',1,1,1)">+</button></div></div>
      <div class="mf"><label>Price (each)</label><div class="stepper"><button type="button" class="step-btn" onclick="stepVal('mp-${idx}',-0.5,0,0.5)">−</button><input type="number" id="mp-${idx}" value="${d.price||''}" step="0.01" min="0" placeholder="0.00" oninput="calcTotal()"><button type="button" class="step-btn" onclick="stepVal('mp-${idx}',0.5,0,0.5)">+</button></div></div>
      <div class="model-row-total"><label>Total</label><div class="total-val" id="mt-${idx}">—</div></div>
    </div>
    <div class="model-options" id="mo-${idx}"></div>
    <div class="model-notes"><input type="text" id="mn-${idx}" value="${esc(d.notes||'')}" placeholder="Item notes (colour, material, special requests…)"></div>
    <input type="hidden" id="mm-${idx}" value="${esc(d.model||'')}">
    <input type="hidden" id="opts-${idx}" value="${esc(d.options||'')}">
    <div class="model-row-footer">
      <button type="button" class="rm-btn-full" onclick="removeModel(this)"><i class="ti ti-trash"></i> Remove Item</button>
    </div>`;
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

function stepVal(id, delta, min, step){
  const el=document.getElementById(id);
  if(!el) return;
  const val=parseFloat(el.value)||0;
  el.value=Math.max(min,Math.round((val+delta*step)*1000)/1000);
  el.dispatchEvent(new Event('input'));
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
  const f=document.getElementById('itemFilter');
  if(!f)return;
  if(count>5){f.style.display='';} else {f.style.display='none';f.value='';filterModelRows('');}
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
        async()=>{
          closeModal();
          setStatus('spin','Deleting…');
          orders=orders.filter(o=>o.orderId!==editOId);renderTable();
          try{
            await sbDelete('orders','order_id=eq.'+encodeURIComponent(editOId));
            setStatus('ok','Deleted · '+uniqueOrderCount()+' orders');
          }catch(e){setStatus('err','Delete failed: '+e.message);}
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

// ── Order modals ───────────────────────────────────────────
function openAddModal(){
  editOId=null;acInst=null;
  document.getElementById('modalTitle').textContent='New Order';
  document.getElementById('f-customer').value='';
  document.getElementById('f-customer-id').value='';
  document.getElementById('f-address').value='';
  document.getElementById('f-address').classList.remove('validated');
  document.getElementById('addrTick').style.display='none';
  document.getElementById('f-delivery').value='Post';
  // Build payment dropdown from config
  const fPayment = document.getElementById('f-payment');
  fPayment.innerHTML = getActivePaymentOptions().map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  fPayment.value = getActivePaymentOptions()[0]?.name||'No';
  document.getElementById('newCustomerPanel').style.display='none';
  updateAddrRefreshBtn();
  const today=todayDMY();
  document.getElementById('f-date').value=today;
  document.getElementById('f-date-display').textContent=today;
  document.getElementById('modelRows').innerHTML='';mCounter=0;
  const _if=document.getElementById('itemFilter');if(_if){_if.value='';_if.style.display='none';}
  addModelRow();
  document.getElementById('orderModal').classList.add('open');
  setTimeout(()=>{document.getElementById('f-customer').focus();initAutocomplete();initCustomerAutocomplete();},80);
}

function openEdit(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);if(!rows.length)return;
  editOId=orderId;acInst=null;const first=rows[0];
  document.getElementById('modalTitle').textContent='Edit Order';
  document.getElementById('f-customer').value=first.customer;
  document.getElementById('f-customer-id').value=first.customer_id||'';
  // Auto-show new customer panel for orders not yet linked to a customer record
  document.getElementById('newCustomerPanel').style.display = first.customer_id ? 'none' : '';
  updateAddrRefreshBtn();
  updateCustomerBorder();
  document.getElementById('f-address').value=first.address||'';
  if(first.address){document.getElementById('f-address').classList.add('validated');document.getElementById('addrTick').style.display='';}
  else{document.getElementById('f-address').classList.remove('validated');document.getElementById('addrTick').style.display='none';}
  document.getElementById('f-delivery').value=first.delivery||'Post';
  const fPayment2 = document.getElementById('f-payment');
  fPayment2.innerHTML = getActivePaymentOptions().map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  fPayment2.value = first.payment||getActivePaymentOptions()[0]?.name||'No';
  const d=toDisplay(first.date);
  document.getElementById('f-date').value=d;
  document.getElementById('f-date-display').textContent=d;
  document.getElementById('modelRows').innerHTML='';mCounter=0;
  const _if2=document.getElementById('itemFilter');if(_if2){_if2.value='';_if2.style.display='none';}
  rows.forEach(r=>addModelRow({model:r.model,catId:r.catId,qty:r.qty,price:r.price,notes:r.notes,options:r.options}));
  document.getElementById('orderModal').classList.add('open');
  setTimeout(()=>{initAutocomplete();initCustomerAutocomplete();},80);
}

function closeModal(){
  document.getElementById('orderModal').classList.remove('open');
  // Clear validation state
  document.querySelectorAll('.field-error').forEach(el=>el.classList.remove('field-error'));
  document.querySelectorAll('.field-error-msg').forEach(el=>el.remove());
  document.querySelectorAll('.model-row.row-error').forEach(el=>el.classList.remove('row-error'));
  document.querySelectorAll('.opt-row.opt-error').forEach(el=>el.classList.remove('opt-error'));
  document.querySelectorAll('.colour-picker-wrap.cp-error').forEach(el=>el.classList.remove('cp-error'));
  const panel = document.getElementById('newCustomerPanel');
  if(panel) panel.style.display='none';
  ['nc-email','nc-phone','nc-notes'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const custInput = document.getElementById('f-customer');
  if(custInput) custInput.classList.remove('cust-linked','cust-new');
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
        customer_id: row.customer_id||null,
        address: row.address, delivery: row.delivery, payment: row.payment,
        cat_id: row.catId, qty: row.qty,
        price: row.price, total: row.total, status: row.status,
        date: row.date, notes: row.notes, options: row.options
      });
    }
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

async function deleteOrder(orderId){
  const rows=orders.filter(o=>o.orderId===orderId);
  const msg = rows.length>1?`Delete this order (${rows.length} models)?`:'Delete this order?';
  showConfirm(msg, async ()=>{
    setStatus('spin','Deleting…');
    orders=orders.filter(o=>o.orderId!==orderId);renderTable();
    try{
      await sbDelete('orders', 'order_id=eq.'+encodeURIComponent(orderId));
      setStatus('ok','Deleted · '+uniqueOrderCount()+' orders');
    }catch(e){setStatus('err','Delete failed: '+e.message);}
  });
  return;
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
  panel.style.left = Math.max(8, rect.right - 220) + 'px';
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
  const palette = ['#5b9cf6','#5cb87a','#e8a93a','#e07c3a','#9b8af6','#e05c5c','#3ab8b8','#c47ab8'];
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
  updateSidebarBadges();
  if (_sidebarView !== 'orders') return;
  const el = document.getElementById('inboxList');
  if (!el) return;

  // Apply tab filter
  let filtered = list;
  if (_inboxTab === 'pending')  filtered = list.filter(r => (r.status||'Pending') === 'Pending');
  if (_inboxTab === 'printing') filtered = list.filter(r => r.status === 'Printing');
  if (_inboxTab === 'complete') filtered = list.filter(r => r.status === 'Complete');

  const orderIds = [];
  const orderMap = new Map();
  filtered.forEach(row => {
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
    const total = rows.reduce((s, r) => s + r.total, 0);
    const status = first.status || 'Pending';
    const blClass = 'bl-' + status.toLowerCase().replace(' ', '-');
    const isSelected = oid === String(_inboxSelectedOrderId);
    const catNames = [...new Set(rows.map(r => {
      const cat = cats.find(c => String(c.id) === String(r.catId));
      return cat ? cat.name : null;
    }).filter(Boolean))].join(', ');
    const itemLabel = rows.length === 1 ? '1 item' : rows.length + ' items';
    const orderNum = orderNumFromId(oid);
    const avatarColor = _avatarColor(first.customer || '');
    const initials = _initials(first.customer || '');
    const statusColor = {Pending:'rgba(232,169,58,0.15)',Printing:'rgba(91,156,246,0.15)',Complete:'rgba(92,184,122,0.15)','On Hold':'rgba(224,124,58,0.15)',Cancelled:'rgba(224,92,92,0.15)'}[status]||'rgba(136,136,133,0.15)';
    const statusText = {Pending:'var(--amber)',Printing:'var(--blue)',Complete:'var(--green)','On Hold':'var(--orange)',Cancelled:'var(--red)'}[status]||'var(--muted)';

    return '<div class="inbox-card ' + blClass + (isSelected ? ' selected' : '') + '" onclick="showInboxDetail(\'' + esc(oid) + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1">'
      + '<span class="inbox-card-customer">' + (esc(first.customer) || '?') + '</span>'
      + '<span class="inbox-card-num">' + orderNum + '</span>'
      + '</div>'
      + '<div class="inbox-card-subject">' + (esc(catNames) || '?') + ' &middot; ' + itemLabel + '</div>'
      + '<div class="inbox-card-footer">'
      + '<span class="inbox-card-status" style="background:' + statusColor + ';color:' + statusText + '">' + status + '</span>'
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

function _inboxClearDetailIfGone(orderIds) {
  if (_inboxSelectedOrderId && !orderIds.includes(String(_inboxSelectedOrderId))) {
    _inboxSelectedOrderId = null;
    const d = document.getElementById('inboxDetail');
    if (d) d.innerHTML = '<div class="inbox-no-selection"><i class="ti ti-inbox"></i><p>Select an order</p></div>';
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
  const bc = 'b-' + status.toLowerCase().replace(' ', '-');
  const total = rows.reduce((s, r) => s + r.total, 0);
  const orderNum = orderNumFromId(orderId);
  const madeSet = buildMadeSet();

  const statusOpts = ['Pending','Printing','Complete','On Hold','Cancelled'].map(s =>
    '<div class="status-dd-opt b-' + s.toLowerCase().replace(' ','-') + (status===s?' active':'') + '"'
    + ' onclick="selectOrderStatus(\'' + esc(String(orderId)) + '\',\'' + s + '\',this)">' + s + '</div>'
  ).join('');

  const statusDd = '<div class="status-dd-wrap">'
    + '<button class="status-dd-btn order-status-dd ' + bc + '" onclick="toggleStatusDd(\'order-' + esc(String(orderId)) + '\',this)">'
    + '<span>' + esc(status) + '</span><i class="ti ti-chevron-down"></i>'
    + '</button>'
    + '<div class="status-dd-list" id="sdd-order-' + esc(String(orderId)) + '">' + statusOpts + '</div>'
    + '</div>';

  const deliveryIcon = first.delivery === 'Pick Up' ? '<i class="ti ti-hand-stop"></i>' : '<i class="ti ti-mail"></i>';

  const itemsHtml = rows.map(row => {
    const cat = cats.find(c => String(c.id) === String(row.catId));
    const parsedOpts = {};
    if (row.options) row.options.split('||').forEach(p => {
      const idx = p.indexOf(':'); if (idx >= 0) parsedOpts[p.slice(0,idx).trim()] = p.slice(idx+1).trim();
    });
    const catOpts = opts.filter(o => String(o.catId) === String(row.catId));
    const prevMade = wasPreviouslyMade(row, madeSet);
    const isBadge = cat && cat.name.toLowerCase().indexOf('name badge') !== -1;

    const optLines = catOpts.map(opt => {
      const val = parsedOpts[opt.name];
      if (!val) return '';
      const isColour = opt.display === 'colour' || opt.name.toLowerCase().indexOf('colour') !== -1;
      if (isColour) {
        const swatches = val.split('|').map(name => {
          const c = colours.find(c => c.name.toLowerCase() === name.toLowerCase());
          return '<span class="inbox-item-swatch" style="background:' + (c ? c.code : '#ccc') + '" title="' + esc(name) + '"></span>';
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
      ? '<button class="icon-btn" title="Generate Badge" onclick="generateBadge(\'/badge/?' + badgeParams + '\')"><i class="ti ti-badge"></i></button>'
      : '';

    return '<div class="inbox-item-card">'
      + '<div class="inbox-item-left">'
      + '<div class="inbox-item-qty">' + row.qty + '</div>'
      + '<div class="inbox-item-qty-label">qty</div>'
      + '<div class="inbox-item-price">$' + row.total.toFixed(2) + '</div>'
      + '</div>'
      + '<div class="inbox-item-divider"></div>'
      + '<div class="inbox-item-right">'
      + '<div class="inbox-item-cat">' + (cat ? esc(cat.name) : '?') + (prevMade ? ' <span class="made-tick"><i class="ti ti-circle-check-filled"></i></span>' : '') + '</div>'
      + optLines
      + (row.notes ? '<div class="inbox-item-opt" style="margin-top:5px"><i class="ti ti-notes" style="font-size:12px;opacity:0.5"></i> <em style="color:var(--muted)">' + esc(row.notes) + '</em></div>' : '')
      + '</div>'
      + (badgeBtn ? '<div class="inbox-item-actions">' + badgeBtn + '</div>' : '')
      + '</div>';
  }).join('');

  const badgeRows = rows.filter(r => {
    const c = cats.find(c => String(c.id) === String(r.catId));
    return c && c.name.toLowerCase().indexOf('name badge') !== -1;
  });
  const batchItems = badgeRows.map(r => {
    const p = {};
    if (r.options) r.options.split('||').forEach(s => { const i = s.indexOf(':'); if (i >= 0) p[s.slice(0,i).trim()] = s.slice(i+1).trim(); });
    return {name: p['Text']||'', backing: p['Backing']||'', colours: p['Colours']||''};
  });
  const bulkBadgeBtn = badgeRows.length
    ? '<button class="btn sm" onclick="openBadgeBatchModal(' + JSON.stringify(batchItems) + ',\'' + esc(first.customer) + '\')"><i class="ti ti-badges"></i> ' + (badgeRows.length > 1 ? 'All Badges' : 'Badge') + '</button>'
    : '';

  const printBtn = first.address
    ? '<button class="icon-btn" style="margin-left:4px" onclick="printShippingLabel(\'' + esc(first.customer) + '\',\'' + esc(first.address) + '\',\'' + esc(String(orderId)) + '\')" title="Print label"><i class="ti ti-printer"></i></button>'
    : '';

  detailEl.innerHTML = '<div class="inbox-detail">'
    + '<div class="inbox-detail-header">'
    + '<div class="inbox-detail-header-top">'
    + '<div class="inbox-detail-customer">' + (esc(first.customer) || '?') + '</div>'
    + '<div class="inbox-detail-num">' + orderNum + '</div>'
    + '</div>'
    + '<div class="inbox-detail-header-bot">'
    + statusDd
    + '<div style="flex:1"></div>'
    + '<button class="btn sm" onclick="openEdit(\'' + esc(String(orderId)) + '\')"><i class="ti ti-edit"></i> Edit</button>'
    + '<button class="btn sm icon-only" onclick="deleteOrder(\'' + esc(String(orderId)) + '\')" title="Delete order" style="border-color:rgba(224,92,92,0.3);color:var(--red)"><i class="ti ti-trash"></i></button>'
    + '</div>'
    + '</div>'

    + '<div class="inbox-detail-meta">'
    + '<div class="inbox-detail-meta-item">' + deliveryIcon + '<strong>' + esc(first.delivery || 'Post') + '</strong></div>'
    + (first.payment ? '<div class="inbox-detail-meta-item"><i class="ti ti-credit-card"></i><strong>' + esc(first.payment) + '</strong></div>' : '')
    + (first.address ? '<div class="inbox-detail-meta-item"><i class="ti ti-map-pin"></i><strong>' + esc(first.address) + '</strong>' + printBtn + '</div>' : '')
    + '</div>'

    + '<div>'
    + '<div class="inbox-detail-items-hdr">'
    + '<div class="inbox-detail-items-label">Items (' + rows.length + ')</div>'
    + bulkBadgeBtn
    + '</div>'
    + '<div class="inbox-items-list">' + itemsHtml + '</div>'
    + '</div>'

    + '<div class="inbox-detail-total">'
    + '<span class="inbox-detail-total-label">Order total</span>'
    + '<span class="inbox-detail-total-val">$' + total.toFixed(2) + '</span>'
    + '</div>'
    + '</div>';
}

// -- Multi-view sidebar system ------------------------------------
let _sidebarView = 'orders';
let _selectedCustomerId = null;

function setSidebarView(view) {
  _sidebarView = view;
  document.querySelectorAll('.topbar-item[data-view]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.view === view);
  });
  _inboxSelectedOrderId = null;
  var detail = document.getElementById('inboxDetail');
  if (detail) detail.innerHTML = '<div class="inbox-no-selection"><i class="ti ti-inbox"></i><p>Select an item</p></div>';
  if (view === 'orders') _renderViewOrders();
  else if (view === 'customers') _renderViewCustomers('');
  else if (view === 'colours') _renderViewColours();
  else if (view === 'categories') _renderViewCategories();
  else if (view === 'stats') _renderViewStats();
  else if (view === 'settings') _renderViewSettings();
  else if (view === 'users') _renderViewUsers();
}

function _setListPane(headerHtml) {
  var col = document.querySelector('.inbox-list-col');
  var footer = col.querySelector('.inbox-list-footer').outerHTML;
  col.innerHTML = '<div class="inbox-list-header" style="padding:12px 14px">' + headerHtml + '</div>'
    + '<div class="inbox-list" id="inboxList"></div>'
    + footer;
}

// Orders view: restore the full orders header + renderTable
function _renderViewOrders() {
  var col = document.querySelector('.inbox-list-col');
  var footer = col.querySelector('.inbox-list-footer').outerHTML;
  var activeTab = _inboxTab || 'all';
  col.innerHTML = '<div class="inbox-list-header">'
    + '<div class="inbox-search-row">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" id="search" placeholder="Search…" oninput="renderTable()">'
    + '</div>'
    + '<div class="inbox-tabs-pill">'
    + ['all','pending','printing','complete'].map(function(t) {
        var label = t.charAt(0).toUpperCase() + t.slice(1);
        return '<button class="inbox-tab-pill' + (activeTab===t?' active':'') + '" data-tab="' + t + '" onclick="setInboxTab(\'' + t + '\')">' + label + '</button>';
      }).join('')
    + '</div>'
    + '<div class="inbox-sort-row">'
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
  renderTable();
}

// Customers view
function _renderViewCustomers(filter) {
  filter = filter || '';
  _setListPane(
    '<div class="inbox-view-header">'
    + '<span class="inbox-view-title">Customers</span>'
    + '<span class="inbox-view-count">' + customers.length + '</span>'
    + '</div>'
    + '<div class="inbox-search-row">'
    + '<i class="ti ti-search inbox-search-icon"></i>'
    + '<input type="text" placeholder="Search customers…" value="' + esc(filter) + '" oninput="_renderViewCustomers(this.value)">'
    + '</div>'
  );
  var list = document.getElementById('inboxList');
  var q = filter.toLowerCase();
  var shown = customers.filter(function(c) {
    return !q || c.name.toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q);
  });
  if (!shown.length) { list.innerHTML = '<div class="inbox-empty-state"><i class="ti ti-users"></i> No customers</div>'; return; }
  list.innerHTML = shown.map(function(c) {
    var ordSet = new Set(orders.filter(function(r) { return String(r.customer_id)===String(c.id)||r.customer===c.name; }).map(function(r){return r.orderId;}));
    var ordCount = ordSet.size;
    var isSelected = String(c.id) === String(_selectedCustomerId);
    var av = _avatarColor(c.name);
    var ini = _initials(c.name);
    return '<div class="inbox-card' + (isSelected?' selected':'') + '" onclick="_showCustomerDetail(\'' + esc(String(c.id)) + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer">' + esc(c.name) + '</span>'
      + (ordCount ? '<span class="inbox-card-num">' + ordCount + ' order' + (ordCount!==1?'s':'') + '</span>' : '')
      + '</div>'
      + '<div class="inbox-card-subject">' + (esc(c.email) || '<em style="opacity:0.4">No email</em>') + '</div>'
      + '<div class="inbox-card-footer"><span style="font-size:11px;color:var(--muted)">' + (esc(c.phone)||'') + '</span></div>'
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
  var totalSpend = custOrders.reduce(function(s,r){return s+r.total;},0);
  var html = '<div class="inbox-detail">'
    + '<div class="inbox-detail-header">'
    + '<div class="inbox-detail-header-top">'
    + '<div style="flex:1;min-width:0">'
    + '<div class="inbox-detail-customer">' + esc(c.name) + '</div>'
    + (c.email?'<div style="font-size:12px;color:var(--muted);margin-top:2px">'+esc(c.email)+'</div>':'')
    + '</div>'
    + '<button class="btn sm" onclick="openCustomersModal(\''+esc(String(c.id))+'\')"><i class="ti ti-edit"></i> Edit</button>'
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
      + '<div style="display:flex;flex-direction:column;gap:8px">';
    orderIds.forEach(function(oid){
      var rows = orderMap.get(oid);
      var first = rows[0];
      var total = rows.reduce(function(s,r){return s+r.total;},0);
      var status = first.status||'Pending';
      var bc = 'b-'+status.toLowerCase().replace(' ','-');
      var orderNum = orderNumFromId(oid);
      var catNames = [...new Set(rows.map(function(r){var cat=cats.find(function(c){return String(c.id)===String(r.catId);});return cat?cat.name:null;}).filter(Boolean))].join(', ');
      html += '<div class="inbox-item-card" style="cursor:pointer" onclick="_switchToOrder(\''+esc(String(oid))+'\')">'
        + '<div class="inbox-item-left"><div class="inbox-item-qty">'+rows.length+'</div><div class="inbox-item-qty-label">items</div><div class="inbox-item-price">$'+total.toFixed(2)+'</div></div>'
        + '<div class="inbox-item-divider"></div>'
        + '<div class="inbox-item-right"><div class="inbox-item-cat">'+orderNum+' &mdash; '+esc(catNames)+'</div>'
        + '<div style="margin-top:4px"><span class="'+bc+'" style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:2px">'+status+'</span></div>'
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

// Colours view
function _renderViewColours() {
  _setListPane('<div class="inbox-view-header"><span class="inbox-view-title">Colours</span><span class="inbox-view-count">'+colours.filter(function(c){return c.available!==false;}).length+'</span></div>');
  var list = document.getElementById('inboxList');
  if (!colours.length) { list.innerHTML = '<div class="inbox-empty-state"><i class="ti ti-palette"></i> No colours</div>'; return; }
  list.innerHTML = colours.map(function(c){
    return '<div class="inbox-card" style="align-items:center;padding:10px 14px">'
      + '<div style="width:30px;height:30px;border-radius:50%;background:'+esc(c.code)+';border:1px solid rgba(255,255,255,0.1);flex-shrink:0"></div>'
      + '<div class="inbox-card-content" style="margin-left:2px">'
      + '<div class="inbox-card-customer">'+esc(c.name)+'</div>'
      + '<div class="inbox-card-subject" style="font-family:monospace">'+esc(c.code)+'</div>'
      + '</div>'
      + (c.available===false?'<span class="inbox-card-num" style="color:var(--red)">archived</span>':'')
      + '</div>';
  }).join('');
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
    return '<div class="inbox-card" style="padding:12px 14px">'
      + '<div class="inbox-card-avatar" style="background:var(--surface2);color:var(--muted);border:1px solid var(--border);font-size:14px"><i class="ti ti-category"></i></div>'
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
  var printing = orders.filter(function(r){return r.status==='Printing';});
  var complete = orders.filter(function(r){return r.status==='Complete';});
  var revenue = orders.filter(function(r){var p=paymentOptions.find(function(p){return p.name===r.payment;});return p&&p.showRevenue;}).reduce(function(s,r){return s+r.total;},0);
  var uniqueOrders = new Set(orders.map(function(r){return r.orderId;})).size;
  var detail = document.getElementById('inboxDetail');
  if (detail) detail.innerHTML = '<div class="inbox-detail" style="max-width:600px">'
    + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Stats</div></div></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    + _statCard('Orders', uniqueOrders, 'ti-shopping-cart', '')
    + _statCard('Pending', new Set(pending.map(function(r){return r.orderId;})).size, 'ti-clock', 'var(--amber)')
    + _statCard('Printing', new Set(printing.map(function(r){return r.orderId;})).size, 'ti-printer', 'var(--blue)')
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
    return '<div class="inbox-card" style="padding:12px 14px">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer">'+esc(x.name)+'</span><span class="inbox-card-num">'+x.n+'</span></div>'
      + '<div style="height:4px;background:var(--border);border-radius:2px;margin-top:8px">'
      + '<div style="height:4px;background:var(--accent);border-radius:2px;width:'+Math.round(x.n/max*100)+'%"></div>'
      + '</div></div></div>';
  }).join('') || '<div class="inbox-empty-state"><i class="ti ti-chart-bar"></i> No data</div>';
}

function _statCard(label, val, icon, color) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;display:flex;flex-direction:column;gap:6px">'
    + '<div style="display:flex;align-items:center;gap:8px;color:'+(color||'var(--muted)')+'">'
    + '<i class="ti '+icon+'" style="font-size:18px"></i>'
    + '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">'+label+'</span>'
    + '</div>'
    + '<div style="font-size:24px;font-weight:700;color:var(--text)">'+val+'</div>'
    + '</div>';
}

// Settings view
var _selectedSettingsCat = null;
var _SETTINGS_CATS = [
  {id:'payment',  icon:'ti-credit-card', title:'Payment Options',      desc:'Manage payment methods and revenue tracking'},
  {id:'cats',     icon:'ti-category',    title:'Categories & Options',  desc:'Product categories and their options'},
  {id:'colours',  icon:'ti-brush',       title:'Colour Library',        desc:'Available colour swatches'},
  {id:'users',    icon:'ti-users',       title:'Users',                 desc:'Invite and manage app users'},
  {id:'app',      icon:'ti-settings',    title:'App Settings',          desc:'Notifications, accent colour and more'},
];

function _renderViewSettings() {
  _setListPane('<div class="inbox-view-header"><span class="inbox-view-title">Settings</span></div>');
  var list = document.getElementById('inboxList');
  list.innerHTML = _SETTINGS_CATS.map(function(cat) {
    var sel = cat.id === _selectedSettingsCat;
    return '<div class="inbox-card' + (sel?' selected':'') + '" onclick="_showSettingsDetail(\'' + cat.id + '\')">'
      + '<div class="inbox-card-content">'
      + '<div class="inbox-card-row1"><span class="inbox-card-customer"><i class="ti ' + cat.icon + '" style="margin-right:7px;opacity:0.7"></i>' + cat.title + '</span></div>'
      + '<div class="inbox-card-subject">' + cat.desc + '</div>'
      + '</div></div>';
  }).join('');
  if (_selectedSettingsCat) {
    _showSettingsDetail(_selectedSettingsCat);
  } else {
    var detail = document.getElementById('inboxDetail');
    if (detail) detail.innerHTML = '<div class="inbox-no-selection"><i class="ti ti-settings"></i><p>Select a category</p></div>';
  }
}

function _showSettingsDetail(catId) {
  _selectedSettingsCat = catId;
  document.querySelectorAll('#inboxList .inbox-card').forEach(function(el) {
    el.classList.toggle('selected', (el.getAttribute('onclick')||'').includes("'" + catId + "'"));
  });
  var detail = document.getElementById('inboxDetail');
  if (!detail) return;

  if (catId === 'payment') {
    var rows = paymentOptions.map(function(p, i) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--border)">'
        + '<span style="flex:1;font-weight:500;color:' + (p.archived?'var(--muted)':'var(--text)') + (p.archived?';text-decoration:line-through':'') + '">' + esc(p.name) + '</span>'
        + '<span style="font-size:10px;color:var(--muted);padding:2px 7px;background:var(--surface2);border-radius:10px">' + (p.showRevenue?'revenue':'no revenue') + '</span>'
        + '<button class="btn sm" onclick="_settingsToggleRevenue(' + i + ')" title="Toggle revenue tracking"><i class="ti ti-currency-dollar"></i></button>'
        + '<button class="btn sm" onclick="_settingsToggleArchive(' + i + ')" title="' + (p.archived?'Restore':'Archive') + '"><i class="ti ti-' + (p.archived?'eye':'eye-off') + '"></i></button>'
        + '</div>';
    }).join('');
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Payment Options</div></div></div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">' + rows + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="btn sm" onclick="_settingsAddPayment()"><i class="ti ti-plus"></i> Add Option</button>'
      + '<button class="btn sm" onclick="openSettings()"><i class="ti ti-external-link"></i> Full Settings</button>'
      + '</div></div>';
  } else if (catId === 'cats') {
    var catRows = cats.filter(function(c){return !c.archived;}).map(function(c) {
      var n = new Set(orders.filter(function(r){return String(r.catId)===String(c.id);}).map(function(r){return r.orderId;})).size;
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">'
        + '<span style="flex:1;font-weight:500;color:var(--text)">' + esc(c.name) + '</span>'
        + '<span style="font-family:monospace;font-size:11px;color:var(--muted)">$' + c.price.toFixed(2) + '</span>'
        + '<span style="font-size:10px;color:var(--muted);padding:2px 7px;background:var(--surface2);border-radius:10px">' + n + ' orders</span>'
        + '</div>';
    }).join('');
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Categories &amp; Options</div></div></div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px">' + (catRows||'<div style="padding:16px;color:var(--muted)">No categories</div>') + '</div>'
      + '<button class="btn sm" onclick="openCatModal()"><i class="ti ti-external-link"></i> Open Category Editor</button>'
      + '</div>';
  } else if (catId === 'colours') {
    var colRows = colours.map(function(c) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border)">'
        + '<div style="width:22px;height:22px;border-radius:50%;background:' + esc(c.code) + ';border:1px solid rgba(255,255,255,0.1);flex-shrink:0"></div>'
        + '<span style="flex:1;font-weight:500;color:var(--text)">' + esc(c.name) + '</span>'
        + '<span style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(c.code) + '</span>'
        + '</div>';
    }).join('');
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Colour Library</div></div></div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;max-height:400px;overflow-y:auto;margin-bottom:12px">' + (colRows||'<div style="padding:16px;color:var(--muted)">No colours</div>') + '</div>'
      + '<button class="btn sm" onclick="openColourModal()"><i class="ti ti-external-link"></i> Open Colour Editor</button>'
      + '</div>';
  } else if (catId === 'users') {
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Users</div></div></div>'
      + '<button class="btn sm" onclick="openUsersModal()"><i class="ti ti-external-link"></i> Manage Users</button>'
      + '</div>';
  } else if (catId === 'app') {
    detail.innerHTML = '<div class="inbox-detail">'
      + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">App Settings</div></div></div>'
      + '<button class="btn sm" onclick="openSettings()"><i class="ti ti-external-link"></i> Open App Settings</button>'
      + '</div>';
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
  var name = prompt('Payment option name:');
  if (!name || !name.trim()) return;
  var isRevenue = confirm('Does this payment option generate revenue?');
  paymentOptions.push({name:name.trim(), archived:false, showRevenue:isRevenue});
  savePaymentOptions();
  _showSettingsDetail('payment');
}

// Users view
function _renderViewUsers() {
  _setListPane('<div class="inbox-view-header"><span class="inbox-view-title">Users</span></div>');
  var detail = document.getElementById('inboxDetail');
  if (detail) detail.innerHTML = '<div class="inbox-detail" style="max-width:560px">'
    + '<div class="inbox-detail-header"><div class="inbox-detail-header-top"><div class="inbox-detail-customer">Users</div></div></div>'
    + '<div><button class="btn sm" onclick="openUsersModal()"><i class="ti ti-users"></i> Manage Users</button></div>'
    + '</div>';
}

// Update sidebar badge counts after data loads
function updateSidebarBadges() {
  var ordBadge = document.getElementById('badge-orders');
  var custBadge = document.getElementById('badge-customers');
  var colBadge = document.getElementById('badge-colours');
  var catBadge = document.getElementById('badge-categories');
  if (ordBadge) ordBadge.textContent = new Set(orders.map(function(r){return r.orderId;})).size;
  if (custBadge) custBadge.textContent = customers.length;
  if (colBadge) colBadge.textContent = colours.filter(function(c){return c.available!==false;}).length;
  if (catBadge) catBadge.textContent = cats.filter(function(c){return !c.archived;}).length;
}

