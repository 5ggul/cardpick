(function () {
  'use strict';

  if (window.__cpAdsInitialized) return;
  window.__cpAdsInitialized = true;

  function initAds() {
    var hostname = String(window.location.hostname || '').toLowerCase();
    var isProduction = hostname === 'cardpick.kr' || hostname === 'www.cardpick.kr';
    var isNarrow = window.matchMedia('(min-width: 320px)').matches === false;
    var pending = [];

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

      wrapper.setAttribute('data-cp-ad-state', 'waiting');
      pending.push({ wrapper: wrapper, slot: slot });
    });

    function requestSlot(item) {
      var wrapper = item.wrapper;
      var slot = item.slot;
      // Recheck at request time in case the viewport or SDK status changed while waiting.
      if (window.matchMedia('(min-width: 320px)').matches === false) {
        wrapper.setAttribute('data-cp-ad-state', 'too-narrow');
        return;
      }
      if (slot.getAttribute('data-cp-ad-requested') === 'true' ||
          slot.getAttribute('data-adsbygoogle-status') ||
          slot.getAttribute('data-ad-status')) return;

      // Reuse the unchanged official async loader. Never reload or refresh an ad.
      slot.setAttribute('data-cp-ad-requested', 'true');
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        wrapper.setAttribute('data-cp-ad-state', 'requested');
      } catch (error) {
        wrapper.setAttribute('data-cp-ad-state', 'unavailable');
      }
      // Blocked or unfilled ads retain their reserved area to avoid late content shifts.
    }

    if (pending.length === 0) return;
    if (typeof window.IntersectionObserver === 'function') {
      var observer = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          pending.forEach(function (item) {
            if (item.wrapper !== entry.target) return;
            observer.unobserve(item.wrapper);
            requestSlot(item);
          });
        });
      }, { rootMargin: '300px 0px', threshold: 0 });
      pending.forEach(function (item) { observer.observe(item.wrapper); });
    } else {
      // Older browsers keep the existing one-shot request, after initial resources load.
      var requestPending = function () { pending.forEach(requestSlot); };
      if (document.readyState === 'complete') requestPending();
      else window.addEventListener('load', requestPending, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds, { once: true });
  } else {
    initAds();
  }
})();
