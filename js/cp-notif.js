/* cp-notif.js — CardPick v5 전역 알림 배지/드롭다운 */
(function(){
  'use strict';
  if (window.__cpNotifLoaded) return;
  window.__cpNotifLoaded = true;

  var IDS = { btn:'cp-notif-btn', count:'cp-notif-count', dd:'cp-notif-dropdown', list:'cp-notif-list', mark:'cp-notif-mark-all', style:'cp-notif-style' };
  var STATE = { user:null, client:null };

  function ready(fn){ if(document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function esc(s){ return String(s||'').replace(/[<>&"]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];}); }
  function relTime(iso){
    var d=new Date(iso), diff=(Date.now()-d.getTime())/1000;
    if(diff<60) return '방금';
    if(diff<3600) return Math.floor(diff/60)+'분 전';
    if(diff<86400) return Math.floor(diff/3600)+'시간 전';
    if(diff<604800) return Math.floor(diff/86400)+'일 전';
    return d.toLocaleDateString('ko-KR');
  }
  function won(v){ var n=Number(v); return Number.isFinite(n) ? '₩'+Math.round(n).toLocaleString('ko-KR') : ''; }

  function injectStyle(){
    if(document.getElementById(IDS.style)) return;
    var st=document.createElement('style'); st.id=IDS.style;
    st.textContent=
      '.cp-notif{position:relative;display:none;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid rgba(255,255,255,.14);border-radius:3px;background:#080D15;color:#8B96A8;cursor:pointer;flex:none}'+
      '.cp-notif:hover{border-color:rgba(255,255,255,.28);background:#0D1420;color:#E8EDF5}.cp-notif svg{width:17px;height:17px;display:block;stroke:currentColor;fill:none;stroke-width:1.8}'+
      '.cp-notif-badge{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#26E0C2;color:#04100E;font:700 10px/1 "IBM Plex Mono",monospace;display:none;align-items:center;justify-content:center}.cp-notif.has-unread .cp-notif-badge{display:flex}'+
      '.cp-notif-dropdown{position:absolute;top:calc(100% + 8px);right:0;width:min(360px,calc(100vw - 24px));max-height:440px;overflow-y:auto;background:#0D121B;border:1px solid rgba(255,255,255,.14);border-radius:5px;box-shadow:0 14px 42px rgba(0,0,0,.55);z-index:100;padding:8px;text-align:left}.cp-notif-dropdown[hidden]{display:none}'+
      '.cp-notif-head{font:600 11px/1.2 "IBM Plex Mono",monospace;color:#8B96A8;letter-spacing:.12em;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between}.cp-notif-head a{color:#8B96A8;text-decoration:none;font-size:10px;letter-spacing:0}.cp-notif-head a:hover{color:#26E0C2}'+
      '.cp-notif-empty{padding:22px 10px;text-align:center;color:#5B6577;font-size:12.5px}.cp-notif-item{display:flex;gap:10px;padding:11px 12px;border:1px solid transparent;border-radius:4px;color:inherit;text-decoration:none;transition:.12s}.cp-notif-item:hover{background:rgba(38,224,194,.06);border-color:rgba(38,224,194,.22)}.cp-notif-item.unread{background:rgba(38,224,194,.035)}'+
      '.cp-notif-kind{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;margin-top:1px;background:#111722;color:#8B96A8;font-size:14px}.cp-notif-kind.reply{color:#6EA8FF}.cp-notif-kind.price_alert{color:#26E0C2}.cp-notif-kind.comment{color:#D8B84A}'+
      '.cp-notif-copy{min-width:0;flex:1}.cp-notif-title{font-size:13px;color:#E8EDF5;font-weight:650;line-height:1.35;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cp-notif-msg{font-size:12px;color:#8B96A8;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cp-notif-time{font:10.5px/1.2 "IBM Plex Mono",monospace;color:#5B6577;margin-top:5px}';
    document.head.appendChild(st);
  }

  function injectButton(){
    if(document.getElementById(IDS.btn)) return true;
    var login=document.querySelector('.cp-topbar-inner .cp-login-google');
    if(!login) return false;
    var btn=document.createElement('button');
    btn.type='button'; btn.className='cp-notif'; btn.id=IDS.btn;
    btn.setAttribute('aria-label','알림'); btn.setAttribute('aria-expanded','false');
    btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="cp-notif-badge" id="'+IDS.count+'">0</span><div class="cp-notif-dropdown" id="'+IDS.dd+'" hidden><div class="cp-notif-head"><span>알림</span><a href="#" id="'+IDS.mark+'">모두 읽음</a></div><div id="'+IDS.list+'"><div class="cp-notif-empty">알림이 없습니다</div></div></div>';
    login.parentNode.insertBefore(btn,login); return true;
  }

  function typeIcon(type){ if(type==='price_alert') return '↗'; if(type==='reply') return '↩'; return '●'; }
  function notificationView(n, actorMap){
    var type=n.type||'comment', actor=actorMap[n.actor_id]||'누군가', meta=n.metadata||{};
    var postTitle=(n.posts&&n.posts.title)||'게시글';
    var title='', msg='', href='/board';
    if(type==='price_alert'){
      title=meta.card_name||n.card_slug||'관심 카드 가격 알림';
      var bits=[];
      if(meta.price_krw!=null) bits.push(won(meta.price_krw));
      if(meta.change_pct!=null){ var c=Number(meta.change_pct); bits.push((c>0?'+':'')+c.toFixed(1)+'%'); }
      msg=bits.length ? bits.join(' · ')+' 변동 조건을 충족했습니다' : '설정한 가격 변동 조건을 충족했습니다';
      href=n.card_slug ? '/cards/'+encodeURIComponent(n.card_slug) : '/my#alerts';
    } else if(type==='reply'){
      title=postTitle; msg=actor+'님이 내 댓글에 답글을 남겼습니다';
      href=n.post_id ? '/board?post='+encodeURIComponent(n.post_id) : '/board';
    } else {
      title=postTitle; msg=actor+'님이 내 글에 댓글을 남겼습니다';
      href=n.post_id ? '/board?post='+encodeURIComponent(n.post_id) : '/board';
    }
    return {type:type,title:title,msg:msg,href:href};
  }

  async function updateBadge(){
    var btn=document.getElementById(IDS.btn); if(!btn) return;
    if(!STATE.user){ btn.style.display='none'; return; }
    btn.style.display='inline-flex';
    try{
      var res=await STATE.client.from('notifications').select('id',{count:'exact',head:true}).is('read_at',null);
      var cnt=Number(res.count||0), badge=document.getElementById(IDS.count);
      btn.classList.toggle('has-unread',cnt>0); if(badge) badge.textContent=cnt>99?'99+':String(cnt);
    }catch(_e){}
  }

  async function openDropdown(){
    var dd=document.getElementById(IDS.dd), list=document.getElementById(IDS.list), btn=document.getElementById(IDS.btn);
    if(!dd||!STATE.user||!STATE.client) return;
    dd.hidden=false; btn.setAttribute('aria-expanded','true'); list.innerHTML='<div class="cp-notif-empty">불러오는 중...</div>';
    try{
      var res=await STATE.client.from('notifications').select('id,type,actor_id,post_id,comment_id,card_slug,metadata,read_at,created_at,posts(title)').order('created_at',{ascending:false}).limit(30);
      var data=res.data||[]; if(!data.length){ list.innerHTML='<div class="cp-notif-empty">알림이 없습니다</div>'; return; }
      var ids=data.map(function(n){return n.actor_id;}).filter(Boolean).filter(function(v,i,a){return a.indexOf(v)===i;}), actorMap={};
      if(ids.length){ var pr=await STATE.client.from('profiles').select('id,display_name').in('id',ids); (pr.data||[]).forEach(function(p){actorMap[p.id]=p.display_name||'누군가';}); }
      list.innerHTML=data.map(function(n){ var v=notificationView(n,actorMap); return '<a href="'+v.href+'" class="cp-notif-item '+(n.read_at?'':'unread')+'" data-id="'+n.id+'"><span class="cp-notif-kind '+esc(v.type)+'">'+typeIcon(v.type)+'</span><span class="cp-notif-copy"><div class="cp-notif-title">'+esc(v.title)+'</div><div class="cp-notif-msg">'+esc(v.msg)+'</div><div class="cp-notif-time">'+relTime(n.created_at)+'</div></span></a>'; }).join('');
      list.querySelectorAll('.cp-notif-item').forEach(function(el){ el.addEventListener('click',function(){ try{ STATE.client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',el.getAttribute('data-id')).then(function(){}); }catch(_e){} }); });
    }catch(e){ console.warn('[cardpick notifications]',e); list.innerHTML='<div class="cp-notif-empty">알림 조회 실패</div>'; }
  }

  function closeDropdown(){ var dd=document.getElementById(IDS.dd), btn=document.getElementById(IDS.btn); if(dd) dd.hidden=true; if(btn) btn.setAttribute('aria-expanded','false'); }
  function bind(){
    document.addEventListener('click',function(e){
      var btn=document.getElementById(IDS.btn), dd=document.getElementById(IDS.dd); if(!btn||!dd) return;
      var mark=document.getElementById(IDS.mark);
      if(mark&&mark.contains(e.target)){ e.preventDefault(); e.stopPropagation(); if(STATE.client&&STATE.user) STATE.client.from('notifications').update({read_at:new Date().toISOString()}).is('read_at',null).then(function(){openDropdown();updateBadge();}); return; }
      if(btn.contains(e.target)&&!dd.contains(e.target)){ dd.hidden?openDropdown():closeDropdown(); }
      else if(!btn.contains(e.target)&&!dd.contains(e.target)) closeDropdown();
    });
  }

  async function waitAuth(ms){ var start=Date.now(); while(Date.now()-start<(ms||6000)){ if(window.cardpickAuth&&typeof window.cardpickAuth.getClient==='function'){ var c=window.cardpickAuth.getClient(); if(c) return c; } await new Promise(function(r){setTimeout(r,150);}); } return null; }
  async function init(){
    injectStyle(); if(!injectButton()) return; bind();
    var c=await waitAuth(6000); if(!c) return; STATE.client=c;
    try{
      var s=await c.auth.getSession(); STATE.user=s&&s.data&&s.data.session?s.data.session.user:null;
      c.auth.onAuthStateChange(function(_evt,sess){STATE.user=sess?sess.user:null;updateBadge();});
      updateBadge();
      setInterval(updateBadge,60000);
    }catch(_e){}
  }
  ready(init);
})();
