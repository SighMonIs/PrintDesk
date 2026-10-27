// ── Shared sign-in + Supabase REST, plus the two prompts that go with it ──
//
// Every maker tool needs the same thing: one PrintDesk sign-in, a token that
// refreshes itself, and four thin wrappers over PostgREST. BadgeMak3r,
// BeadMak3r and EmbossMak3r each carry their own copy of this; LithoMak3r is
// the first to use this file instead. Move the other three over when they're
// next open — the copies have drifted slightly, so it wants its own pass.
//
// Expects window.CONFIG (config.js) and a page with #loginScreen / #appScreen
// / #loginEmail / #loginPassword / #loginError / #loginBtn, and a showApp().

const SB_URL=(window.CONFIG&&window.CONFIG.SUPABASE_URL)||'';
const SB_KEY=(window.CONFIG&&window.CONFIG.SUPABASE_KEY)||'';
let sbToken=null, sbRefreshToken=null, currentUser=null;

function sbHeaders(){ return{'apikey':SB_KEY,'Authorization':'Bearer '+(sbToken||SB_KEY),'Content-Type':'application/json','Prefer':'return=representation'}; }

let _refreshInFlight=null;
async function refreshSession(){
  if(!sbRefreshToken) return false;
  if(_refreshInFlight) return _refreshInFlight;
  _refreshInFlight=(async()=>{
    try{
      const res=await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`,{
        method:'POST', headers:{'apikey':SB_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:sbRefreshToken}),
      });
      const data=await res.json();
      if(!res.ok || !data.access_token) return false;
      storeSession(data); return true;
    }catch(e){ return false; }
    finally{ _refreshInFlight=null; }
  })();
  return _refreshInFlight;
}
function storeSession(data){
  sbToken=data.access_token;
  if(data.refresh_token) sbRefreshToken=data.refresh_token;
  if(data.user) currentUser=data.user;
  // Same keys as BadgeMak3r — one sign-in covers every tool.
  localStorage.setItem('badgemaker_token', sbToken);
  if(sbRefreshToken) localStorage.setItem('badgemaker_refresh', sbRefreshToken);
}
async function sbFetch(path, opts={}, extra={}){
  const send=()=>fetch(`${SB_URL}/rest/v1/${path}`,{...opts, headers:{...sbHeaders(), ...extra}});
  let r=await send();
  if(r.status===401 && await refreshSession()) r=await send();
  return r;
}
async function sbGet(table,q=''){ const r=await sbFetch(`${table}${q}`); return r.json(); }
async function sbInsert(table,row){ const r=await sbFetch(table,{method:'POST',body:JSON.stringify(row)}); return r.json(); }
async function sbPatch(table,q,row){ const r=await sbFetch(`${table}${q}`,{method:'PATCH',body:JSON.stringify(row)}); return r.ok?null:await r.json(); }
async function sbDelete(table,q){ const r=await sbFetch(`${table}${q}`,{method:'DELETE'}); return r.ok?null:await r.json(); }

async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value;
  const errEl=document.getElementById('loginError');
  const btn=document.getElementById('loginBtn');
  errEl.style.display='none';
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Signing in…';
  try{
    const res=await fetch(`${SB_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'apikey':SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const data=await res.json();
    if(data.error) throw new Error(data.error_description||data.error);
    storeSession(data);
    showApp();
  }catch(e){
    errEl.textContent=e.message; errEl.style.display='block';
    btn.disabled=false; btn.innerHTML='<i class="ti ti-login"></i> Sign in';
  }
}
async function restoreSession(){
  const t=localStorage.getItem('badgemaker_token')||localStorage.getItem('pd_access_token')||localStorage.getItem('pd_token');
  sbRefreshToken=localStorage.getItem('badgemaker_refresh')||null;
  if(!t && !sbRefreshToken) return false;
  const fetchUser=async tok=>{
    const res=await fetch(`${SB_URL}/auth/v1/user`,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}});
    return res.ok ? res.json() : null;
  };
  try{
    if(t){ const user=await fetchUser(t); if(user){ sbToken=t; currentUser=user; return true; } }
    if(await refreshSession()){ currentUser=await fetchUser(sbToken); return !!currentUser; }
    return false;
  }catch(e){ return false; }
}
function doLogout(){
  localStorage.removeItem('badgemaker_token');
  localStorage.removeItem('badgemaker_refresh');
  sbToken=null; sbRefreshToken=null; currentUser=null;
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}

// ── The two prompts ────────────────────────────────────────────
// Naming and confirming a design, styled like the rest of the tool instead of
// the browser's own grey boxes.
function askText(message, defaultValue){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML='<div class="bm-modal"><div class="bm-modal-msg"></div><input type="text" class="adv-text-input" id="bmModalInput"><div class="bm-modal-btns"><button class="btn sm" id="bmModalCancel">Cancel</button><button class="btn sm primary" id="bmModalOk">OK</button></div></div>';
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const input=overlay.querySelector('#bmModalInput');
    input.value=defaultValue||''; input.focus(); input.select();
    const close=val=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#bmModalOk').onclick=()=>close(input.value.trim()||null);
    overlay.querySelector('#bmModalCancel').onclick=()=>close(null);
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close(null); });
    input.onkeydown=e=>{ if(e.key==='Enter') close(input.value.trim()||null); if(e.key==='Escape') close(null); };
  });
}
function askConfirm(message, confirmLabel='Delete'){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='bm-modal-overlay';
    overlay.innerHTML='<div class="bm-modal"><div class="bm-modal-msg"></div><div class="bm-modal-btns"><button class="btn sm" id="bmModalCancel">Cancel</button><button class="btn sm primary" id="bmModalOk">'+String(confirmLabel).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</button></div></div>';
    overlay.querySelector('.bm-modal-msg').textContent=message;
    document.body.appendChild(overlay);
    const close=val=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#bmModalOk').onclick=()=>close(true);
    overlay.querySelector('#bmModalCancel').onclick=()=>close(false);
    overlay.addEventListener('click', e=>{ if(e.target===overlay) close(false); });
  });
}
