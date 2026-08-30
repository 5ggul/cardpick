/* cp-notif.js — 전역 알림 배지 컴포넌트 (2026-08-30)
 *
 * 카드픽 모든 페이지 헤더에 자동 삽입되는 종 아이콘 + 미읽음 배지 + 드롭다운.
 * board.html 은 자체 종 아이콘 있으므로 skip. 다른 페이지(홈·hot·guides·tools·
 * card-detail·about 등)에서 로그인 유저면 자동 노출.
 *
 * 의존성: window.cardpickAuth (기존 auth SDK).
 * 스타일: 자체 <style> 주입 (기존 다크 터미널 팔레트 준수).
 * 클릭 시: 알림 -> post 페이지 (?post= 쿼리) or /board 이동.
 */
(function(){
  'use strict';
  if (window.__cpNotifLoaded) return;
  window.__cpNotifLoaded = true;

  function ready(fn){
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var IDS = {
    btn: 'cp-notif-btn',
    count: 'cp-notif-count',
    dd: 'cp-notif-dropdown',
    list: 'cp-notif-list',
    mark: 'cp-notif-mark-all',
    style: 'cp-notif-style'
  };

  function injectStyle(){
    if (document.getElementById(IDS.style)) return;
    var css = '.cp-notif{position:relative;display:none;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid rgba(255,255,255,0.14);border-radius:1px;background:#080D15;color:#8B96A8;cursor:pointer;flex:none}' +
      '.cp-notif:hover{border-color:rgba(255,255,255,0.28);background:#0D1420;color:#E8EDF5}' +
      '.cp-notif svg{width:16px;height:16px;display:block;stroke:currentColor;fill:none;stroke-width:1.8}' +
      '.cp-notif .cp-notif-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#26E0C2;color:#04100E;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;line-height:1}' +
      '.cp-notif.has-unread .cp-notif-badge{display:flex}' +
      '.cp-notif-dropdown{position:absolute;top:calc(100% + 8px);right:0;width:340px;max-height:420px;overflow-y:auto;background:#0D121B;border:1px solid rgba(255,255,255,0.14);border-radius:3px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:100;padding:8px;text-align:left}' +
      '.cp-notif-dropdown[hidden]{display:none}' +
      '.cp-notif-dropdown .lbl{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;color:#8B96A8;letter-spacing:.14em;text-transform:uppercase;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between}' +
      '.cp-notif-dropdown .lbl a{color:#8B96A8;text-decoration:none;font-size:10px}' +
      '.cp-notif-dropdown .lbl a:hover{color:#26E0C2}' +
      '.cp-notif-dropdown .empty{padding:20px 10px;text-align:center;color:#5B6577;font-size:12.5px}' +
      '.cp-notif-item{display:block;padding:10px 12px;border:1px solid transparent;border-radius:2px;cursor:pointer;color:inherit;text-decoration:none;transition:background .12s,border-color .12s}' +
      '.cp-notif-item:hover{background:rgba(38,224,194,0.06);border-color:rgba(38,224,194,0.25)}' +
      '.cp-notif-item.unread{background:rgba(38,224,194,0.04)}' +
      '.cp-notif-item .n-title{font-size:13px;color:#E8EDF5;font-weight:600;line-height:1.35;margin-bottom:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
      '.cp-notif-item .n-msg{font-size:12px;color:#8B96A8;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
      '.cp-notif-item .n-time{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;color:#5B6577;margin-top:4px;letter-spacing:.04em}';
    var st = document.createElement('style');
    st.id = IDS.style;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function injectButton(){
    if (document.getElementById(IDS.btn)) return true; // board.html or 이미 있음
    // 삽입 위치: cp-topbar-inner 안, cp-login-google 앞. 없으면 skip.
    var login = document.querySelector('.cp-topbar-inner .cp-login-google');
    if (!login) return false;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cp-notif';
    btn.id = IDS.btn;
    btn.setAttribute('aria-label', '알림');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'true');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z"/>' +
      '<path d="M10 20a2 2 0 0 0 4 0"/>' +
      '</svg>' +
      '<span class="cp-notif-badge" id="' + IDS.count + '">0</span>' +
      '<div class="cp-notif-dropdown" id="' + IDS.dd + '" role="menu" hidden>' +
      '<div class="lbl"><span>알림</span><a href="#" id="' + IDS.mark + '" role="menuitem">모두 읽음</a></div>' +
      '<div id="' + IDS.list + '"><div class="empty">알림이 없습니다</div></div>' +
      '</div>';
    login.parentNode.insertBefore(btn, login);
    return true;
  }

  function esc(s){ return String(s||'').replace(/[<>&"]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];}); }
  function relTime(iso){
    var d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return Math.floor(diff/60) + '분 전';
    if (diff < 86400) return Math.floor(diff/3600) + '시간 전';
    if (diff < 604800) return Math.floor(diff/86400) + '일 전';
    return d.toLocaleDateString('ko-KR');
  }

  var STATE = { user: null, client: null };

  async function updateBadge(){
    var btn = document.getElementById(IDS.btn);
    if (!btn) return;
    if (!STATE.user){ btn.style.display = 'none'; return; }
    btn.style.display = 'inline-flex';
    var c = STATE.client; if (!c) return;
    try {
      var res = await c.from('notifications').select('id', { count:'exact', head:true }).is('read_at', null);
      var cnt = Number(res.count || 0);
      btn.classList.toggle('has-unread', cnt > 0);
      var el = document.getElementById(IDS.count);
      if (el) el.textContent = cnt > 99 ? '99+' : String(cnt);
    } catch(e){ /* graceful */ }
  }

  async function openDropdown(){
    var dd = document.getElementById(IDS.dd);
    var list = document.getElementById(IDS.list);
    var btn = document.getElementById(IDS.btn);
    if (!dd || !STATE.user) return;
    dd.hidden = false;
    btn.setAttribute('aria-expanded','true');
    list.innerHTML = '<div class="empty">불러오는 중...</div>';
    var c = STATE.client; if (!c) return;
    try {
      var res = await c.from('notifications')
        .select('id,type,actor_id,post_id,comment_id,read_at,created_at,posts(title)')
        .order('created_at', { ascending:false }).limit(20);
      var data = res.data || [];
      if (!data.length){ list.innerHTML = '<div class="empty">알림이 없습니다</div>'; return; }
      var actorIds = [].concat.apply([], data.map(function(n){return n.actor_id ? [n.actor_id] : [];}));
      var uniqIds = actorIds.filter(function(v,i){ return actorIds.indexOf(v) === i; });
      var actorMap = {};
      if (uniqIds.length){
        var pr = await c.from('profiles').select('id,display_name').in('id', uniqIds);
        (pr.data || []).forEach(function(p){ actorMap[p.id] = p.display_name || '누군가'; });
      }
      list.innerHTML = data.map(function(n){
        var actor = actorMap[n.actor_id] || '누군가';
        var title = (n.posts && n.posts.title) || '(삭제된 글)';
        return '<a href="/board?post=' + encodeURIComponent(n.post_id) + '" class="cp-notif-item ' + (n.read_at ? '' : 'unread') + '" data-id="' + n.id + '">' +
               '<div class="n-title">' + esc(title) + '</div>' +
               '<div class="n-msg">' + esc(actor) + '님이 댓글을 남겼습니다</div>' +
               '<div class="n-time">' + relTime(n.created_at) + '</div>' +
               '</a>';
      }).join('');
      // 클릭 시 read_at 갱신 (navigation 은 기본 href 로 진행 = /board?post=)
      list.querySelectorAll('.cp-notif-item').forEach(function(el){
        el.addEventListener('click', function(){
          var id = el.getAttribute('data-id');
          try { c.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).then(function(){}); } catch(_){}
        });
      });
    } catch(e){
      list.innerHTML = '<div class="empty">알림 조회 실패</div>';
    }
  }

  function closeDropdown(){
    var dd = document.getElementById(IDS.dd);
    var btn = document.getElementById(IDS.btn);
    if (dd) dd.hidden = true;
    if (btn) btn.setAttribute('aria-expanded','false');
  }

  function bind(){
    document.addEventListener('click', function(e){
      var btn = document.getElementById(IDS.btn);
      var dd = document.getElementById(IDS.dd);
      if (!btn || !dd) return;
      var mark = document.getElementById(IDS.mark);
      if (mark && mark.contains(e.target)){
        e.preventDefault(); e.stopPropagation();
        var c = STATE.client;
        if (c && STATE.user){
          c.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).then(function(){
            openDropdown(); updateBadge();
          });
        }
        return;
      }
      if (btn.contains(e.target) && !dd.contains(e.target)){
        if (dd.hidden) openDropdown(); else closeDropdown();
      } else if (!btn.contains(e.target) && !dd.contains(e.target)){
        closeDropdown();
      }
    });
  }

  async function waitAuth(maxMs){
    var start = Date.now();
    while (Date.now() - start < (maxMs || 5000)){
      if (window.cardpickAuth && typeof window.cardpickAuth.getClient === 'function'){
        var c = window.cardpickAuth.getClient();
        if (c) return c;
      }
      await new Promise(function(r){ setTimeout(r, 150); });
    }
    return null;
  }

  async function init(){
    injectStyle();
    if (!injectButton()) return; // 헤더 구조 없음 (예: 정책 페이지 다른 헤더)
    bind();
    var c = await waitAuth(6000);
    if (!c) return;
    STATE.client = c;
    try {
      var s = await c.auth.getSession();
      STATE.user = s && s.data && s.data.session ? s.data.session.user : null;
      c.auth.onAuthStateChange(function(_e, sess){
        STATE.user = sess ? sess.user : null;
        updateBadge();
      });
      updateBadge();
    } catch(e){ /* graceful */ }
  }

  ready(init);
})();
