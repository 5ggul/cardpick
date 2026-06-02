// /rss.xml — 카드픽 RSS 2.0 피드 (가이드 글 + 최근 핫카드)
// Naver Search Advisor / 블로그 RSS 리더 호환
export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
  const SITE = 'https://cardpick.kr';

  function esc(s){ return String(s||'').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
  function pubDate(d){ return new Date(d).toUTCString(); }

  // 1. 정적 가이드 글 manifest (functions/guides.js의 GUIDES와 동기)
  //    새 가이드 추가 시 functions/guides.js + 여기 두 곳 모두 갱신.
  const guides = [
    {
      slug: 'guide-fake-detection',
      title: '포켓몬 카드 가품 판별법 가이드 — 인쇄·홀로·잉크·모서리·무게 5가지 신호',
      description: '인쇄 결, 홀로 패턴, 카드 뒷면 잉크 두께, 모서리 절단면, 두께·무게까지 5가지 식별 신호. 자주 출몰하는 가품 카드, 메루카리·중고나라 의심 신호, PSA 슬랩 위조 확인까지.',
      date: '2026-05-24',
      category: '거래 안전',
      image: '/images/guides/fake-detection-hero.webp?v=20260602'
    },
    {
      slug: 'guide-card-rarities',
      title: '포켓몬 카드 레어도 등급 정리 — SAR · SIR · UR · HR · IR · AR',
      description: 'SAR · SIR · UR · HR · IR · AR · RR · R · U · C 한국어 등급 체계 정리. 등급별 가격대 비교, 카드 표기 식별법, SV 시리즈 신규 등급, 자주 헷갈리는 5가지까지.',
      date: '2026-05-24',
      category: '시세 분석',
      image: '/images/guides/card-rarities-hero.webp?v=20260602'
    },
    {
      slug: 'guide-japan-import',
      title: '포켓몬 카드 일본 직구 가이드 — 한판·일판 차이, 비용, 통관',
      description: '한판 vs 일판 시세 차이, 메루카리·야후옥션·포케카닷컴·아마존JP 구매처 비교, 배송 대행 vs 직배송, 진짜 비용 계산, 통관 관세 기준까지 한 번에.',
      date: '2026-05-22',
      category: '해외 직구',
      image: '/images/guides/japan-import-hero.png?v=2'
    },
    {
      slug: 'guide-psa-grading-korea',
      title: '포켓몬 카드 PSA 그레이딩 신청 방법 — 한국에서 보내는 법',
      description: '한국에서 PSA로 카드 보내는 가이드. 비용·기간·신청 단계·자주 하는 실수 7가지·BRG10 비교까지 처음 보내는 분도 한 번에.',
      date: '2026-05-21',
      category: '그레이딩',
      image: '/images/guides/psa-grading-hero.png?v=4'
    },
    {
      slug: 'guide-what-is-tcg',
      title: 'TCG란? 트레이딩 카드 게임 입문 가이드',
      description: 'TCG의 정의부터 포켓몬·원피스·매직·유희왕 등 5대 트레이딩 카드 게임 종류, 입문 방법, 시세 흐름까지 한 번에 정리.',
      date: '2026-05-19',
      category: '입문',
      image: '/images/guides/what-is-tcg-hero.png'
    },
    {
      slug: 'guide-trade-safety',
      title: '카드 거래 안전 체크리스트',
      description: '판매자 평판, 사진 인증, 안전결제, 외부 카톡 거래 거절까지 7단계로 정리한 중고거래 안전 가이드.',
      date: '2026-05-18',
      category: '거래 안전',
      image: '/images/guides/trade-safety-hero.png'
    }
  ];

  // 2. 최근 핫카드 Top 5 (정직 — 데이터 없으면 빈)
  let hot = [];
  try {
    const res = await fetch(`${SUPA}/rest/v1/rpc/get_hot_cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY },
      body: JSON.stringify({})
    });
    if (res.ok) {
      const rows = await res.json();
      hot = rows
        .filter(r => r.category === 'top' && r.latest_krw >= 3000)
        .slice(0, 5);
    }
  } catch (e) { /* graceful */ }

  const items = [];

  // 가이드 글 item
  for (const g of guides) {
    items.push(`
    <item>
      <title>${esc(g.title)}</title>
      <link>${SITE}/${g.slug}</link>
      <guid isPermaLink="true">${SITE}/${g.slug}</guid>
      <description><![CDATA[${g.description} <br><img src="${SITE}${g.image}" alt="${esc(g.title)}" />]]></description>
      <category>${esc(g.category)}</category>
      <pubDate>${pubDate(g.date + 'T00:00:00Z')}</pubDate>
      <author>contact@cardpick.kr (카드픽 편집부)</author>
    </item>`);
  }

  // 핫카드 item (오늘의 TOP)
  const today = new Date().toISOString().slice(0, 10);
  for (const h of hot) {
    const krwTxt = h.latest_krw ? `₩${Math.round(Number(h.latest_krw)).toLocaleString('en-US')}` : '';
    const chgTxt = h.change_7d_pct != null ? `7일 변화 ${Number(h.change_7d_pct).toFixed(1)}%` : '';
    items.push(`
    <item>
      <title>오늘의 핫카드: ${esc(h.name)} ${esc(h.set_code || '')} - ${krwTxt}</title>
      <link>${SITE}/cards/${esc(h.card_slug)}</link>
      <guid isPermaLink="false">${SITE}/cards/${esc(h.card_slug)}#${today}</guid>
      <description><![CDATA[${esc(h.name)} (${esc(h.set_name || '')}, ${esc(h.rarity_class || '')}) ${krwTxt} ${chgTxt}. ${esc(h.reason || '')}]]></description>
      <category>핫카드</category>
      <pubDate>${pubDate(today + 'T00:00:00Z')}</pubDate>
    </item>`);
  }

  const lastBuild = new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>카드픽 — 포켓몬 카드 가격 참고가</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>포켓몬 카드 해외 참고가, 트레이딩 카드 게임 입문 가이드, 거래 안전 정보, 오늘의 핫카드를 한국어로 정리하는 한국 TCG 정보 사이트입니다.</description>
    <language>ko-KR</language>
    <copyright>© 2026 CARDPICK</copyright>
    <managingEditor>contact@cardpick.kr (카드픽 편집부)</managingEditor>
    <webMaster>admin@cardpick.kr (카드픽 관리)</webMaster>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <generator>cardpick.kr/rss.xml</generator>
    <ttl>60</ttl>
    <image>
      <url>${SITE}/logo.png</url>
      <title>카드픽</title>
      <link>${SITE}/</link>
    </image>
${items.join('')}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
