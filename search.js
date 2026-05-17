// 카드픽 — 카드 검색 (모든 페이지 공유)
(function () {
  function ready(cb) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cb);
    else cb();
  }
  function waitAuth(cb, tries) {
    if (tries === undefined) tries = 0;
    if (window.cardpickAuth && window.cardpickAuth.getClient()) return cb();
    if (tries > 50) return;
    setTimeout(function () { waitAuth(cb, tries + 1); }, 100);
  }

  // 검색바가 placeholder 텍스트로만 되어있는 페이지에 input element 자동 주입
  function ensureInput() {
    if (document.getElementById('cp-search')) return true;
    var bar = document.querySelector('.cp-search, .search');
    if (!bar) return false;
    // 컨테이너에 position 부여 (드롭다운 위치 잡으려고)
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.innerHTML =
      '<span aria-hidden="true" style="color:#8B96A8;font-family:\'IBM Plex Mono\',monospace;font-size:12px">⌕</span>'
      + '<input id="cp-search" type="search" placeholder="카드명, 세트 코드 검색" autocomplete="off" '
      + 'style="background:transparent;border:0;color:#E8EDF5;font-family:inherit;font-size:13px;outline:none;flex:1;padding:0 4px;min-width:0">'
      + '<kbd id="cp-search-kbd" style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#8B96A8;border:1px solid rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;margin-left:auto">⌘K</kbd>';
    var box = document.createElement('div');
    box.id = 'cp-search-results';
    box.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;max-height:480px;overflow-y:auto;background:#0D121B;border:1px solid rgba(255,255,255,0.14);border-radius:3px;box-shadow:0 8px 24px rgba(0,0,0,0.6);z-index:200;font-family:Pretendard,system-ui,sans-serif';
    bar.appendChild(box);
    return true;
  }

  ready(function () {
    if (!ensureInput()) return;
    var input = document.getElementById('cp-search');
    var box = document.getElementById('cp-search-results');
    if (!input || !box) return;

    var debounceTimer = null;
    var lastQuery = '';

    function gameStripStyle(g) {
      if (g === 'pokemon') return 'background:linear-gradient(180deg,#D8B84A,#8C6F1F)';
      if (g === 'onepiece') return 'background:linear-gradient(180deg,#FF4D6D,#7A2030)';
      return 'background:#26E0C2';
    }
    function rarityColor(rc) {
      var map = { SAR:'#F2C94C', SEC:'#FF4D6D', UR:'#9B8CE6', HR:'#FF7F50', AR:'#5FB0FF', VMAX:'#FF4D6D', HOLO:'#9CC2FF', PROMO:'#26E0C2', PARALLEL:'#9B8CE6' };
      return map[rc] || '#8B96A8';
    }
    function fmtKRW(n) {
      if (!n && n !== 0) return '';
      return '₩ ' + Math.round(n).toLocaleString('ko-KR');
    }
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
    }

    function close() {
      box.style.display = 'none';
      box.innerHTML = '';
    }

    // 클라이언트 정렬: 정확 매치 → 시작 일치 → 이름 길이 → popularity
    function sortByRelevance(cards, q) {
      var qL = q.toLowerCase();
      return cards.slice().sort(function (a, b) {
        var aN = (a.name || '').toLowerCase();
        var bN = (b.name || '').toLowerCase();
        var aExact = aN === qL;
        var bExact = bN === qL;
        if (aExact !== bExact) return aExact ? -1 : 1;
        var aStarts = aN.indexOf(qL) === 0;
        var bStarts = bN.indexOf(qL) === 0;
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        // 이름 짧은 것 우선 (메인 카드 = 짧은 이름)
        if (aN.length !== bN.length) return aN.length - bN.length;
        return (a.popularity_rank || 9999) - (b.popularity_rank || 9999);
      });
    }

    function render(rows) {
      if (!rows || !rows.length) {
        box.innerHTML = '<div style="padding:18px 14px;text-align:center;color:#8B96A8;font-size:12.5px;font-family:\'IBM Plex Mono\',monospace">결과 없음 · 영문/세트 코드로도 시도</div>';
        box.style.display = 'block';
        return;
      }
      box.innerHTML = rows.map(function (c) {
        var krw = c.price_krw ? fmtKRW(c.price_krw) : '<span style="color:#5B6577">시세 미수집</span>';
        var rc = c.rarity_class || 'OTHER';
        return '<a href="/cards/' + encodeURIComponent(c.slug) + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;text-decoration:none;color:inherit;border-bottom:1px solid rgba(255,255,255,0.05);transition:background .12s" onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseleave="this.style.background=\'\'">'
          + '<span style="width:3px;align-self:stretch;' + gameStripStyle(c.game) + ';border-radius:2px;flex:none"></span>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;color:#E8EDF5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">' + escapeHtml(c.name) + '</div>'
          + '<div style="font-size:10.5px;color:#8B96A8;font-family:\'IBM Plex Mono\',monospace;letter-spacing:.04em;margin-top:2px">'
            + escapeHtml((c.set_name || c.set_code || '').toUpperCase()) + ' · '
            + '<span style="color:' + rarityColor(rc) + '">' + escapeHtml(rc) + '</span>'
            + (c.number ? ' · #' + escapeHtml(c.number) : '')
          + '</div>'
          + '</div>'
          + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#26E0C2;flex:none;white-space:nowrap;text-align:right">' + krw + '</div>'
          + '</a>';
      }).join('');
      box.style.display = 'block';
    }

    async function search(q) {
      var c = window.cardpickAuth.getClient();
      if (!c) return;
      var pattern = '%' + q.replace(/[%_]/g, '\\$&') + '%';
      // 50건 조회 후 클라이언트에서 관련도 정렬
      var { data: cards, error } = await c.from('cards')
        .select('slug,name,name_en,game,set_name,set_code,number,rarity_class,popularity_rank')
        .or('name.ilike.' + pattern + ',name_en.ilike.' + pattern + ',external_id.ilike.' + pattern + ',set_code.ilike.' + pattern)
        .limit(50);
      if (error) { console.warn(error); return; }
      if (!cards || !cards.length) { render([]); return; }

      // 관련도 정렬 후 12장만
      cards = sortByRelevance(cards, q).slice(0, 12);

      // 가격 join
      var slugs = cards.map(function (x) { return x.slug; });
      var { data: prices } = await c.from('price_latest').select('card_slug,price_krw,price_market,variant').eq('source', 'tcgplayer').in('card_slug', slugs);
      var priceMap = {};
      (prices || []).forEach(function (p) {
        var rank = { normal:1, holofoil:2, reverseHolofoil:3, unlimitedHolofoil:4 };
        var existing = priceMap[p.card_slug];
        if (!existing || (rank[p.variant] || 9) < (rank[existing.variant] || 9)) {
          priceMap[p.card_slug] = p;
        }
      });
      cards.forEach(function (cd) { var p = priceMap[cd.slug]; if (p) cd.price_krw = p.price_krw; });
      render(cards);
    }

    function onInput() {
      var q = input.value.trim();
      if (q === lastQuery) return;
      lastQuery = q;
      clearTimeout(debounceTimer);
      if (q.length < 2) { close(); return; }
      box.innerHTML = '<div style="padding:14px;color:#8B96A8;font-size:12px;text-align:center;font-family:\'IBM Plex Mono\',monospace">검색 중...</div>';
      box.style.display = 'block';
      debounceTimer = setTimeout(function () { search(q); }, 200);
    }

    waitAuth(function () {
      input.addEventListener('input', onInput);
      input.addEventListener('focus', function () { if (input.value.trim().length >= 2) onInput(); });
      document.addEventListener('click', function (e) {
        var bar = input.closest('.cp-search, .search, .search-wrap');
        if (bar && !bar.contains(e.target)) close();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { close(); input.blur(); }
        if (e.key === 'Enter') {
          var first = box.querySelector('a');
          if (first) location.href = first.href;
        }
      });
      document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          input.focus();
        }
      });
    });
  });
})();
