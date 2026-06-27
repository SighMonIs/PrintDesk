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
  if(btn){ btn.className='status-dd-btn b-'+newStatus.toLowerCase().replace(' ','-'); btn.innerHTML=newStatus+' <i class="ti ti-chevron-down"></i>'; }
  list?.querySelectorAll('.status-dd-opt').forEach(o=>o.classList.toggle('active',o.textContent.trim()===newStatus));
  const rows = orders.filter(r=>r.orderId===orderId);
  for(const row of rows){ row.status=newStatus; }
  updateStats(); renderTable();
  try{
    for(const row of rows){
      await sbUpsert('orders',{id:row.id,order_id:row.orderId,customer:row.customer,address:row.address,delivery:row.delivery,payment:row.payment,cat_id:row.catId,qty:row.qty,price:row.price,total:row.total,status:newStatus,date:row.date,notes:row.notes,options:row.options});
    }
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

  updateStats();

  const tbody=document.getElementById('tbody');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="11" data-label=""><div class="empty"><i class="ti ti-inbox"></i>No orders yet.</div></td></tr>`;return;}

  const seen=new Set();
  let groupIdx=0;
  const isMobile = window.innerWidth <= 640;
  const orderItemCount={};
  list.forEach(o=>{orderItemCount[o.orderId]=(orderItemCount[o.orderId]||0)+1;});

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
        ${o.status||'Pending'} <i class="ti ti-chevron-down"></i>
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
    const badgeBtn=isBadgeCat?`<button class="icon-btn" title="Generate Badge" onclick="generateBadge('/badge/?${new URLSearchParams({name:parsedOpts['Text']||'',backing:parsedOpts['Backing']||'',colours:parsedOpts['Colours']||''})}')"><i class="ti ti-badge"></i></button>`:'';
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
      const catTotals={};
      orderRows.forEach(r=>{
        const name=(cats.find(c=>c.id===r.catId)||{}).name||'Unknown';
        catTotals[name]=(catTotals[name]||0)+(r.qty||1);
      });
      const itemSummaryHtml=Object.entries(catTotals).map(([name,qty])=>
        `<div style="font-size:10px;color:var(--muted);line-height:1.6">${qty}× ${name}</div>`
      ).join('');
      const orderStat=o.status||'Pending';
      const orderStatusDd=`<div class="status-dd-wrap" onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:7px">
        <span style="font-size:10px;color:var(--muted);letter-spacing:0.3px;white-space:nowrap">Applies to entire order</span>
        <button class="status-dd-btn b-${orderStat.toLowerCase().replace(' ','-')}" onclick="toggleStatusDd('order-${esc(o.orderId)}',this)">
          ${orderStat} <i class="ti ti-chevron-down"></i>
        </button>
        <div class="status-dd-list" id="sdd-order-${esc(o.orderId)}">
          ${['Pending','Printing','Complete','On Hold','Cancelled'].map(s=>`
            <div class="status-dd-opt b-${s.toLowerCase().replace(' ','-')}${orderStat===s?' active':''}"
              onclick="selectOrderStatus('${esc(o.orderId)}','${s}',this)">${s}</div>`).join('')}
        </div>
      </div>`;
      const summaryRow=`<tr class="group-first order-summary-row ${altClass}">
        <td class="card-order-num" style="padding:7px 8px"><span class="order-id-badge">${orderNum}</span></td>
        <td data-label="Customer" style="padding:7px 8px" title="${esc(o.customer)}"><div>${esc(o.customer)||'—'}</div>${itemSummaryHtml}</td>
        <td data-label="Address" style="padding:7px 8px;white-space:normal;word-break:break-word;font-size:11px;color:var(--muted)"><span style="display:flex;align-items:flex-start;gap:4px">${deliveryIcon}<span title="${esc(o.address)}">${esc(o.address)||'—'}</span></span></td>
        <td colspan="5"></td>
        <td data-label="Status" style="padding:4px 6px;text-align:center;overflow:visible;white-space:nowrap">${orderStatusDd}</td>
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
      <td data-label="Customer" style="padding:7px 8px" title="${esc(o.customer)}">${esc(o.customer)||'—'}</td>
      <td data-label="Address" style="padding:7px 8px;white-space:normal;word-break:break-word;font-size:11px;color:var(--muted)"><span style="display:flex;align-items:flex-start;gap:4px">${deliveryIcon}<span title="${esc(o.address)}">${esc(o.address)||'—'}</span></span></td>
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
function updateSortArrow(){ updateSortUI(); }
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

function attachNominatim(input, tickEl){
  // Now uses Google Maps Places instead of Nominatim
  attachGooglePlaces(input, tickEl);
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

async function fetchNominatim(q, input, list, tickEl){
  // No longer used — kept as stub to avoid reference errors
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
  container.innerHTML=catOpts.map(opt=>{
    const val=saved[opt.name]||'';
    if(opt.display==='text'){
      const capsStyle=opt.force_caps?'text-transform:uppercase':'';
      const capsHandler=opt.force_caps?`this.value=this.value.toUpperCase();collectOpts(${idx})`:`collectOpts(${idx})`;
      return`<div class="opt-row"><label>${esc(opt.name)}</label><input type="text" id="ov-${idx}-${opt.id}" value="${esc(opt.force_caps&&val?val.toUpperCase():val)}" placeholder="Enter ${esc(opt.name).toLowerCase()}…" style="${capsStyle}" oninput="${capsHandler}"></div>`;
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
      <div class="mf"><label>Qty</label><input type="number" id="mq-${idx}" value="${d.qty||1}" min="1" oninput="calcTotal()"></div>
      <div class="mf"><label>Price ($)</label><input type="number" id="mp-${idx}" value="${d.price||''}" step="0.01" min="0" placeholder="0.00" oninput="calcTotal()"></div>
      <button class="rm-btn" onclick="removeModel(this)" title="Remove item"><i class="ti ti-x"></i></button>
    </div>
    <div class="model-options" id="mo-${idx}"></div>
    <div class="model-notes"><input type="text" id="mn-${idx}" value="${esc(d.notes||'')}" placeholder="Item notes (colour, material, special requests…)"></div>
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
  document.getElementById('modelRows').innerHTML='';mCounter=0;addModelRow();
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
  const models=getModelData();
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
  updateStats();
  try{
    // Update status via Supabase upsert
    await sbUpsert('orders', {
      id: row.id, order_id: row.orderId, customer: row.customer,
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
