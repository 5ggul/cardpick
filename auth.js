// 카드픽 — Supabase Google 인증
// 모든 페이지에서 공유: 로그인/로그아웃/세션 관리
(function () {
  const SUPABASE_URL = 'https://adhjwyiwajgsaryxkomw.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_rP_R-8CcR1VZ7eq0MeWSLA_XDf8MZOL';

  // Supabase JS SDK 동적 로드 (CDN)
  function loadSDK(cb) {
    if (window.supabase && window.supabase.createClient) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = cb;
    s.onerror = () => console.error('[cardpick] Supabase SDK load failed');
    document.head.appendChild(s);
  }

  let client = null;

  function getClient() {
    if (!client && window.supabase) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  // 로그인: 현재 페이지로 redirect
  async function signIn() {
    const c = getClient();
    if (!c) { alert('인증 시스템 로딩 중 입니다. 잠시 후 다시 시도해주세요.'); return; }
    const redirectTo = location.origin + location.pathname;
    const { error } = await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'consent' } }
    });
    if (error) alert('로그인 오류: ' + error.message);
  }

  async function signOut() {
    const c = getClient();
    if (!c) return;
    await c.auth.signOut();
    renderAuthUI(null);
  }

  // 드롭다운 열고 닫기
  function closeMenus() {
    document.querySelectorAll('[data-cp-menu]').forEach(m => m.remove());
    document.removeEventListener('click', onDocClick, true);
  }
  function onDocClick(e) {
    const inside = e.target.closest('[data-cp-menu]') || e.target.closest('[data-cp-user-trigger]');
    if (!inside) closeMenus();
  }
  function openMenu(anchorBtn, user) {
    closeMenus();
    const rect = anchorBtn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.setAttribute('data-cp-menu', '');
    menu.style.cssText = `
      position:fixed; z-index:9999;
      top:${rect.bottom + 6}px; right:${Math.max(8, window.innerWidth - rect.right)}px;
      min-width:200px; background:#0D121B; border:1px solid rgba(255,255,255,0.14);
      border-radius:3px; box-shadow:0 8px 24px rgba(0,0,0,0.5);
      font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif;
      overflow:hidden;
    `;
    const email = user.email || '';
    const name = user.user_metadata?.name || user.user_metadata?.full_name || (email ? email.split('@')[0] : '사용자');
    menu.innerHTML = `
      <div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div style="font-size:13px;font-weight:600;color:#E8EDF5">${name}</div>
        <div style="font-size:11px;color:#8B96A8;font-family:'IBM Plex Mono',monospace;margin-top:2px;word-break:break-all">${email}</div>
      </div>
      <a href="/my.html" data-cp-mi style="display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;color:#E8EDF5;text-decoration:none">
        <span style="color:#8B96A8;font-size:11px;width:14px;text-align:center">◆</span>내 정보
      </a>
      <a href="/board.html" data-cp-mi style="display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;color:#E8EDF5;text-decoration:none">
        <span style="color:#8B96A8;font-size:11px;width:14px;text-align:center">▤</span>게시판
      </a>
      <a href="/tools.html" data-cp-mi style="display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;color:#E8EDF5;text-decoration:none">
        <span style="color:#8B96A8;font-size:11px;width:14px;text-align:center">⚙</span>계산기·도구
      </a>
      <div style="border-top:1px solid rgba(255,255,255,0.08)"></div>
      <button type="button" data-cp-signout style="display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;color:#FF4D6D;text-decoration:none;background:none;border:0;width:100%;text-align:left;cursor:pointer">
        <span style="font-size:11px;width:14px;text-align:center">↩</span>로그아웃
      </button>
    `;
    menu.querySelectorAll('[data-cp-mi]').forEach(a => {
      a.addEventListener('mouseenter', () => a.style.background = 'rgba(255,255,255,0.04)');
      a.addEventListener('mouseleave', () => a.style.background = '');
    });
    const so = menu.querySelector('[data-cp-signout]');
    so.addEventListener('mouseenter', () => so.style.background = 'rgba(255,77,109,0.08)');
    so.addEventListener('mouseleave', () => so.style.background = '');
    so.addEventListener('click', () => { closeMenus(); if (confirm('로그아웃 하시겠습니까?')) signOut(); });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  }

  // 로그인 버튼 → 사용자 메뉴로 전환
  function renderAuthUI(user) {
    closeMenus();
    // index.html 기존 .login-google 또는 8개 페이지 .cp-login-google 모두 대응
    const btns = document.querySelectorAll('.login-google, .cp-login-google, [data-cp-login]');
    btns.forEach((btn) => {
      if (user) {
        const name = user.user_metadata?.name
                  || user.user_metadata?.full_name
                  || (user.email ? user.email.split('@')[0] : '사용자');
        const avatar = user.user_metadata?.avatar_url || '';
        btn.innerHTML = `
          <div data-cp-user-trigger style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">
            ${avatar
              ? `<img src="${avatar}" alt="" style="width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,0.18)">`
              : `<span style="width:24px;height:24px;border-radius:50%;background:#26E0C2;color:#04100E;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${name.charAt(0).toUpperCase()}</span>`
            }
            <span style="font-size:12.5px;font-weight:500;color:#E8EDF5;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
            <span style="color:#8B96A8;font-size:10px">▾</span>
          </div>
        `;
        // 클릭 시 드롭다운 메뉴
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 이미 열려있으면 닫기
          if (document.querySelector('[data-cp-menu]')) { closeMenus(); return; }
          openMenu(btn, user);
        };
        btn.style.cursor = 'pointer';
      } else {
        // 비로그인 — 기본 Google 버튼 UI 복원
        btn.innerHTML = `
          <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false" style="width:16px;height:16px;display:block;flex:none">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.35 2.82.94 4.04l3.01-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z"/>
          </svg>
          <span>Google로 로그인</span>
        `;
        btn.onclick = (e) => { e.preventDefault(); signIn(); };
      }
    });

    // 헤더 외 다른 곳 (예: index.html의 추가 로그인 링크)도 처리
    const links = document.querySelectorAll('a[href="/login/google"]');
    links.forEach((a) => {
      if (user) {
        a.style.display = 'none';
      } else {
        a.onclick = (e) => { e.preventDefault(); signIn(); };
      }
    });
  }

  // 초기화
  function init() {
    loadSDK(async () => {
      const c = getClient();
      if (!c) return;

      // 현재 세션 가져오기
      const { data: { session } } = await c.auth.getSession();
      renderAuthUI(session?.user || null);

      // 세션 변화 감지 (OAuth 콜백, 로그아웃 등)
      c.auth.onAuthStateChange((_evt, sess) => {
        renderAuthUI(sess?.user || null);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 글로벌 공개 (디버그/외부 호출용)
  window.cardpickAuth = { signIn, signOut, getClient };
})();
