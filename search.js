// 카드픽 공통 카드 검색. Query policy is lazy-loaded only after input.
(function () {
  function ready(cb) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cb);
    else cb();
  }
  var policyPromise;
  function loadPolicy() {
    if (!policyPromise) {
      policyPromise = import('/search-query.mjs?v=20261015').catch(function (error) {
        policyPromise = null; throw error;
      });
    }
    return policyPromise;
  }
  function ensureInput() {
    if (document.getElementById('cp-search')) return true;
    var bar = document.querySelector('.cp-search, .search');
    if (!bar) return false;
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.innerHTML =
      '<span aria-hidden="true" style="color:#8B96A8;font-family:\'IBM Plex Mono\',monospace;font-size:12px">⌕</span>'
      + '<input id="cp-search" type="search" aria-label="카드명 검색" placeholder="카드명, 세트 코드, 희귀도 검색" autocomplete="off" '
      + 'style="background:transparent;border:0;color:#E8EDF5;font-family:inherit;font-size:13px;flex:1;padding:0 4px;min-width:0">'
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
    var ownStyle = document.createElement('style');
    ownStyle.id = 'cp-search-ui-style';
    ownStyle.textContent = '#cp-search:focus-visible{outline:2px solid #26E0C2!important;outline-offset:3px}#cp-search-results a:focus-visible{outline:2px solid #26E0C2;outline-offset:-3px;background:rgba(38,224,194,0.08)}@media(max-width:980px){#cp-search{min-height:44px}#cp-search-results a{min-height:44px;box-sizing:border-box}}';
    document.head.appendChild(ownStyle);
    input.setAttribute('aria-label', '카드명 검색');
    input.setAttribute('aria-controls', 'cp-search-results');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', '카드 검색 결과');
    box.setAttribute('aria-live', 'polite');
    var debounceTimer = null, lastQuery = '', generation = 0, controller = null, composing = false, restoringFocus = false;
    function invalidate() {
      clearTimeout(debounceTimer);
      generation++;
      if (controller) controller.abort();
      controller = null;
    }
    function close() {
      invalidate(); lastQuery = '';
      box.style.display = 'none'; box.innerHTML = '';
    }
    function show() { box.style.display = 'block'; }
    function notice(text) {
      box.innerHTML = '<div style="padding:18px 16px;text-align:center;color:#8B96A8;font-size:12.5px">' + escapeHtml(text) + '</div>';
      show();
    }
    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
    }
    function rarityColor(rc) {
      return ({SAR:'#F2C94C',SEC:'#FF4D6D',UR:'#9B8CE6',HR:'#FF7F50',AR:'#5FB0FF',VMAX:'#FF4D6D',HOLO:'#9CC2FF',PROMO:'#26E0C2',PARALLEL:'#9B8CE6',LEADER:'#FF8DA6',SR:'#FF7F50'})[rc] || '#8B96A8';
    }
    function render(rows, totalCount, partial, candidateCount) {
      if (!rows.length) return notice('검색 결과가 없습니다. 카드명·세트 코드·번호를 다시 확인해 주세요.');
      var countLabel = totalCount == null ? '표시 ' + rows.length + '장' : '총 ' + totalCount + '건';
      var extra = totalCount > rows.length ? rows.length + '장 표시' : '';
      box.innerHTML = '<div style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.06);background:#0A0F17;font-size:11px;color:#8B96A8;display:flex;justify-content:space-between"><span>' + countLabel + '</span><span>' + extra + '</span></div>'
        + (candidateCount >= 200 ? '<div data-search-candidate-limit style="padding:10px 16px;color:#8B96A8;font-size:11px">최대 200장을 조회해 정렬합니다. 표시 순서는 조회한 카드 기준입니다.</div>' : '')
        + (partial ? '<div style="padding:10px 16px;color:#8B96A8;font-size:11px">가격 정보를 불러오지 못했습니다.</div>' : '')
        + rows.map(function (c) {
          var price = c.price_krw == null
            ? '<span style="color:#8B96A8;font-size:11px">참고가 산출 불가</span>'
            : '₩ ' + c.price_krw.toLocaleString('ko-KR') + (c.trust_level === 'LOW' ? '<span style="display:block;color:#F2C94C;font-size:10px">표본 부족</span>' : '');
          return '<a href="/cards/' + encodeURIComponent(c.slug) + '" style="display:flex;align-items:center;gap:10px;padding:12px 16px;text-decoration:none;color:inherit;border-bottom:1px solid rgba(255,255,255,0.05);transition:background .12s" onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseleave="this.style.background=\'\'">'
            + '<span style="width:3px;align-self:stretch;background:linear-gradient(180deg,#D8B84A,#8C6F1F);border-radius:2px;flex:none"></span>'
            + '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#E8EDF5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">'
            + escapeHtml(c.name) + (c.name_ko ? '<span style="color:#8B96A8;margin-left:6px;font-size:11.5px">' + escapeHtml(c.name_ko) + '</span>' : '')
            + '</div><div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#8B96A8;margin-top:2px">'
            + escapeHtml((c.set_name || c.set_code || '').toUpperCase()) + ' · <span style="color:' + rarityColor(c.rarity_class) + '">' + escapeHtml(c.rarity_class || 'OTHER') + '</span>'
            + (c.number ? ' · #' + escapeHtml(c.number) : '') + '</div></div>'
            + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#26E0C2;flex:none;text-align:right">' + price + '</div></a>';
        }).join('')
        + '<a href="/search?q=' + encodeURIComponent(lastQuery) + '" style="display:block;padding:12px 16px;color:#26E0C2;font-size:12px">검색 결과 보기</a>';
      show();
    }
    async function search(q, id) {
      var active = new AbortController(), timeout, policyLoad, policyReady = false, rejectCancelled;
      controller = active;
      var cancelled = new Promise(function (_, reject) { rejectCancelled = reject; });
      function onAbort() { rejectCancelled(new Error('search cancelled or timed out')); }
      active.signal.addEventListener('abort', onAbort, { once:true });
      // The same budget covers policy loading, SDK readiness, cards and trust.
      // Promise.race also bounds providers that ignore AbortSignal.
      timeout = setTimeout(function () { active.abort(); }, 6000);
      function bounded(promise) { return Promise.race([promise, cancelled]); }
      function waitClient() {
        return new Promise(function (resolve, reject) {
          var poll;
          function stop() { clearTimeout(poll); active.signal.removeEventListener('abort', abort); }
          function abort() { stop(); reject(new Error('search client wait cancelled')); }
          function check() {
            if (active.signal.aborted) return abort();
            try {
              var client = window.cardpickAuth && window.cardpickAuth.getClient();
              if (client) { stop(); resolve(client); return; }
              poll = setTimeout(check, 100);
            } catch (error) { stop(); reject(error); }
          }
          active.signal.addEventListener('abort', abort, { once:true });
          check();
        });
      }
      try {
        policyLoad = loadPolicy();
        var policy = await bounded(policyLoad);
        policyReady = true;
        if (id !== generation) return;
        var queryText = policy.planSearchQuery(q);
        if (!queryText.queryTokens.length) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }
        var client = await bounded(waitClient());
        if (id !== generation || active.signal.aborted) return;
        function filter(query) {
          queryText.queryTokens.forEach(function (token) {
            query = query.ilike('search_text', '%' + policy.escapeSearchToken(token) + '%');
          });
          return query.abortSignal(active.signal);
        }
        var queries = await bounded(Promise.all([
          filter(client.from('cards').select('slug', { count:'exact', head:true }).eq('game', 'pokemon')),
          filter(client.from('cards').select('slug,name,name_en,name_ko,game,set_name,set_code,number,rarity,rarity_class,popularity_rank,external_id').eq('game', 'pokemon').limit(200))
        ]));
        if (id !== generation) return;
        if (queries[1].error || !Array.isArray(queries[1].data)) throw new Error('card search failed');
        var cards = policy.sortSearchCards(queries[1].data, queryText.queryNormalized).slice(0, 50);
        var count = queries[0].error ? null : queries[0].count;
        if (!cards.length) { render([], 0, false); return; }
        var trustResult;
        try {
          trustResult = await bounded(client.from('card_price_trust').select('card_slug,trust_level,display_krw')
            .in('card_slug', cards.map(function (c) { return c.slug; })).abortSignal(active.signal));
        } catch (_) { trustResult = { error:true }; }
        if (active.signal.aborted) throw new Error('search deadline exceeded');
        if (id !== generation) return;
        var partial = !!trustResult.error || !Array.isArray(trustResult.data);
        var bySlug = Object.create(null);
        (partial ? [] : trustResult.data).forEach(function (t) { bySlug[t.card_slug] = t; });
        cards.forEach(function (c) {
          c.price_krw = policy.getTrustedSearchPrice(bySlug[c.slug]);
          c.trust_level = bySlug[c.slug] ? bySlug[c.slug].trust_level : 'NONE';
        });
        render(cards, count, partial, queries[1].data.length);
        // Local QA never writes production search logs or update requests.
        if (!partial && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
          fetch('/api/search-log', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ query:queryText.original, game:'pokemon', result_count:cards.length,
              has_price:cards.some(function (c) { return c.price_krw != null; }), matched_slug:cards[0].slug })
          }).catch(function () {});
        }
      } catch (_) {
        if (!policyReady && policyPromise === policyLoad) policyPromise = null;
        if (id === generation) { lastQuery = ''; notice('검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
      } finally {
        clearTimeout(timeout);
        active.signal.removeEventListener('abort', onAbort);
        if (id === generation) controller = null;
      }
    }
    function onInput(event) {
      if (restoringFocus || composing) return;
      if (event && event.isComposing) { close(); return; }
      var q = input.value.trim();
      if (q === lastQuery && box.style.display !== 'none') return;
      invalidate(); lastQuery = q;
      // Mew's official Korean name is a single syllable.
      if (q.length < 2 && q !== '뮤') { close(); return; }
      notice('검색 중...');
      var id = generation;
      debounceTimer = setTimeout(function () { search(q, id); }, 200);
    }
    // Listen before the SDK is available so early input and Enter are never lost.
      input.addEventListener('input', onInput);
      input.addEventListener('focus', onInput);
      input.addEventListener('compositionstart', function () { composing = true; close(); });
      input.addEventListener('compositionend', function () { composing = false; onInput(); });
      function closeOutside(e) {
        var bar = input.closest('.search-wrap') || input.closest('.cp-search, .search');
        if (bar && !bar.contains(e.target)) close();
      }
      document.addEventListener('click', closeOutside);
      document.addEventListener('focusin', closeOutside);
      input.addEventListener('keydown', function (e) {
        if (composing || e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') { close(); input.blur(); }
        if (e.key === 'Enter') {
          e.preventDefault();
          close();
          location.href = '/search?q=' + encodeURIComponent(input.value.trim());
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && box.contains(e.target)) {
          e.preventDefault(); close(); restoringFocus = true; input.focus(); restoringFocus = false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
      });
      if (input.value.trim()) onInput();
  });
})();
