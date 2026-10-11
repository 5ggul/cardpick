(function () {
  'use strict';

  if (window.__cpAdsInitialized) return;
  window.__cpAdsInitialized = true;

  function initAds() {
    var hostname = String(window.location.hostname || '').toLowerCase();
    var isProduction = hostname === 'cardpick.kr' || hostname === 'www.cardpick.kr';
    var isNarrow = window.matchMedia('(min-width: 320px)').matches === false;
    var pending = [];
    var loaderStarted = false;
    var loaderFailed = false;

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

    function startLoader(client) {
      if (loaderFailed) throw new Error('ad-loader-unavailable');
      if (loaderStarted) return;
      var heads = document.querySelectorAll('head');
      var templates = document.querySelectorAll('template[data-cp-ad-loader]');
      var template = templates[0];
      if (heads.length !== 1 || heads[0] !== document.head || templates.length !== 1 ||
          !template || template.tagName !== 'TEMPLATE' || !template.content ||
          !document.head.contains(template)) throw new Error('invalid-ad-loader-template');
      var sources = template.content.querySelectorAll('script');
      var source = sources[0];
      var expectedSrc = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + client;
      if (sources.length !== 1 || !source || source.tagName !== 'SCRIPT' ||
          source.getAttributeNames().length !== 3 || source.getAttribute('async') !== '' ||
          source.getAttribute('src') !== expectedSrc || source.getAttribute('crossorigin') !== 'anonymous' ||
          String(source.textContent || '').trim() !== '' ||
          document.head.querySelector('script[src*="/pagead/js/adsbygoogle.js"]')) {
        throw new Error('invalid-ad-loader-script');
      }
      // Copy the unchanged official snippet only when an eligible slot is near view.
      var loader = source.cloneNode(true);
      loader.addEventListener('error', function () {
        loaderFailed = true;
        pending.forEach(function (item) {
          if (item.slot.getAttribute('data-cp-ad-requested') === 'true') {
            item.wrapper.setAttribute('data-cp-ad-state', 'unavailable');
          }
        });
      }, { once: true });
      loaderStarted = true;
      document.head.appendChild(loader);
    }

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

      // The exact official loader and each slot are started once, with no retries.
      slot.setAttribute('data-cp-ad-requested', 'true');
      try {
        startLoader(slot.getAttribute('data-ad-client') || '');
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        wrapper.setAttribute('data-cp-ad-state', 'requested');
      } catch (error) {
        loaderFailed = true;
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
