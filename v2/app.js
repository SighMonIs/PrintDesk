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

const VERSION = '2.1.0';

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
    // Same rule as the main site: stock is drawn down when an order completes,
    // never before. Without this v2 could complete an order and silently leave
    // the inventory ledger short.
    if (status === 'Complete') await consumeInventory(o.lines, id);
    toast(o.no + ' → ' + meta(status).label);
    render();
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
    await maybeAdvance(id);
    render();
    toast(o.no + ' marked ' + (paid ? 'paid' : 'unpaid'));
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Order editor — create, edit, delete.

   Everything here writes the same row shapes the main site writes, so an
   order created in v2 is indistinguishable from one created in v1:
   - one `orders` row per line item, each carrying the order header
   - row ids are O<n>-<i>, order ids are O000000000<n>
   - dates are stored dd/mm/yyyy (what the main site's form produces)
   - options are packed "Name:Value||Name:Value", colours pipe-joined
   - editing marks the old rows deleted, then upserts the new set
   ══════════════════════════════════════════════════════════════════════ */

// shared/sb.js deliberately ships no upsert (only BadgeMak3r needed one), so
// v2 adds the same one-liner rather than changing the shared module.
async function sbUpsert(table, row) {
  const r = await sbFetch(table, { method: 'POST', body: JSON.stringify(row) },
    { 'Prefer': 'resolution=merge-duplicates,return=representation' });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r.json();
}

const padN = (n, l) => String(n).padStart(l, '0');
const todayDMY = () => { const d = new Date(); return padN(d.getDate(), 2) + '/' + padN(d.getMonth() + 1, 2) + '/' + d.getFullYear(); };
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + padN(d.getMonth() + 1, 2) + '-' + padN(d.getDate(), 2); };
const toDMY = v => { const d = parseDate(v); return d ? padN(d.getDate(), 2) + '/' + padN(d.getMonth() + 1, 2) + '/' + d.getFullYear() : ''; };
const makeRowId = (orderId, i) => String(orderId).replace(/^O0*/, 'O') + '-' + (i + 1);

function nextOrderId() {
  const ns = orders.map(o => o.id).filter(id => /^O\d+$/.test(id)).map(id => parseInt(id.slice(1), 10));
  return 'O' + padN((ns.length ? Math.max(...ns) : 0) + 1, 10);
}
// Checked against the server right before use, the way the main site does it:
// two people creating an order at once would otherwise compute the same id.
async function nextOrderIdChecked() {
  let id = nextOrderId();
  for (let i = 0; i < 5; i++) {
    const hit = await sbGet('orders', '?order_id=eq.' + encodeURIComponent(id) + '&select=order_id&limit=1');
    if (!Array.isArray(hit) || !hit.length) return id;
    id = 'O' + padN(parseInt(id.slice(1), 10) + 1, 10);
  }
  return id;
}
function nextInvConsumptionId() {
  const ns = invConsumption.map(c => String(c.id)).filter(id => /^IC\d+$/.test(id)).map(id => parseInt(id.slice(2), 10));
  return 'IC' + padN((ns.length ? Math.max(...ns) : 0) + 1, 6);
}

/* ── Inventory ─────────────────────────────────────────────────────── */
// The main site links stock by name: an option *value* that matches an
// inventory item *name* draws that item down. No explicit linking table.
function matchedInventoryItems(line) {
  if (!line.options) return [];
  return String(line.options).split('||')
    .map(p => p.includes(':') ? p.split(':').slice(1).join(':').trim() : '')
    .filter(Boolean)
    .map(v => invItems.find(i => i.name.toLowerCase() === v.toLowerCase()))
    .filter(Boolean);
}

async function logConsumption(itemId, orderId, qty) {
  const rec = { id: nextInvConsumptionId(), item_id: itemId, order_id: orderId, qty, date: todayISO() };
  try {
    await sbUpsert('inventory_consumption', rec);
    invConsumption.push(rec);
  } catch (e) {
    console.error('Inventory write failed for ' + itemId + ' on ' + orderId + ':', e);
  }
}

