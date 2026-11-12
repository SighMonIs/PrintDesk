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

const VERSION = '2.9.0';

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
  { k: 'calculator',label: 'Calculator',short: 'Calc',   icon: 'ti-calculator',       sub: 'Print cost calculator' },
  { k: 'settings',  label: 'Settings',  short: 'More',   icon: 'ti-settings',         sub: 'Workspace configuration' }
];

/* ── State ─────────────────────────────────────────────────────────── */
let rows = [];          // raw order line-item rows
let orders = [];        // grouped by order_id
let cats = [], opts = [], colours = [], customers = [];
let deliveryOptions = [], paymentOptions = [];
let invItems = [], invReceipts = [], invConsumption = [];
let bmModels = [];      // BadgeMak3r models linked to a product

let view = 'dashboard';
let selected = null;
let chip = 'open';   // restored from localStorage once lsGet is defined (see boot)
let showDetail = false;   // phone: detail takes over the screen
let relatedOpen = false;  // collapsed by default; restored from localStorage in boot()
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
async function loadAll() {
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
    // Non-fatal: the category_id column only exists once the BadgeMak3r
    // migration has run, and a product with no linked model simply gets no
    // badge button.
    bmModels = await sbGet('badgemaker_models', '?archived=eq.false&category_id=not.is.null&select=id,name,category_id')
      .then(r => Array.isArray(r) ? r : []).catch(() => []);
    group();
    loading = false;
  } catch (e) {
    loading = false;
    toast('Load failed: ' + e.message, 'err');
  } finally {
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
  // No confirm: moving a stage is a single tap you can tap straight back,
  // and the toast offers an undo for a mis-tap.
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
    render();
    showUndo(o.no + ' → ' + meta(status).label, async () => {
      const e2 = await sbPatch('orders', '?order_id=eq.' + encodeURIComponent(id), { status: was });
      if (e2) { toast('Undo failed: ' + (e2.message || ''), 'err'); return; }
      o.status = was; o.lines.forEach(l => { l.status = was; });
      render();
      // Stock already drawn down by a completion stays drawn down — the
      // ledger is append-only, so correct it in Stock if that matters.
      toast(o.no + ' back to ' + meta(was).label + (status === 'Complete' ? ' — stock stays used' : ''));
    });
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
// One generator for every sequential id in the schema. The prefixes and
// widths are the main site's, so ids stay consistent whichever app wrote
// the row: CUST0001, COL0001, C0001, O0001, INV0001, RCPT0001, CONS0001.
function seqId(list, prefix, width) {
  const re = new RegExp('^' + prefix + '(\\d+)$');
  const ns = (list || []).map(x => String(x.id)).map(id => (id.match(re) || [])[1])
    .filter(Boolean).map(n => parseInt(n, 10));
  return prefix + padN((ns.length ? Math.max(...ns) : 0) + 1, width);
}
const nextInvConsumptionId = () => seqId(invConsumption, 'CONS', 4);

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
function go(v) { view = v; showDetail = false; editing = null; record = null; window.scrollTo(0, 0); render(); }
function pick(id) {
  selected = id; showDetail = true; editing = null; record = null;
  if (view !== 'orders') view = 'orders';
  // If the current filter hides this order the list would quietly select a
  // different one, so following a link to a completed order while filtered
  // to Open landed you on someone else's order entirely.
  if (!filtered().some(o => o.id === id)) chip = 'all';
  render();
}
function closeDetail() { if (editing) { editing = null; } else { showDetail = false; } render(); }
// The chosen filter is remembered, which is what the main site's
// "save as default filter" amounts to in a single-select world.
function setChip(c) { chip = c; lsSet('v2_filter', c); render(); }

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
    <tbody>${body.map(r => `<tr${r.click
      // A link or button inside the row is its own target — mailto, tel and the
      // order pills must not also trigger the row.
      ? ` class="clickable" onclick="if(event.target.closest('a,button'))return;${r.click}"` : ''}>`
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
  // Older orders predate customer_id, so fall back to matching on name —
  // otherwise their customer card would have nothing to link to.
  const c = customers.find(x => String(x.id) === o.customerId)
    || customers.find(x => x.name.trim().toLowerCase() === String(o.customer || '').trim().toLowerCase())
    || {};
  const cur = stageIdx(o.status);
  const next = cur < 0 ? FLOW[1] : FLOW[cur + 1];
  const age = ageDays(o);

  return `<div class="detail">

    <div class="detail-hdr">
      <div class="detail-actions">
        ${next && isOpen(o) ? `<button class="btn success" onclick="advance('${esc(o.id)}')"><i class="ti ${next.icon}"></i> Mark ${esc(next.label)}</button>` : ''}
        <button class="btn ${o.paid ? '' : 'primary'}" onclick="togglePaid('${esc(o.id)}')">
          <i class="ti ${o.paid ? 'ti-rotate-2' : 'ti-cash'}"></i> ${o.paid ? 'Mark unpaid' : 'Mark paid'}</button>
        <button class="btn" onclick="openEditOrder('${esc(o.id)}')"><i class="ti ti-pencil"></i> Edit</button>
        <button class="btn icon ghost" onclick="generateInvoice('${esc(o.id)}')" title="Invoice PDF" aria-label="Invoice PDF"><i class="ti ti-file-invoice"></i></button>
        <button class="btn icon ghost" onclick="printShippingLabel('${esc(o.id)}')" title="Shipping label" aria-label="Shipping label"><i class="ti ti-tag"></i></button>
        <button class="btn icon ghost" onclick="deleteOrder('${esc(o.id)}')" title="Delete order" aria-label="Delete order"><i class="ti ti-trash"></i></button>
      </div>
    </div>

    ${pipeline(o)}

    ${o.notes ? `<div class="note"><i class="ti ti-message-2"></i><div>${esc(o.notes)}</div></div>` : ''}

    <div class="grid2">
      <div class="card">
        <div class="card-hdr"><i class="ti ti-user"></i><h3>Customer</h3></div>
        <div class="card-body kv">
          <div class="kv-row"><div class="k">Order</div><div class="v">${esc(o.no)} <span class="detail-id">${esc(o.id)}</span></div></div>
          <div class="kv-row"><div class="k">Ordered</div><div class="v">${esc(fmtDate(o.date))}${age != null ? ` <span class="subtle">· ${age}d ago</span>` : ''}</div></div>
          <div class="kv-row"><div class="k">Name</div><div class="v">${c.id
            ? `<a href="#" class="record-link" onclick="event.preventDefault();openRecord('customer','${esc(c.id)}',1)">${esc(o.customer)}<i class="ti ti-arrow-up-right"></i></a>`
            : esc(o.customer || '—')}</div></div>
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

    ${relatedOrders(o)}

    <div class="card">
      <div class="card-hdr"><i class="ti ti-list-details"></i><h3>Line items</h3>
        ${badgeItemsFor(o).length ? `<div class="right">
          <button class="btn sm" onclick="openBadgeBatch('${esc(o.id)}')"><i class="ti ti-badges"></i> All badges</button>
        </div>` : ''}
      </div>
      <div class="card-body flush">
        <div class="lines">${o.lines.map(l => {
          const attrs = parseOpts(l);
          return `<div class="line">
            <div class="line-qty"><b>${esc(l.qty)}</b><small>qty</small></div>
            <div class="line-main">
              <div class="line-name">${esc(catName(l.cat_id))}</div>
              ${attrs.length || hasBadgeTemplate(l.cat_id) ? `<div class="line-attrs">
                ${attrs.map(a => a.colours
                  ? `<span class="attr">${esc(a.name)} ${a.colours.map(n => `<span class="sw" style="--sw:${esc(colourCode(n))}" title="${esc(n)}"></span>`).join('')}</span>`
                  : `<span class="attr">${esc(a.name)} <b>${esc(a.value)}</b></span>`).join('')}
                ${hasBadgeTemplate(l.cat_id) ? `<button class="btn sm ghost badge-btn" onclick="generateBadge('${esc(o.id)}','${esc(l.id)}')" title="Download .3mf">
                  <i class="ti ti-badge"></i> 3MF</button>` : ''}
              </div>` : ''}
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

  </div>`;
}

/* ── Number stepper ────────────────────────────────────────────────────
   The browser's own spinner is a tiny light-grey control that can't be
   themed and doesn't appear on phones at all, so the field gets its own
   −/+ buttons instead. `step` stays fine-grained for typing; `nudge` is
   how far a button press moves it. */
function stepper(id, value, o) {
  return `<div class="stepper">
    <button type="button" class="step-btn" tabindex="-1" aria-label="Decrease" onclick="stepNum('${id}',-1)"><i class="ti ti-minus"></i></button>
    <input type="number" id="${id}" value="${esc(value)}" min="${o.min}" step="${o.step}" data-nudge="${o.nudge}"
      inputmode="${o.mode}" oninput="syncForm();updateFormTotal()">
    <button type="button" class="step-btn" tabindex="-1" aria-label="Increase" onclick="stepNum('${id}',1)"><i class="ti ti-plus"></i></button>
  </div>`;
}

function stepNum(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  const nudge = parseFloat(el.dataset.nudge) || parseFloat(el.step) || 1;
  const min = el.min === '' ? -Infinity : parseFloat(el.min);
  const dp = (String(nudge).split('.')[1] || '').length;
  let v = (parseFloat(el.value) || 0) + dir * nudge;
  if (v < min) v = min;
  el.value = dp ? v.toFixed(dp) : String(Math.round(v));
  syncForm();
  updateFormTotal();
}

/* ── Colour picker ─────────────────────────────────────────────────────
   A native <option> can't carry a round swatch (background-color on an
   option is ignored on macOS and iOS), so this is a button plus a popup
   list. The value lives in a hidden input keeping the same id the option
   packer reads, so nothing downstream changes. */
let openColourMenu = null;

function colourPicker(id, selectedName) {
  const usable = colours.filter(c => !c.archived);
  const cur = usable.find(c => c.name === selectedName);
  return `<div class="cpick" id="w-${id}">
    <input type="hidden" id="${id}" value="${esc(selectedName || '')}">
    <button type="button" class="cpick-btn" onclick="toggleColourMenu('${id}')" aria-haspopup="listbox">
      <span class="sw-dot" style="--sw:${esc(cur ? cur.code : 'transparent')}${cur ? '' : ';border-style:dashed'}"></span>
      <span class="cpick-name">${esc(selectedName || '—')}</span>
      <i class="ti ti-chevron-down"></i>
    </button>
    <div class="cpick-menu" role="listbox" hidden>
      <button type="button" class="cpick-opt" role="option" onclick="chooseColour('${id}','')">
        <span class="sw-dot" style="--sw:transparent;border-style:dashed"></span>none</button>
      ${usable.map(c => `<button type="button" class="cpick-opt${c.name === selectedName ? ' on' : ''}" role="option"
        onclick="chooseColour('${id}','${esc(c.name).replace(/'/g, "\\'")}')">
        <span class="sw-dot" style="--sw:${esc(c.code)}"></span>${esc(c.name)}</button>`).join('')}
    </div>
  </div>`;
}

function toggleColourMenu(id) {
  const wrap = document.getElementById('w-' + id);
  const menu = wrap.querySelector('.cpick-menu');
  const isOpen = !menu.hidden;
  closeColourMenu();
  if (isOpen) return;
  menu.hidden = false;
  openColourMenu = menu;
  // Flip above the button when there isn't room below it.
  const r = wrap.getBoundingClientRect();
  menu.classList.toggle('up', r.bottom + 240 > window.innerHeight && r.top > 240);
  const on = menu.querySelector('.cpick-opt.on');
  if (on) on.scrollIntoView({ block: 'center' });
}

function closeColourMenu() {
  if (openColourMenu) { openColourMenu.hidden = true; openColourMenu = null; }
}

function chooseColour(id, name) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = name;
  const c = colours.find(x => x.name === name);
  const btn = document.querySelector('#w-' + id + ' .cpick-btn');
  btn.querySelector('.cpick-name').textContent = name || '—';
  const dot = btn.querySelector('.sw-dot');
  dot.style.setProperty('--sw', c ? c.code : 'transparent');
  dot.style.borderStyle = c ? 'solid' : 'dashed';
  document.querySelectorAll('#w-' + id + ' .cpick-opt').forEach(b => b.classList.remove('on'));
  closeColourMenu();
  syncForm();
}

document.addEventListener('click', e => {
  if (openColourMenu && !e.target.closest('.cpick')) closeColourMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeColourMenu(); });

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
    return `<div class="form-row"><label>${esc(d.name)}</label>
      <div class="opt-colours">${Array.from({ length: n }, (_, k) =>
        colourPicker('optc-' + i + '-' + d.id + '-' + k, picked[k] || '')).join('')}</div></div>`;
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
                  ${stepper('l-qty-' + i, l.qty, { min: 1, step: 1, nudge: 1, mode: 'numeric' })}</div>
                <div><label for="l-price-${i}">Unit price</label>
                  ${stepper('l-price-' + i, l.price, { min: 0, step: 0.01, nudge: 0.5, mode: 'decimal' })}</div>
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

// Other orders from the same customer, so you can hop between them.
// Collapsible, and capped at five rows tall so a regular customer's history
// never pushes the line items off the screen.
function toggleRelated() {
  relatedOpen = !relatedOpen;
  lsSet('v2_related_open', relatedOpen ? '1' : '0');
  render();
}

// Measure a real row rather than assuming its height, so exactly five show
// and the sixth is cleanly off the edge whatever the font ends up being.
const RELATED_VISIBLE = 5;
function capRelatedHeight() {
  const box = document.querySelector('.related-scroll');
  if (!box) return;
  const rows = box.querySelectorAll('.related-row');
  if (rows.length <= RELATED_VISIBLE) { box.style.maxHeight = 'none'; return; }
  box.style.maxHeight = (rows[0].getBoundingClientRect().height * RELATED_VISIBLE) + 'px';
}

function relatedOrders(o) {
  const others = orders.filter(x => x.id !== o.id &&
    (o.customerId ? x.customerId === o.customerId : x.customer === o.customer));
  if (!others.length) return '';
  return `<div class="card">
    <button class="card-hdr card-hdr-toggle" onclick="toggleRelated()" aria-expanded="${relatedOpen}">
      <i class="ti ti-link"></i>
      <h3>Other orders from ${esc(o.customer || 'this customer')}</h3>
      <span class="right subtle">${others.length}</span>
      <i class="ti ti-chevron-down chev${relatedOpen ? ' open' : ''}"></i>
    </button>
    ${relatedOpen ? `<div class="card-body flush related-scroll">
      ${others.map(x => `<button class="related-row" onclick="pick('${esc(x.id)}')">
        <span class="mono">${esc(x.no)}</span>
        <span class="subtle">${esc(fmtDate(x.date))}</span>
        ${pill(x.status)}
        <span class="mono related-total">${money(x.total)}</span>
      </button>`).join('')}
    </div>` : ''}
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
        <select class="filter-select" aria-label="Filter orders" onchange="setChip(this.value)">
          ${chips.map(([k, l, n]) =>
            `<option value="${esc(k)}"${chip === k ? ' selected' : ''}>${esc(l)} (${n})</option>`).join('')}
        </select>
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
  if (record) return `<div class="page">${recordForm()}</div>`;
  return `<div class="page"><div class="page-inner">
    <div class="section-title">Customers <span class="subtle">${list.length}</span>
      <span class="right"><button class="btn sm" onclick="openRecord('customer')"><i class="ti ti-plus"></i> Add customer</button></span></div>
    ${table(
      [{ h: 'Customer' }, { h: 'Contact' }, { h: 'Address', cls: 'subtle' },
       { h: 'Orders', cls: 'num mono' }, { h: 'Lifetime', cls: 'num mono' }, { h: 'Open' }],
      list.map(c => {
        const os = ordersOf(c), open = os.filter(isOpen);
        return { click: `openRecord('customer','${esc(c.id)}',1)`, cells: [
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
  if (record) return `<div class="page">${recordForm()}</div>`;
  const live = orders.filter(o => o.status !== 'Cancelled').flatMap(o => o.lines);
  return `<div class="page"><div class="page-inner">
    <div class="section-title">Catalogue <span class="subtle">${cats.length}</span>
      <span class="right"><button class="btn sm" onclick="openRecord('product')"><i class="ti ti-plus"></i> New product</button></span></div>
    ${table(
      [{ h: 'Product' }, { h: 'Price', cls: 'num mono' }, { h: 'Options', cls: 'subtle' },
       { h: 'Sold', cls: 'num mono' }, { h: 'Revenue', cls: 'num mono' }, { h: 'Open now', cls: 'num mono' }, { h: '', cls: 'num' }],
      cats.map(c => {
        const ls = live.filter(l => String(l.cat_id) === String(c.id));
        const openLs = orders.filter(isOpen).flatMap(o => o.lines).filter(l => String(l.cat_id) === String(c.id));
        return { cells: [
          esc(c.name) + (c.shop_visible === false ? ' <span class="pill" style="--pc:var(--muted)">hidden</span>' : ''),
          money(c.price),
          opts.filter(o => String(o.cat_id) === String(c.id)).map(o => esc(o.name)).join(', ') || '—',
          String(ls.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
          money(ls.reduce((s, l) => s + (Number(l.total) || 0), 0)),
          String(openLs.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
          `<button class="btn sm ghost" onclick="openRecord('product','${esc(c.id)}')" aria-label="Edit ${esc(c.name)}"><i class="ti ti-pencil"></i></button>`
        ] };
      })
    )}
    ${coloursSection()}
  </div></div>`;
}

// The colour library lives under Products: it is only ever used by product
// options, so it does not need a tab of its own.
function coloursSection() {
  const usable = colours.filter(c => !c.archived);
  return `<div class="section-title">Colour library <span class="subtle">${usable.length}</span>
      <span class="right"><button class="btn sm" onclick="openRecord('colour')"><i class="ti ti-plus"></i> Add colour</button></span></div>
    <div class="swatch-grid">
      ${usable.map(c => `<button class="swatch-cell" onclick="openRecord('colour','${esc(c.id)}')" title="${esc(c.code)}">
        <span class="sw-dot" style="--sw:${esc(c.code)}"></span>
        <span class="swatch-name">${esc(c.name)}</span>
        ${c.available === false ? '<span class="pill" style="--pc:var(--muted)">off</span>' : ''}
      </button>`).join('') || '<span class="subtle">No colours yet.</span>'}
    </div>`;
}

/* ── Stock ─────────────────────────────────────────────────────────── */
function viewStock() {
  const received = id => invReceipts.filter(r => String(r.item_id) === String(id)).reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const used = id => invConsumption.filter(c => String(c.item_id) === String(id)).reduce((s, c) => s + (Number(c.qty) || 0), 0);
  const spent = id => invReceipts.filter(r => String(r.item_id) === String(id)).reduce((s, r) => s + (Number(r.cost) || 0), 0);

  if (record) return `<div class="page">${recordForm()}</div>`;
  return `<div class="page"><div class="page-inner">
    <div class="section-title">Stock on hand <span class="subtle">${invItems.length} items</span>
      <span class="right"><button class="btn sm" onclick="openRecord('invitem')"><i class="ti ti-plus"></i> Add item</button></span></div>
    ${table(
      [{ h: 'Item' }, { h: 'Received', cls: 'num mono' }, { h: 'Used', cls: 'num mono' },
       { h: 'On hand', cls: 'num mono' }, { h: 'Spend', cls: 'num mono' }, { h: 'Level' }, { h: '', cls: 'num' }],
      invItems.map(i => {
        const rec = received(i.id), use = used(i.id), left = rec - use;
        const col = left <= 0 ? '--red' : left < rec * 0.2 ? '--amber' : '--green';
        return { cells: [
          esc(i.name) + (i.notes ? `<div class="subtle">${esc(i.notes)}</div>` : ''),
          String(rec), String(use),
          `<span style="color:var(${col})">${left}</span>`,
          money(spent(i.id)),
          `<div class="bar" style="--bc:var(${col})"><i style="width:${rec ? Math.max(0, Math.min(100, left / rec * 100)) : 0}%"></i></div>`,
          `<button class="btn sm ghost" onclick="openRecord('invitem','${esc(i.id)}')" aria-label="Edit ${esc(i.name)}"><i class="ti ti-pencil"></i></button>`
        ] };
      })
    )}
    ${invItems.length ? '' : `<p class="readonly-note"><i class="ti ti-info-circle"></i> Name an item exactly as an option value — "Magnet", say — and completed orders draw it down on their own.</p>`}
  </div></div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   Badge generation

   Each order badge is built from the BadgeMak3r model linked to its
   product. The geometry and 3MF writing already exist in
   ../badgemaker/geometry.js and ../shared/3mf.js, so this loads those
   rather than carrying a second copy; only the paths differ from the
   main site, since v2 sits one directory down.
   ══════════════════════════════════════════════════════════════════════ */
const CDN_SRI = {
  'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js': 'sha384-3TaxGqyHrMuRIWY5Z5WHNIzgNRqGIUJE+mk6tm+g1wkm9Ux2kUyOLfy9AsNWXA6u',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js': 'sha384-qOkzR5Ke/XkQxuGVJ9hpFEpDlcoLtWwVYhnJf06cLIZa2vaIptSqaubivErzmD5O',
  'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js': 'sha384-oV9/r5hoq7qHFHfbghYwt50E2fe8J20vXRW0eIGQl20k40zMEAhSXMCh9ANASVB9'
};

const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src;
  if (CDN_SRI[src]) { s.integrity = CDN_SRI[src]; s.crossOrigin = 'anonymous'; }
  s.onload = res;
  s.onerror = () => rej(new Error('Failed to load ' + src));
  document.head.appendChild(s);
});

let badgeDepsReady = false;
const badgeTemplates = new Map();   // model id -> {model, layerRows, inputRows}
let projSettingsTmpl;

const errMsg = e => (e && e.message) || String(e) || 'Unknown error';
const projectSettings = () => projSettingsTmpl ??=
  fetch('../badge/project_settings_template.json').then(r => r.json()).catch(() => null);

async function loadBadgeDeps() {
  if (badgeDepsReady) return;
  await loadScript('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js');
  await loadScript('https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js');
  await loadScript('../shared/3mf.js?v=' + VERSION);
  await loadScript('../badgemaker/geometry.js?v=' + VERSION);
  await loadBuiltinFont('../badge/LEGO.TTF');
  badgeDepsReady = true;
}

const badgeModelFor = catId => catId
  ? bmModels.find(m => String(m.category_id) === String(catId)) || null : null;
const hasBadgeTemplate = catId => !!badgeModelFor(catId);

function badgeModelOrThrow(catId) {
  const m = badgeModelFor(catId);
  if (!m) throw new Error('No BadgeMak3r model is linked to "' + catName(catId) + '" — set its Category in BadgeMak3r');
  return m;
}

async function loadBadgeTemplate(model) {
  if (badgeTemplates.has(model.id)) return badgeTemplates.get(model.id);
  await loadBadgeDeps();
  const [layerRows, inputRows] = await Promise.all([
    sbGet('badgemaker_layers', '?model_id=eq.' + model.id + '&order=layer_order'),
    sbGet('badgemaker_inputs', '?model_id=eq.' + model.id + '&order=input_order')
  ]);
  // Custom fonts must be parsed before modelFromRows can resolve fontObj.
  const fontIds = [...new Set(layerRows.map(r => r.font_id).filter(id => id != null && !getCachedFont(id)))];
  if (fontIds.length) {
    const fonts = await sbGet('badgemaker_fonts', '?id=in.(' + fontIds.join(',') + ')&select=id,data_base64');
    for (const f of fonts) parseAndCacheFont(f.id, f.data_base64);
  }
  const tmpl = { model, layerRows, inputRows };
  badgeTemplates.set(model.id, tmpl);
  return tmpl;
}

// The raw {Name: value} map the bindings expect, straight from the stored
// option string rather than v2's display-oriented parseOpts().
function optsMap(line) {
  const out = {};
  String(line.options || '').split('||').forEach(p => {
    const i = p.indexOf(':');
    if (i >= 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
const badgeName = o => String((o && o['Text']) || 'NAME').toUpperCase();

// geometry.js builds from its own globals `inputs` and `layerConfig`.
function buildBadge(tmpl, orderOpts, name, projTmpl) {
  const m = modelFromRows(tmpl.layerRows, tmpl.inputRows);
  const warnings = applyOrderBindings(m, orderOpts,
    n => (colours.find(c => c.name.toLowerCase() === String(n).toLowerCase()) || {}).code || null);
  inputs = m.inputs; layerConfig = m.layerConfig;
  const objects = buildExportObjects();
  if (!objects.length) throw new Error('Template "' + tmpl.model.name + '" produced no geometry');
  return { zip: _badgeBuildZip(_badgeBuild3MF(objects, name, projTmpl)), warnings };
}

function saveBlob(data, filename, type) {
  const u = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = u; a.download = filename; a.click();
  URL.revokeObjectURL(u);
}
const MIME_3MF = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';

async function generateBadge(orderId, rowId) {
  const o = orders.find(x => x.id === orderId);
  const l = o && o.lines.find(x => String(x.id) === String(rowId));
  if (!l) return;
  toast('Generating badge…');
  try {
    const opts = optsMap(l);
    const name = badgeName(opts);
    const tmpl = await loadBadgeTemplate(badgeModelOrThrow(l.cat_id));
    const { zip, warnings } = buildBadge(tmpl, opts, name, await projectSettings());
    saveBlob(zip, name + '.3mf', MIME_3MF);
    toast(warnings.length ? name + '.3mf — ' + warnings.join(' · ') : 'Downloaded ' + name + '.3mf');
  } catch (e) {
    toast('Badge failed: ' + errMsg(e), 'err');
  }
}

/* ── Batch ─────────────────────────────────────────────────────────── */
// Duplicate names in one order get " 2", " 3"… so files don't overwrite.
function filenameMap(items) {
  const totals = {}, counters = {};
  const key = it => badgeName(it.opts);
  items.forEach(it => { totals[key(it)] = (totals[key(it)] || 0) + 1; });
  return { next(n) { counters[n] = (counters[n] || 0) + 1; return totals[n] > 1 ? n + ' ' + counters[n] + '.3mf' : n + '.3mf'; } };
}

function buildOuterZip(entries) {
  const enc = new TextEncoder();
  const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) { c ^= d[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); } return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = [], cd = []; let off = 0;
  for (const { name, data } of entries) {
    const nb = enc.encode(name), crc = crc32(data);
    const loc = new Uint8Array(30 + nb.length + data.length), dv = new DataView(loc.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true);
    loc.set(nb, 30); loc.set(data, 30 + nb.length); parts.push(loc);
    const ce = new Uint8Array(46 + nb.length), cv = new DataView(ce.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nb.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, off, true);
    ce.set(nb, 46); cd.push(ce); off += loc.length;
  }
  const cdSize = cd.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true); ev.setUint16(20, 0, true);
  const all = [...parts, ...cd, eocd];
  const res = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; for (const a of all) { res.set(a, p); p += a.length; }
  return res;
}

function badgeItemsFor(o) {
  return o.lines.filter(l => hasBadgeTemplate(l.cat_id)).map(l => ({ catId: l.cat_id, opts: optsMap(l) }));
}

let batchState = null;   // {orderId, items, customer, phase, done, total, label, msg, sub}

function openBadgeBatch(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const items = badgeItemsFor(o);
  if (!items.length) { toast('No items in this order have a badge template', 'err'); return; }
  batchState = { orderId, items, customer: o.customer || 'badges', phase: 'choose', done: 0, total: items.length };
  renderBatch();
}
function closeBadgeBatch() { batchState = null; renderBatch(); }

function batchProgress(done, total, label) {
  Object.assign(batchState, { phase: 'progress', done, total, label });
  renderBatch();
}

async function runBadgeLoop(onProgress) {
  const entries = [], warnings = new Set(), names = filenameMap(batchState.items);
  const projTmpl = await projectSettings();
  for (let i = 0; i < batchState.items.length; i++) {
    const it = batchState.items[i];
    const name = badgeName(it.opts);
    onProgress(i, batchState.items.length, name);
    await new Promise(r => setTimeout(r, 0));   // let the progress bar paint
    const tmpl = await loadBadgeTemplate(badgeModelOrThrow(it.catId));
    const r = buildBadge(tmpl, it.opts, name, projTmpl);
    r.warnings.forEach(w => warnings.add(name + ': ' + w));
    entries.push({ name: names.next(name), data: r.zip });
  }
  return { entries, warnings: [...warnings] };
}

async function generateAllBadgesZip() {
  const total = batchState.items.length;
  batchProgress(0, total, 'Starting…');
  try {
    const { entries, warnings } = await runBadgeLoop((i, n, name) => batchProgress(i, n, name));
    batchProgress(total, total, 'Building ZIP…');
    await new Promise(r => setTimeout(r, 0));
    const zipName = (batchState.customer.replace(/[^a-z0-9 _-]/gi, '').trim() || 'badges') + '.zip';
    saveBlob(buildOuterZip(entries), zipName, 'application/zip');
    Object.assign(batchState, { phase: 'done', msg: entries.length + ' badges downloaded as ' + zipName, sub: warnings.join(' · ') });
  } catch (e) {
    Object.assign(batchState, { phase: 'done', msg: 'Badge generation failed', sub: errMsg(e) });
  }
  renderBatch();
}

async function generateAllBadges() {
  const total = batchState.items.length;
  batchProgress(0, total * 2, 'Starting…');
  try {
    const { entries, warnings } = await runBadgeLoop((i, n, name) => batchProgress(i, n * 2, name));
    for (let i = 0; i < entries.length; i++) {
      batchProgress(total + i, total * 2, 'Downloading ' + entries[i].name);
      saveBlob(entries[i].data, entries[i].name, MIME_3MF);
      await new Promise(r => setTimeout(r, 250));   // browsers throttle rapid downloads
    }
    Object.assign(batchState, { phase: 'done', msg: entries.length + ' badges downloaded', sub: warnings.join(' · ') });
  } catch (e) {
    Object.assign(batchState, { phase: 'done', msg: 'Badge generation failed', sub: errMsg(e) });
  }
  renderBatch();
}

function renderBatch() {
  const host = document.getElementById('batchHost');
  if (!host) return;
  if (!batchState) { host.innerHTML = ''; return; }
  const s = batchState;
  let body;
  if (s.phase === 'choose') {
    body = `<p class="bm-modal-msg">${s.items.length} badge${s.items.length === 1 ? '' : 's'} in ${esc(orderNo(s.orderId))}.</p>
      <button class="btn batch-option" onclick="generateAllBadges()">
        <i class="ti ti-files"></i><span><strong>${s.items.length}</strong> individual .3mf files</span></button>
      <button class="btn primary batch-option" onclick="generateAllBadgesZip()">
        <i class="ti ti-file-zip"></i><span>One ZIP containing them all</span></button>
      <div class="bm-modal-btns"><button class="btn" onclick="closeBadgeBatch()">Cancel</button></div>`;
  } else if (s.phase === 'progress') {
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    body = `<p class="bm-modal-msg">Generating badges…</p>
      <div class="batch-track"><div class="batch-fill" style="width:${pct}%"></div></div>
      <p class="subtle">${esc(s.label || '')}</p>`;
  } else {
    body = `<p class="bm-modal-msg">${esc(s.msg)}</p>
      ${s.sub ? `<p class="subtle">${esc(s.sub)}</p>` : ''}
      <div class="bm-modal-btns"><button class="btn primary" onclick="closeBadgeBatch()">Close</button></div>`;
  }
  host.innerHTML = `<div class="bm-modal-overlay"><div class="bm-modal">${body}</div></div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   Invoice and shipping label

   Same output as the main site: an A4 PDF via jsPDF loaded on demand, and
   a 100x150mm label printed from a popup. The invoice number is the same
   deterministic hash of the order id, so a customer sent an invoice by v1
   and then by v2 sees the same number, and neither reveals how many
   orders have been processed.
   ══════════════════════════════════════════════════════════════════════ */
let jsPDFReady = false;
function loadJsPDF() {
  if (jsPDFReady) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
    s.crossOrigin = 'anonymous';
    s.onload = () => { jsPDFReady = true; res(); };
    s.onerror = () => rej(new Error('Could not load the PDF library'));
    document.head.appendChild(s);
  });
}

const invoiceNumber = orderId => {
  let h = 0;
  for (const ch of String(orderId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return '#' + (100000 + (h % 900000));
};

async function generateInvoice(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  toast('Building invoice…');
  try {
    await loadJsPDF();
    const num = invoiceNumber(orderId);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 20;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('PrintDesk', 15, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
    doc.text('INVOICE', pageW - 15, y, { align: 'right' });
    y += 6;
    doc.setFontSize(10); doc.setTextColor(100);
    doc.text('Order ' + num, pageW - 15, y, { align: 'right' }); y += 5;
    doc.text(toDMY(o.date) || '', pageW - 15, y, { align: 'right' });
    doc.setTextColor(0);
    y += 12;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Bill To', 15, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(o.customer || '', 15, y); y += 5;
    (o.address || '').split(/,\s*|\n/).map(s => s.trim()).filter(Boolean)
      .forEach(line => { doc.text(line, 15, y); y += 5; });
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 5, pageW - 30, 8, 'F');
    doc.text('Item', 17, y);
    doc.text('Qty', pageW - 70, y, { align: 'right' });
    doc.text('Price', pageW - 45, y, { align: 'right' });
    doc.text('Total', pageW - 17, y, { align: 'right' });
    y += 8;
    doc.setFont('helvetica', 'normal');

    o.lines.forEach(l => {
      // Colour choices are a production detail, not something the customer
      // ordered by name, so the invoice lists the other options only.
      const labels = parseOpts(l).filter(a => !a.colours).map(a => a.value);
      const text = [catName(l.cat_id), ...labels].join(' - ');
      const wrapped = doc.splitTextToSize(text, pageW - 95);
      doc.text(wrapped, 17, y);
      doc.text(String(l.qty), pageW - 70, y, { align: 'right' });
      doc.text('$' + (Number(l.price) || 0).toFixed(2), pageW - 45, y, { align: 'right' });
      doc.text('$' + (Number(l.total) || 0).toFixed(2), pageW - 17, y, { align: 'right' });
      y += 7 * wrapped.length;
      if (l.notes) {
        doc.setFontSize(8); doc.setTextColor(120);
        doc.text(l.notes, 17, y); y += 5;
        doc.setFontSize(10); doc.setTextColor(0);
      }
      if (y > 270) { doc.addPage(); y = 20; }
    });

    if (o.ship) {
      doc.text('Delivery (' + o.delivery + ')', 17, y);
      doc.text('$' + o.ship.toFixed(2), pageW - 17, y, { align: 'right' });
      y += 7;
    }
    y += 3;
    doc.setDrawColor(200); doc.line(15, y, pageW - 15, y);
    y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Total', pageW - 45, y, { align: 'right' });
    doc.text('$' + o.total.toFixed(2), pageW - 17, y, { align: 'right' });

    doc.save('Invoice_' + num.replace('#', '') + '_' + String(o.customer || '').replace(/[^a-z0-9]/gi, '') + '.pdf');
    toast('Invoice downloaded');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function printShippingLabel(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  if (!o.address) { toast('This order has no address', 'err'); return; }
  const addr = o.address.split(/,\s*|\n/).map(s => s.trim()).filter(Boolean)
    .map(l => '<div>' + esc(l) + '</div>').join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Shipping Label</title>
<style>
  @page{size:100mm 150mm;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;width:100mm;height:150mm;padding:6mm;display:flex;flex-direction:column;gap:4mm}
  .from-block{border:1.5px solid #000;padding:3mm 4mm;font-size:9pt}
  .from-label{font-size:7pt;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#555;margin-bottom:1mm}
  .from-name{font-weight:700;font-size:10pt}
  .to-block{flex:1;border:1.5px solid #000;padding:3mm 4mm;display:flex;flex-direction:column;justify-content:center}
  .to-label{font-size:7pt;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#555;margin-bottom:2mm}
  .to-name{font-size:15pt;font-weight:700;margin-bottom:2mm}
  .to-addr{font-size:11pt;line-height:1.5}
  .order-ref{text-align:right;font-size:7.5pt;color:#555;margin-top:auto;padding-top:2mm}
</style></head><body>
  <div class="from-block"><div class="from-label">From</div><div class="from-name">PrintDesk</div></div>
  <div class="to-block">
    <div class="to-label">To</div>
    <div class="to-name">${esc(o.customer)}</div>
    <div class="to-addr">${addr}</div>
    <div class="order-ref">Order ${esc(o.id)}</div>
  </div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { toast('Allow pop-ups to print a label', 'err'); return; }
  w.document.write(html);
  w.document.close();
}

/* ══════════════════════════════════════════════════════════════════════
   Record editor

   Customers, colours, inventory items and products are all "a row with a
   few fields", so they share one form rather than getting four bespoke
   editors. Each entry below says which table it writes, how to mint an
   id, and what fields to show. Removing archives rather than deletes,
   matching the soft-delete pattern used everywhere else.
   ══════════════════════════════════════════════════════════════════════ */
const FORMS = {
  customer: {
    table: 'customers', title: 'Customer', prefix: 'CUST', width: 4,
    list: () => customers, back: 'customers',
    fields: [
      { k: 'name', label: 'Name', required: true },
      { k: 'email', label: 'Email', type: 'email' },
      { k: 'phone', label: 'Phone', type: 'tel' },
      { k: 'address', label: 'Address', type: 'textarea' },
      { k: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  colour: {
    table: 'colours', title: 'Colour', prefix: 'COL', width: 4,
    list: () => colours, back: 'products',   // the library lives on the Products page
    fields: [
      { k: 'name', label: 'Name', required: true },
      { k: 'code', label: 'Hex code', type: 'colour', def: '#cccccc' },
      { k: 'available', label: 'In stock / selectable', type: 'check', def: true }
    ]
  },
  invitem: {
    table: 'inventory_items', title: 'Stock item', prefix: 'INV', width: 4,
    list: () => invItems, back: 'stock',
    fields: [
      { k: 'name', label: 'Name', required: true, hint: 'Match an option value exactly (e.g. "Magnet") and completed orders draw it down automatically.' },
      { k: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  product: {
    table: 'categories', title: 'Product', prefix: 'C', width: 4,
    list: () => cats, back: 'products',
    fields: [
      { k: 'name', label: 'Name', required: true },
      { k: 'price', label: 'Default price', type: 'number', def: 0 },
      { k: 'shop_visible', label: 'Show in the online shop', type: 'check', def: true }
    ]
  }
};

let record = null;   // {kind, id|null, data:{}, opts:[] for products}

// ro: open read-only (a record you are looking at, not editing) — the Edit
// button on the page switches it over.
function openRecord(kind, id, ro) {
  const spec = FORMS[kind];
  const existing = id ? spec.list().find(x => String(x.id) === String(id)) : null;
  const data = {};
  spec.fields.forEach(f => {
    data[f.k] = existing ? existing[f.k] : (f.def !== undefined ? f.def : '');
    if (data[f.k] === null || data[f.k] === undefined) data[f.k] = f.def !== undefined ? f.def : '';
  });
  // Remember where this was opened from, so Cancel goes back there rather
  // than dumping you in the list — you may have arrived from an order.
  record = { kind, id: id || null, data, ro: !!(ro && id), ret: { view, selected, showDetail } };
  view = spec.back;   // the form renders inside that view's page
  if (kind === 'product') {
    record.opts = id
      ? opts.filter(o => String(o.cat_id) === String(id)).map(o => ({ ...o }))
      : [];
  }
  showDetail = true;
  render();
}

function editRecord() { if (record) { record.ro = false; render(); } }

function closeRecord() {
  const ret = record && record.ret;
  record = null;
  if (ret) { view = ret.view; selected = ret.selected; showDetail = ret.showDetail; }
  render();
}

function readRecord() {
  const spec = FORMS[record.kind];
  spec.fields.forEach(f => {
    const el = document.getElementById('r-' + f.k);
    if (!el) return;
    record.data[f.k] = f.type === 'check' ? el.checked
      : f.type === 'number' ? (parseFloat(el.value) || 0)
      : el.value.trim();
  });
  if (record.kind === 'product') {
    record.opts.forEach((o, i) => {
      o.name = (val('o-name-' + i) || '').trim();
      o.display = val('o-display-' + i) || 'text';
      o.options = (val('o-values-' + i) || '').trim();
      o.num_colours = parseInt(val('o-num-' + i), 10) || 4;
      o.default_colours = (val('o-def-' + i) || '').trim();
      o.force_caps = !!(document.getElementById('o-caps-' + i) || {}).checked;
      o.multi_item = !!(document.getElementById('o-multi-' + i) || {}).checked;
    });
  }
}

async function saveRecord() {
  readRecord();
  const spec = FORMS[record.kind];
  const missing = spec.fields.filter(f => f.required && !record.data[f.k]);
  if (missing.length) { toast(missing[0].label + ' is required', 'err'); return; }
  if (record.kind === 'product' && record.opts.some(o => !o.name)) { toast('Every option needs a name', 'err'); return; }

  const btn = document.getElementById('recSave');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Saving…'; }
  try {
    const id = record.id || seqId(spec.list(), spec.prefix, spec.width);
    const row = { id, ...record.data, archived: false };
    await sbUpsert(spec.table, row);

    if (record.kind === 'product') {
      for (let i = 0; i < record.opts.length; i++) {
        const o = record.opts[i];
        await sbUpsert('options', {
          id: o.id || seqId(opts.concat(record.opts.filter(x => x.id)), 'O', 4),
          cat_id: id, name: o.name, display: o.display, options: o.options || '',
          sort_order: i, num_colours: o.num_colours || 4,
          force_caps: !!o.force_caps, multi_item: !!o.multi_item,
          sortable: !!o.sortable, archived: false,
          default_colours: o.default_colours || ''
        });
      }
    }

    const back = spec.back;
    record = null;
    await loadAll();
    view = back; showDetail = false;
    toast(spec.title + ' saved');
  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
  } finally {
    render();
  }
}

async function archiveRecord(kind, id, label) {
  const spec = FORMS[kind];
  const ok = await askConfirm('Remove "' + (label || 'this record') + '"?\n\nIt is hidden rather than deleted, so anything already referring to it keeps working.', 'Remove');
  if (!ok) return;
  const err = await sbPatch(spec.table, '?id=eq.' + encodeURIComponent(id), { archived: true });
  if (err) { toast('Could not remove: ' + (err.message || ''), 'err'); return; }
  toast('Removed ' + (label || spec.title));
  record = null;
  await loadAll();
}

function addProductOption() {
  readRecord();
  record.opts.push({ id: '', name: '', display: 'text', options: '', num_colours: 4, default_colours: '', force_caps: false, multi_item: false });
  render();
}
function removeProductOption(i) {
  readRecord();
  const o = record.opts[i];
  if (o.id) sbPatch('options', '?id=eq.' + encodeURIComponent(o.id), { archived: true });
  record.opts.splice(i, 1);
  render();
}

function recordForm() {
  const spec = FORMS[record.kind];
  const d = record.data;

  // Looking rather than editing: the same grid, values as plain text.
  const readOnly = f => {
    const v = d[f.k];
    const shown = f.type === 'check' ? (v ? 'Yes' : 'No')
      : f.type === 'colour' && v ? `<span class="sw" style="background:${esc(v)}"></span><span class="mono">${esc(v)}</span>`
      : f.type === 'email' && v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>`
      : f.type === 'tel' && v ? `<a href="tel:${esc(String(v).replace(/\s/g, ''))}">${esc(v)}</a>`
      : f.type === 'number' ? esc(String(v))
      : String(v || '').trim() ? esc(String(v)) : '<span class="subtle">—</span>';
    return `<div class="form-row"><label>${esc(f.label)}</label><div class="ro">${shown}</div></div>`;
  };

  const field = f => {
    const v = d[f.k];
    if (f.type === 'check') {
      return `<div class="form-row"><label class="method-check" style="font-size:13px">
        <input type="checkbox" id="r-${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="form-row"><label for="r-${f.k}">${esc(f.label)}</label>
        <textarea id="r-${f.k}" rows="2">${esc(v)}</textarea></div>`;
    }
    if (f.type === 'colour') {
      return `<div class="form-row"><label for="r-${f.k}">${esc(f.label)}</label>
        <div class="hexrow">
          <input type="color" id="r-${f.k}-pick" value="${esc(/^#[0-9a-f]{6}$/i.test(v) ? v : '#cccccc')}"
            oninput="document.getElementById('r-${f.k}').value=this.value">
          <input type="text" id="r-${f.k}" value="${esc(v)}" placeholder="#rrggbb"
            oninput="if(/^#[0-9a-f]{6}$/i.test(this.value))document.getElementById('r-${f.k}-pick').value=this.value">
        </div></div>`;
    }
    const type = f.type === 'number' ? 'number' : f.type || 'text';
    const extra = f.type === 'number' ? ' min="0" step="0.01" inputmode="decimal"'
      : f.type === 'email' ? ' inputmode="email"' : f.type === 'tel' ? ' inputmode="tel"' : '';
    return `<div class="form-row"><label for="r-${f.k}">${esc(f.label)}</label>
      <input type="${type}" id="r-${f.k}" value="${esc(v)}"${extra}>
      ${f.hint ? `<span class="field-hint">${esc(f.hint)}</span>` : ''}</div>`;
  };

  return `<div class="detail">
    <div class="detail-hdr">
      <div class="detail-hdr-main">
        <div class="detail-title">${record.ro ? esc(d.name || spec.title) : (record.id ? 'Edit ' : 'New ') + esc(spec.title.toLowerCase())}</div>
        ${record.id ? `<div class="detail-sub"><span class="mono">${esc(record.id)}</span></div>` : ''}
      </div>
      <div class="detail-actions">
        ${record.ro
          ? `<button class="btn" onclick="closeRecord()"><i class="ti ti-arrow-left"></i> Back</button>
             <button class="btn primary" onclick="editRecord()"><i class="ti ti-pencil"></i> Edit</button>`
          : `<button class="btn" onclick="closeRecord()">Cancel</button>
             <button class="btn primary" id="recSave" onclick="saveRecord()"><i class="ti ti-check"></i> Save</button>`}
      </div>
    </div>

    <div class="card"><div class="card-body form-grid">
      ${spec.fields.map(record.ro ? readOnly : field).join('')}
    </div></div>

    ${record.kind === 'product' && !record.ro ? productOptionsEditor() : ''}
    ${record.kind === 'invitem' && record.id && !record.ro ? receiptsEditor() : ''}
    ${record.kind === 'customer' && record.id ? customerOrdersCard() : ''}

    ${record.id && !record.ro ? `<div class="card">
      <div class="card-hdr"><i class="ti ti-trash"></i><h3>Remove</h3></div>
      <div class="card-body">
        <button class="btn danger" onclick="archiveRecord('${record.kind}','${esc(record.id)}','${esc(d.name || '').replace(/'/g, "\\'")}')">
          <i class="ti ti-trash"></i> Remove ${esc(spec.title.toLowerCase())}</button>
      </div>
    </div>` : ''}
  </div>`;
}

// The same list the order detail shows, on the customer's own record.
function customerOrdersCard() {
  const name = String(record.data.name || '').trim().toLowerCase();
  const theirs = orders.filter(o => o.customerId === String(record.id)
    || (!o.customerId && o.customer.trim().toLowerCase() === name));
  const spent = theirs.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + o.total, 0);
  return `<div class="card">
    <div class="card-hdr"><i class="ti ti-receipt"></i><h3>Their orders</h3>
      <div class="right subtle">${theirs.length}${theirs.length ? ' · ' + money(spent) : ''}</div></div>
    ${theirs.length ? `<div class="card-body flush related-scroll">
      ${theirs.map(o => `<button class="related-row" onclick="pick('${esc(o.id)}')">
        <span class="mono">${esc(o.no)}</span>
        <span class="subtle">${esc(fmtDate(o.date))}</span>
        ${pill(o.status)}
        <span class="mono related-total">${money(o.total)}</span>
      </button>`).join('')}
    </div>` : '<div class="card-body"><span class="subtle">No orders yet.</span></div>'}
  </div>`;
}

function productOptionsEditor() {
  return `<div class="card">
    <div class="card-hdr"><i class="ti ti-adjustments"></i><h3>Options</h3>
      <div class="right"><button class="btn sm" onclick="addProductOption()"><i class="ti ti-plus"></i> Add option</button></div>
    </div>
    <div class="card-body flush">
      ${record.opts.length ? record.opts.map((o, i) => {
        const isColour = o.display === 'colour';
        return `<div class="form-line">
          <div class="form-line-hdr">
            <span class="form-line-n">Option ${i + 1}</span>
            <button class="btn sm ghost" onclick="removeProductOption(${i})" aria-label="Remove option ${i + 1}"><i class="ti ti-trash"></i></button>
          </div>
          <div class="form-grid">
            <div class="form-row form-row-pair">
              <div><label for="o-name-${i}">Name</label><input type="text" id="o-name-${i}" value="${esc(o.name)}" placeholder="e.g. Backing"></div>
              <div><label for="o-display-${i}">Type</label>
                <select id="o-display-${i}" onchange="readRecord();render()">
                  <option value="text"${o.display === 'text' ? ' selected' : ''}>Free text</option>
                  <option value="select"${o.display !== 'text' && o.display !== 'colour' ? ' selected' : ''}>Dropdown</option>
                  <option value="colour"${isColour ? ' selected' : ''}>Colours</option>
                </select></div>
            </div>
            ${o.display === 'text' ? `
              <div class="form-row"><label class="method-check" style="font-size:13px">
                <input type="checkbox" id="o-caps-${i}" ${o.force_caps ? 'checked' : ''}> Force capitals</label></div>
              <div class="form-row"><label class="method-check" style="font-size:13px">
                <input type="checkbox" id="o-multi-${i}" ${o.multi_item ? 'checked' : ''}> Comma-separated values make one item each</label></div>`
            : isColour ? `
              <div class="form-row form-row-pair">
                <div><label for="o-num-${i}">How many colours</label>
                  <input type="number" id="o-num-${i}" value="${esc(o.num_colours || 4)}" min="1" max="8" step="1" inputmode="numeric"></div>
                <div><label for="o-def-${i}">Default</label>
                  <input type="text" id="o-def-${i}" value="${esc(o.default_colours || '')}" placeholder="Red|Yellow|Black"></div>
              </div>
              <span class="field-hint">Colour names separated by | — they must match the colour library.</span>`
            : `
              <div class="form-row"><label for="o-values-${i}">Choices</label>
                <input type="text" id="o-values-${i}" value="${esc(o.options || '')}" placeholder="Pin, Magnet, Keychain">
                <span class="field-hint">Comma separated. The order form also offers a Custom box.</span></div>`}
          </div>
        </div>`;
      }).join('') : '<div class="method-row"><span class="subtle">No options — this product is ordered as-is.</span></div>'}
    </div>
  </div>`;
}

/* ── Stock receipts ────────────────────────────────────────────────── */
async function addReceipt() {
  const qty = parseFloat(val('rc-qty')) || 0;
  const cost = parseFloat(val('rc-cost')) || 0;
  const date = val('rc-date') || todayISO();
  if (!qty) { toast('Enter a quantity', 'err'); return; }
  try {
    const rec = { id: seqId(invReceipts, 'RCPT', 4), item_id: record.id, qty, cost, date };
    await sbUpsert('inventory_receipts', rec);
    invReceipts.push(rec);
    toast('Stock received');
  } catch (e) { toast('Could not save: ' + e.message, 'err'); }
  render();
}

async function removeReceipt(id) {
  const ok = await askConfirm('Delete this stock receipt? It changes what the item shows as received.', 'Delete');
  if (!ok) return;
  const err = await sbDelete('inventory_receipts', '?id=eq.' + encodeURIComponent(id));
  if (err) { toast('Could not delete', 'err'); return; }
  invReceipts = invReceipts.filter(r => String(r.id) !== String(id));
  toast('Receipt deleted');
  render();
}

function receiptsEditor() {
  const mine = invReceipts.filter(r => String(r.item_id) === String(record.id))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const used = invConsumption.filter(c => String(c.item_id) === String(record.id)).reduce((s, c) => s + (Number(c.qty) || 0), 0);
  const got = mine.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  return `<div class="card">
    <div class="card-hdr"><i class="ti ti-package-import"></i><h3>Stock received</h3>
      <div class="right subtle">${got} in · ${used} used · <strong>${got - used} on hand</strong></div>
    </div>
    <div class="card-body flush">
      ${mine.map(r => `<div class="method-row">
        <span class="mono" style="flex:1">${esc(fmtDate(r.date))}</span>
        <span class="mono">${esc(r.qty)}</span>
        <span class="mono subtle">${money(r.cost)}</span>
        <button class="btn icon ghost" onclick="removeReceipt('${esc(r.id)}')" aria-label="Delete receipt"><i class="ti ti-trash"></i></button>
      </div>`).join('') || '<div class="method-row"><span class="subtle">Nothing received yet.</span></div>'}
    </div>
    <div class="card-foot form-grid">
      <div class="form-row form-row-pair">
        <div><label for="rc-qty">Quantity</label><input type="number" id="rc-qty" min="0" step="1" inputmode="numeric" placeholder="0"></div>
        <div><label for="rc-cost">Total cost</label><input type="number" id="rc-cost" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
      </div>
      <div class="form-row"><label for="rc-date">Date</label><input type="date" id="rc-date" value="${todayISO()}"></div>
      <button class="btn" onclick="addReceipt()"><i class="ti ti-plus"></i> Add stock</button>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   Users

   Goes through the admin-users Edge Function exactly as the main site
   does — it holds the service-role key server-side and checks the
   caller's own access token. Nothing privileged is done in the browser.
   ══════════════════════════════════════════════════════════════════════ */
let users = null;        // null = not fetched yet
let usersError = '';

async function sbAdminCall(method, path, body) {
  return fetch(window.CONFIG.SUPABASE_URL + '/functions/v1/admin-users', {
    method: 'POST',
    headers: {
      'apikey': window.CONFIG.SUPABASE_KEY,
      'Authorization': 'Bearer ' + (sbToken || window.CONFIG.SUPABASE_KEY),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ method, path, body })
  });
}

async function loadUsers() {
  try {
    const res = await sbAdminCall('GET', 'users');
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.message || 'Could not list users');
    users = data.users || [];
    usersError = '';
  } catch (e) {
    users = [];
    usersError = e.message;
  }
  render();
}

async function inviteUser() {
  const email = (val('u-email') || '').trim();
  const name = (val('u-name') || '').trim();
  if (!email) { toast('An email address is required', 'err'); return; }
  const btn = document.getElementById('u-invite');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Inviting…'; }
  try {
    const res = await sbAdminCall('POST', 'invite', {
      email, data: { display_name: name || email.split('@')[0] },
      redirect_to: location.origin + '/v2/'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.message || data.error_description || 'Invite failed');
    toast('Invite sent to ' + email);
    await loadUsers();
  } catch (e) {
    toast(e.message, 'err');
    render();
  }
}

async function renameUser(id, current) {
  const name = await askText('Display name for this user:', current || '');
  if (name === null) return;
  const res = await sbAdminCall('PUT', 'users/' + id, { data: { display_name: name } });
  if (!res.ok) { toast('Could not rename', 'err'); return; }
  toast('Name updated');
  await loadUsers();
}

async function removeUser(id, email) {
  if (currentUser && currentUser.id === id) { toast('You cannot remove your own account here', 'err'); return; }
  const typed = await askText('Type the email address to confirm removing this user:\n\n"' + email + '"', '');
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== String(email).trim().toLowerCase()) { toast('Email did not match — nothing removed', 'err'); return; }
  const res = await sbAdminCall('DELETE', 'users/' + id);
  if (!res.ok) { toast('Could not remove user', 'err'); return; }
  toast('Removed ' + email);
  await loadUsers();
}

function usersCard() {
  let body;
  if (users === null) {
    body = `<div class="card-body"><button class="btn" onclick="loadUsers()"><i class="ti ti-users"></i> Load users</button></div>`;
  } else if (usersError) {
    body = `<div class="card-body"><p class="subtle" style="font-size:12px;line-height:1.5">${esc(usersError)}</p>
      <button class="btn" style="margin-top:10px" onclick="loadUsers()"><i class="ti ti-refresh"></i> Try again</button></div>`;
  } else {
    body = `<div class="card-body flush">
      ${users.map(u => {
        const name = (u.user_metadata && u.user_metadata.display_name) || String(u.email || '').split('@')[0] || 'Unknown';
        const signedIn = !!u.last_sign_in_at;
        const when = u[signedIn ? 'created_at' : 'invited_at'] || u.created_at;
        const isMe = currentUser && currentUser.id === u.id;
        return `<div class="user-row">
          ${avatar(name)}
          <div class="user-main">
            <div class="user-name">${esc(name)}${isMe ? ' <span class="pill" style="--pc:var(--blue)">you</span>' : ''}</div>
            <div class="subtle">${esc(u.email || '—')}</div>
            <div class="subtle">${signedIn ? 'Joined' : 'Invited'} ${when ? esc(new Date(when).toLocaleDateString('en-AU')) : '—'}${signedIn ? '' : ' · not signed in yet'}</div>
          </div>
          <div class="user-actions">
            <button class="btn icon ghost" onclick="renameUser('${esc(u.id)}','${esc(name).replace(/'/g, "\\'")}')" aria-label="Rename ${esc(name)}"><i class="ti ti-pencil"></i></button>
            ${isMe ? '' : `<button class="btn icon ghost" onclick="removeUser('${esc(u.id)}','${esc(u.email)}')" aria-label="Remove ${esc(name)}"><i class="ti ti-trash"></i></button>`}
          </div>
        </div>`;
      }).join('') || '<div class="method-row"><span class="subtle">No users returned.</span></div>'}
    </div>
    <div class="card-foot form-grid">
      <div class="form-row-pair form-row">
        <div><label for="u-name">Name</label><input type="text" id="u-name" placeholder="Their name"></div>
        <div><label for="u-email">Email</label><input type="email" id="u-email" placeholder="them@example.com" inputmode="email"></div>
      </div>
      <button class="btn primary" id="u-invite" onclick="inviteUser()"><i class="ti ti-mail-forward"></i> Send invite</button>
    </div>`;
  }

  return `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ti-users"></i><h3>Users</h3>
      ${users !== null && !usersError ? `<div class="right"><span class="subtle">${users.length}</span></div>` : ''}
    </div>
    ${body}
  </div>`;
}

/* ── Print cost calculator ─────────────────────────────────────────────
   Same model as the main site. Inputs persist locally so the machine and
   filament rates survive a reload. */
const CALC_KEY = 'v2_calc';
const CALC_FIELDS = [
  { k: 'weight', label: 'Filament used (g)', def: 50, step: 1 },
  { k: 'hours', label: 'Print time (hours)', def: 3, step: 0.1 },
  { k: 'filamentPrice', label: 'Filament $/kg', def: 25, step: 0.5 },
  { k: 'power', label: 'Printer draw (W)', def: 150, step: 5 },
  { k: 'elecRate', label: 'Electricity $/kWh', def: 0.3, step: 0.01 },
  { k: 'laborMin', label: 'Hands-on time (min)', def: 10, step: 1 },
  { k: 'laborRate', label: 'Your rate $/hr', def: 30, step: 1 },
  { k: 'waste', label: 'Failure allowance (%)', def: 10, step: 1 },
  { k: 'markup', label: 'Markup (%)', def: 50, step: 1 }
];

function calcValues() {
  let saved = {};
  try { saved = JSON.parse(lsGet(CALC_KEY) || '{}'); } catch (e) { /* ignore */ }
  const v = {};
  CALC_FIELDS.forEach(f => {
    const el = document.getElementById('calc-' + f.k);
    v[f.k] = el ? (parseFloat(el.value) || 0) : (saved[f.k] !== undefined ? saved[f.k] : f.def);
  });
  return v;
}

function calcRun() {
  const v = calcValues();
  lsSet(CALC_KEY, JSON.stringify(v));
  const material = (v.weight / 1000) * v.filamentPrice;
  const electricity = (v.power / 1000) * v.hours * v.elecRate;
  const labour = (v.laborMin / 60) * v.laborRate;
  const subtotal = material + electricity + labour;
  const waste = subtotal * (v.waste / 100);
  const withWaste = subtotal + waste;
  const markup = withWaste * (v.markup / 100);
  const out = { material, electricity, labour, subtotal, waste, markup, total: withWaste + markup };
  for (const k in out) {
    const el = document.getElementById('calc-out-' + k);
    if (el) el.textContent = money(out[k]);
  }
  return out;
}

function viewCalculator() {
  const v = calcValues();
  const row = (label, id, cls) => `<div class="totals-row${cls || ''}"><span>${esc(label)}</span><span id="calc-out-${id}">$0.00</span></div>`;
  return `<div class="page"><div class="page-inner narrow">
    <div class="section-title">Print cost calculator</div>
    <div class="card"><div class="card-body form-grid">
      ${CALC_FIELDS.map(f => `<div class="form-row"><label for="calc-${f.k}">${esc(f.label)}</label>
        <input type="number" id="calc-${f.k}" value="${esc(v[f.k])}" step="${f.step}" min="0" inputmode="decimal" oninput="calcRun()"></div>`).join('')}
    </div></div>
    <div class="card" style="margin-top:12px"><div class="totals">
      ${row('Material', 'material')}
      ${row('Electricity', 'electricity')}
      ${row('Labour', 'labour')}
      ${row('Subtotal', 'subtotal')}
      ${row('Failure allowance', 'waste')}
      ${row('Markup', 'markup')}
      ${row('Suggested price', 'total', ' grand')}
    </div></div>
  </div></div>`;
}

/* ── Stats ─────────────────────────────────────────────────────────── */
function statsCard() {
  const live = orders.filter(o => o.status !== 'Cancelled');
  const paid = live.filter(o => o.paid);
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const byMonth = new Map();
  for (const o of paid) {
    const d = parseDate(o.date);
    if (!d) continue;
    const k = d.getFullYear() + '-' + padN(d.getMonth() + 1, 2);
    byMonth.set(k, (byMonth.get(k) || 0) + o.total);
  }
  const months = [...byMonth.entries()].sort().slice(-6);
  const peak = Math.max(1, ...months.map(m => m[1]));
  const spend = invReceipts.reduce((s, r) => s + (Number(r.cost) || 0), 0);

  return `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ti-chart-bar"></i><h3>Stats</h3></div>
    <div class="card-body kv">
      <div class="kv-row"><div class="k wide">Orders</div><div class="v">${live.length} <span class="subtle">(${orders.length - live.length} cancelled)</span></div></div>
      <div class="kv-row"><div class="k wide">Units sold</div><div class="v">${live.reduce((s, o) => s + o.units, 0)}</div></div>
      <div class="kv-row"><div class="k wide">Revenue collected</div><div class="v mono">${money(revenue)}</div></div>
      <div class="kv-row"><div class="k wide">Outstanding</div><div class="v mono">${money(live.filter(o => !o.paid).reduce((s, o) => s + o.total, 0))}</div></div>
      <div class="kv-row"><div class="k wide">Average order</div><div class="v mono">${money(live.length ? live.reduce((s, o) => s + o.total, 0) / live.length : 0)}</div></div>
      ${spend ? `<div class="kv-row"><div class="k wide">Stock spend</div><div class="v mono">${money(spend)}</div></div>` : ''}
    </div>
    ${months.length ? `<div class="card-body" style="border-top:1px solid var(--border)">
      <div class="subtle" style="margin-bottom:9px">Collected by month</div>
      ${months.map(([k, v]) => `<div class="month-row">
        <span class="mono month-label">${esc(k)}</span>
        <div class="bar"><i style="width:${v / peak * 100}%"></i></div>
        <span class="mono month-val">${money(v)}</span>
      </div>`).join('')}
    </div>` : ''}
  </div>`;
}

/* ── Profile ───────────────────────────────────────────────────────── */
async function saveProfile() {
  const name = (val('p-name') || '').trim();
  const pass = val('p-pass') || '';
  if (pass && pass.length < 6) { toast('Password must be at least 6 characters', 'err'); return; }
  if (!currentUser) { toast('Not signed in', 'err'); return; }
  const body = { data: { display_name: name } };
  if (pass) body.password = pass;
  const btn = document.getElementById('p-save');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Saving…'; }
  try {
    const res = await sbAdminCall('PUT', 'users/' + currentUser.id, body);
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.message || 'Could not save');
    currentUser.user_metadata = Object.assign({}, currentUser.user_metadata, { display_name: name });
    toast(pass ? 'Profile and password updated' : 'Profile updated');
  } catch (e) {
    toast(e.message, 'err');
  } finally { render(); }
}

function profileCard() {
  const name = (currentUser && currentUser.user_metadata && currentUser.user_metadata.display_name) || '';
  return `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ti-user-circle"></i><h3>Your profile</h3></div>
    <div class="card-body form-grid">
      <div class="form-row"><label>Email</label>
        <input type="text" value="${esc((currentUser && currentUser.email) || '')}" disabled></div>
      <div class="form-row"><label for="p-name">Display name</label>
        <input type="text" id="p-name" value="${esc(name)}" placeholder="Your name"></div>
      <div class="form-row"><label for="p-pass">New password</label>
        <input type="password" id="p-pass" autocomplete="new-password" placeholder="Leave blank to keep it">
        <span class="field-hint">At least 6 characters.</span></div>
      <button class="btn primary" id="p-save" onclick="saveProfile()"><i class="ti ti-check"></i> Save profile</button>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   Email alerts

   These rows already exist in app_settings and are what the main site
   writes; v2 just surfaces the same switches. The sender itself is not in
   this repo — notify_threshold_last_sent has never been set — so these
   configure something that is not currently sending.
   ══════════════════════════════════════════════════════════════════════ */
let appSettings = null;

async function loadAppSettings() {
  try {
    const rows = await sbGet('app_settings', '?select=key,value');
    appSettings = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
  } catch (e) { appSettings = {}; }
  render();
}

async function saveAppSettings() {
  const rows = [
    { key: 'notify_email', value: (val('n-email') || '').trim() },
    { key: 'notify_daily_enabled', value: String(!!(document.getElementById('n-daily') || {}).checked) },
    { key: 'notify_threshold_enabled', value: String(!!(document.getElementById('n-thresh') || {}).checked) },
    { key: 'notify_threshold_count', value: val('n-count') || '5' }
  ];
  const btn = document.getElementById('n-save');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Saving…'; }
  try {
    for (const r of rows) await sbUpsert('app_settings', r);
    rows.forEach(r => { appSettings[r.key] = r.value; });
    toast('Email alert settings saved');
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
  finally { render(); }
}

function emailAlertsCard() {
  if (appSettings === null) {
    return `<div class="card settings-card">
      <div class="card-hdr"><i class="ti ti-mail"></i><h3>Email alerts</h3></div>
      <div class="card-body"><button class="btn" onclick="loadAppSettings()"><i class="ti ti-mail"></i> Load settings</button></div>
    </div>`;
  }
  const s = appSettings;
  const lastSent = s.notify_threshold_last_sent;
  return `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ti-mail"></i><h3>Email alerts</h3>
      <div class="right"><span class="pill" style="--pc:var(${lastSent ? '--green' : '--amber'})">${lastSent ? 'sending' : 'never sent'}</span></div>
    </div>
    <div class="card-body form-grid">
      <div class="form-row"><label for="n-email">Send alerts to</label>
        <input type="email" id="n-email" value="${esc(s.notify_email || '')}" placeholder="you@example.com" inputmode="email"></div>
      <div class="form-row"><label class="method-check">
        <input type="checkbox" id="n-daily" ${s.notify_daily_enabled === 'true' ? 'checked' : ''}> Daily summary of new orders</label></div>
      <div class="form-row"><label class="method-check">
        <input type="checkbox" id="n-thresh" ${s.notify_threshold_enabled === 'true' ? 'checked' : ''}> Alert me after a number of new orders</label></div>
      <div class="form-row"><label for="n-count">That number</label>
        <input type="number" id="n-count" value="${esc(s.notify_threshold_count || '5')}" min="1" step="1" inputmode="numeric"></div>
      <div class="kv-row"><div class="k wide">Last sent</div><div class="v">${lastSent ? esc(new Date(lastSent).toLocaleString('en-AU')) : 'Never'}</div></div>
      <button class="btn primary" id="n-save" onclick="saveAppSettings()"><i class="ti ti-check"></i> Save email alerts</button>
      ${!lastSent ? `<p class="readonly-note"><i class="ti ti-alert-triangle"></i>
        These settings are stored, but nothing has ever sent from them. The sender is not in this repository — it needs an Edge Function that reads these rows and emails via Resend.</p>` : ''}
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   New-order alerts

   While a tab is open this polls for the highest order id and raises a
   desktop/phone notification when it moves. It deliberately does NOT try
   to be push: real push with the app closed needs a service worker, VAPID
   keys and something server-side to send it. This covers "I have the tab
   open and want to know", with no backend and no new dependency.
   ══════════════════════════════════════════════════════════════════════ */
const NOTIFY_KEY = 'v2_notify_orders';
const SEEN_KEY = 'v2_last_seen_order';
const POLL_MS = 60000;
let pollTimer = null;

const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

const notifyOn = () => lsGet(NOTIFY_KEY) === '1';
const orderNum = id => { const m = String(id).match(/^O?0*(\d+)$/); return m ? parseInt(m[1], 10) : 0; };
const highestOrder = () => orders.reduce((m, o) => Math.max(m, orderNum(o.id)), 0);

const notifyState = () => {
  if (!('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (Notification.permission === 'denied') return 'blocked';
  if (!notifyOn()) return 'off';
  return Notification.permission === 'granted' ? 'on' : 'needs-permission';
};

async function toggleNotifications() {
  if (notifyOn()) {
    lsSet(NOTIFY_KEY, '0');
    stopPolling();
    toast('New-order alerts off');
    render();
    return;
  }
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Your browser blocked notifications', 'err'); render(); return; }
  lsSet(NOTIFY_KEY, '1');
  lsSet(SEEN_KEY, String(highestOrder()));   // only alert on what arrives from now on
  startPolling();
  toast('New-order alerts on');
  render();
}

function startPolling() {
  stopPolling();
  if (!notifyOn()) return;
  pollTimer = setInterval(checkForNewOrders, POLL_MS);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function checkForNewOrders() {
  if (!notifyOn()) return;
  try {
    const latest = await sbGet('orders', '?deleted=eq.false&select=order_id,customer&order=order_id.desc&limit=1');
    if (!Array.isArray(latest) || !latest.length) return;
    const top = orderNum(latest[0].order_id);
    const seen = parseInt(lsGet(SEEN_KEY) || '0', 10) || 0;
    if (top <= seen) return;
    lsSet(SEEN_KEY, String(top));
    const who = latest[0].customer || 'someone';
    const label = 'New order ' + orderNo(latest[0].order_id);
    toast(label + ' from ' + who);
    if (Notification.permission === 'granted') {
      const n = new Notification(label, { body: who, tag: 'v2-order-' + top, icon: '../Logo2.svg' });
      n.onclick = () => { window.focus(); pick(String(latest[0].order_id)); };
    }
    await loadAll();
  } catch (e) {
    console.warn('Order check failed:', e.message);
  }
}

function notificationsCard() {
  const state = notifyState();
  const copy = {
    on: ['On', 'Checking every minute while this tab is open.'],
    off: ['Off', 'Get a notification when a new order arrives.'],
    'needs-permission': ['Needs permission', 'Your browser has not granted notification permission yet.'],
    blocked: ['Blocked', 'Notifications are blocked for this site — allow them in your browser settings first.'],
    unsupported: ['Not supported', 'This browser has no Notification API.'],
    insecure: ['Needs HTTPS', 'Notifications only work on the live site, not over plain http.']
  }[state];
  const canToggle = state === 'on' || state === 'off' || state === 'needs-permission';

  return `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ti-bell"></i><h3>New-order alerts</h3>
      <div class="right"><span class="pill" style="--pc:var(${state === 'on' ? '--green' : state === 'blocked' || state === 'unsupported' || state === 'insecure' ? '--red' : '--muted'})">${esc(copy[0])}</span></div>
    </div>
    <div class="card-body">
      <p class="subtle" style="font-size:12px;line-height:1.5">${esc(copy[1])}</p>
      ${canToggle ? `<button class="btn ${state === 'on' ? '' : 'primary'}" style="margin-top:11px" onclick="toggleNotifications()">
        <i class="ti ${state === 'on' ? 'ti-bell-off' : 'ti-bell'}"></i> ${state === 'on' ? 'Turn off' : 'Turn on'}</button>` : ''}
      <p class="readonly-note" style="margin-top:11px"><i class="ti ti-info-circle"></i>
        Only fires while this tab is open. Alerts with the app closed would need a service worker and something server-side to send the push.</p>
    </div>
  </div>`;
}

/* ── Shipping and payment methods ──────────────────────────────────────
   Edited in place and upserted row by row. Removing archives the row the
   way the rest of the app soft-deletes, so historic orders that reference
   a retired method keep resolving. */
const DELIVERY_ICON_PACK = [
  'ti-mail', 'ti-hand-stop', 'ti-truck-delivery', 'ti-package', 'ti-box',
  'ti-walk', 'ti-bike', 'ti-car', 'ti-plane', 'ti-ship', 'ti-train', 'ti-rocket',
  'ti-building-store', 'ti-home', 'ti-map-pin', 'ti-send', 'ti-forklift',
  'ti-parking', 'ti-door', 'ti-gift', 'ti-shopping-bag', 'ti-clock', 'ti-calendar-event'
];

function addMethod(kind) {
  if (kind === 'delivery') deliveryOptions.push({ id: seqId(deliveryOptions, 'DEL', 4), name: '', price: 0, icon: 'ti-truck-delivery', archived: false });
  else paymentOptions.push({ id: seqId(paymentOptions, 'PAY', 4), name: '', show_revenue: false, archived: false });
  render();
}

async function archiveMethod(kind, id) {
  const table = kind === 'delivery' ? 'delivery_options' : 'payment_options';
  const list = kind === 'delivery' ? deliveryOptions : paymentOptions;
  const row = list.find(x => String(x.id) === String(id));
  if (!row) return;
  const used = kind === 'delivery'
    ? orders.filter(o => o.delivery === row.name).length
    : orders.filter(o => o.payment === row.name).length;
  const ok = await askConfirm('Remove "' + (row.name || 'this method') + '"?'
    + (used ? '\n\n' + used + ' existing ' + (used === 1 ? 'order uses' : 'orders use') + ' it. They keep their value — the method is just hidden from new orders.' : ''), 'Remove');
  if (!ok) return;
  const i = list.indexOf(row);
  list.splice(i, 1);
  render();
  const err = await sbPatch(table, '?id=eq.' + encodeURIComponent(id), { archived: true });
  if (err) { list.splice(i, 0, row); render(); toast('Could not remove: ' + (err.message || ''), 'err'); }
  else toast('Removed ' + (row.name || 'method'));
}

async function saveMethods(kind) {
  const table = kind === 'delivery' ? 'delivery_options' : 'payment_options';
  const list = kind === 'delivery' ? deliveryOptions : paymentOptions;
  const rows = list.map((m, i) => kind === 'delivery' ? {
    id: m.id, name: val('m-del-name-' + m.id).trim(), price: parseFloat(val('m-del-price-' + m.id)) || 0,
    icon: val('m-del-icon-' + m.id) || 'ti-truck-delivery', archived: false, sort_order: i
  } : {
    id: m.id, name: val('m-pay-name-' + m.id).trim(),
    show_revenue: !!(document.getElementById('m-pay-rev-' + m.id) || {}).checked,
    archived: false, sort_order: i
  });
  if (rows.some(r => !r.name)) { toast('Every method needs a name', 'err'); return; }

  const btn = document.getElementById('save-' + kind);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Saving…'; }
  try {
    for (const r of rows) await sbUpsert(table, r);
    rows.forEach((r, i) => Object.assign(list[i], r));
    toast(kind === 'delivery' ? 'Shipping methods saved' : 'Payment methods saved');
  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
  } finally {
    render();
  }
}

function methodsCard(kind) {
  const isDel = kind === 'delivery';
  const list = isDel ? deliveryOptions : paymentOptions;
  return `<div class="card settings-card">
    <div class="card-hdr"><i class="ti ${isDel ? 'ti-truck' : 'ti-credit-card'}"></i>
      <h3>${isDel ? 'Shipping methods' : 'Payment methods'}</h3>
      <div class="right"><button class="btn sm" onclick="addMethod('${kind}')"><i class="ti ti-plus"></i> Add</button></div>
    </div>
    <div class="card-body flush">
      ${list.length ? list.map(m => isDel ? `
        <div class="method-row">
          <i class="ti ${esc(m.icon || 'ti-truck-delivery')} method-preview" id="m-del-prev-${esc(m.id)}"></i>
          <select id="m-del-icon-${esc(m.id)}" class="method-icon" aria-label="Icon for ${esc(m.name)}"
            onchange="document.getElementById('m-del-prev-${esc(m.id)}').className='ti '+this.value+' method-preview'">
            ${DELIVERY_ICON_PACK.map(ic => `<option value="${ic}"${(m.icon || '') === ic ? ' selected' : ''}>${ic.replace('ti-', '').replace(/-/g, ' ')}</option>`).join('')}
          </select>
          <input type="text" id="m-del-name-${esc(m.id)}" value="${esc(m.name)}" placeholder="Method name" class="method-name">
          <input type="number" id="m-del-price-${esc(m.id)}" value="${esc(m.price || 0)}" min="0" step="0.01" inputmode="decimal" class="method-price" aria-label="Price">
          <button class="btn icon ghost" onclick="archiveMethod('${kind}','${esc(m.id)}')" aria-label="Remove ${esc(m.name)}"><i class="ti ti-trash"></i></button>
        </div>` : `
        <div class="method-row">
          <input type="text" id="m-pay-name-${esc(m.id)}" value="${esc(m.name)}" placeholder="Method name" class="method-name">
          <label class="method-check"><input type="checkbox" id="m-pay-rev-${esc(m.id)}" ${m.show_revenue ? 'checked' : ''}> counts as revenue</label>
          <button class="btn icon ghost" onclick="archiveMethod('${kind}','${esc(m.id)}')" aria-label="Remove ${esc(m.name)}"><i class="ti ti-trash"></i></button>
        </div>`).join('') : `<div class="method-row"><span class="subtle">None yet — add one.</span></div>`}
    </div>
    ${list.length ? `<div class="card-foot">
      <button class="btn primary" id="save-${kind}" onclick="saveMethods('${kind}')"><i class="ti ti-check"></i> Save ${isDel ? 'shipping' : 'payment'} methods</button>
    </div>` : ''}
  </div>`;
}

/* ── Settings ──────────────────────────────────────────────────────── */
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
    ${statsCard()}
    ${methodsCard('delivery')}
    ${methodsCard('payment')}
    ${usersCard()}
    ${profileCard()}
    ${emailAlertsCard()}
    ${notificationsCard()}
    ${group('Workspace', 'ti-building', [
      ['Signed in as', esc((typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '—')],
      ['Database', esc(String(window.CONFIG.SUPABASE_URL || '').replace(/^https?:\/\//, ''))],
      ['Orders loaded', orders.length + ' (' + rows.length + ' line items)'],
      ['Products', cats.length], ['Customers', customers.length],
      ['Version', 'v' + VERSION]
    ])}
  </div></div>`;
}

/* ── Render ────────────────────────────────────────────────────────── */
const RENDER = {
  dashboard: viewDashboard, orders: viewOrders, queue: viewQueue,
  customers: viewCustomers, products: viewProducts, stock: viewStock,
  calculator: viewCalculator, settings: viewSettings
};

function render() {
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

  const who = (typeof currentUser !== 'undefined' && currentUser) || null;
  const label = (who && (who.user_metadata && who.user_metadata.display_name)) || (who && who.email) || '?';
  document.getElementById('userChip').textContent = initials(label);
  document.getElementById('userChipMobile').textContent = initials(label);
  document.getElementById('userName').textContent = label;

  const root = document.getElementById('viewRoot');
  root.className = 'body' + (view === 'orders' && showDetail ? ' show-detail' : '');
  root.innerHTML = loading
    ? `<div class="empty"><i class="ti ti-loader-2 spin"></i><p>Loading&hellip;</p></div>`
    : RENDER[view]();

  if (view === 'calculator') calcRun();   // fill the results after the inputs exist
  capRelatedHeight();

  // Back arrow belongs to the phone detail view only.
  document.getElementById('backBtn').classList.toggle('hide', !(view === 'orders' && showDetail));
}

/* ── Boot (shared/sb.js calls showApp() after a successful sign-in) ── */
function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = '';
  document.getElementById('railVer').textContent = 'v' + VERSION;
  render();
  loadAll().then(startPolling);
}

(async function boot() {
  chip = lsGet('v2_filter') || 'open';
  relatedOpen = lsGet('v2_related_open') === '1';
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

  // Sequential ids must match the main site's prefixes and widths exactly.
  console.assert(seqId([{ id: 'CUST0019' }], 'CUST', 4) === 'CUST0020', 'customer ids');
  console.assert(seqId([{ id: 'COL0009' }, { id: 'COL0030' }], 'COL', 4) === 'COL0031', 'colour ids take the max, not the last');
  console.assert(seqId([], 'INV', 4) === 'INV0001', 'first id in an empty table');
  console.assert(seqId([{ id: 'CONS0007' }], 'CONS', 4) === 'CONS0008', 'consumption ids');
  console.assert(seqId([{ id: 'C0003' }, { id: 'CUST0099' }], 'C', 4) === 'C0004', 'a longer prefix does not leak into a shorter one');

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
