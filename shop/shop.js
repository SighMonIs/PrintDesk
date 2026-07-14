// Customer shop: category/option form, cart (localStorage), and the glue that
// maps a selected category + its options onto the badge render engine
// (data.js/render.js, copied from ../badge/).

function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function optId(o){ return String(o.id); }

// The Text and Backing options get dedicated, fixed-position controls
// (name field above the tabs, backing dropdown inline with them) instead of
// a generic row in #optionFields — this is where every lookup for either
// one resolves to the right element id.
function fieldElementId(o) {
  const n = o.name.trim().toLowerCase();
  if (n === 'text') return 'nameInput';
  if (n === 'backing') return 'backingInline';
  return 'opt-' + optId(o);
}

let categories = [], selectedCat = null, catOptions = [];
let cart = [];
try { cart = JSON.parse(localStorage.getItem('shop_cart') || '[]'); } catch(e) { cart = []; }

// ── Category → 3D model type mapping ────────────────────────────
// Only categories that correspond to a badge/keychain/plaque/dog-tag geometry
// get a live 3D preview. Anything else (e.g. "Special Order") shows a placeholder.
function modelTypeIdFor(catName, backingVal) {
  const n = (catName || '').toLowerCase();
  if (n.includes('name badge') || n === 'badge') {
    if (backingVal === 'Pin') return 'badge-pin';
    if (backingVal === 'Round Magnet') return 'badge-round-magnet';
    return 'badge-magnet';
  }
  if (n.includes('dog tag')) return 'dog-tag';
  if (n.includes('keychain')) return 'keychain';
  if (n.includes('plaque')) return 'plaque';
  return null;
}

// ponytail: hardcoded rather than a new `visible_in_shop` DB column — these
// are still being finalized and just need pulling from the storefront for now.
const HIDDEN_CATEGORIES = ['Dog Tag', 'Plaque', 'Special Order'];
// Display order for the Style dropdown — not alphabetical, so it's explicit.
const CATEGORY_ORDER = ['Name Badge', 'Keychain'];

async function boot() {
  await Promise.all([loadColours(), loadModelsList()]);
  const allCats = await sbGet('categories', '?archived=eq.false&order=name.asc');
  categories = allCats
    .filter(c => !HIDDEN_CATEGORIES.includes(c.name))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.name) - CATEGORY_ORDER.indexOf(b.name));
  if (categories.length) {
    const initial = categories.find(c => c.name === 'Name Badge') || categories[0];
    await selectCategory(initial.id);
  }
  renderCart();
  setupPreviewBarSpacing();
}

// Keeps the 3D preview's visible area above the floating bottom bar instead
// of rendering underneath it. The bar's height is content-driven (wraps,
// Backing shows/hides per category), so it's measured via ResizeObserver
// rather than a fixed number.
function setupPreviewBarSpacing() {
  const bar = document.getElementById('shopBottomBar');
  const preview = document.getElementById('previewPane');
  const main = document.querySelector('.shop-main');
  if (!bar || !preview || !main) return;
  const reposition = () => {
    const barRect = bar.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    preview.style.bottom = (mainRect.bottom - barRect.top + 16) + 'px';
  };
  new ResizeObserver(reposition).observe(bar);
  window.addEventListener('resize', reposition);
  reposition();
}

function selectStyleByName(name) {
  const cat = categories.find(c => c.name === name);
  if (cat) selectCategory(cat.id);
}

async function selectCategory(catId) {
  selectedCat = categories.find(c => c.id === catId);
  document.querySelectorAll('.style-quick-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.style === selectedCat?.name)
  );
  catOptions = await sbGet('options', `?cat_id=eq.${catId}&archived=eq.false&order=sort_order.asc`);
  document.getElementById('qtyInput').value = 1;
  renderNameField();
  renderBackingInline();
  renderOptionForm();
  await applyModelForCategory();
  updatePriceDisplay();
}

// ── Name field (promoted above the category tabs — it's the most important
// field, so it isn't just another row in the dynamic option list below). ──
// The 3D rebuild is debounced well past render.js's own 300ms — on mobile the
// rebuild itself briefly blocks the main thread, which was making the very
// next keystroke feel dropped. Enter or leaving the field renders right away.
let nameRenderTimer = null;
function renderNameField() {
  clearTimeout(nameRenderTimer);
  const textOpt = catOptions.find(o => o.display === 'text' && o.name.trim().toLowerCase() === 'text');
  const wrap = document.getElementById('nameFieldWrap');
  if (!textOpt) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const input = document.getElementById('nameInput');
  input.value = '';
  input.placeholder = 'Your Name';
  input.classList.remove('shop-field-error');
  fitNameFontSize(input);
  const renderNow = () => { clearTimeout(nameRenderTimer); onOptionChanged(optId(textOpt)); };
  input.oninput = function () {
    if (textOpt.force_caps) this.value = this.value.toUpperCase();
    if (this.value.trim()) { this.classList.remove('shop-field-error'); this.placeholder = 'Your Name'; }
    fitNameFontSize(this);
    clearTimeout(nameRenderTimer);
    nameRenderTimer = setTimeout(renderNow, 700);
  };
  input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); renderNow(); this.blur(); } };
  input.onblur = renderNow;
}