// Guarded by inv_consumed per row so completing an order twice never
// double-counts.
async function consumeInventory(lines, orderId) {
  for (const l of lines) {
    if (l.inv_consumed || !l.options) continue;
    for (const item of matchedInventoryItems(l)) await logConsumption(item.id, orderId, Number(l.qty) || 0);
    l.inv_consumed = true;
    await sbPatch('orders', '?id=eq.' + encodeURIComponent(l.id), { inv_consumed: true });
  }
}

// inventory_consumption is an append-only ledger, so a qty change on an
// already-consumed row is logged as a delta (which may be negative) rather
// than by editing the original entry.
async function reconcileQty(line, prevQty, orderId) {
  const delta = (Number(line.qty) || 0) - prevQty;
  if (!delta) return;
  for (const item of matchedInventoryItems(line)) await logConsumption(item.id, orderId, delta);
}

/* ── Editor state ──────────────────────────────────────────────────── */
let editing = null;   // {orderId|null, header:{…}, lines:[…]}
let saving = false;

function newLine() { return { catId: cats[0] ? String(cats[0].id) : '', qty: 1, price: cats[0] ? Number(cats[0].price) || 0 : 0, notes: '', options: '', model: '' }; }

function openNewOrder() {
  if (!cats.length) { toast('Add a product in the main site first', 'err'); return; }
  editing = {
    orderId: null,
    header: { customer: '', customerId: '', address: '', date: todayDMY(), delivery: (deliveryOptions[0] || {}).name || '', payment: '', hold: '' },
    lines: [newLine()]
  };
  view = 'orders'; showDetail = true; render();
}

function openEditOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  editing = {
    orderId: o.id,
    header: {
      customer: o.customer, customerId: o.customerId, address: o.address,
      date: toDMY(o.date) || todayDMY(), delivery: o.delivery, payment: o.payment,
      hold: (o.status === 'On Hold' || o.status === 'Cancelled') ? o.status : ''
    },
    lines: o.lines.map(l => ({
      catId: String(l.cat_id || ''), qty: Number(l.qty) || 1, price: Number(l.price) || 0,
      notes: l.notes || '', options: l.options || '', model: l.model || ''
    }))
  };
  view = 'orders'; showDetail = true; render();
}

function closeEditor() { editing = null; render(); }

function addLine() { syncForm(); editing.lines.push(newLine()); render(); }
function removeLine(i) {
  syncForm();
  if (editing.lines.length === 1) { toast('An order needs at least one item', 'err'); return; }
  editing.lines.splice(i, 1); render();
}
// Picking a different product changes which option fields exist, so the row
// is re-rendered and its price reset to that product's default.
function lineProductChanged(i, catId) {
  syncForm();
  editing.lines[i].catId = catId;
  editing.lines[i].options = '';
  const c = cats.find(x => String(x.id) === String(catId));
  if (c) editing.lines[i].price = Number(c.price) || 0;
  render();
}

/* ── Reading the form back ─────────────────────────────────────────── */
const val = id => (document.getElementById(id) || {}).value || '';
// A '|' in free text would corrupt the packed option string, which uses '|'
// between colour layers and '||' between fields.
const safeOptValue = s => String(s).replace(/\|/g, '/').trim();

function optionsStringFor(i) {
  const defs = opts.filter(d => String(d.cat_id) === String(editing.lines[i].catId));
  const parts = [];
  for (const d of defs) {
    let v = '';
    if (isColourOpt(d)) {
      const n = Number(d.num_colours) || 4;
      const picked = [];
      for (let k = 0; k < n; k++) {
        const c = val('optc-' + i + '-' + d.id + '-' + k);
        if (c) picked.push(c);
      }
      v = picked.join('|');
    } else if (d.display === 'text') {
      v = safeOptValue(val('opt-' + i + '-' + d.id));
      if (d.force_caps) v = v.toUpperCase();
    } else {
      v = val('opt-' + i + '-' + d.id);
      if (v === 'Custom') v = safeOptValue(val('optx-' + i + '-' + d.id));
    }
    if (v) parts.push(d.name + ':' + v);
  }
  return parts.join('||');
}

