(function(){
  var CARDS = {};

  // slug 추출 — SSR이 주입한 window.CARDPICK_SLUG 우선, URL 패턴 fallback
  var m = location.pathname.match(/\/cards?\/([^\/?]+)/);
  var slug = window.CARDPICK_SLUG || (m && m[1]) || new URLSearchParams(location.search).get('slug');
  if (!slug) {
    // slug 없으면 카드 페이지 자체가 의미 없음 → 홈으로
    location.replace('/');
    return;
  }
  // 옛 슬러그 redirect는 functions/cards/[slug].js (SSR) 가 301 응답으로 처리.
  // client-side fallback 불필요.
  var SLUG_REMAP = {};
  var card;
  var isDbCard = false;
  if (CARDS[slug]) {
    card = CARDS[slug];
  } else {
    // 동적 카드 — 일단 placeholder, DB fetch 후 채움
    card = {
      name: decodeURIComponent(slug).replace(/-/g,' ').replace(/\b\w/g, function(c){return c.toUpperCase()}),
      name_en: slug, subtitle: '카드 상세 정보',
      game: 'pokemon', game_label: '포켓몬', game_full: '포켓몬 카드 게임',
      set_jp: '—', set_jp_code: '—', set_jp_slug: '',
      set_en: '—', set_en_short: '—',
      rarity: 'OTHER', rarity_full: '—', rarity_color: '#8B96A8',
      type: '—',
      about: '이 카드의 상세 정보를 데이터베이스에서 가져오고 있습니다.',
      __pending: true
    };
    isDbCard = true;
  }
  card.slug = slug;
  // watchlist runtime
  window.__CARDPICK_CARD__ = window.__CARDPICK_CARD__ || { runtime: { slug: slug, name: card.name, set: card.set_jp, game: card.game } };

  // DB에서 카드 정보 가져오기 (any slug)
  async function fetchCardFromDb(slug) {
    if (!window.cardpickAuth) return null;
    var c = window.cardpickAuth.getClient();
    if (!c) return null;
    var { data, error } = await c.from('cards').select('*').eq('slug', slug).maybeSingle();
    if (error || !data) return null;
    return data;
  }
  function fmtKRW(n) { return '₩ ' + Math.round(n).toLocaleString('ko-KR'); }
  function rarityColorMap(rc) {
    var m = { SAR:'#F2C94C', SEC:'#FF4D6D', UR:'#9B8CE6', HR:'#FF7F50', AR:'#5FB0FF', VMAX:'#FF4D6D', HOLO:'#9CC2FF', PROMO:'#26E0C2', PARALLEL:'#9B8CE6' };
    return m[rc] || '#8B96A8';
  }

  // DB 카드 → card 객체 (영문판 카드 — 영문명 primary)
  function dbCardToCard(db) {
    return {
      name: db.name,
      name_ko_alias: db.name_ko || '',
      name_en: db.name_en || db.name,
      subtitle: (db.set_name || '—') + ' · ' + (db.rarity || db.rarity_class || '—'),
      game: db.game,
      game_label: '포켓몬',
      game_full: '포켓몬 카드 게임',
      set_jp: db.set_name || '—',
      set_jp_code: db.set_code || '—',
      set_jp_slug: db.set_id || '',
      set_en: db.set_name || '—',
      set_en_short: db.set_code || '—',
      rarity: db.rarity_class || 'OTHER',
      rarity_full: db.rarity || db.rarity_class || '—',
      rarity_color: rarityColorMap(db.rarity_class),
      type: db.type || '',
      supertype: db.supertype || '',
      subtypes: Array.isArray(db.subtypes) ? db.subtypes : [],
      number: db.number || '—',
      artist: db.artist || '',
      hp: db.hp ? String(db.hp) : '',
      about: '포켓몬 카드 ' + db.name + (db.name_ko ? ' (한국어 ' + db.name_ko + ')' : '') + (db.set_name ? ' · ' + db.set_name : '') + ' 영문판 정보입니다. 가격은 TCGplayer 북미 기준 해외 참고가이며 국내 거래가와 다를 수 있습니다.',
    };
  }

  function setAttr(sel, attr, val){ var el = document.querySelector(sel); if (el && el.getAttribute(attr) !== String(val)) el.setAttribute(attr, val); }
  function setText(selOrEl, txt){ var el = (typeof selOrEl === 'string') ? document.querySelector(selOrEl) : selOrEl; if (el && el.textContent !== String(txt)) el.textContent = txt; }
  function gameChipColor(g){
    if (g === 'pokemon') return { color:'#D8B84A', border:'rgba(216,184,74,0.4)', cls:'chip-pokemon' };
    // MVP는 포켓몬 전용
    return { color:'#8B96A8', border:'rgba(255,255,255,0.1)', cls:'' };
  }

  function apply(){
    // ★ 2026-08-19 외부 검수 P1-09: title/description/canonical/og 는 SSR([slug].js) 이 이미
    //   카드 고유값으로 정확하게 세팅함. 클라이언트 JS 가 덮어쓰면 SSR/CSR 정합성 깨져
    //   Google 크롤러가 보는 title 과 실제 렌더 결과가 달라 SEO 신호 손상.
    //   따라서 여기서는 meta 재설정 없이 SSR 값을 그대로 유지.
    //   (참고: canonical 은 SSR 이 `https://cardpick.kr/cards/${slug}` 로 이미 설정)

    // 본문 요소
    document.querySelectorAll('[data-c-name]').forEach(function(el){
      if (el.tagName === 'H1' && card.name_ko_alias) {
        el.innerHTML = card.name + ' <span style="font-size:.55em;color:#8B96A8;font-weight:500;margin-left:8px;letter-spacing:0">' + card.name_ko_alias + '</span>';
      } else {
        setText(el, card.name);
      }
    });
    document.querySelectorAll('[data-c-subtitle]').forEach(function(el){ setText(el, card.subtitle); });
    if (!window.CARDPICK_PRICE_DISPLAY) document.querySelectorAll('[data-c-about]').forEach(function(el){ setText(el, card.about); });
    document.querySelectorAll('[data-c-info-h2]').forEach(function(el){ setText(el, card.name + ' 카드 정보'); });
    document.querySelectorAll('[data-c-game-name]').forEach(function(el){ setText(el, card.game_full); });
    document.querySelectorAll('[data-c-set-jp]').forEach(function(el){ setText(el, card.set_jp); });
    document.querySelectorAll('[data-c-set-en]').forEach(function(el){ setText(el, card.set_en); });
    document.querySelectorAll('[data-c-rarity-full]').forEach(function(el){ setText(el, card.rarity_full); });
    // 타입 영→한 매핑 (Pokemon TCG 공식 11종)
    var TYPE_KO = {
      'Grass':'풀', 'Fire':'불꽃', 'Water':'물', 'Lightning':'번개',
      'Psychic':'초', 'Fighting':'격투', 'Darkness':'악',
      'Metal':'강철', 'Dragon':'드래곤', 'Fairy':'페어리', 'Colorless':'무색'
    };
    var supertype = String(card.supertype || '').trim();
    var isPokemon = supertype === 'Pokémon' || supertype === 'Pokemon' || (!supertype && !!String(card.type || '').trim());
    var SUPERTYPE_KO = { 'Pokémon':'포켓몬', 'Pokemon':'포켓몬', 'Trainer':'트레이너', 'Energy':'에너지' };
    document.querySelectorAll('[data-c-type]').forEach(function(el){
      var t = String(card.type || '').trim();
      setText(el, TYPE_KO[t] || t);
    });
    document.querySelectorAll('[data-c-type-row]').forEach(function(el){ el.hidden = !isPokemon || !String(card.type || '').trim(); });
    document.querySelectorAll('[data-c-card-class]').forEach(function(el){ setText(el, SUPERTYPE_KO[supertype] || supertype); });
    document.querySelectorAll('[data-c-card-class-row]').forEach(function(el){ el.hidden = !supertype; });
    document.querySelectorAll('[data-c-set-code-jp]').forEach(function(el){ setText(el, card.set_jp_code); });
    document.querySelectorAll('[data-c-set-en-short]').forEach(function(el){ setText(el, card.set_en_short); });
    document.querySelectorAll('[data-c-name-en]').forEach(function(el){ setText(el, card.name_en || '—'); });
    document.querySelectorAll('[data-c-number]').forEach(function(el){ setText(el, card.number || '—'); });
    document.querySelectorAll('[data-c-artist]').forEach(function(el){ setText(el, card.artist || '정보 없음'); });
    document.querySelectorAll('[data-c-hp]').forEach(function(el){ setText(el, card.hp ? card.hp + ' HP' : ''); });
    document.querySelectorAll('[data-c-hp-row]').forEach(function(el){ el.hidden = !card.hp; });

    // 빵부스러기 set 링크
    var setLink = document.querySelector('[data-c-set-link]');
    if (setLink){ setText(setLink, card.set_jp); setLink.href = '/sets/' + card.set_jp_slug; }

    // 칩 (게임·레어도·세트)
    var gc = gameChipColor(card.game);
    document.querySelectorAll('[data-c-game-chip]').forEach(function(el){
      el.className = 'chip ' + gc.cls;
      setText(el, card.game_label);
      if (!gc.cls){ el.style.color = gc.color; el.style.borderColor = gc.border; }
    });
    document.querySelectorAll('[data-c-rarity-chip]').forEach(function(el){
      setText(el, card.rarity);
      el.style.color = card.rarity_color;
      el.style.borderColor = card.rarity_color.replace('#','rgba(0,0,0,0.4)');  // 단순 처리
      // 실제 RGBA로
      var c = card.rarity_color.replace('#','');
      var r=parseInt(c.substr(0,2),16), g=parseInt(c.substr(2,2),16), b=parseInt(c.substr(4,2),16);
      el.style.borderColor = 'rgba(' + r + ',' + g + ',' + b + ',0.45)';
    });
    // ★ 2026-08-19 외부 검수 P0-05: 영문 카드에 '일본판' 하드코딩 표시하던 버그 수정.
    //   카드픽 스코프는 영문 Pokemon TCG. SSR 은 이미 '영문판' 세팅. JS 가 덮어쓰지 않도록 정정.
    document.querySelectorAll('[data-c-set-chip]').forEach(function(el){
      setText(el, card.set_en_short + ' · 영문판');
    });

    // Breadcrumb JSON-LD 재생성
    var ldBc = document.getElementById('ld-bc');
    if (ldBc){
      ldBc.textContent = JSON.stringify({
        "@context":"https://schema.org",
        "@type":"BreadcrumbList",
        "itemListElement":[
          {"@type":"ListItem","position":1,"name":"카드픽","item":"https://cardpick.kr/"},
          {"@type":"ListItem","position":2,"name":card.game_label,"item":"https://cardpick.kr/"+card.game},
          {"@type":"ListItem","position":3,"name":card.set_jp,"item":"https://cardpick.kr/sets/"+card.set_jp_slug},
          {"@type":"ListItem","position":4,"name":card.name,"item":canonicalUrl}
        ]
      });
    }
  }

  // eBay 거래완료 링크 — 포켓몬 카드 전용 검색어 (Codex 권장)
  // sold는 검색어에 넣지 않고 LH_Sold=1&LH_Complete=1 필터로만 처리.
  // 1순위: Pokemon + 영문명 + 전체 카드번호 (예: 'Pokemon Seaking 21/109')
  // 2순위(번호 없을 때): Pokemon + 영문명 + 세트명
  function setEbayLink() {
    var ebayLink = document.getElementById('ebay-search-link');
    if (!ebayLink) return;
    var ssr = window.CARDPICK_CARD || {};
    var name = ssr.name_en || ssr.name || card.name_en || card.name || slug.replace(/-/g, ' ');
    var num = ssr.number || card.number || '';
    var setName = ssr.set_name || card.set_name || '';
    var parts = ['Pokemon', name];
    if (num) {
      parts.push(String(num).trim());  // '21/109' 그대로 — eBay 제목 매칭 정확
    } else if (setName) {
      parts.push(String(setName).replace(/&/g, ' ').trim());
    }
    var q = encodeURIComponent(parts.filter(Boolean).join(' '));
    ebayLink.href = 'https://www.ebay.com/sch/i.html?_nkw=' + q + '&LH_Sold=1&LH_Complete=1';
  }

  async function paintLivePrice(){
    setEbayLink();  // 즉시 set
    // auth.js 로딩 대기
    for (var i = 0; i < 40; i++) {
      if (window.cardpickAuth && window.cardpickAuth.getClient()) break;
      await new Promise(function(r){ setTimeout(r, 100); });
    }
    if (!window.cardpickAuth || !window.cardpickAuth.getClient()) return;

    // DB 조회 — 항상 시도 (hardcoded 카드도 number/artist/hp 메타 보강)
    var db = await fetchCardFromDb(slug);
    if (db) {
      card = dbCardToCard(db);
      card.slug = slug;
      window.__CARDPICK_CARD__.runtime.name = card.name;
      window.__CARDPICK_CARD__.runtime.set = card.set_jp;
      window.__CARDPICK_CARD__.runtime.game = card.game;
      apply();
      setEbayLink();  // DB에서 영문명 받은 후 다시 set
    } else if (isDbCard) {
      // DB에도 없는 unknown slug
      document.querySelectorAll('[data-c-name]').forEach(function(el){ el.textContent = '카드를 찾을 수 없습니다'; });
      document.querySelectorAll('[data-c-subtitle]').forEach(function(el){ el.textContent = '데이터베이스에 해당 카드가 없습니다. 검색에서 다시 찾아주세요.'; });
      return;
    }

    // 가격은 아래 공통 표시 계약에서 한 번만 갱신한다.
  }
  function escapeHtmlSimple(s){ return String(s||'').replace(/[<>&]/g, function(c){return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c];}); }
  function formatTime(iso){
    if (!iso) return '—';
    var d = new Date(iso); var now = Date.now();
    var diff = Math.floor((now - d.getTime())/1000);
    if (diff < 3600) return Math.floor(diff/60) + '분 전';
    if (diff < 86400) return Math.floor(diff/3600) + '시간 전';
    return Math.floor(diff/86400) + '일 전';
  }

  // ============ 관련 게시글 (DB에서 카드명 매칭) ============
  async function loadRelatedPosts(){
    var c = window.cardpickAuth && window.cardpickAuth.getClient();
    var el = document.getElementById('related-posts');
    if (!el) return;
    if (!c) { el.innerHTML = '<div class="mono text-[12px] text-muted text-center py-8">—</div>'; return; }
    try {
      var name = card.name || '';
      // 카드명 첫 단어(한글/영문)로 검색
      var keyword = name.split(/[\s·\(]/)[0] || name;
      if (keyword.length < 2) keyword = name;
      var pattern = '%' + keyword.replace(/[%_]/g, '\\$&') + '%';
      var { data: posts } = await c.from('posts')
        .select('id,title,board,comments_count,likes,created_at')
        .or('title.ilike.' + pattern + ',body.ilike.' + pattern)
        .order('created_at', { ascending: false })
        .limit(5);
      if (!posts || !posts.length){
        el.innerHTML = '<div class="mono text-[12px] text-muted text-center py-8">관련 게시글이 없습니다. <a href="/board" class="underline-mint text-ink hover:text-brand pb-0.5">게시판에서 첫 글 작성 →</a></div>';
        return;
      }
      var chipMap = { free:['자유','#26E0C2'], qna:['질문','#F2C94C'], trade:['거래','#12D6B0'], show:['후기','#FF4D6D'], meta:['메타','#9B8CE6'] };
      function relTime(iso){ var d=new Date(iso),s=Math.floor((Date.now()-d.getTime())/1000);
        if (s<60) return '방금'; if (s<3600) return Math.floor(s/60)+'분'; if (s<86400) return Math.floor(s/3600)+'시간';
        if (s<86400*7) return Math.floor(s/86400)+'일'; return d.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'}); }
      el.innerHTML = '<ul class="divide-y divide-line">' + posts.map(function(p){
        var ch = chipMap[p.board] || ['기타','#8B96A8'];
        return '<li><a href="/board?post='+p.id+'" class="grid grid-cols-[60px_1fr_auto] md:grid-cols-[60px_1fr_60px_60px_60px] items-center gap-4 py-3 hover:bg-panel2" style="text-decoration:none;color:inherit">'
          + '<span class="chip" style="color:'+ch[1]+';border-color:'+ch[1]+';justify-self:center">'+ch[0]+'</span>'
          + '<span class="text-[14px]">'+escapeHtmlSimple(p.title)+'</span>'
          + '<span class="hidden md:block mono text-[12px] text-muted text-right">댓 '+(p.comments_count||0)+'</span>'
          + '<span class="hidden md:block mono text-[12px] text-muted text-right">♥ '+(p.likes||0)+'</span>'
          + '<span class="mono text-[12px] text-muted text-right">'+relTime(p.created_at)+'</span>'
          + '</a></li>';
      }).join('') + '</ul>';
    } catch (e) {
      console.warn('related posts', e);
      el.innerHTML = '<div class="mono text-[12px] text-muted text-center py-8">—</div>';
    }
  }

  // ============ 가격 추이 차트 (Cardmarket 평균 → KRW 환산) ============
  async function loadRealPriceChart(){
    // 차트 폐기 — Cardmarket data stale로 misleading. Hero(TCGplayer) 단일 출처.
    return;
    var SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
    var KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
    try {
      // 1) Cardmarket 평균 + 2) TCGCSV summary (환율 산출용) 병렬 fetch
      var [mvRes, sumRes] = await Promise.all([
        fetch(SUPA + '/rest/v1/price_metrics_external?card_slug=eq.' + encodeURIComponent(slug) + '&source=eq.pokemontcg-cardmarket&select=ext_avg_24h,ext_avg_7d,ext_avg_14d,ext_avg_30d,ext_updated_at', {headers:{apikey:KEY}}),
        fetch(SUPA + '/rest/v1/card_price_summary_best?card_slug=eq.' + encodeURIComponent(slug) + '&select=latest_krw,latest_usd&limit=1', {headers:{apikey:KEY}})
      ]);
      var rows = await mvRes.json();
      var sumRows = sumRes.ok ? await sumRes.json() : [];
      if (!Array.isArray(rows) || !rows.length) {
        // 차트 영역 자체를 줄여서 빈 공간 최소화
        var section = document.querySelector('#price-chart');
        if (section) {
          section.style.height = '120px';
          var volEl2 = document.getElementById('volume-chart');
          if (volEl2) volEl2.style.display = 'none';
          // 헤더 영역도 안내문으로 변경
          var h2 = document.querySelector('h2.h2');
          // chart section h2를 찾아서 변경
        }
        showEmptyChart('이 카드는 EU Cardmarket 거래 데이터 없음', 'TCGplayer 북미 단일 평균가만 표시됩니다 (위 박스 참고)');
        return;
      }
      var m = rows[0];

      // 환율 산출: USD→KRW (TCGCSV 비율) × EUR→USD (1.08 명시)
      var usdToKrw = 1381; // 명시 환율 (페이지 상단 배너와 일치)
      var s = sumRows[0];
      if (s && s.latest_usd && s.latest_krw && Number(s.latest_usd) > 0) {
        usdToKrw = Number(s.latest_krw) / Number(s.latest_usd);
      }
      var eurToUsd = 1.08; // 명시 환율
      var eurToKrw = usdToKrw * eurToUsd;

      // 4-포인트 시계열: 30일 전 → 14일 전 → 7일 전 → 어제 (KRW 환산)
      var today = new Date();
      function dateStr(daysAgo) {
        var d = new Date(today); d.setDate(d.getDate() - daysAgo);
        return d.toISOString().slice(0, 10);
      }
      var rawPoints = [
        { daysAgo: 30, v: m.ext_avg_30d },
        { daysAgo: 14, v: m.ext_avg_14d },
        { daysAgo: 7,  v: m.ext_avg_7d  },
        { daysAgo: 1,  v: m.ext_avg_24h }
      ];
      var clean = rawPoints
        .filter(function(p){ return p.v != null; })
        .map(function(p){ return { time: dateStr(p.daysAgo), value: Math.round(Number(p.v) * eurToKrw) }; });

      if (clean.length < 2) {
        showEmptyChart('Cardmarket 평균가 추이 데이터 부족', '7일 이상 누적 후 차트 활성화');
        return;
      }

      function applyChartData(){
        var h = window.cardpickChart;
        if (h && typeof h.setData === 'function') {
          window.cardpickChartData = clean;
          // KRW 단위로 priceFormat
          if (h.areaSeries && h.areaSeries.applyOptions) {
            h.areaSeries.applyOptions({
              priceFormat: { type: 'price', precision: 0, minMove: 100 }
            });
          }
          return h.setData(clean);
        }
        return false;
      }
      if (!applyChartData()) {
        window.addEventListener('cardpick:chart-ready', applyChartData, { once: true });
        var tries = 0;
        var iv = setInterval(function(){
          if (applyChartData() || ++tries >= 8) clearInterval(iv);
        }, 250);
      }

      // 안내문: 출처·환율·갱신일 명시 (mock 의심 해소)
      var section = document.getElementById('price-chart');
      if (section) {
        var noticeWrap = document.querySelector('.real-data-notice');
        if (!noticeWrap) {
          noticeWrap = document.createElement('div');
          noticeWrap.className = 'real-data-notice';
          noticeWrap.style.cssText = 'margin-top:8px;font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8B96A8';
          var upd = m.ext_updated_at ? String(m.ext_updated_at).slice(0,10) : '—';
          noticeWrap.textContent = 'Cardmarket EU 평균가 (30/14/7/24h) · KRW 환산 (USD/KRW ' + Math.round(usdToKrw).toLocaleString() + ', EUR/USD 1.08) · 갱신 ' + upd;
          section.parentElement.appendChild(noticeWrap);
        }
      }
    } catch (e) { console.warn('chart', e); showEmptyChart('차트 로드 실패', e.message || ''); }
  }

  function showEmptyChart(title, sub){
    var priceEl2 = document.getElementById('price-chart');
    if (!priceEl2) return;
    priceEl2.dataset.replaced = '1';
    priceEl2.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:8px;color:#8B96A8;font-family:&quot;IBM Plex Mono&quot;,monospace;font-size:12px;text-align:center;padding:40px"><div style="font-size:24px;opacity:.4">⊙</div><div>'+title+'</div><div style="font-size:10.5px;color:#5B6577">'+sub+'</div></div>';
    var volEl2 = document.getElementById('volume-chart');
    if (volEl2) volEl2.style.display = 'none';
  }

  // ============ 관련 카드 (같은 세트 → 폴백: 인기 카드) ============
  async function loadRelatedCards(){
    var el = document.getElementById('related-cards');
    if (!el) return;
    var SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
    var KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
    try {
      // 1) 현재 카드 set_id 찾기 (DB에 없으면 null)
      var setId = null;
      try {
        var meRes = await fetch(SUPA+'/rest/v1/cards?select=set_id&slug=eq.'+encodeURIComponent(slug)+'&limit=1', {headers:{apikey:KEY}});
        var meData = await meRes.json();
        if (Array.isArray(meData) && meData[0]) setId = meData[0].set_id;
      } catch (e) {}

      // 2) 같은 set_id 카드 fetch (없으면 인기 카드 폴백)
      var cards = [];
      if (setId) {
        var res = await fetch(SUPA+'/rest/v1/cards?select=slug,name,name_ko,game,set_code,rarity,rarity_class,number&set_id=eq.'+encodeURIComponent(setId)+'&slug=neq.'+encodeURIComponent(slug)+'&order=popularity_rank.asc&limit=6', {headers:{apikey:KEY}});
        cards = await res.json();
      }
      if (!cards || !cards.length){
        // 폴백: 인기 카드 6장
        var res2 = await fetch(SUPA+'/rest/v1/cards?select=slug,name,name_ko,game,set_code,rarity,rarity_class,number&slug=neq.'+encodeURIComponent(slug)+'&order=popularity_rank.asc&limit=6', {headers:{apikey:KEY}});
        cards = await res2.json();
      }
      if (!cards || !cards.length){
        el.innerHTML = '<li class="py-6 text-center mono text-[12px] text-muted">관련 카드 없음</li>';
        return;
      }
      // 2) 가격 + Trust Gate 병렬 join (outlier 차단)
      // ★ 2026-05-27 fix: card_price_trust 통과한 카드만 가격 표시
      var slugs = cards.map(function(x){return x.slug;});
      var slugIn = slugs.map(function(s){return '"'+s.replace(/"/g,'\\"')+'"';}).join(',');
      var KEY2 = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
      var [pricesRes, trustRes] = await Promise.all([
        fetch('https://aqxrmdratnkffvivguqs.supabase.co/rest/v1/price_latest?select=card_slug,price_krw,variant&source=eq.tcgplayer&card_slug=in.(' + slugIn + ')', {headers:{apikey:KEY2}}),
        fetch('https://aqxrmdratnkffvivguqs.supabase.co/rest/v1/card_price_trust?select=card_slug,trust_level,display_krw&card_slug=in.(' + slugIn + ')', {headers:{apikey:KEY2}})
      ]);
      var prices = await pricesRes.json();
      var trusts = trustRes.ok ? await trustRes.json() : [];
      var trustMap = {};
      (trusts||[]).forEach(function(t){ trustMap[t.card_slug] = t; });
      var priceMap = {};
      var rank = { normal:1, holofoil:2, reverseHolofoil:3, unlimitedHolofoil:4 };
      (prices||[]).forEach(function(p){
        var tr = trustMap[p.card_slug];
        // Trust Gate: NONE이거나 trust 데이터 없으면 가격 차단
        if (!tr || tr.trust_level === 'NONE') return;
        // display_krw 있으면 그것 사용, 없으면 raw price_krw
        var safeKrw = tr.display_krw ? Math.round(Number(tr.display_krw)) : null;
        if (!safeKrw) return;
        var ex = priceMap[p.card_slug];
        if (!ex || (rank[p.variant]||9) < (rank[ex.variant]||9)) {
          priceMap[p.card_slug] = { card_slug: p.card_slug, price_krw: safeKrw, variant: p.variant };
        }
      });
      function rarityCls(r){ return { SAR:'rb-sar', SEC:'rb-sec', UR:'rb-ur', AR:'rb-ar', PARALLEL:'rb-parallel', PROMO:'rb-sp', SR:'rb-sr', VMAX:'rb-sec' }[r] || ''; }
      var rows = cards.slice(0,5).map(function(card, i){
        var p = priceMap[card.slug];
        var priceStr = p && p.price_krw ? '₩ ' + Math.round(p.price_krw).toLocaleString('ko-KR') : '<span class="text-muted">—</span>';
        var rc = card.rarity_class || '';
        var koPart = card.name_ko ? ' <span style="color:#8B96A8;font-weight:400;margin-left:4px;font-size:11.5px">'+escapeHtmlSimple(card.name_ko)+'</span>' : '';
        var gameLbl = card.game === 'pokemon' ? 'PKM' : 'OP';
        var setLbl  = (card.set_code || '').toUpperCase();
        return '<li class="related-card-row items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-panel2 transition-colors">'
          + '<span class="mono text-[13px] text-muted">' + String(i+1).padStart(2,'0') + '</span>'
          + '<a href="/cards/'+encodeURIComponent(card.slug)+'" class="group" style="text-decoration:none">'
            + '<div class="flex items-center gap-2 flex-wrap">'
              + '<strong class="text-[14px] text-ink group-hover:text-brand font-medium">'+escapeHtmlSimple(card.name)+koPart+'</strong>'
              + (rc ? '<span class="rarity-badge '+rarityCls(rc)+'">'+escapeHtmlSimple(rc)+'</span>' : '')
            + '</div>'
            + '<div class="identity-meta mt-1">'+gameLbl+' · '+escapeHtmlSimple(setLbl)+(card.number ? ' · #'+escapeHtmlSimple(card.number) : '')+'</div>'
          + '</a>'
          + '<div class="related-card-price text-right"><div class="mono text-[13px] text-ink">'+priceStr+'</div></div>'
          + '<span class="related-card-change mono text-[12px] text-muted text-right">—</span>'
          + '</li>';
      }).join('');
      el.innerHTML = rows;
    } catch (e) {
      console.warn('related cards', e);
      el.innerHTML = '<li class="py-6 text-center mono text-[12px] text-muted">—</li>';
    }
  }

  // SSR이 head 끝에 주입한 카드 메타를 DOMContentLoaded 직전에 채택한다.
  // 공개 Supabase 클라이언트가 늦거나 실패해도 서버가 완성한 본문을 placeholder로 되돌리지 않는다.
  function hydrateCardFromSsr(){
    var ssrCard = window.CARDPICK_CARD;
    if (!ssrCard || ssrCard.slug !== slug) return;
    card = dbCardToCard(ssrCard);
    card.slug = slug;
    isDbCard = false;
    window.__CARDPICK_CARD__.runtime.name = card.name;
    window.__CARDPICK_CARD__.runtime.set = card.set_jp;
    window.__CARDPICK_CARD__.runtime.game = card.game;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      hydrateCardFromSsr();
      apply(); paintLivePrice(); loadRelatedPosts(); loadRealPriceChart(); loadRelatedCards();
    });
  } else {
    hydrateCardFromSsr();
    apply(); paintLivePrice(); loadRelatedPosts(); loadRealPriceChart(); loadRelatedCards();
  }
})();