// Shrinks the name input's font so a long name stays inside the box instead
// of overflowing it, rather than wrapping or clipping.
function fitNameFontSize(el) {
  const base = window.innerWidth <= 640 ? 22 : 28;
  const min = 13;
  let size = base;
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > el.clientWidth && size > min) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
}

// ── Backing dropdown, inline with the category tabs (drives which 3D model
// type shows, so it belongs next to the thing it's choosing a variant of). ─
function renderBackingInline() {
  const backingOpt = catOptions.find(o => o.name.trim().toLowerCase() === 'backing');
  const wrap = document.getElementById('backingFieldWrap');
  const el = document.getElementById('backingInline');
  if (!backingOpt) { wrap.style.display = 'none'; return; }
  const choices = (backingOpt.options || '').split(',').map(s => s.trim()).filter(Boolean);
  el.innerHTML = choices.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  wrap.style.display = '';
  el.onchange = () => onOptionChanged(optId(backingOpt));
}

// ── Option form (everything except the name field, backing, and colours,
// which have their own dedicated spots) ────────────────────────────────
function renderOptionForm() {
  const rows = catOptions.filter(o => {
    if (o.display === 'colour') return false;
    const n = o.name.trim().toLowerCase();
    return n !== 'text' && n !== 'backing';
  }).map(o => {
    if (o.display === 'text') {
      return `
        <div class="shop-field">
          <label class="shop-field-label">${esc(o.name)}</label>
          <input type="text" id="${fieldElementId(o)}" class="shop-field-input" placeholder="Enter ${esc(o.name).toLowerCase()}…"
            oninput="${o.force_caps ? 'this.value=this.value.toUpperCase();' : ''}onOptionChanged('${optId(o)}')">
        </div>`;
    }
    if (o.display === 'dropdown') {
      const choices = (o.options || '').split(',').map(s => s.trim()).filter(Boolean);
      return `
        <div class="shop-field">
          <label class="shop-field-label">${esc(o.name)}</label>
          <select id="${fieldElementId(o)}" class="shop-field-input" onchange="onOptionChanged('${optId(o)}')">
            ${choices.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>`;
    }
    return '';
  }).join('');
  document.getElementById('optionFields').innerHTML = rows;
}

function onOptionChanged(optionId) {
  const opt = catOptions.find(o => optId(o) === optionId);
  if (opt && opt.name.trim().toLowerCase() === 'backing') applyModelForCategory();
  if (opt && opt.name.trim().toLowerCase() === 'text' && typeof scheduleRender === 'function') scheduleRender();
}

async function applyModelForCategory() {
  const backingOpt = catOptions.find(o => o.name.trim().toLowerCase() === 'backing');
  const backingVal = backingOpt ? document.getElementById(fieldElementId(backingOpt))?.value : null;
  const typeId = modelTypeIdFor(selectedCat.name, backingVal);
  const previewPane = document.getElementById('previewPane');
  const placeholder = document.getElementById('noPreview');
  if (!typeId) {
    previewPane.style.display = 'none';
    placeholder.style.display = 'flex';
    return;
  }
  previewPane.style.display = '';
  placeholder.style.display = 'none';
  document.getElementById('modelSelect').value = typeId;
  await loadModel();
  applyCategoryDefaultColours();
}

// Mirrors ui.js's admin order form: a fresh colour-option pick starts from
// opt.default_colours (pipe-separated colour names configured per category),
// not the engine's generic fallback swatches.
function applyCategoryDefaultColours() {
  const colourOpt = catOptions.find(o => o.display === 'colour');
  if (!colourOpt || !colourOpt.default_colours) return;
  const names = colourOpt.default_colours.split('|').map(s => s.trim()).filter(Boolean);
  names.forEach((name, i) => {
    if (i >= layerConfig.length) return;
    const c = colours.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (c) { layerConfig[i].hex = c.code; layerConfig[i].colourId = c.id; }
  });
  buildLayerUI();
  scheduleRender();
}

// ── Pricing ──────────────────────────────────────────────────────
function updatePriceDisplay() {
  const qty = Math.max(1, +document.getElementById('qtyInput').value || 1);
  const total = (selectedCat?.price || 0) * qty;
  document.getElementById('unitPrice').textContent = '$' + (selectedCat?.price || 0).toFixed(2);
  document.getElementById('lineTotal').textContent = '$' + total.toFixed(2);
}
function stepQty(dir) {
  const el = document.getElementById('qtyInput');
  el.value = Math.max(1, (+el.value || 1) + dir);
  updatePriceDisplay();
}