function syncForm() {
  if (!editing) return;
  const typed = val('f-customer').trim();
  // Resolve the customer record by name on every read rather than trusting a
  // change event to have fired — autofill and paste don't always raise one,
  // and an order saved with a null customer_id loses its account link.
  const match = customers.find(c => c.name.trim().toLowerCase() === typed.toLowerCase());
  editing.header = {
    customer: typed,
    customerId: match ? String(match.id) : '',
    address: val('f-address').trim(),
    date: val('f-date'),
    delivery: val('f-delivery'),
    payment: val('f-payment'),
    hold: val('f-hold')
  };
  editing.lines.forEach((l, i) => {
    l.catId = val('l-cat-' + i) || l.catId;
    l.qty = Math.max(1, parseInt(val('l-qty-' + i), 10) || 1);
    l.price = parseFloat(val('l-price-' + i)) || 0;
    l.notes = val('l-notes-' + i).trim();
    l.options = optionsStringFor(i);
  });
}

const isColourOpt = d => d.display === 'colour'
  || d.name.toLowerCase().includes('colour') || d.name.toLowerCase().includes('color');

/* ── Save ──────────────────────────────────────────────────────────── */
function validate() {
  const errs = [];
  if (!editing.header.customer) errs.push('Customer name is required');
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(editing.header.date)) errs.push('Date must be dd/mm/yyyy');
  editing.lines.forEach((l, i) => {
    if (!l.catId) errs.push('Item ' + (i + 1) + ' has no product');
    if (!(l.qty > 0)) errs.push('Item ' + (i + 1) + ' needs a quantity');
  });
  return errs;
}

async function saveOrder() {
  if (saving) return;
  syncForm();
  const errs = validate();
  if (errs.length) { toast(errs[0], 'err'); return; }

  saving = true;
  const btn = document.getElementById('saveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Saving…'; }

  const isEdit = !!editing.orderId;
  const prev = isEdit ? orders.find(o => o.id === editing.orderId) : null;
  try {
    const orderId = editing.orderId || await nextOrderIdChecked();
    const h = editing.header;

    // Carry the untouched workflow fields across an edit, matched by row id.
    const prevById = new Map((prev ? prev.lines : []).map(l => [String(l.id), l]));
    const qtyChanges = [];
    const newRows = editing.lines.map((l, i) => {
      const id = makeRowId(orderId, i);
      const old = prevById.get(id);
      let status = old ? old.status : 'Pending';
      if (h.hold) status = h.hold;
      else if (status === 'On Hold' || status === 'Cancelled') status = 'Pending';
      const qty = Number(l.qty) || 0;
      if (old && old.inv_consumed && Number(old.qty) !== qty) qtyChanges.push([id, Number(old.qty) || 0]);
      return {
        id, order_id: orderId, customer: h.customer, customer_id: h.customerId || null,
        address: h.address, delivery: h.delivery, payment: h.payment || 'No',
        model: l.model || '', cat_id: l.catId, qty, price: Number(l.price) || 0,
        total: parseFloat((qty * (Number(l.price) || 0)).toFixed(2)),
        status, date: h.date, notes: l.notes, options: l.options,
        printed: old ? !!old.printed : false,
        paid: prev ? !!prev.paid : false,
        inv_consumed: old ? !!old.inv_consumed : false,
        deleted: false
      };
    });

    // Mark the whole old set deleted first; the upsert below revives the rows
    // that still exist, so any item removed in this edit stays deleted.
    if (isEdit) await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(orderId), { deleted: true });
    for (const r of newRows) await sbUpsert('orders', r);

    for (const [id, was] of qtyChanges) {
      await reconcileQty(newRows.find(r => r.id === id), was, orderId);
    }
    if (newRows[0].status === 'Complete') await consumeInventory(newRows, orderId);

    rows = rows.filter(r => String(r.order_id) !== String(orderId)).concat(newRows);
    group();
    selected = orderId;
    editing = null;
    toast((isEdit ? 'Saved ' : 'Created ') + orderNo(orderId));
  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
  } finally {
    saving = false;
    render();
  }
}

/* ── Delete (soft, with undo) ──────────────────────────────────────── */
async function deleteOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const name = o.customer || 'this order';
  const typed = await askText('Type the customer name to confirm deleting ' + o.no + ':\n\n"' + name + '"', '');
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== name.trim().toLowerCase()) { toast('Name did not match — nothing deleted', 'err'); return; }

  const kept = o.lines.slice();
  rows = rows.filter(r => String(r.order_id) !== String(id));
  group();
  if (selected === id) { selected = null; showDetail = false; }
  editing = null;
  render();

  const err = await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(id), { deleted: true });
  if (err) {
    rows = rows.concat(kept); group(); render();
    toast('Delete failed: ' + (err.message || 'unknown error'), 'err');
    return;
  }
  showUndo(o.no + ' deleted', async () => {
    const e2 = await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(id), { deleted: false });
    if (e2) { toast('Undo failed: ' + (e2.message || 'unknown error'), 'err'); return; }
    rows = rows.concat(kept); group(); selected = id; render();
    toast(o.no + ' restored');
  });
}

