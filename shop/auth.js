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

// Some GoTrue versions/configs don't include a `user` object in the
// signup/token response body — the access_token JWT always carries the
// user's id/email in its payload regardless, so decode that instead of
// trusting the response shape.
function userFromToken(accessToken) {
  try {
    const base64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    const payload = JSON.parse(json);
    return { id: payload.sub, email: payload.email, user_metadata: payload.user_metadata || {} };
  } catch (e) { return null; }
}

function storeSession(data) {
  localStorage.setItem('shop_token', data.access_token);
  if (data.refresh_token) localStorage.setItem('shop_refresh_token', data.refresh_token);
  window.sbToken = data.access_token;
}

function clearSession() {
  localStorage.removeItem('shop_token');
  localStorage.removeItem('shop_refresh_token');
}

// The access token is short-lived (Supabase's default is ~1hr) — a page
// reload after it expires needs to trade the refresh token for a new one
// rather than just dropping the session.
async function refreshSession() {
  const refreshToken = localStorage.getItem('shop_refresh_token');
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!res.ok || data.error || !data.access_token) return null;
    storeSession(data);
    return data;
  } catch (e) { return null; }
}

async function restoreCustomerSession() {
  let token = localStorage.getItem('shop_token');
  if (!token) return updateAccountUI();
  try {
    let res = await fetch(`${AUTH_SB_URL}/auth/v1/user`, { headers: authHeaders({ 'Authorization': 'Bearer ' + token }) });
    if (!res.ok) {
      const refreshed = await refreshSession();
      if (!refreshed) { clearSession(); return updateAccountUI(); }
      token = refreshed.access_token;
      res = await fetch(`${AUTH_SB_URL}/auth/v1/user`, { headers: authHeaders({ 'Authorization': 'Bearer ' + token }) });
      if (!res.ok) { clearSession(); return updateAccountUI(); }
    }
    const user = await res.json();
    window.sbToken = token;
    await loadOrCreateCustomer(user);
    await checkStaffStatus();
  } catch (e) { /* offline — fall back to guest, keep the stored session for next time */ }
  updateAccountUI();
}

async function loadOrCreateCustomer(user) {
  const rows = await sbGet('customers', `?auth_user_id=eq.${user.id}&limit=1`);
  if (Array.isArray(rows) && rows[0]) { window.sbCustomer = rows[0]; return; }
  // customers.id has no DB default — admin generates sequential CUSTnnnn ids,
  // but that requires reading every existing customer to find the next
  // number, which a brand-new customer's RLS-limited access can't do. Using
  // the auth user's own uuid instead: globally unique, no read needed.
  const res = await fetch(`${AUTH_SB_URL}/rest/v1/customers`, {
    method: 'POST',
    headers: authHeaders({ 'Authorization': 'Bearer ' + window.sbToken, 'Prefer': 'return=representation' }),
    body: JSON.stringify({ id: user.id, auth_user_id: user.id, name: user.user_metadata?.display_name || user.email, email: user.email }),
  });
  const created = await res.json();
  if (!res.ok) throw new Error(created?.message || 'Could not set up your account — please try again.');
  window.sbCustomer = Array.isArray(created) ? created[0] : created;
}

// Supabase Auth's own minimum is 6 chars with no complexity rule — this adds
// the length/uppercase/number bar recommended for customer-facing signup.
function passwordIssue(pass) {
  if (pass.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(pass)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pass)) return 'Password must include a number.';
  return null;
}

async function doCustomerSignup() {
  const name = document.getElementById('authName').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPassword').value;
  const passConfirm = document.getElementById('authPasswordConfirm').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if (!name || !email || !pass) { errEl.textContent = 'Please fill in all fields.'; errEl.style.display = 'block'; return; }
  if (pass !== passConfirm) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }
  const issue = passwordIssue(pass);
  if (issue) { errEl.textContent = issue; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password: pass, data: { display_name: name } }),
    });
    const data = await res.json();
    if (data.error || !data.access_token) throw new Error(data.error_description || data.msg || 'Could not create account');
    const user = data.user || userFromToken(data.access_token);
    if (!user?.id) throw new Error('Could not create account — please try again.');
    storeSession(data);
    await loadOrCreateCustomer(user);
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
    const user = data.user || userFromToken(data.access_token);
    if (!user?.id) throw new Error('Could not sign in — please try again.');
    storeSession(data);
    await loadOrCreateCustomer(user);
    await checkStaffStatus();
    closeAuthModal();
    updateAccountUI();
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
}

function doCustomerLogout() {
  clearSession();
  window.sbToken = null; window.sbCustomer = null; window.isStaff = false;
  updateAccountUI();
  if (typeof onStaffStatusChanged === 'function') onStaffStatusChanged();
}

function updateAccountUI() {
  const chip = document.getElementById('accountChip');
  if (window.sbCustomer) {
    const label = window.sbCustomer.name || window.sbCustomer.email;
    chip.innerHTML = `<i class="ti ti-user"></i> ${esc(label)}`;
    chip.classList.add('cart-btn-wide');
    chip.onclick = openAccountModal;
    chip.title = label;
  } else {
    chip.innerHTML = `<i class="ti ti-user"></i> Sign In / Up`;
    chip.classList.add('cart-btn-wide');
    chip.onclick = () => openAuthModal();
    chip.title = 'Sign in / create account';
  }
}

function openAccountModal() {
  if (!window.sbCustomer) return openAuthModal();
  document.getElementById('accountError').style.display = 'none';
  document.getElementById('accountName').value = window.sbCustomer.name || '';
  document.getElementById('accountEmail').value = window.sbCustomer.email || '';
  document.getElementById('accountPhone').value = window.sbCustomer.phone || '';
  document.getElementById('accountModal').style.display = 'flex';
}
function closeAccountModal() { document.getElementById('accountModal').style.display = 'none'; }

