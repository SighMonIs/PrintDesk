/* ══════════════════════════════════════════════════════════════════════
   OrderDesk v2 — generalised order-fulfilment front end over the live
   PrintDesk database. Sign-in and REST come from ../shared/sb.js (the same
   module the makers use) so there is no second copy of that logic here.

   Reads: orders, categories, options, colours, customers, delivery_options,
          payment_options, inventory_items, inventory_receipts,
          inventory_consumption.
   Writes: order status and paid flag only — everything else is read-only in
          v2 so it can be tested against production without risk.
   ══════════════════════════════════════════════════════════════════════ */

const VERSION = '2.0.1';

/* ── Pipeline ──────────────────────────────────────────────────────────
   The database values stay exactly as the live site writes them; only the
   labels are generalised, so v2 and v1 can run side by side on one order. */
const FLOW = [
  { k: 'Pending',   label: 'New',       c: '--amber', icon: 'ti-inbox' },
  { k: 'Confirmed', label: 'Confirmed', c: '--blue',  icon: 'ti-circle-check' },
  { k: 'Printed',   label: 'Ready',     c: '--teal',  icon: 'ti-package' },
  { k: 'Complete',  label: 'Complete',  c: '--green', icon: 'ti-check' }
];
const OFF_FLOW = {
  'On Hold':   { label: 'On Hold',   c: '--muted', icon: 'ti-player-pause' },
  'Cancelled': { label: 'Cancelled', c: '--red',   icon: 'ti-x' }
};
const AGEING_DAYS = 14;   // an open order older than this wants a look

const VIEWS = [
  { k: 'dashboard', label: 'Today',     short: 'Today',  icon: 'ti-layout-dashboard', sub: 'Operations overview' },
  { k: 'orders',    label: 'Orders',    short: 'Orders', icon: 'ti-receipt',          sub: 'All orders' },
  { k: 'queue',     label: 'Fulfilment',short: 'Queue',  icon: 'ti-truck-loading',    sub: 'Work queue by stage' },
  { k: 'customers', label: 'Customers', short: 'People', icon: 'ti-users',            sub: 'Accounts and history' },
  { k: 'products',  label: 'Products',  short: 'Items',  icon: 'ti-tags',             sub: 'Catalogue and pricing' },
  { k: 'stock',     label: 'Stock',     short: 'Stock',  icon: 'ti-stack-2',          sub: 'Inventory on hand' },
  { k: 'settings',  label: 'Settings',  short: 'More',   icon: 'ti-settings',         sub: 'Workspace configuration' }
];

/* ── State ─────────────────────────────────────────────────────────── */
let rows = [];          // raw order line-item rows
let orders = [];        // grouped by order_id
let cats = [], opts = [], colours = [], customers = [];
let deliveryOptions = [], paymentOptions = [];
let invItems = [], invReceipts = [], invConsumption = [];

let view = 'dashboard';
let selected = null;
let chip = 'open';
let showDetail = false;   // phone: detail takes over the screen
let loading = true;

/* ── Helpers ───────────────────────────────────────────────────────── */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + (Number(n) || 0).toFixed(2);
const meta = s => FLOW.find(f => f.k === s) || OFF_FLOW[s] || { label: s || 'Unknown', c: '--muted', icon: 'ti-circle' };
const stageIdx = s => FLOW.findIndex(f => f.k === s);
const isOpen = o => o.status !== 'Complete' && o.status !== 'Cancelled';
const orderNo = id => { const m = String(id).match(/^O?0*(\d+)$/); return m ? '#' + m[1] : '#' + id; };

