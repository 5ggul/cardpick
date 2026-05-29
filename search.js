// 카드픽 — 카드 검색 (모든 페이지 공유)
// 토큰 분할 검색 + 한국어 alias + 세트 alias + 희귀도 매칭
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

  function ensureInput() {
    if (document.getElementById('cp-search')) return true;
    var bar = document.querySelector('.cp-search, .search');
    if (!bar) return false;
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.innerHTML =
      '<span aria-hidden="true" style="color:#8B96A8;font-family:\'IBM Plex Mono\',monospace;font-size:12px">⌕</span>'
      + '<input id="cp-search" type="search" placeholder="카드명, 세트 코드, 희귀도 검색" autocomplete="off" '
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
      return 'background:#26E0C2';
    }
    function rarityColor(rc) {
      var map = { SAR:'#F2C94C', SEC:'#FF4D6D', UR:'#9B8CE6', HR:'#FF7F50', AR:'#5FB0FF', VMAX:'#FF4D6D', HOLO:'#9CC2FF', PROMO:'#26E0C2', PARALLEL:'#9B8CE6', LEADER:'#FF8DA6', SR:'#FF7F50' };
      return map[rc] || '#8B96A8';
    }
    function fmtKRW(n) { if (!n && n !== 0) return ''; return '₩ ' + Math.round(n).toLocaleString('ko-KR'); }
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
    }
    function close() { box.style.display = 'none'; box.innerHTML = ''; }

    // 토큰 분할 + 관련도 정렬
    function sortByRelevance(cards, q, tokens) {
      var qL = q.toLowerCase();
      return cards.slice().sort(function (a, b) {
        var aN = (a.name || '').toLowerCase();
        var bN = (b.name || '').toLowerCase();
        var aKo = (a.name_ko || '').toLowerCase();
        var bKo = (b.name_ko || '').toLowerCase();
        // 1. 이름 정확 일치 (영문/한글)
        var aExact = aN === qL || aKo === qL;
        var bExact = bN === qL || bKo === qL;
        if (aExact !== bExact) return aExact ? -1 : 1;
        // 2. 이름 시작 일치
        var aStarts = aN.indexOf(qL) === 0 || aKo.indexOf(qL) === 0;
        var bStarts = bN.indexOf(qL) === 0 || bKo.indexOf(qL) === 0;
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        // 3. 이름 길이 짧은 것 우선 (대표 카드)
        var aLen = Math.min(aN.length, aKo.length || 999);
        var bLen = Math.min(bN.length, bKo.length || 999);
        if (aLen !== bLen) return aLen - bLen;
        // 4. popularity
        return (a.popularity_rank || 9999) - (b.popularity_rank || 9999);
      });
    }

    function render(rows, q, totalCount) {
      if (!rows || !rows.length) {
        box.innerHTML = '<div style="padding:18px 14px;text-align:center;color:#8B96A8;font-size:12.5px;font-family:\'IBM Plex Mono\',monospace">결과 없음 · 영문/세트코드/희귀도로도 시도해주세요</div>';
        box.style.display = 'block';
        return;
      }
      var header = '<div style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);background:#0A0F17;font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8B96A8;display:flex;justify-content:space-between;align-items:center"><span>총 <span style="color:#26E0C2;font-weight:600">' + (totalCount || rows.length) + '</span>건</span>' + (totalCount > rows.length ? '<span>상위 ' + rows.length + '장 · 좁히려면 추가 키워드</span>' : '') + '</div>';
      box.innerHTML = header + rows.map(function (c) {
        var krw = c.price_krw ? fmtKRW(c.price_krw) : '<span style="color:#5B6577;font-size:11px">가격 미수집</span>';
        var rc = c.rarity_class || 'OTHER';
        // 영문판 카드 (TCGplayer 북미) — 영문명 primary, 한글 alias subtle
        var displayName = c.name + (c.name_ko ? '<span style="color:#5B6577;font-weight:400;margin-left:6px;font-size:11.5px">' + escapeHtml(c.name_ko) + '</span>' : '');
        var statusBadge = '';
        return '<a href="/cards/' + encodeURIComponent(c.slug) + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;text-decoration:none;color:inherit;border-bottom:1px solid rgba(255,255,255,0.05);transition:background .12s" onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseleave="this.style.background=\'\'">'
          + '<span style="width:3px;align-self:stretch;' + gameStripStyle(c.game) + ';border-radius:2px;flex:none"></span>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;color:#E8EDF5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">' + escapeHtml(c.name) + (c.name_ko ? '<span style="color:#5B6577;font-weight:400;margin-left:6px;font-size:11.5px">' + escapeHtml(c.name_ko) + '</span>' : '') + statusBadge + '</div>'
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

    // 포켓몬 한글 → 영문 매핑 (인기 100+종)
    // 사용자가 "리자몽" 입력 → "charizard" 으로 변환해 search_text 검색
    var KO_EN_MAP = {
      // 1세대 인기
      '리자몽':'charizard', '거북왕':'blastoise', '이상해꽃':'venusaur',
      '파이리':'charmander', '꼬부기':'squirtle', '이상해씨':'bulbasaur',
      '리자드':'charmeleon', '어니부기':'wartortle', '이상해풀':'ivysaur',
      '피카츄':'pikachu', '라이츄':'raichu', '뮤':'mew', '뮤츠':'mewtwo',
      '잠만보':'snorlax', '망나뇽':'dragonite', '미뇽':'dratini', '신뇽':'dragonair',
      '갸라도스':'gyarados', '잉어킹':'magikarp', '식스테일':'vulpix', '나인테일':'ninetales',
      '아보크':'arbok', '모래두지':'sandshrew', '고지':'sandslash',
      '나옹':'meowth', '페르시온':'persian', '독침붕':'beedrill', '버터플':'butterfree',
      '꼬렛':'rattata', '레트라':'raticate', '깨비참':'spearow', '깨비드릴조':'fearow',
      '아보':'ekans', '뚜벅쵸':'oddish', '냄새꼬':'gloom', '라플레시아':'vileplume',
      '파라스':'paras', '파라섹트':'parasect', '윙크':'venonat', '도나리':'venomoth',
      '디그다':'diglett', '닥트리오':'dugtrio', '나옹':'meowth',
      '고라파덕':'psyduck', '골덕':'golduck', '망키':'mankey', '성원숭':'primeape',
      '가디':'growlithe', '윈디':'arcanine', '발챙이':'poliwag', '슈륙챙이':'poliwhirl',
      '강챙이':'poliwrath', '캐이시':'abra', '윤겔라':'kadabra', '후딘':'alakazam',
      '알통몬':'machop', '근육몬':'machoke', '괴력몬':'machamp',
      '모다피':'bellsprout', '우츠동':'weepinbell', '우츠보트':'victreebel',
      '왕눈해':'tentacool', '독파리':'tentacruel', '꼬마돌':'geodude',
      '데구리':'graveler', '딱구리':'golem', '포니타':'ponyta', '날쌩마':'rapidash',
      '야돈':'slowpoke', '야도란':'slowbro', '코일':'magnemite', '레어코일':'magneton',
      '파오리':'farfetchd', '두두':'doduo', '두트리오':'dodrio',
      '쥬쥬':'seel', '쥬레곤':'dewgong', '질퍽이':'grimer', '질뻐기':'muk',
      '셀러':'shellder', '파르셀':'cloyster', '고오스':'gastly', '고우스트':'haunter', '팬텀':'gengar',
      '롱스톤':'onix', '슬리프':'drowzee', '슬리퍼':'hypno', '크랩':'krabby', '킹크랩':'kingler',
      '찌리리공':'voltorb', '붐볼':'electrode', '아라리':'exeggcute', '나시':'exeggutor',
      '탕구리':'cubone', '텅구리':'marowak', '시라소몬':'hitmonlee', '홍수몬':'hitmonchan',
      '내루미':'lickitung', '또가스':'koffing', '또도가스':'weezing',
      '뿔카노':'rhyhorn', '코뿌리':'rhydon', '럭키':'chansey', '덩쿠리':'tangela',
      '캥카':'kangaskhan', '쏘드라':'horsea', '시드라':'seadra', '콘치':'goldeen', '왕콘치':'seaking',
      '별가사리':'staryu', '아쿠스타':'starmie', '마임맨':'mr-mime', '스라크':'scyther',
      '루주라':'jynx', '에레브':'electabuzz', '마그마':'magmar', '쁘사이저':'pinsir',
      '켄타로스':'tauros', '메타몽':'ditto', '이브이':'eevee',
      '샤미드':'vaporeon', '쥬피썬더':'jolteon', '부스터':'flareon',
      '폴리곤':'porygon', '암나이트':'omanyte', '암스타':'omastar',
      '투구':'kabuto', '투구푸스':'kabutops', '프테라':'aerodactyl',
      '프리져':'articuno', '썬더':'zapdos', '파이어':'moltres', '루기아':'lugia', '칠색조':'ho-oh',
      // 인기 ex/V/VMAX/이브이 진화형
      '에브이':'eevee', '에이브이':'eevee',
      '님피아':'sylveon', '리피아':'leafeon', '글레이시아':'glaceon',
      '블래키':'umbreon', '에브이':'eevee', '에브이':'eevee',
      '샤미드':'vaporeon', '쥬피썬더':'jolteon', '부스터':'flareon', '에브이':'eevee',
      '에피':'espeon', '블래키':'umbreon',
      // 메가
      '메가리자몽':'mega charizard', '메가팬텀':'mega gengar',
      '메가입치트':'mega mawile', '메가갸라도스':'mega gyarados',
      // 6세대+
      '제라오라':'zeraora', '미뇽':'dratini', '코라이돈':'koraidon', '미라이돈':'miraidon',
      '루카리오':'lucario', '리오르':'riolu',
      // 한자식
      '캐터피':'caterpie', '단데기':'metapod', '뿔충이':'weedle', '딱충이':'kakuna',
      '구구':'pidgey', '피죤':'pidgeotto', '피죤투':'pidgeot'
    };

    function translateKorean(q) {
      // 한글 토큰을 영문으로 변환 (혹시 일부만 매칭되면 그것만 변환)
      var lower = q.toLowerCase().trim();
      if (KO_EN_MAP[lower]) return KO_EN_MAP[lower];
      // 부분 매칭 — 한글 키 중 q에 포함된 게 있으면 그 영문으로 변환
      for (var ko in KO_EN_MAP) {
        if (q.indexOf(ko) !== -1) {
          return q.replace(ko, KO_EN_MAP[ko]);
        }
      }
      return q;
    }

    async function search(q) {
      var c = window.cardpickAuth.getClient();
      if (!c) return;

      // 한글 → 영문 변환 시도
      var qOriginal = q;
      q = translateKorean(q);

      // 토큰 분할
      var tokens = q.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 0; });
      if (!tokens.length) return;

      // 1) 총 개수 count
      var countQuery = c.from('cards').select('slug', { count: 'exact', head: true }).eq('game', 'pokemon');
      tokens.forEach(function (t) {
        countQuery = countQuery.ilike('search_text', '%' + t.replace(/[%_]/g, '\\$&') + '%');
      });
      var { count: totalCount } = await countQuery;

      // 2) 상위 50건 fetch
      var query = c.from('cards')
        .select('slug,name,name_en,name_ko,game,set_name,set_code,number,rarity,rarity_class,popularity_rank,external_id')
        .eq('game', 'pokemon')  // MVP: 포켓몬만
        .limit(200);  // 정렬 위해 충분히
      tokens.forEach(function (t) {
        query = query.ilike('search_text', '%' + t.replace(/[%_]/g, '\\$&') + '%');
      });
      var { data: cards, error } = await query;
      if (error) { console.warn(error); return; }
      if (!cards || !cards.length) { render([], q, 0); return; }

      cards = sortByRelevance(cards, q, tokens).slice(0, 50);

      // 가격 join
      var slugs = cards.map(function (x) { return x.slug; });
      var { data: prices } = await c.from('price_latest').select('card_slug,price_krw,price_market,variant').eq('source', 'tcgplayer').in('card_slug', slugs);
      var priceMap = {};
      (prices || []).forEach(function (p) {
        var rank = { normal:1, holofoil:2, reverseHolofoil:3, unlimitedHolofoil:4 };
        var existing = priceMap[p.card_slug];
        if (!existing || (rank[p.variant] || 9) < (rank[existing.variant] || 9)) priceMap[p.card_slug] = p;
      });
      cards.forEach(function (cd) { var p = priceMap[cd.slug]; if (p) cd.price_krw = p.price_krw; });
      render(cards, q, totalCount != null ? totalCount : cards.length);

      // 검색 로그 송신 (debounce 끝난 실 검색만)
      try {
        var topSlug = cards.length ? cards[0].slug : null;
        var hasPrice = cards.some(function(cd){ return !!cd.price_krw; });
        fetch('/api/search-log', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            query: q, game: 'pokemon',
            result_count: cards.length, has_price: hasPrice,
            matched_slug: topSlug
          })
        }).catch(function(){});
      } catch(e) {}
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
