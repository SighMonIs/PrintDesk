// Customer account: Supabase Auth signup/login (self-service — doesn't exist
// on the admin side, which only supports staff invites). On first sign-in we
// link/create a `customers` row via `auth_user_id` so order history can be
// scoped to the signed-in customer (see the RLS policies in the shop plan —
// this requires the `customers.auth_user_id` column + policies to be in place).
const AUTH_SB_URL = (window.CONFIG && window.CONFIG.SUPABASE_URL) || '';
const AUTH_SB_KEY = (window.CONFIG && window.CONFIG.SUPABASE_KEY) || '';

window.sbToken = null;
window.sbCustomer = null;
window.isStaff = false;

// RLS on `staff` only lets a row's own user read it (see the shop RLS plan),
// so this naturally returns empty for anyone who isn't staff — no uid filter needed.
async function checkStaffStatus() {
  try {
    const rows = await sbGet('staff', '?select=user_id&limit=1');
    window.isStaff = Array.isArray(rows) && rows.length > 0;
  } catch (e) { window.isStaff = false; }
  if (typeof onStaffStatusChanged === 'function') onStaffStatusChanged();
}

function authHeaders(extra) { return { 'apikey': AUTH_SB_KEY, 'Content-Type': 'application/json', ...extra }; }

async function restoreCustomerSession() {
  const token = localStorage.getItem('shop_token');
  if (!token) return updateAccountUI();
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/user`, { headers: authHeaders({ 'Authorization': 'Bearer ' + token }) });
    if (!res.ok) { localStorage.removeItem('shop_token'); return updateAccountUI(); }
    const user = await res.json();
    window.sbToken = token;
    await loadOrCreateCustomer(user);
    await checkStaffStatus();
  } catch (e) { /* offline / expired — fall back to guest */ }
  updateAccountUI();
}

async function loadOrCreateCustomer(user) {
  const rows = await sbGet('customers', `?auth_user_id=eq.${user.id}&limit=1`);
  if (Array.isArray(rows) && rows[0]) { window.sbCustomer = rows[0]; return; }
  const created = await fetch(`${AUTH_SB_URL}/rest/v1/customers`, {
    method: 'POST',
    headers: authHeaders({ 'Authorization': 'Bearer ' + window.sbToken, 'Prefer': 'return=representation' }),
    body: JSON.stringify({ auth_user_id: user.id, name: user.user_metadata?.display_name || user.email, email: user.email }),
  }).then(r => r.json());
  window.sbCustomer = Array.isArray(created) ? created[0] : created;
}

async function doCustomerSignup() {
  const name = document.getElementById('authName').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if (!name || !email || !pass) { errEl.textContent = 'Please fill in all fields.'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password: pass, data: { display_name: name } }),
    });
    const data = await res.json();
    if (data.error || !data.access_token) throw new Error(data.error_description || data.msg || 'Could not create account');
    window.sbToken = data.access_token;
    localStorage.setItem('shop_token', data.access_token);
    await loadOrCreateCustomer(data.user);
    await checkStaffStatus();
    closeAuthModal();
    updateAccountUI();
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
}

async function doCustomerLogin() {
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    window.sbToken = data.access_token;
    localStorage.setItem('shop_token', data.access_token);
    await loadOrCreateCustomer(data.user);
    await checkStaffStatus();
    closeAuthModal();
    updateAccountUI();
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
}

function doCustomerLogout() {
  localStorage.removeItem('shop_token');
  window.sbToken = null; window.sbCustomer = null; window.isStaff = false;
  updateAccountUI();
  if (typeof onStaffStatusChanged === 'function') onStaffStatusChanged();
}

function updateAccountUI() {
  const chip = document.getElementById('accountChip');
  if (window.sbCustomer) {
    chip.innerHTML = `<i class="ti ti-user"></i> ${esc(window.sbCustomer.name || window.sbCustomer.email)}`;
    chip.onclick = doCustomerLogout;
    chip.title = 'Sign out';
  } else {
    chip.innerHTML = `<i class="ti ti-user"></i> Sign in`;
    chip.onclick = openAuthModal;
    chip.title = 'Sign in / create account';
  }
}

let authMode = 'login';
function openAuthModal(mode) {
  authMode = mode || 'login';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authNameRow').style.display = authMode === 'signup' ? '' : 'none';
  document.getElementById('authTitle').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('authSubmitBtn').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('authSubmitBtn').onclick = authMode === 'signup' ? doCustomerSignup : doCustomerLogin;
  document.getElementById('authSwitchText').innerHTML = authMode === 'signup'
    ? `Already have an account? <a href="#" onclick="openAuthModal('login');return false">Sign in</a>`
    : `New here? <a href="#" onclick="openAuthModal('signup');return false">Create an account</a>`;
  document.getElementById('authModal').style.display = 'flex';
}
function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }

document.addEventListener('DOMContentLoaded', restoreCustomerSession);