// Stored as ISO or dd/mm/yyyy depending on when the row was written.
function parseDate(s) {
  if (!s) return null;
  let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'; };
const ageDays = o => { const d = parseDate(o.date); return d ? Math.floor((Date.now() - d) / 86400000) : null; };
const isStale = o => isOpen(o) && o.status !== 'On Hold' && (ageDays(o) || 0) >= AGEING_DAYS;

const pill = s => `<span class="pill" style="--pc:var(${meta(s).c})"><span class="dot"></span>${esc(meta(s).label)}</span>`;
const initials = n => (String(n).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const avatar = n => `<div class="avatar" style="background:hsl(${hue(n)} 38% 42%)">${esc(initials(n))}</div>`;

const catName = id => (cats.find(c => String(c.id) === String(id)) || {}).name || 'Unknown item';
const delivery = name => deliveryOptions.find(d => d.name === name) || { name: name || '—', price: 0, icon: 'ti-package' };

function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

/* ── Load ──────────────────────────────────────────────────────────── */
async function loadAll(manual) {
  if (manual) document.getElementById('refreshIcon').classList.add('spin');
  try {
    const [o, c, op, col, cu, del, pay, ii, ir, ic] = await Promise.all([
      sbGet('orders', '?deleted=eq.false&order=order_id.desc&limit=10000'),
      sbGet('categories', '?order=sort_order.asc,id.asc'),
      sbGet('options', '?order=sort_order.asc,id.asc'),
      sbGet('colours', '?order=id.asc'),
      sbGet('customers', '?order=name.asc'),
      sbGet('delivery_options', '?order=sort_order.asc,id.asc'),
      sbGet('payment_options', '?order=sort_order.asc,id.asc'),
      sbGet('inventory_items', '?order=name.asc'),
      sbGet('inventory_receipts', '?order=date.asc'),
      sbGet('inventory_consumption', '?order=date.asc')
    ]);
    if (!Array.isArray(o)) throw new Error((o && (o.message || o.hint)) || 'Unexpected response');

    rows = o;
    cats = (c || []).filter(x => !x.archived);
    opts = (op || []).filter(x => !x.archived);
    colours = col || [];
    customers = (cu || []).filter(x => !x.archived);
    deliveryOptions = (del || []).filter(x => !x.archived);
    paymentOptions = (pay || []).filter(x => !x.archived);
    invItems = (ii || []).filter(x => !x.archived);
    invReceipts = ir || [];
    invConsumption = ic || [];
    group();
    loading = false;
    if (manual) toast('Refreshed — ' + orders.length + ' orders');
  } catch (e) {
    loading = false;
    toast('Load failed: ' + e.message, 'err');
  } finally {
    if (manual) document.getElementById('refreshIcon').classList.remove('spin');
    render();
  }
}

// Order rows are line items; one order is every row sharing an order_id.
function group() {
  const by = new Map();
  for (const r of rows) {
    const id = String(r.order_id || '');
    if (!id) continue;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  }
  orders = [...by.entries()].map(([id, lines]) => {
    const f = lines[0];
    const sub = lines.reduce((s, l) => s + (Number(l.total) || 0), 0);
    return {
      id, no: orderNo(id), lines,
      customer: f.customer || '', customerId: String(f.customer_id || ''),
      address: f.address || '', delivery: f.delivery || '',
      payment: (f.payment || '').trim(), status: f.status || 'Pending',
      // the same note is often repeated on every line of an order
      date: f.date || '', notes: [...new Set(lines.map(l => l.notes).filter(Boolean))].join(' · '),
      paid: lines.every(l => l.paid === true || String(l.paid) === 'true'),
      subtotal: sub, ship: Number(delivery(f.delivery).price) || 0,
      total: sub + (Number(delivery(f.delivery).price) || 0),
      units: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
    };
  }).sort((a, b) => {
    const d = (parseDate(b.date) || 0) - (parseDate(a.date) || 0);
    return d || String(b.id).localeCompare(String(a.id));
  });
}

/* ── Option strings → readable attributes ──────────────────────────── */
function parseOpts(line) {
  const out = [];
  if (!line.options) return out;
  const parsed = {};
  String(line.options).split('||').forEach(p => {
    const i = p.indexOf(':');
    if (i >= 0) parsed[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  const defs = opts.filter(d => String(d.cat_id) === String(line.cat_id));
  // Known options first (they carry the display type), then anything left over.
  for (const d of defs) {
    const v = parsed[d.name];
    if (!v) continue;
    const isColour = d.display === 'colour' || d.name.toLowerCase().includes('colour');
    out.push({ name: d.name, value: v, colours: isColour ? v.split('|') : null });
    delete parsed[d.name];
  }
  for (const k in parsed) if (parsed[k]) out.push({ name: k, value: parsed[k], colours: null });
  return out;
}
const colourCode = name => (colours.find(c => c.name.toLowerCase() === String(name).toLowerCase()) || {}).code || '#ccc';

/* ── Writes (status + paid only) ───────────────────────────────────── */
async function setOrderStatus(id, status) {
  const o = orders.find(x => x.id === id);
  if (!o || o.status === status) return;
  const ok = await askConfirm('Set order ' + o.no + ' to "' + meta(status).label + '"? This applies to every item in the order.', 'Set ' + meta(status).label);
  if (!ok) return;
  const was = o.status;
  o.status = status;
  o.lines.forEach(l => { l.status = status; });
  render();
  const err = await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(id), { status });
  if (err) {
    o.status = was; o.lines.forEach(l => { l.status = was; });
    toast('Could not save: ' + (err.message || 'unknown error'), 'err');
    render();
  } else {
    toast(o.no + ' → ' + meta(status).label);
  }
}

function advance(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const i = stageIdx(o.status);
  setOrderStatus(id, i < 0 ? 'Confirmed' : FLOW[Math.min(i + 1, FLOW.length - 1)].k);
}

async function togglePaid(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const paid = !o.paid;
  o.paid = paid;
  o.lines.forEach(l => { l.paid = paid; });
  render();
  const err = await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(id), { paid });
  if (err) {
    o.paid = !paid; o.lines.forEach(l => { l.paid = !paid; });
    toast('Could not save: ' + (err.message || 'unknown error'), 'err');
    render();
  } else {
    toast(o.no + ' marked ' + (paid ? 'paid' : 'unpaid'));
  }
}

/* ── Navigation ────────────────────────────────────────────────────── */
function go(v) { view = v; showDetail = false; window.scrollTo(0, 0); render(); }
function pick(id) { selected = id; showDetail = true; if (view !== 'orders') view = 'orders'; render(); }
function closeDetail() { showDetail = false; render(); }
function setChip(c) { chip = c; render(); }

/* ── Shared bits ───────────────────────────────────────────────────── */
function pipeline(o) {
  const cur = stageIdx(o.status);
  return `<div class="pipeline">` + FLOW.map((f, i) => {
    const role = cur < 0 ? '' : i < cur ? 'done' : i === cur ? 'now' : '';
    return `<button class="pipeline-step ${role}" style="--sc:var(${f.c})" title="${esc(f.label)}" onclick="setOrderStatus('${esc(o.id)}','${esc(f.k)}')">
      <div class="lbl"><i class="ti ${i < cur ? 'ti-check' : f.icon}"></i><span>${esc(f.label)}</span></div>
      <div class="trk"></div></button>`;
  }).join('') + `</div>`
  + (cur < 0 ? `<div class="offflow">${pill(o.status)}<span>This order sits outside the pipeline — pick a stage above to bring it back in.</span></div>` : '');
}

// One table helper so every table gets the same stacked-card treatment on a
// phone: each cell carries its column name, and the CSS reads it back.
function table(cols, body) {
  return `<div class="tbl-wrap"><table>
    <thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead>
    <tbody>${body.map(r => `<tr${r.click ? ` class="clickable" onclick="${r.click}"` : ''}>`
      // .cv is display:contents on a wide screen and a flex group on a phone,
      // so stacked cells keep their content together next to the label.
      + r.cells.map((cell, i) => `<td class="${cols[i].cls || ''}" data-label="${esc(cols[i].h)}"><span class="cv">${cell}</span></td>`).join('')
      + `</tr>`).join('') || `<tr><td class="subtle" colspan="${cols.length}" data-label="">Nothing here yet.</td></tr>`}</tbody>
  </table></div>`;
}

/* ── Orders ────────────────────────────────────────────────────────── */
function query() { return (document.getElementById('globalSearch')?.value || '').toLowerCase().trim(); }

function filtered() {
  const q = query();
  return orders.filter(o => {
    if (chip === 'open' && !isOpen(o)) return false;
    if (chip === 'stale' && !isStale(o)) return false;
    if (chip === 'unpaid' && (o.paid || !isOpen(o))) return false;
    if ((FLOW.some(f => f.k === chip) || OFF_FLOW[chip]) && o.status !== chip) return false;
    if (!q) return true;
    const hay = [o.no, o.id, o.customer, o.notes, o.payment, o.delivery,
      ...o.lines.map(l => catName(l.cat_id) + ' ' + (l.options || ''))].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// Real orders often repeat the same product across many lines (one per
// personalisation), so the card summarises by product rather than by line.
function lineSummary(lines) {
  const by = new Map();
  for (const l of lines) {
    const n = catName(l.cat_id);
    by.set(n, (by.get(n) || 0) + (Number(l.qty) || 0));
  }
  return [...by].map(([n, q]) => `${q} × ${n}`).join(', ');
}

function orderCard(o) {
  const summary = lineSummary(o.lines);
  const age = ageDays(o);
  return `<div class="ocard ${o.id === selected ? 'sel' : ''}" onclick="pick('${esc(o.id)}')" role="button" tabindex="0"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
    ${avatar(o.customer)}
    <div class="ocard-body">
      <div class="ocard-r1">
        <div class="ocard-name">${esc(o.customer || 'No customer')}</div>
        <div class="ocard-ref">${esc(o.no)}</div>
      </div>
      <div class="ocard-sum">${esc(summary)}</div>
      <div class="ocard-r3">
        ${pill(o.status)}
        ${isStale(o) ? `<span class="ocard-late"><i class="ti ti-clock-exclamation"></i>${age}d</span>` : ''}
        ${!o.paid && isOpen(o) ? `<span class="pill" style="--pc:var(--red)">unpaid</span>` : ''}
        <div class="ocard-total">${money(o.total)}</div>
      </div>
    </div>
  </div>`;
}

function orderDetail(o) {
  if (!o) return `<div class="empty"><i class="ti ti-receipt"></i><p>Select an order</p></div>`;
  const ship = delivery(o.delivery);
  const c = customers.find(x => String(x.id) === o.customerId) || {};
  const cur = stageIdx(o.status);
  const next = cur < 0 ? FLOW[1] : FLOW[cur + 1];
  const age = ageDays(o);

  return `<div class="detail">

    <div class="detail-hdr">
      <div class="detail-hdr-main">
        <div class="detail-title">${esc(o.no)} <span class="detail-id">${esc(o.id)}</span></div>
        <div class="detail-sub">
          <span>${esc(o.customer || 'No customer')}</span>
          <span>Ordered ${esc(fmtDate(o.date))}${age != null ? ` · ${age}d ago` : ''}</span>
          <span>${o.units} units · ${o.lines.length} ${o.lines.length === 1 ? 'line' : 'lines'}</span>
        </div>
      </div>
      <div class="detail-actions">
        ${next && isOpen(o) ? `<button class="btn success" onclick="advance('${esc(o.id)}')"><i class="ti ${next.icon}"></i> Mark ${esc(next.label)}</button>` : ''}
        <button class="btn ${o.paid ? '' : 'primary'}" onclick="togglePaid('${esc(o.id)}')">
          <i class="ti ${o.paid ? 'ti-rotate-2' : 'ti-cash'}"></i> ${o.paid ? 'Mark unpaid' : 'Mark paid'}</button>
      </div>
    </div>

    ${pipeline(o)}

    ${o.notes ? `<div class="note"><i class="ti ti-message-2"></i><div>${esc(o.notes)}</div></div>` : ''}

    <div class="grid2">
      <div class="card">
        <div class="card-hdr"><i class="ti ti-user"></i><h3>Customer</h3></div>
        <div class="card-body kv">
          <div class="kv-row"><div class="k">Name</div><div class="v">${esc(o.customer || '—')}</div></div>
          ${c.email ? `<div class="kv-row"><div class="k">Email</div><div class="v"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div></div>` : ''}
          ${c.phone ? `<div class="kv-row"><div class="k">Phone</div><div class="v"><a href="tel:${esc(String(c.phone).replace(/\s/g, ''))}">${esc(c.phone)}</a></div></div>` : ''}
          <div class="kv-row"><div class="k">Ship to</div><div class="v">${o.address
            ? `<a href="https://maps.google.com/?q=${encodeURIComponent(o.address)}" target="_blank" rel="noopener">${esc(o.address)}</a>`
            : '<span class="subtle">—</span>'}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-hdr"><i class="ti ti-truck-delivery"></i><h3>Fulfilment &amp; payment</h3></div>
        <div class="card-body kv">
          <div class="kv-row"><div class="k">Method</div><div class="v"><i class="ti ${esc(ship.icon || 'ti-package')}"></i> ${esc(ship.name)}${ship.price ? ' · ' + money(ship.price) : ''}</div></div>
          <div class="kv-row"><div class="k">Payment</div><div class="v">${esc(o.payment && o.payment !== 'No' ? o.payment : 'Not set')}</div></div>
          <div class="kv-row"><div class="k">Status</div><div class="v">${o.paid
            ? `<span class="pill" style="--pc:var(--green)">paid</span>`
            : `<span class="pill" style="--pc:var(--red)">unpaid</span>`}</div></div>
          <div class="kv-row"><div class="k">Stage</div><div class="v">${pill(o.status)}</div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hdr"><i class="ti ti-list-details"></i><h3>Line items</h3></div>
      <div class="card-body flush">
        <div class="lines">${o.lines.map(l => {
          const attrs = parseOpts(l);
          return `<div class="line">
            <div class="line-qty"><b>${esc(l.qty)}</b><small>qty</small></div>
            <div class="line-main">
              <div class="line-name">${esc(catName(l.cat_id))}</div>
              ${attrs.length ? `<div class="line-attrs">${attrs.map(a => a.colours
                ? `<span class="attr">${esc(a.name)} ${a.colours.map(n => `<span class="sw" style="--sw:${esc(colourCode(n))}" title="${esc(n)}"></span>`).join('')}</span>`
                : `<span class="attr">${esc(a.name)} <b>${esc(a.value)}</b></span>`).join('')}</div>` : ''}
              ${l.notes ? `<div class="line-note"><i class="ti ti-note"></i>${esc(l.notes)}</div>` : ''}
            </div>
            <div class="line-money">
              <div class="ea">${money(l.price)} ea</div>
              <div class="tot">${money(l.total)}</div>
            </div>
          </div>`;
        }).join('')}</div>
        <div class="totals">
          <div class="totals-row"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
          <div class="totals-row"><span>${esc(ship.name)}</span><span>${money(o.ship)}</span></div>
          <div class="totals-row grand"><span>Total</span><span>${money(o.total)}</span></div>
        </div>
      </div>
    </div>

    <p class="readonly-note"><i class="ti ti-info-circle"></i> v2 writes stage and paid only. Everything else is read-only — edit it in the live site.</p>
  </div>`;
}

function viewOrders() {
  const list = filtered();
  const counts = k => orders.filter(o => o.status === k).length;
  const chips = [
    ['open', 'Open', orders.filter(isOpen).length],
    ['stale', 'Ageing', orders.filter(isStale).length],
    ['unpaid', 'Unpaid', orders.filter(o => !o.paid && isOpen(o)).length],
    ...FLOW.map(f => [f.k, f.label, counts(f.k)]),
    ['On Hold', 'On Hold', counts('On Hold')],
    ['all', 'All', orders.length]
  ];
  if (!list.find(o => o.id === selected)) selected = list.length ? list[0].id : null;
  const sel = orders.find(o => o.id === selected);

  return `<div class="pane-list">
      <div class="pane-list-hdr">
        <div class="chipbar">${chips.map(([k, l, n]) =>
          `<button class="chip ${chip === k ? 'active' : ''}" onclick="setChip('${esc(k)}')">${esc(l)}<span class="n">${n}</span></button>`).join('')}</div>
      </div>
      <div class="pane-list-scroll">${list.length
        ? list.map(orderCard).join('')
        : `<div class="empty"><i class="ti ti-search-off"></i><p>No orders match</p></div>`}</div>
      <div class="pane-list-ftr">
        <span>${list.length} of ${orders.length}</span>
        <span style="margin-left:auto">${money(list.reduce((s, o) => s + o.total, 0))}</span>
      </div>
    </div>
    <div class="pane-detail">${orderDetail(sel)}</div>`;
}

/* ── Dashboard ─────────────────────────────────────────────────────── */
function viewDashboard() {
  const open = orders.filter(isOpen);
  const stale = orders.filter(isStale);
  const unpaid = orders.filter(o => !o.paid && isOpen(o));
  const owed = unpaid.reduce((s, o) => s + o.total, 0);
  const collected = orders.filter(o => o.paid && o.status !== 'Cancelled').reduce((s, o) => s + o.total, 0);
  const attention = orders.filter(o => isStale(o) || (!o.paid && isOpen(o)) || o.status === 'On Hold');

  const stat = (lbl, icon, val, sub, mono) =>
    `<div class="stat"><div class="lbl"><i class="ti ${icon}"></i>${lbl}</div>
      <div class="val${mono ? ' mono' : ''}">${val}</div><div class="sub">${sub}</div></div>`;

  return `<div class="page"><div class="page-inner">
    <div class="stats">
      ${stat('Open orders', 'ti-inbox', open.length, open.reduce((s, o) => s + o.units, 0) + ' units to fulfil')}
      ${stat('Ageing', 'ti-clock-exclamation', stale.length, 'open ' + AGEING_DAYS + '+ days')}
      ${stat('Awaiting payment', 'ti-credit-card', money(owed), unpaid.length + (unpaid.length === 1 ? ' order' : ' orders'), true)}
      ${stat('Collected', 'ti-cash', money(collected), 'paid orders to date', true)}
    </div>

    <div class="section-title">Pipeline<span class="right"><button class="btn sm ghost" onclick="go('queue')">Work queue</button></span></div>
    <div class="funnel">${FLOW.concat([{ k: 'On Hold', label: 'On Hold', c: '--muted', icon: 'ti-player-pause' }]).map(f => {
      const rs = orders.filter(o => o.status === f.k);
      return `<button class="funnel-col" style="--fc:var(${f.c})" onclick="chip='${esc(f.k)}';go('orders')">
        <div class="fc-top"><i class="ti ${f.icon}"></i>${esc(f.label)}</div>
        <div class="fc-n">${rs.length}</div>
        <div class="fc-v">${money(rs.reduce((s, o) => s + o.total, 0))}</div>
        <div class="funnel-bar" style="width:${orders.length ? Math.max(8, rs.length / orders.length * 100) : 8}%"></div>
      </button>`;
    }).join('')}</div>

    <div class="section-title">Needs attention <span class="subtle">${attention.length}</span></div>
    ${table(
      [{ h: 'Order', cls: 'mono' }, { h: 'Customer' }, { h: 'Stage' }, { h: 'Age', cls: 'mono' }, { h: 'Why', cls: 'subtle' }, { h: 'Value', cls: 'num mono' }],
      attention.slice(0, 25).map(o => ({
        click: `pick('${esc(o.id)}')`,
        cells: [
          esc(o.no),
          `<div class="cellrow">${avatar(o.customer)}<div>${esc(o.customer || '—')}</div></div>`,
          pill(o.status),
          (ageDays(o) != null ? ageDays(o) + 'd' : '—'),
          [isStale(o) ? 'ageing' : '', !o.paid ? 'unpaid' : '', o.status === 'On Hold' ? 'on hold' : ''].filter(Boolean).join(' · '),
          money(o.total)
        ]
      }))
    )}
  </div></div>`;
}

/* ── Fulfilment queue ──────────────────────────────────────────────── */
function viewQueue() {
  const cols = [{ h: 'Order', cls: 'mono' }, { h: 'Customer' }, { h: 'Items', cls: 'subtle' },
    { h: 'Method', cls: 'subtle' }, { h: 'Age', cls: 'mono' }, { h: 'Value', cls: 'num mono' }, { h: 'Next', cls: 'num' }];

  const sections = FLOW.slice(0, -1).map(f => {
    const rs = orders.filter(o => o.status === f.k);
    if (!rs.length) return '';
    const nxt = FLOW[stageIdx(f.k) + 1];
    return `<div class="section-title"><i class="ti ${f.icon}" style="color:var(${f.c})"></i>${esc(f.label)} <span class="subtle">${rs.length}</span></div>`
      + table(cols, rs.map(o => ({
        cells: [
          `<a href="#" onclick="event.preventDefault();pick('${esc(o.id)}')">${esc(o.no)}</a>`,
          esc(o.customer || '—'),
          esc(lineSummary(o.lines)),
          `<i class="ti ${esc(delivery(o.delivery).icon || 'ti-package')}"></i> ${esc(delivery(o.delivery).name)}`,
          (ageDays(o) != null ? ageDays(o) + 'd' : '—'),
          money(o.total),
          `<button class="btn sm" onclick="event.stopPropagation();advance('${esc(o.id)}')"><i class="ti ${nxt.icon}"></i> ${esc(nxt.label)}</button>`
        ]
      })));
  }).join('');

  const held = orders.filter(o => o.status === 'On Hold');
  return `<div class="page"><div class="page-inner">
    ${sections || `<div class="empty"><i class="ti ti-checkbox"></i><p>Nothing in the queue</p></div>`}
    ${held.length ? `<div class="section-title"><i class="ti ti-player-pause"></i>On hold <span class="subtle">${held.length}</span></div>`
      + table([{ h: 'Order', cls: 'mono' }, { h: 'Customer' }, { h: 'Note', cls: 'subtle' }, { h: 'Value', cls: 'num mono' }, { h: 'Resume', cls: 'num' }],
        held.map(o => ({ cells: [
          `<a href="#" onclick="event.preventDefault();pick('${esc(o.id)}')">${esc(o.no)}</a>`,
          esc(o.customer || '—'), esc(o.notes || '—'), money(o.total),
          `<button class="btn sm" onclick="setOrderStatus('${esc(o.id)}','Confirmed')"><i class="ti ti-player-play"></i> Resume</button>`
        ] }))) : ''}
  </div></div>`;
}

/* ── Customers ─────────────────────────────────────────────────────── */
function viewCustomers() {
  const q = query();
  const list = customers.filter(c => !q || (c.name + ' ' + (c.email || '') + ' ' + (c.id || '')).toLowerCase().includes(q));
  const ordersOf = c => orders.filter(o => o.customerId === String(c.id) || o.customer === c.name);
  return `<div class="page"><div class="page-inner">
    <div class="section-title">Customers <span class="subtle">${list.length}</span></div>
    ${table(
      [{ h: 'Customer' }, { h: 'Contact' }, { h: 'Address', cls: 'subtle' },
       { h: 'Orders', cls: 'num mono' }, { h: 'Lifetime', cls: 'num mono' }, { h: 'Open' }],
      list.map(c => {
        const os = ordersOf(c), open = os.filter(isOpen);
        return { cells: [
          `<div class="cellrow">${avatar(c.name)}<div>${esc(c.name)}</div></div>`,
          (c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '') +
            (c.phone ? `<div class="subtle"><a href="tel:${esc(String(c.phone).replace(/\s/g, ''))}">${esc(c.phone)}</a></div>` : '') || '<span class="subtle">—</span>',
          esc(c.address || '—'),
          String(os.length),
          money(os.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + o.total, 0)),
          open.length ? open.slice(0, 3).map(o => `<a href="#" onclick="event.preventDefault();pick('${esc(o.id)}')">${pill(o.status)}</a>`).join(' ') : '<span class="subtle">—</span>'
        ] };
      })
    )}
  </div></div>`;
}

/* ── Products ──────────────────────────────────────────────────────── */
function viewProducts() {
  const live = orders.filter(o => o.status !== 'Cancelled').flatMap(o => o.lines);
  return `<div class="page"><div class="page-inner">
    <div class="section-title">Catalogue <span class="subtle">${cats.length}</span></div>
    ${table(
      [{ h: 'Product' }, { h: 'Price', cls: 'num mono' }, { h: 'Options', cls: 'subtle' },
       { h: 'Sold', cls: 'num mono' }, { h: 'Revenue', cls: 'num mono' }, { h: 'Open now', cls: 'num mono' }],
      cats.map(c => {
        const ls = live.filter(l => String(l.cat_id) === String(c.id));
        const openLs = orders.filter(isOpen).flatMap(o => o.lines).filter(l => String(l.cat_id) === String(c.id));
        return { cells: [
          esc(c.name),
          money(c.price),
          opts.filter(o => String(o.cat_id) === String(c.id)).map(o => esc(o.name)).join(', ') || '—',
          String(ls.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
          money(ls.reduce((s, l) => s + (Number(l.total) || 0), 0)),
          String(openLs.reduce((s, l) => s + (Number(l.qty) || 0), 0))
        ] };
      })
    )}
  </div></div>`;
}

/* ── Stock ─────────────────────────────────────────────────────────── */
function viewStock() {
  const received = id => invReceipts.filter(r => String(r.item_id) === String(id)).reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const used = id => invConsumption.filter(c => String(c.item_id) === String(id)).reduce((s, c) => s + (Number(c.qty) || 0), 0);
  const spent = id => invReceipts.filter(r => String(r.item_id) === String(id)).reduce((s, r) => s + (Number(r.cost) || 0), 0);

  return `<div class="page"><div class="page-inner">
    <div class="section-title">Stock on hand <span class="subtle">${invItems.length} items</span></div>
    ${table(
      [{ h: 'Item' }, { h: 'Received', cls: 'num mono' }, { h: 'Used', cls: 'num mono' },
       { h: 'On hand', cls: 'num mono' }, { h: 'Spend', cls: 'num mono' }, { h: 'Level' }],
      invItems.map(i => {
        const rec = received(i.id), use = used(i.id), left = rec - use;
        const col = left <= 0 ? '--red' : left < rec * 0.2 ? '--amber' : '--green';
        return { cells: [
          esc(i.name) + (i.notes ? `<div class="subtle">${esc(i.notes)}</div>` : ''),
          String(rec), String(use),
          `<span style="color:var(${col})">${left}</span>`,
          money(spent(i.id)),
          `<div class="bar" style="--bc:var(${col})"><i style="width:${rec ? Math.max(0, Math.min(100, left / rec * 100)) : 0}%"></i></div>`
        ] };
      })
    )}
  </div></div>`;
}

/* ── Settings (read-only mirror of what the live site configures) ──── */
function viewSettings() {
  const group = (title, icon, items) => `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ${icon}"></i><h3>${esc(title)}</h3></div>
    <div class="card-body kv">${items.map(([k, v]) =>
      `<div class="kv-row"><div class="k wide">${esc(k)}</div><div class="v">${v}</div></div>`).join('')}</div>
  </div>`;

  return `<div class="page"><div class="page-inner narrow">
    ${group('Pipeline', 'ti-route', [
      ['Stages', FLOW.map(f => `<span class="pill" style="--pc:var(${f.c})">${esc(f.label)}</span>`).join(' ')],
      ['Off-pipeline', Object.keys(OFF_FLOW).map(k => `<span class="pill" style="--pc:var(${OFF_FLOW[k].c})">${esc(OFF_FLOW[k].label)}</span>`).join(' ')],
      ['Stored as', FLOW.map(f => `<code>${esc(f.k)}</code>`).join(', ')],
      ['Ageing after', AGEING_DAYS + ' days open']
    ])}
    ${group('Shipping methods', 'ti-truck', deliveryOptions.length
      ? deliveryOptions.map(d => [d.name, `<i class="ti ${esc(d.icon || 'ti-package')}"></i> <span class="mono">${money(d.price)}</span>`])
      : [['None configured', '—']])}
    ${group('Payment methods', 'ti-credit-card', paymentOptions.length
      ? paymentOptions.map(p => [p.name, p.show_revenue ? '<span class="subtle">counts as revenue</span>' : '<span class="subtle">—</span>'])
      : [['None configured', '—']])}
    ${group('Workspace', 'ti-building', [
      ['Signed in as', esc((typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '—')],
      ['Database', esc(String(window.CONFIG.SUPABASE_URL || '').replace(/^https?:\/\//, ''))],
      ['Orders loaded', orders.length + ' (' + rows.length + ' line items)'],
      ['Products', cats.length], ['Customers', customers.length],
      ['Version', 'v' + VERSION]
    ])}
    <p class="readonly-note"><i class="ti ti-info-circle"></i> These are read from the live database. Change them in the main site; v2 only reflects them.</p>
  </div></div>`;
}

/* ── Render ────────────────────────────────────────────────────────── */
const RENDER = {
  dashboard: viewDashboard, orders: viewOrders, queue: viewQueue,
  customers: viewCustomers, products: viewProducts, stock: viewStock, settings: viewSettings
};

function render() {
  const v = VIEWS.find(x => x.k === view) || VIEWS[0];

  document.getElementById('railNav').innerHTML = VIEWS.filter(x => x.k !== 'settings').map(x => {
    const n = x.k === 'orders' ? orders.filter(isOpen).length
            : x.k === 'queue' ? orders.filter(o => isOpen(o) && o.status !== 'On Hold').length
            : x.k === 'customers' ? customers.length
            : x.k === 'products' ? cats.length
            : x.k === 'stock' ? invItems.length : '';
    return `<button class="rail-item ${view === x.k ? 'active' : ''}" onclick="go('${x.k}')" aria-current="${view === x.k}">
      <i class="ti ${x.icon}"></i><span class="full">${esc(x.label)}</span><span class="short">${esc(x.short)}</span>
      ${n !== '' ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
  document.getElementById('railSettings').classList.toggle('active', view === 'settings');

  document.getElementById('crumb').innerHTML = `${esc(v.label)}<small>${esc(v.sub)}</small>`;
  document.getElementById('userChip').textContent =
    initials((typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '?');

  const root = document.getElementById('viewRoot');
  root.className = 'body' + (view === 'orders' && showDetail ? ' show-detail' : '');
  root.innerHTML = loading
    ? `<div class="empty"><i class="ti ti-loader-2 spin"></i><p>Loading&hellip;</p></div>`
    : RENDER[view]();

  // Back arrow belongs to the phone detail view only.
  document.getElementById('backBtn').classList.toggle('hide', !(view === 'orders' && showDetail));
}

/* ── Boot (shared/sb.js calls showApp() after a successful sign-in) ── */
function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = '';
  document.getElementById('railVer').textContent = 'v' + VERSION;
  render();
  loadAll();
}

(async function boot() {
  const ok = await restoreSession();
  document.getElementById('bootSplash').remove();
  if (ok) showApp();
  else document.getElementById('loginScreen').style.display = 'flex';
})();

/* ── Self-check: grouping, totals, pipeline, ageing ────────────────── */
function _selftest() {
  const saveRows = rows, saveDel = deliveryOptions, saveOrders = orders;
  deliveryOptions = [{ name: 'Post', price: 9, icon: 'ti-mail' }];
  rows = [
    { order_id: 'O1', customer: 'A', delivery: 'Post', status: 'Confirmed', qty: 2, total: 20, paid: true,  date: '2026-01-01' },
    { order_id: 'O1', customer: 'A', delivery: 'Post', status: 'Confirmed', qty: 3, total: 30, paid: false, date: '2026-01-01' },
    { order_id: 'O2', customer: 'B', delivery: 'Post', status: 'Complete',  qty: 1, total: 10, paid: true,  date: '2026-01-02' }
  ];
  group();
  const o1 = orders.find(o => o.id === 'O1');
  console.assert(orders.length === 2, 'two orders from three rows');
  console.assert(o1.lines.length === 2 && o1.units === 5, 'lines and units grouped');
  console.assert(o1.subtotal === 50 && o1.total === 59, 'total adds delivery once');
  console.assert(o1.paid === false, 'order is paid only when every line is');
  console.assert(isOpen(o1) && !isOpen(orders.find(o => o.id === 'O2')), 'open excludes Complete');
  console.assert(stageIdx('On Hold') === -1 && meta('On Hold').label === 'On Hold', 'off-flow handled');
  console.assert(fmtDate('2026-01-05') === fmtDate('5/1/2026'), 'both stored date formats parse alike');
  rows = saveRows; deliveryOptions = saveDel; orders = saveOrders;
  console.log('v2 selftest ok');
}
if (location.search.includes('selftest')) _selftest();