// ── Cart ───────────────────────────────────────────────────────────
// Line-item options are serialized as "Field:value||Field:value", the same
// format ui.js's collectOpts() writes on admin-created orders, so a cart item
// slots into the existing `orders` table unchanged once checkout writes it.
function serializeOptions() {
  const parts = [];
  for (const o of catOptions) {
    if (o.display === 'colour') {
      parts.push(`${o.name}:${layerConfig.map(l => colourName(l.hex)).join('|')}`);
      continue;
    }
    const el = document.getElementById(fieldElementId(o));
    if (!el) continue;
    parts.push(`${o.name}:${el.value || ''}`);
  }
  return parts.join('||');
}

function addToCart() {
  if (!selectedCat) return;
  const nameEl = document.getElementById('nameInput');
  const nameFieldVisible = document.getElementById('nameFieldWrap').style.display !== 'none';
  if (nameEl && nameFieldVisible && !nameEl.value.trim()) {
    nameEl.focus();
    nameEl.classList.add('shop-field-error');
    nameEl.placeholder = 'Please enter a name';
    return;
  }
  const qty = Math.max(1, +document.getElementById('qtyInput').value || 1);
  cart.push({
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    cat_id: selectedCat.id,
    catName: selectedCat.name,
    qty,
    unitPrice: selectedCat.price,
    total: selectedCat.price * qty,
    options: serializeOptions(),
  });
  saveCart();
  renderCart();
  openCartDrawer();
}

function removeFromCart(id) { cart = cart.filter(i => i.id !== id); saveCart(); renderCart(); }
function saveCart() { localStorage.setItem('shop_cart', JSON.stringify(cart)); }

function renderCart() {
  document.getElementById('cartCount').textContent = cart.reduce((s, i) => s + i.qty, 0);
  const list = document.getElementById('cartItems');
  if (!cart.length) {
    list.innerHTML = '<div class="cart-empty"><i class="ti ti-shopping-cart-off"></i>Your cart is empty</div>';
    document.getElementById('cartTotal').textContent = '$0.00';
    return;
  }
  list.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-main">
        <div class="cart-item-name">${esc(item.catName)}</div>
        <div class="cart-item-opts">${esc((item.options || '').split('||').filter(Boolean).join(' · '))}</div>
        <div class="cart-item-qty">Qty ${item.qty} × $${item.unitPrice.toFixed(2)}</div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">$${item.total.toFixed(2)}</div>
        <button class="cart-item-remove" onclick="removeFromCart('${item.id}')" title="Remove"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
  document.getElementById('cartTotal').textContent = '$' + cart.reduce((s, i) => s + i.total, 0).toFixed(2);
}

function toggleCartDrawer() {
  document.getElementById('cartDrawer').classList.toggle('open');
  document.getElementById('cartDrawerBackdrop').classList.toggle('open');
}
function openCartDrawer() {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('cartDrawerBackdrop').classList.add('open');
}
function closeCartDrawer() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('cartDrawerBackdrop').classList.remove('open');
}

function checkout() {
  // ponytail: Stripe checkout lands in a later pass (needs a Supabase Edge
  // Function to re-price server-side and create the session — see plan).
  document.getElementById('checkoutNote').textContent = 'Online payment is coming soon — check back shortly!';
}

// ── Staff-only: set the site-wide default camera view per product type ────
function onStaffStatusChanged() {
  const btn = document.getElementById('camControlsToggle');
  if (btn) btn.style.display = window.isStaff ? '' : 'none';
  if (!window.isStaff) {
    const panel = document.getElementById('camAnglePanel');
    if (panel) panel.style.display = 'none';
  }
}

async function sbUpsertRow(table, row) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  return r.json();
}

async function saveShopDefaultView() {
  if (!window.isStaff) return;
  const typeId = document.getElementById('modelSelect').value;
  const type = MODEL_TYPES.find(t => t.id === typeId);
  if (!type) return;
  const btn = document.getElementById('saveViewBtn');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'Saving…';
  try {
    if (!currentModel) {
      const created = await sbUpsertRow('badge_models', { name: type.label, archived: false });
      currentModel = Array.isArray(created) ? created[0] : created;
      if (!currentModel?.id) throw new Error('Could not create model row');
      models.push(currentModel);
    }
    const existing = await sbGet('badge_model_settings', `?model_id=eq.${currentModel.id}`);
    await sbUpsertRow('badge_model_settings', {
      ...(existing[0] ? { id: existing[0].id } : {}),
      model_id: currentModel.id,
      def_rot_x: rotX, def_rot_y: rotY, def_zoom: zoom,
    });
    defRotX = rotX; defRotY = rotY; defZoom = zoom;
    btn.innerHTML = '<i class="ti ti-check"></i> Saved!';
  } catch (e) {
    console.error(e);
    btn.innerHTML = 'Failed';
  }
  setTimeout(() => { btn.disabled = false; btn.innerHTML = orig; }, 1500);
}

document.addEventListener('DOMContentLoaded', boot);