function showUndo(msg, onUndo) {
  const el = document.getElementById('toast');
  el.className = 'toast';
  el.innerHTML = '';
  el.appendChild(document.createTextNode(msg + ' '));
  const b = document.createElement('button');
  b.className = 'btn sm';
  b.textContent = 'Undo';
  b.onclick = () => { el.style.display = 'none'; onUndo(); };
  el.appendChild(b);
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, 7000);
}

/* ── Per-item printed, and the forward-only auto-advance ───────────── */
async function toggleLinePrinted(orderId, rowId, checked) {
  const o = orders.find(x => x.id === orderId);
  const l = o && o.lines.find(x => String(x.id) === String(rowId));
  if (!l) return;
  l.printed = checked;
  render();
  const err = await sbPatch('orders', '?id=eq.' + encodeURIComponent(rowId), { printed: checked });
  if (err) { l.printed = !checked; toast('Could not save: ' + (err.message || ''), 'err'); render(); return; }
  await maybeAdvance(orderId);
  render();
}

// Mirrors the main site: Pending/Confirmed → Printed once every item is
// printed, Printed → Complete once it is paid. Never moves backwards, and
// never touches On Hold, Cancelled or Complete.
async function maybeAdvance(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o || ['On Hold', 'Cancelled', 'Complete'].includes(o.status)) return;
  let next = null;
  if (o.status === 'Printed' && o.paid) next = 'Complete';
  else if ((o.status === 'Pending' || o.status === 'Confirmed') && o.lines.every(l => l.printed)) next = 'Printed';
  if (!next) return;
  o.status = next; o.lines.forEach(l => { l.status = next; });
  const err = await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(orderId), { status: next });
  if (err) { toast('Could not save: ' + (err.message || ''), 'err'); return; }
  if (next === 'Complete') await consumeInventory(o.lines, orderId);
  toast(o.no + ' advanced to ' + meta(next).label);
}

/* ── Navigation ────────────────────────────────────────────────────── */
function go(v) { view = v; showDetail = false; editing = null; window.scrollTo(0, 0); render(); }
function pick(id) { selected = id; showDetail = true; editing = null; if (view !== 'orders') view = 'orders'; render(); }
function closeDetail() { if (editing) { editing = null; } else { showDetail = false; } render(); }
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
        <button class="btn" onclick="openEditOrder('${esc(o.id)}')"><i class="ti ti-pencil"></i> Edit</button>
        <button class="btn icon ghost" onclick="deleteOrder('${esc(o.id)}')" title="Delete order" aria-label="Delete order"><i class="ti ti-trash"></i></button>
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
              <label class="made-check" title="Mark this item made">
                <input type="checkbox" ${l.printed ? 'checked' : ''}
                  onchange="toggleLinePrinted('${esc(o.id)}','${esc(l.id)}',this.checked)"> made
              </label>
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

