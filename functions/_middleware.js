// Pages Function: www → apex 301 + 호스트 정규화
// + 홈(/) 시세표 SSR — Googlebot이 첫 페인트에 Top 20 카드 발견 (외부 감사 P3)
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // www → apex
  if (url.hostname === 'www.cardpick.kr') {
    url.hostname = 'cardpick.kr';
    return Response.redirect(url.toString(), 301);
  }

  // 홈 SSR 만 처리 (다른 경로는 그대로 next)
  if (url.pathname !== '/' && url.pathname !== '/index.html') return next();

  // ★ 엣지 캐시 (Cache API) — Pages Function은 헤더만으론 캐시 안 됨. 명시적 캐시.
  const edgeCache = caches.default;
  const cacheKey = new Request('https://cardpick.kr/__home_ssr', { method: 'GET' });
  const cached = await edgeCache.match(cacheKey);
  if (cached) { const h = new Headers(cached.headers); h.set('X-Edge-Cache','HIT'); return new Response(cached.body, { status: cached.status, headers: h }); }

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY  = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 정적 index.html 가져오기
  const tplRes = await env.ASSETS.fetch(url.toString());
  if (!tplRes.ok) return tplRes;

  // Top 20 카드 fetch — ★ Trust Gate 필터: display_krw 있는 카드만 (NONE 제외)
  // card_price_trust JOIN — NONE 카드 자동 제외, display_krw 사용 (가격 게이트 + outlier 차단 동시)
  let cards = [];
  try {
    // limit 120 + dedupe 거쳐 Top 20 확보 (고가 카드는 variant가 많아 80장+ 후보 필요)
    const sRes = await fetch(
      `${SUPA}/rest/v1/card_price_trust?display_krw=not.is.null&display_krw=gte.3000&order=display_krw.desc.nullslast&limit=120`,
      { headers: { apikey: KEY } }
    );
    if (sRes.ok) {
      const sums = await sRes.json();
      const slugs = sums.map(s => `"${s.card_slug.replace(/"/g, '\\"')}"`).join(',');
      if (slugs) {
        const cRes = await fetch(
          `${SUPA}/rest/v1/cards?select=slug,name,name_ko,set_code,set_name,number,rarity_class&game=eq.pokemon&slug=in.(${slugs})`,
          { headers: { apikey: KEY } }
        );
        if (cRes.ok) {
          const cardMap = {};
          for (const c of await cRes.json()) cardMap[c.slug] = c;
          const seenSlug = new Set();
          const seenKey = new Set();
          for (const s of sums) {
            if (cards.length >= 20) break;
            if (seenSlug.has(s.card_slug)) continue;
            seenSlug.add(s.card_slug);
            const c = cardMap[s.card_slug];
            if (!c) continue;
            // ★ (name + number_normalized) 키로 중복 카드 제거
            // 'mew-ex-232' vs 'mew-ex---232091', variant 분리 row 등 같은 카드 한 번만
            const numNorm = String(c.number || '').split('/')[0].trim().replace(/^0+/, '');
            const dupKey = (c.name || '').toLowerCase().trim() + '|' + numNorm;
            if (seenKey.has(dupKey)) continue;
            seenKey.add(dupKey);
            // display_krw 사용 — trust-vetted 가격 (TCGplayer 북미 USD 기반, outlier 차단)
            cards.push({ ...c, krw: Math.round(Number(s.display_krw)) });
          }
        }
      }
    }
  } catch (e) { /* graceful — JS fallback 동작 */ }

  if (!cards.length) return new Response(tplRes.body, tplRes);

  function esc(s) { return String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // 레어도 → 짧은 약어 + 심볼 매핑 (카드 미리보기 .ct)
  function rarityToken(rc) {
    const r = String(rc || '').toLowerCase();
    if (r.includes('special illustration')) return { code: 'SIR', sym: '★★★' };
    if (r.includes('illustration rare'))    return { code: 'IR',  sym: '★★'  };
    if (r.includes('special art'))          return { code: 'SAR', sym: '★★★' };
    if (r.includes('hyper rare'))           return { code: 'HR',  sym: '★★★★' };
    if (r.includes('secret'))               return { code: 'SEC', sym: '★★★' };
    if (r.includes('ultra rare'))           return { code: 'UR',  sym: '★★'  };
    if (r.includes('amazing'))              return { code: 'AR',  sym: '★★'  };
    if (r.includes('shiny'))                return { code: 'SR',  sym: '★★'  };
    if (r.includes('rainbow'))              return { code: 'RR',  sym: '★★★' };
    if (r.includes('double rare'))          return { code: 'RR',  sym: '★★'  };
    if (r.includes('rare holo'))            return { code: 'RH',  sym: '★'   };
    if (r === 'rare')                       return { code: 'R',   sym: '★'   };
    if (r.includes('uncommon'))             return { code: 'U',   sym: '◆'   };
    if (r === 'common')                     return { code: 'C',   sym: '●'   };
    if (r.includes('promo'))                return { code: 'PR',  sym: '◆'   };
    return { code: (rc || '').slice(0, 3).toUpperCase() || '—', sym: '●' };
  }

  // SSR 행 HTML (priceBody에 inject) — 3 컬럼 (#, 카드·세트, 해외 참고가)
  const ssrRows = cards.slice(0, 20).map((c, i) => {
    const tok = rarityToken(c.rarity_class);
    const tokenHtml = `<div class="ct" data-r="${esc(tok.code)}" aria-hidden="true"><div class="top"></div><div class="sym">${tok.sym}</div><div class="r">${esc(tok.code)}</div><div class="num">${esc(c.number||'')}</div></div>`;
    return `
    <tr data-ssr="1">
      <td class="rk">${String(i+1).padStart(2,'0')}</td>
      <td>
        <div class="card-cell">
          ${tokenHtml}
          <div class="meta">
            <a class="name" href="/cards/${esc(c.slug)}" title="${esc(c.name)} ${esc(c.number||'')}">${esc(c.name)}${c.number ? '<span style="color:#8B96A8;font-weight:500;margin-left:8px;font-family:\'IBM Plex Mono\',ui-monospace,monospace;font-size:12px">#'+esc(c.number)+'</span>' : ''}</a>
            <div class="set-line" style="color:#8B96A8;font-size:11.5px;font-family:'IBM Plex Mono',ui-monospace,monospace;margin-top:2px;letter-spacing:.02em">${esc(c.set_name||c.set_code||'-')}${c.rarity_class ? ' · ' + esc(c.rarity_class) : ''} · 영문판</div>
          </div>
        </div>
      </td>
      <td class="price">₩${c.krw.toLocaleString('ko-KR')}</td>
    </tr>`;
  }).join('');

  // Ticker SSR — 같은 cards로 ticker-item HTML 생성 (JS가 나중에 덮어쓰지만 first-paint 안전망)
  function fmtKrw(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function renderTickerItem(c) {
    const tok = rarityToken(c.rarity_class);
    const rColorMap = { SAR:'#F2C94C', SEC:'#FF4D6D', UR:'#9B8CE6', HR:'#FF7F50', AR:'#5FB0FF', SIR:'#F2C94C', IR:'#5FB0FF', SR:'#9B8CE6', RR:'#9B8CE6', RH:'#9CC2FF', R:'#9CC2FF', U:'#8B96A8', C:'#8B96A8', PR:'#26E0C2' };
    const rColor = rColorMap[tok.code] || '#8B96A8';
    const rgb = rColor.replace('#','').match(/.{2}/g).map(h => parseInt(h, 16));
    const rBg = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.12)`;
    const gameColor = '#F2C94C';
    const gameBg = 'rgba(242,201,76,0.12)';
    const setChip = c.set_code ? `<span class="chip-set" style="color:#8B96A8;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;border:1px solid rgba(255,255,255,0.12);padding:1px 5px">${esc(c.set_code)}</span>` : '';
    return `<a class="ticker-item" href="/cards/${esc(c.slug)}" style="text-decoration:none;color:inherit"><span class="chip-game" style="background:${gameBg};color:${gameColor};padding:1px 6px;border:1px solid ${gameColor};font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.08em;font-weight:600">PKM</span><span class="card">${esc(c.name)}</span>${setChip}<span class="chip-rarity" style="background:${rBg};color:${rColor};padding:1px 6px;border:1px solid ${rColor};font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.06em;font-weight:600">${esc(tok.code)}</span><span class="price" style="font-weight:600">₩${fmtKrw(c.krw)}</span><span class="chg" style="color:#5B6577">—</span></a>`;
  }
  // ticker seamless animation — 카드가 적으면 더 많이 반복해 트랙 길이 확보
  const tickerCards = cards.slice(0, 15);
  const repeatCount = tickerCards.length >= 12 ? 3 : (tickerCards.length >= 6 ? 5 : 8);
  let tickerHtml = '';
  for (let i = 0; i < repeatCount; i++) tickerHtml += tickerCards.map(renderTickerItem).join('');

  // HTMLRewriter로 <tbody id="priceBody"> + <div id="liveTicker"> 양쪽 SSR
  const rewriter = new HTMLRewriter()
    .on('tbody#priceBody', {
      element(el) {
        el.setInnerContent(ssrRows, { html: true });
      }
    })
    .on('div#liveTicker', {
      element(el) {
        el.setInnerContent(tickerHtml, { html: true });
      }
    });

  const transformed = rewriter.transform(new Response(tplRes.body, tplRes));
  const resp = new Response(transformed.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      'X-Cardpick-SSR': 'home',
      'X-Edge-Cache': 'MISS'
    }
  });
  context.waitUntil(edgeCache.put(cacheKey, resp.clone()));
  return resp;
}
