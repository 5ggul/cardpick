/**
 * 카드픽 공용 공유 모듈 (cp-share.js)
 * - 모바일: Web Share API (네이티브 OS 시트)
 * - 데스크탑: Kakao SDK Share.sendDefault (PC 카톡 미리보기 카드)
 * - 폴백: 클립보드 URL 복사
 *
 * 사용:
 *   <script src="/cp-share.js" defer></script>
 *   <button onclick="cpShare()">[ 공유 ]</button>
 *   <button onclick="cpShareCopy()">[ 링크 복사 ]</button>
 *
 * 커스텀 메시지:
 *   cpShare({title, description, image, url, button}) — 옵션 전부 선택
 */
(function(){
  'use strict';

  // Kakao JavaScript Key — 도메인 화이트리스트로 보호 (공개 OK)
  var KAKAO_KEY = '4fb2c43520d7a1ea98b6491584872d22';
  var SDK_URL   = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';

  // Kakao SDK 로드 (1회) — onload 시 init
  function loadKakao(){
    if (window.Kakao && window.Kakao.isInitialized && window.Kakao.isInitialized()) return Promise.resolve(true);
    if (window.__cpKakaoLoading) return window.__cpKakaoLoading;
    window.__cpKakaoLoading = new Promise(function(resolve){
      var s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = function(){
        try {
          if (window.Kakao && !window.Kakao.isInitialized()) {
            window.Kakao.init(KAKAO_KEY);
          }
          resolve(true);
        } catch(e){ resolve(false); }
      };
      s.onerror = function(){ resolve(false); };
      document.head.appendChild(s);
    });
    return window.__cpKakaoLoading;
  }

  // 페이지 메타에서 기본값 추출
  function pageDefaults(){
    var get = function(sel){ var el = document.querySelector(sel); return el ? el.getAttribute('content') || el.textContent : ''; };
    var og  = function(p){ return get('meta[property="og:'+p+'"]') || get('meta[name="twitter:'+p+'"]'); };
    return {
      title:       og('title')       || document.title || '카드픽',
      description: og('description') || get('meta[name="description"]') || '',
      image:       og('image')       || 'https://cardpick.kr/og.jpg',
      url:         get('link[rel="canonical"]') || location.href
    };
  }

  function isMobile(){
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  /**
   * 통합 공유. 옵션 전부 선택. 옵션 없으면 페이지 메타 사용.
   */
  window.cpShare = async function(opts){
    var d = pageDefaults();
    opts = opts || {};
    var title       = opts.title       || d.title;
    var description = opts.description || d.description;
    var image       = opts.image       || d.image;
    var url         = opts.url         || d.url;
    var buttonLabel = opts.button      || '카드픽에서 보기';

    // 1순위: 모바일 Web Share API (네이티브 시트)
    if (isMobile() && navigator.share) {
      try {
        await navigator.share({
          title: title,
          text:  description,
          url:   url
        });
        return 'web-share';
      } catch(e){
        if (e && e.name === 'AbortError') return 'cancel';
        // 실패 → Kakao SDK 폴백
      }
    }

    // 2순위: Kakao SDK
    try {
      await loadKakao();
      if (window.Kakao && window.Kakao.Share) {
        window.Kakao.Share.sendDefault({
          objectType: 'feed',
          content: {
            title: title,
            description: description,
            imageUrl: image,
            link: { mobileWebUrl: url, webUrl: url }
          },
          buttons: [{
            title: buttonLabel,
            link: { mobileWebUrl: url, webUrl: url }
          }]
        });
        return 'kakao';
      }
    } catch(e){}

    // 3순위: URL 복사 폴백
    return cpShareCopy(url);
  };

  /**
   * URL 클립보드 복사.
   */
  window.cpShareCopy = async function(url){
    var u = url || pageDefaults().url || location.href;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(u);
        cpToast('링크 복사됨');
        return 'clipboard';
      }
      throw new Error('no-api');
    } catch(e){
      // fallback: textarea
      try {
        var ta = document.createElement('textarea');
        ta.value = u;
        ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        cpToast('링크 복사됨');
        return 'exec-copy';
      } catch(err){
        alert('복사 실패. URL: ' + u);
        return 'fail';
      }
    }
  };

  // 작은 토스트
  function cpToast(msg){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0D121B;color:#E8EDF5;border:1px solid rgba(38,224,194,0.5);padding:10px 18px;border-radius:3px;font-family:IBM Plex Mono,monospace;font-size:13px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.4)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.transition='opacity 0.3s'; t.style.opacity='0'; }, 1800);
    setTimeout(function(){ t.remove(); }, 2200);
  }
  window.cpToast = cpToast;

  // SDK 사전 로딩 (background) — 첫 클릭 지연 최소화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(loadKakao, 500); });
  } else {
    setTimeout(loadKakao, 500);
  }
})();