async function saveAccountDetails() {
  const name = document.getElementById('accountName').value.trim();
  const phone = document.getElementById('accountPhone').value.trim();
  const errEl = document.getElementById('accountError');
  const btn = document.getElementById('accountSaveBtn');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Please enter a name.'; errEl.style.display = 'block'; return; }
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`${AUTH_SB_URL}/rest/v1/customers?id=eq.${window.sbCustomer.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Authorization': 'Bearer ' + window.sbToken, 'Prefer': 'return=representation' }),
      body: JSON.stringify({ name, phone }),
    });
    const updated = await res.json();
    if (!res.ok) throw new Error(updated?.message || 'Could not save changes');
    window.sbCustomer = Array.isArray(updated) ? updated[0] : updated;
    updateAccountUI();
    closeAccountModal();
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = orig;
}

let authMode = 'login';
function openAuthModal(mode) {
  authMode = mode || 'login';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSuccess').style.display = 'none';
  document.getElementById('authNameRow').style.display = authMode === 'signup' ? '' : 'none';
  document.getElementById('authEmailRow').style.display = authMode === 'reset' ? 'none' : '';
  document.getElementById('authPasswordRow').style.display = authMode === 'forgot' ? 'none' : '';
  document.getElementById('authPasswordLabel').textContent = authMode === 'reset' ? 'New password' : 'Password';
  document.getElementById('authPasswordConfirmRow').style.display = (authMode === 'signup' || authMode === 'reset') ? '' : 'none';
  document.getElementById('authPasswordConfirmLabel').textContent = authMode === 'reset' ? 'Confirm new password' : 'Confirm password';
  document.getElementById('authPasswordConfirm').value = '';
  document.getElementById('authForgotLink').style.display = authMode === 'login' ? '' : 'none';

  const titles      = { login: 'Sign in', signup: 'Create account', forgot: 'Reset password', reset: 'Set new password' };
  const submitLabels = { login: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Set new password' };
  const handlers    = { login: doCustomerLogin, signup: doCustomerSignup, forgot: doRequestPasswordReset, reset: doResetPassword };
  document.getElementById('authTitle').textContent = titles[authMode];
  document.getElementById('authSubmitBtn').textContent = submitLabels[authMode];
  document.getElementById('authSubmitBtn').onclick = handlers[authMode];

  const switchEl = document.getElementById('authSwitchText');
  if (authMode === 'forgot') { switchEl.style.display = ''; switchEl.innerHTML = `<a href="#" onclick="openAuthModal('login');return false">Back to sign in</a>`; }
  else if (authMode === 'reset') { switchEl.style.display = 'none'; }
  else {
    switchEl.style.display = '';
    switchEl.innerHTML = authMode === 'signup'
      ? `Already have an account? <a href="#" onclick="openAuthModal('login');return false">Sign in</a>`
      : `New here? <a href="#" onclick="openAuthModal('signup');return false">Create an account</a>`;
  }
  document.getElementById('authModal').style.display = 'flex';
}
function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }

async function doRequestPasswordReset() {
  const email = document.getElementById('authEmail').value.trim();
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if (!email) { errEl.textContent = 'Please enter your email.'; errEl.style.display = 'block'; return; }
  const btn = document.getElementById('authSubmitBtn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, redirect_to: window.location.origin + window.location.pathname }),
    });
    // GoTrue returns 200 regardless of whether the email exists, so it never
    // reveals which addresses have accounts.
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error_description || data.msg || 'Could not send reset email.'); }
    document.getElementById('authSuccess').textContent = 'Check your email for a reset link.';
    document.getElementById('authSuccess').style.display = 'block';
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  btn.disabled = false; btn.textContent = orig;
}

async function doResetPassword() {
  const pass = document.getElementById('authPassword').value;
  const passConfirm = document.getElementById('authPasswordConfirm').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if (pass !== passConfirm) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }
  const issue = passwordIssue(pass);
  if (issue) { errEl.textContent = issue; errEl.style.display = 'block'; return; }
  const recoveryToken = sessionStorage.getItem('shop_recovery_token');
  if (!recoveryToken) { errEl.textContent = 'This reset link has expired — please request a new one.'; errEl.style.display = 'block'; return; }
  const btn = document.getElementById('authSubmitBtn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`${AUTH_SB_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: authHeaders({ 'Authorization': 'Bearer ' + recoveryToken }),
      body: JSON.stringify({ password: pass }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Could not set new password.');
    sessionStorage.removeItem('shop_recovery_token');
    const user = data.id ? data : userFromToken(recoveryToken);
    storeSession({ access_token: recoveryToken });
    await loadOrCreateCustomer(user);
    await checkStaffStatus();
    closeAuthModal();
    updateAccountUI();
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  btn.disabled = false; btn.textContent = orig;
}

// A password-reset email link redirects back here with
// #access_token=...&type=recovery in the URL hash (same mechanism as invite
// links on the admin side — see checkInviteToken() in api.js).
function checkRecoveryToken() {
  const hash = window.location.hash;
  if (!hash) return false;
  const params = new URLSearchParams(hash.slice(1));
  if (params.get('type') !== 'recovery' || !params.get('access_token')) return false;
  sessionStorage.setItem('shop_recovery_token', params.get('access_token'));
  history.replaceState(null, '', window.location.pathname + window.location.search);
  openAuthModal('reset');
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  checkRecoveryToken();
  restoreCustomerSession();
});
