(function () {
  'use strict';

  if (window.__cpAdsInitialized) return;
  window.__cpAdsInitialized = true;

  function initAds() {
    var hostname = String(window.location.hostname || '').toLowerCase();
    var isProduction = hostname === 'cardpick.kr' || hostname === 'www.cardpick.kr';
    var isNarrow = window.matchMedia('(min-width: 320px)').matches === false;

    document.querySelectorAll('aside.cp-ad[data-ad-placement]').forEach(function (wrapper) {
      var placement = wrapper.getAttribute('data-ad-placement');
      if (placement !== 'home' && placement !== 'guide-hub' && placement !== 'guide-body') return;

      var slot = wrapper.querySelector('ins.adsbygoogle');
      if (!slot) return;

      if (!isProduction) {
        wrapper.setAttribute('data-cp-ad-state', 'preview');
        if (!wrapper.querySelector('[data-cp-ad-preview-note]')) {
          var note = document.createElement('div');
          note.className = 'cp-ad-preview-note';
          note.setAttribute('data-cp-ad-preview-note', '');
          note.textContent = '로컬 배치 확인 · 실제 광고 요청 없음';
          wrapper.appendChild(note);
        }
        return;
      }

      // Never request a placement hidden below the supported width or retry after resizing.
      if (isNarrow) {
        wrapper.setAttribute('data-cp-ad-state', 'too-narrow');
        return;
      }

      if (slot.getAttribute('data-cp-ad-requested') === 'true' ||
          slot.getAttribute('data-adsbygoogle-status') ||
          slot.getAttribute('data-ad-status')) return;

      var client = slot.getAttribute('data-ad-client') || '';
      var slotId = slot.getAttribute('data-ad-slot') || '';
      if (!/^ca-pub-\d+$/.test(client) || !/^\d+$/.test(slotId)) {
        wrapper.setAttribute('data-cp-ad-state', 'unconfigured');
        return;
      }

      // Reuse the official async loader's queue. Each configured slot gets one push only.
      slot.setAttribute('data-cp-ad-requested', 'true');
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        wrapper.setAttribute('data-cp-ad-state', 'requested');
      } catch (error) {
        wrapper.setAttribute('data-cp-ad-state', 'unavailable');
      }
      // Blocked or unfilled ads keep their reserved area; late collapse would move content.
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds, { once: true });
  } else {
    initAds();
  }
})();
