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

  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY  = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // 정적 index.html 가져오기
  const tplRes = await env.ASSETS.fetch(url.toString());
  if (!tplRes.ok) return tplRes;

  // Top 20 카드 fetch — ★ Trust Gate 필터: display_krw 있는 카드만 (NONE 제외)
  // card_price_trust JOIN — NONE 카드 자동 제외, display_krw 사용 (가격 게이트 + outlier 차단 동시)
  let cards = [];
  try {
    const sRes = await fetch(
      `${SUPA}/rest/v1/card_price_trust?display_krw=not.is.null&display_krw=gte.3000&order=display_krw.desc.nullslast&limit=20`,
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
          for (const s of sums) {
            const c = cardMap[s.card_slug];
            if (!c) continue;
            // display_krw 사용 — trust-vetted 가격 (raw latest_krw가 outlier여도 안전)
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

  // SSR 행 HTML (priceBody에 inject) — 6 컬럼 (7일 변화/sparkline은 JS 후속 fetch로 채움)
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
      <td class="chg flat"><span style="color:#5B6577">—</span></td>
      <td class="spark-cell hide-sm" style="min-width:120px;padding-right:18px"><span style="color:#5B6577;font-size:11px">—</span></td>
    </tr>`;
  }).join('');

  // HTMLRewriter로 <tbody id="priceBody"> 안에 SSR 행 삽입
  const rewriter = new HTMLRewriter()
    .on('tbody#priceBody', {
      element(el) {
        el.setInnerContent(ssrRows, { html: true });
      }
    });

  const transformed = rewriter.transform(new Response(tplRes.body, tplRes));
  return new Response(transformed.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      'X-Cardpick-SSR': 'home'
    }
  });
}
