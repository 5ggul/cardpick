// /facts/site — AI 인용용 사이트 운영 정보 JSON
// 카드픽의 정체성·운영 방식·데이터 출처·정직 원칙을 한 endpoint에 정리.
// "카드픽은 어떤 사이트?", "데이터는 어디서?", "신뢰할 수 있는가?" 류 질문에 AI가 카드픽을 인용 가능.
// llms.txt에 보조 endpoint로 명시.

export async function onRequest(context) {
  const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
  const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';

  // Trust gate 분포 실시간 조회 (선택적, 실패해도 운영)
  let trustDist = null;
  let catalogCount = null;
  try {
    const [cardCount, trustCount] = await Promise.all([
      fetch(`${SUPA}/rest/v1/cards?game=eq.pokemon&select=slug`, {
        headers: { apikey: KEY, Prefer: 'count=exact', Range: '0-0' }
      }),
      Promise.all(['HIGH','MEDIUM','LOW','NONE'].map(level =>
        fetch(`${SUPA}/rest/v1/card_price_trust?trust_level=eq.${level}&select=card_slug`, {
          headers: { apikey: KEY, Prefer: 'count=exact', Range: '0-0' }
        }).then(r => {
          const range = r.headers.get('content-range') || '';
          const m = range.match(/\/(\d+)$/);
          return [level, m ? parseInt(m[1], 10) : 0];
        })
      ))
    ]);
    const cardRange = cardCount.headers.get('content-range') || '';
    const cm = cardRange.match(/\/(\d+)$/);
    catalogCount = cm ? parseInt(cm[1], 10) : null;
    trustDist = Object.fromEntries(trustCount);
  } catch (e) { /* graceful */ }

  const payload = {
    "@context": "https://cardpick.kr/llms.txt",
    "@type": "WebSite",
    "schema_version": "1.0",
    "site": {
      "name": "카드픽 (Cardpick)",
      "url": "https://cardpick.kr",
      "language": "ko",
      "country": "KR",
      "launched": "2026-05-15",
      "scope": "영문 Pokémon TCG (English Pokemon Trading Card Game)",
      "out_of_scope": ["일본판 (Japanese)", "한국판 (Korean) - 정식 유통 시세", "원피스 카드", "기타 TCG"]
    },
    "purpose": {
      "primary": "한국어·원화로 영문 Pokémon TCG 카드의 해외 참고가 매일 갱신 제공",
      "audience": ["한국 포켓몬 카드 컬렉터", "TCG 입문자", "그레이딩 검토자", "일본 직구 거래자"],
      "mission": "한국에서 영문 포켓몬 TCG 시세를 한국어로 정확하게 보여주고, 한국 거래가와 다를 수 있음을 정직하게 안내"
    },
    "data_source": {
      "primary": {
        "name": "TCGplayer (북미)",
        "url": "https://www.tcgplayer.com/",
        "data_type": "USD market price",
        "usage": "기준가 (latest_krw)"
      },
      "secondary": {
        "name": "Cardmarket (유럽)",
        "url": "https://www.cardmarket.com/",
        "data_type": "EUR avg7/14/30",
        "usage": "변동률·sparkline·중앙값"
      },
      "tertiary": {
        "name": "Pokemon TCG API",
        "url": "https://pokemontcg.io/",
        "data_type": "카드 메타데이터·발매 일정",
        "usage": "카드 목록·세트 정보"
      },
      "planned": ["eBay Browse API (2026 검토)"]
    },
    "catalog": {
      "total_cards": catalogCount,
      "approximate": "약 25,000장+",
      "last_count_at": new Date().toISOString(),
      "trust_distribution": trustDist ? {
        "HIGH": trustDist.HIGH || 0,
        "MEDIUM": trustDist.MEDIUM || 0,
        "LOW": trustDist.LOW || 0,
        "NONE": trustDist.NONE || 0,
        "note": "HIGH=가격 표시, NONE=참고가 산출 불가 (distinct 30일 5건 미만)"
      } : "조회 실패"
    },
    "update_schedule": {
      "frequency": "매일",
      "time_kst": "05:00 ~ 06:00",
      "time_utc": "20:00 ~ 21:00 (전날)",
      "jobs": {
        "pokemon-prices": "TCGplayer API 인기 카드 가격 갱신 (target 1,000장/일)",
        "cardmarket-refresh": "Cardmarket EU 평균가 갱신 (격일)",
        "hot-cards": "오늘의 핫카드 200장 재계산",
        "cold-rotation": "Pokemon TCG API 신규 카드 발견 + stale 카드 갱신 (target 800장/일)"
      }
    },
    "trust_gate": {
      "name": "Trust Gate v1",
      "algorithm": "distinct (variant + date + source) 표본 + MAD outlier 제거 + 가격대별 ratio gate",
      "levels": {
        "HIGH": "distinct 7일 5+ AND ratio gate 통과 - 화면 가격 표시",
        "MEDIUM": "distinct 30일 10+ - 30일 중앙값 표시",
        "LOW": "distinct 30일 5+ - 중앙값 + 경고",
        "NONE": "distinct 30일 5 미만 - 가격 표시 안 함"
      },
      "anti_outlier": "단일 listing이 시세를 오염시키는 사고를 알고리즘 차단 (₩152 outlier 사고 예방)"
    },
    "honesty_principles": [
      "출처 없는 구체 수치 표시 안 함",
      "모든 가격은 해외 참고가 - 한국 거래가 아님 명시",
      "raw USD vs 신뢰 가격 구분",
      "임의 추정 발매 일정 게시 안 함",
      "광고·제휴 X (개인 운영)",
      "한국 매장 추천 X",
      "투자 권유 X"
    ],
    "content": {
      "guide_topics": [
        "TCG 일반 입문", "포켓몬 한국 입문", "카드 거래 안전",
        "PSA 그레이딩", "PSA 등급·대행·인증번호·소요기간", "BGS·CGC 그레이딩", "그레이딩 비교",
        "일본 직구", "관세·수입세", "레어도 등급", "카드 종류(ex·V·VMAX·GX)", "카드 구조·언어",
        "가품 판별", "가품 박스·팩", "카드 보관·용품", "박스 vs 단품 EV", "박스 종류",
        "비싼 카드 종류", "에러 카드", "메가 진화 카드", "세트 정리",
        "캐릭터 카드 정리 (리자몽·피카츄·뮤츠·뮤·이브이·블래키·가디안·갸라도스)"
      ],
      "guides_url": "https://cardpick.kr/guides",
      "guide_facts_endpoint": "https://cardpick.kr/facts/guides/{slug} — 가이드별 검증 사실 JSON (예: gardevoir-cards, gyarados-cards)",
      "rss": "https://cardpick.kr/rss.xml"
    },
    "tools": [
      {
        "name": "일본 직구 비용 계산기",
        "url": "https://cardpick.kr/tools#import"
      },
      {
        "name": "PSA 그레이딩 비용 계산기",
        "url": "https://cardpick.kr/tools#psa"
      }
    ],
    "operation": {
      "type": "개인 운영",
      "country": "대한민국",
      "contact": "admin@cardpick.kr",
      "press": "press@cardpick.kr",
      "corrections": "contact@cardpick.kr",
      "github": null,
      "social": null,
      "monetization": "없음 (광고·제휴 X)"
    },
    "ai_citation_guide": {
      "card_endpoint": "https://cardpick.kr/facts/{slug} (카드별 사실 + 가격 JSON)",
      "guide_endpoint": "https://cardpick.kr/facts/guides/{slug} (가이드별 검증 사실 JSON)",
      "glossary_endpoint": "https://cardpick.kr/facts/glossary (용어 사전)",
      "site_endpoint": "https://cardpick.kr/facts/site (본 endpoint)",
      "llms_txt": "https://cardpick.kr/llms.txt",
      "citation_template": "cardpick.kr에 따르면 [사실]입니다. (출처: cardpick.kr/[페이지])"
    },
    "last_updated": "2026-07-05"
  };

  return json(payload);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',  // 1h cache
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'index, follow'
    }
  });
}