/* ── The form ──────────────────────────────────────────────────────── */
function optionFieldHtml(i, d) {
  const saved = {};
  String(editing.lines[i].options || '').split('||').forEach(p => {
    const x = p.indexOf(':'); if (x >= 0) saved[p.slice(0, x).trim()] = p.slice(x + 1).trim();
  });
  const v = saved[d.name] || '';
  const label = `<label for="opt-${i}-${d.id}">${esc(d.name)}</label>`;

  if (isColourOpt(d)) {
    const n = Number(d.num_colours) || 4;
    const picked = v ? v.split('|') : String(d.default_colours || '').split('|').filter(Boolean);
    const usable = colours.filter(c => !c.archived);
    const sel = k => `<select id="optc-${i}-${d.id}-${k}" class="opt-colour">
      <option value="">—</option>
      ${usable.map(c => `<option value="${esc(c.name)}"${picked[k] === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select>`;
    return `<div class="form-row"><label>${esc(d.name)}</label>
      <div class="opt-colours">${Array.from({ length: n }, (_, k) => sel(k)).join('')}</div></div>`;
  }

  if (d.display === 'text') {
    return `<div class="form-row">${label}
      <input type="text" id="opt-${i}-${d.id}" value="${esc(v)}" ${d.force_caps ? 'style="text-transform:uppercase"' : ''}
        placeholder="${esc(d.name)}…"></div>`;
  }

  const items = String(d.options || '').split(',').map(s => s.trim()).filter(Boolean);
  const custom = v && !items.includes(v);
  return `<div class="form-row">${label}
    <select id="opt-${i}-${d.id}" onchange="syncForm();render()">
      <option value="">— select —</option>
      ${items.map(it => `<option${v === it ? ' selected' : ''}>${esc(it)}</option>`).join('')}
      <option value="Custom"${custom ? ' selected' : ''}>Custom…</option>
    </select>
    ${custom ? `<input type="text" id="optx-${i}-${d.id}" value="${esc(v)}" placeholder="Describe the custom option…" class="mt6">` : ''}
  </div>`;
}

function orderForm() {
  const h = editing.header;
  const isEdit = !!editing.orderId;
  const total = editing.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0)
    + (Number(delivery(h.delivery).price) || 0);

  return `<div class="detail">
    <div class="detail-hdr">
      <div class="detail-hdr-main">
        <div class="detail-title">${isEdit ? 'Edit ' + esc(orderNo(editing.orderId)) : 'New order'}</div>
        <div class="detail-sub"><span>${isEdit ? 'Changes replace every line in this order' : 'Saved straight to the live database'}</span></div>
      </div>
      <div class="detail-actions">
        <button class="btn" onclick="closeEditor()">Cancel</button>
        <button class="btn primary" id="saveBtn" onclick="saveOrder()"><i class="ti ti-check"></i> Save order</button>
      </div>
    </div>

    <div class="card">
      <div class="card-hdr"><i class="ti ti-user"></i><h3>Customer</h3></div>
      <div class="card-body form-grid">
        <div class="form-row"><label for="f-customer">Name</label>
          <input type="text" id="f-customer" list="customerList" value="${esc(h.customer)}" placeholder="Start typing a name…"
            onchange="linkCustomer(this.value)">
          <datalist id="customerList">${customers.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
        </div>
        <input type="hidden" id="f-customer-id" value="${esc(h.customerId)}">
        <div class="form-row"><label for="f-address">Address</label>
          <textarea id="f-address" rows="2" placeholder="Delivery address">${esc(h.address)}</textarea></div>
        <div class="form-row"><label for="f-date">Date</label>
          <input type="text" id="f-date" value="${esc(h.date)}" placeholder="dd/mm/yyyy" inputmode="numeric"></div>
        <div class="form-row"><label for="f-delivery">Delivery</label>
          <select id="f-delivery" onchange="syncForm();render()">
            ${deliveryOptions.map(d => `<option value="${esc(d.name)}"${h.delivery === d.name ? ' selected' : ''}>${esc(d.name)} — ${money(d.price)}</option>`).join('')}
          </select></div>
        <div class="form-row"><label for="f-payment">Payment</label>
          <select id="f-payment">
            <option value="">— not set —</option>
            ${paymentOptions.map(p => `<option value="${esc(p.name)}"${h.payment === p.name ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></div>
        ${isEdit ? `<div class="form-row"><label for="f-hold">Hold / cancel</label>
          <select id="f-hold">
            <option value="">— in the normal pipeline —</option>
            <option value="On Hold"${h.hold === 'On Hold' ? ' selected' : ''}>On Hold</option>
            <option value="Cancelled"${h.hold === 'Cancelled' ? ' selected' : ''}>Cancelled</option>
          </select></div>` : '<input type="hidden" id="f-hold" value="">'}
      </div>
    </div>

    <div class="card">
      <div class="card-hdr"><i class="ti ti-list-details"></i><h3>Items</h3>
        <div class="right"><button class="btn sm" onclick="addLine()"><i class="ti ti-plus"></i> Add item</button></div>
      </div>
      <div class="card-body flush">
        ${editing.lines.map((l, i) => {
          const defs = opts.filter(d => String(d.cat_id) === String(l.catId));
          return `<div class="form-line">
            <div class="form-line-hdr">
              <span class="form-line-n">Item ${i + 1}</span>
              <button class="btn sm ghost" onclick="removeLine(${i})" aria-label="Remove item ${i + 1}"><i class="ti ti-trash"></i></button>
            </div>
            <div class="form-grid">
              <div class="form-row"><label for="l-cat-${i}">Product</label>
                <select id="l-cat-${i}" onchange="lineProductChanged(${i},this.value)">
                  ${cats.map(c => `<option value="${esc(c.id)}"${String(l.catId) === String(c.id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
                </select></div>
              <div class="form-row form-row-pair">
                <div><label for="l-qty-${i}">Qty</label>
                  <input type="number" id="l-qty-${i}" min="1" step="1" value="${esc(l.qty)}" inputmode="numeric" oninput="syncForm();updateFormTotal()"></div>
                <div><label for="l-price-${i}">Unit price</label>
                  <input type="number" id="l-price-${i}" min="0" step="0.01" value="${esc(l.price)}" inputmode="decimal" oninput="syncForm();updateFormTotal()"></div>
              </div>
              ${defs.map(d => optionFieldHtml(i, d)).join('')}
              <div class="form-row"><label for="l-notes-${i}">Notes</label>
                <input type="text" id="l-notes-${i}" value="${esc(l.notes)}" placeholder="Anything to remember for this item"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="totals">
        <div class="totals-row"><span>${esc(delivery(h.delivery).name || 'Delivery')}</span><span>${money(delivery(h.delivery).price || 0)}</span></div>
        <div class="totals-row grand"><span>Total</span><span id="formTotal">${money(total)}</span></div>
      </div>
    </div>

    ${isEdit ? `<div class="card">
      <div class="card-hdr"><i class="ti ti-trash"></i><h3>Danger zone</h3></div>
      <div class="card-body">
        <button class="btn danger" onclick="deleteOrder('${esc(editing.orderId)}')"><i class="ti ti-trash"></i> Delete this order</button>
        <p class="readonly-note" style="margin-top:9px"><i class="ti ti-info-circle"></i> Marks the order deleted rather than removing it, and offers an undo. The main site hides deleted orders the same way.</p>
      </div>
    </div>` : ''}
  </div>`;
}

// Cheap live total — avoids re-rendering (and losing focus) on every keystroke.
function updateFormTotal() {
  if (!editing) return;
  const t = editing.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0)
    + (Number(delivery(editing.header.delivery).price) || 0);
  const el = document.getElementById('formTotal');
  if (el) el.textContent = money(t);
}

// Picking a known customer fills in their address and links the record.
function linkCustomer(name) {
  const c = customers.find(x => x.name.toLowerCase() === String(name).trim().toLowerCase());
  syncForm();
  editing.header.customerId = c ? String(c.id) : '';
  if (c && c.address && !editing.header.address) editing.header.address = c.address;
  render();
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
    <div class="pane-detail">${editing ? orderForm() : orderDetail(sel)}</div>`;
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

  // Writing: ids and shapes must match what the main site produces.
  console.assert(nextOrderId() === 'O0000000003', 'next order id follows the highest existing');
  console.assert(makeRowId('O0000000014', 0) === 'O14-1', 'row id strips the padding');
  console.assert(makeRowId('O0000000014', 2) === 'O14-3', 'row ids are 1-based');
  console.assert(toDMY('2026-01-05') === '05/01/2026', 'dates are written dd/mm/yyyy');
  console.assert(toDMY('5/1/2026') === '05/01/2026', 'already-DMY dates round-trip');

  const saveInv = invItems;
  invItems = [{ id: 'I1', name: 'Magnet' }, { id: 'I2', name: 'Gold' }];
  const hit = matchedInventoryItems({ options: 'Backing:Magnet||Text:Kevin||Colours:Gold|Black' });
  console.assert(hit.length === 1 && hit[0].id === 'I1', 'stock matches whole option values, not pipe-joined colours');
  console.assert(matchedInventoryItems({ options: '' }).length === 0, 'no options, no stock movement');
  invItems = saveInv;

  rows = saveRows; deliveryOptions = saveDel; orders = saveOrders;
  console.log('v2 selftest ok');
}
if (location.search.includes('selftest')) _selftest();
