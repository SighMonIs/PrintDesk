// Customer shop: category/option form, cart (localStorage), and the glue that
// maps a selected category + its options onto the badge render engine
// (data.js/render.js, copied from ../badge/).

function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function optId(o){ return String(o.id); }

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

async function boot() {
  await Promise.all([loadColours(), loadModelsList()]);
  categories = await sbGet('categories', '?archived=eq.false&order=name.asc');
  renderCategoryTabs();
  if (categories.length) await selectCategory(categories[0].id);
  renderCart();
}

function renderCategoryTabs() {
  document.getElementById('catTabs').innerHTML = categories.map(c =>
    `<button class="cat-tab${selectedCat && c.id === selectedCat.id ? ' active' : ''}" onclick="selectCategory('${c.id}')">${esc(c.name)}</button>`
  ).join('');
}

async function selectCategory(catId) {
  selectedCat = categories.find(c => c.id === catId);
  renderCategoryTabs();
  catOptions = await sbGet('options', `?cat_id=eq.${catId}&archived=eq.false&order=sort_order.asc`);
  document.getElementById('qtyInput').value = 1;
  renderOptionForm();
  await applyModelForCategory();
  updatePriceDisplay();
}

// ── Option form ──────────────────────────────────────────────────
function renderOptionForm() {
  const rows = catOptions.filter(o => o.display !== 'colour').map(o => {
    const isNameField = o.name.trim().toLowerCase() === 'text';
    if (o.display === 'text') {
      const id = isNameField ? 'nameInput' : 'opt-' + optId(o);
      return `
        <div class="opt-row">
          <label class="opt-label">${esc(o.name)}</label>
          <input type="text" id="${id}" class="opt-input" placeholder="Enter ${esc(o.name).toLowerCase()}…"
            oninput="${o.force_caps ? 'this.value=this.value.toUpperCase();' : ''}onOptionChanged('${optId(o)}')">
        </div>`;
    }
    if (o.display === 'dropdown') {
      const choices = (o.options || '').split(',').map(s => s.trim()).filter(Boolean);
      const isBacking = o.name.trim().toLowerCase() === 'backing';
      return `
        <div class="opt-row">
          <label class="opt-label">${esc(o.name)}</label>
          <select id="opt-${optId(o)}" class="opt-input" onchange="onOptionChanged('${optId(o)}')">
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
  const backingVal = backingOpt ? document.getElementById('opt-' + optId(backingOpt))?.value : null;
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
    const isNameField = o.name.trim().toLowerCase() === 'text';
    const el = document.getElementById(isNameField ? 'nameInput' : 'opt-' + optId(o));
    if (!el) continue;
    parts.push(`${o.name}:${el.value || ''}`);
  }
  return parts.join('||');
}

function addToCart() {
  if (!selectedCat) return;
  const nameEl = document.getElementById('nameInput');
  if (nameEl && !nameEl.value.trim()) { nameEl.focus(); return; }
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

document.addEventListener('DOMContentLoaded', boot);
