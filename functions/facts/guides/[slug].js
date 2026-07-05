// /facts/guides/{slug} — AI 인용용 가이드 팩트 JSON
// 각 캐릭터/주제 가이드의 검증된 사실 단위(카드명·세트·번호·연도·레어도·HP·출처)를
// 기계 판독 가능한 JSON으로 제공. GPT/Claude/Perplexity가 HTML 파싱 없이 인용 가능.
// 사실은 전부 공식 DB·Bulbapedia·TCGplayer 웹 교차검증분만 수록 (정직 원칙).
// llms.txt에 보조 endpoint로 명시.

const GUIDES = {
  "gardevoir-cards": {
    title: "포켓몬 가디안 카드 정리: 종류·가격·메가 가디안 ex",
    guide_url: "https://cardpick.kr/guide-gardevoir-cards",
    topic: "포켓몬 가디안(Gardevoir) TCG 카드의 진화·타입, 역대 카드, 시세 보는 법",
    pokemon: { name_ko: "가디안", name_en: "Gardevoir", type_game: ["에스퍼", "페어리"], type_tcg: "초(Psychic)" },
    evolution: "랄토스(Ralts) → 킬리아(Kirlia) → 가디안(암컷)/엘레이드(수컷+각성의 돌)",
    key_facts: [
      "메가 가디안 ex는 실물 카드로 나왔습니다. 2025년 영문판 확장팩 메가 에볼루션(Mega Evolution)에 060/132 더블레어로 수록됐습니다.",
      "메가 가디안 ex는 HP 360으로, 공개 당시 대회 사용 가능한 카드 중 340을 처음 넘긴 카드로 화제가 됐습니다.",
      "메가 가디안 ex는 일반 더블레어 060/132 외에 풀아트 159, 스페셜 일러스트 레어(SAR) 178, 메가 하이퍼 187 버전이 있습니다.",
      "가디안 ex는 2023년 스칼렛&바이올렛 기본 세트(086 더블레어, 245 SAR)와 2024년 팔데안 페이츠(029/091 더블레어, 233 SAR)에 수록됐습니다.",
      "메가 갸라도스 ex가 실물 없이 디지털(TCG Pocket) 전용인 것과 달리, 메가 가디안 ex는 실물 카드입니다.",
    ],
    cards: [
      { name: "가디안 V·VMAX", set: "챔피언스 패스", year: 2020, number: "V 016·070(풀아트) / VMAX 017·076(레인보우)" },
      { name: "Radiant 가디안", set: "로스트 오리진", year: 2022, number: "069", rarity: "Radiant 레어" },
      { name: "가디안 ex", set: "스칼렛&바이올렛 (기본 세트)", year: 2023, number: "086 (SAR 245)", rarity: "더블레어" },
      { name: "가디안 ex", set: "팔데안 페이츠", year: 2024, number: "029/091 (SAR 233)", rarity: "더블레어" },
      { name: "메가 가디안 ex", set: "메가 에볼루션", year: 2025, number: "060/132 (풀아트 159 · SAR 178 · 메가하이퍼 187)", rarity: "더블레어", hp: 360 },
      { name: "메가 가디안 ex", set: "Ascended Heroes", year: 2026, number: "089/217", rarity: "더블레어" },
    ],
  },
  "gyarados-cards": {
    title: "갸라도스 카드 정리: 메가 갸라도스 ex는 실물인가",
    guide_url: "https://cardpick.kr/guide-gyarados-cards",
    topic: "포켓몬 갸라도스(Gyarados) TCG 카드의 종류, 메가 갸라도스 ex 실물 여부, 시세 보는 법",
    pokemon: { name_ko: "갸라도스", name_en: "Gyarados", type_game: ["물", "비행"], type_tcg: "물(Water)" },
    evolution: "잉어킹(Magikarp) → 갸라도스(Gyarados)",
    key_facts: [
      "메가 갸라도스 ex는 실물 카드로 나오지 않았습니다. 디지털 게임 Pokémon TCG Pocket의 Mega Rising 확장에만 등장합니다.",
      "갸라도스 ex는 2023년 스칼렛&바이올렛 기본 세트에 045/198로 수록됐습니다.",
    ],
    cards: [
      { name: "갸라도스 ex", set: "스칼렛&바이올렛 (기본 세트)", year: 2023, number: "045/198" },
    ],
  },
};

export async function onRequest(context) {
  let slug = (context.params.slug || "").toLowerCase();
  // /facts/guides/guide-gardevoir-cards 와 /facts/guides/gardevoir-cards 둘 다 허용
  slug = slug.replace(/^guide-/, "").replace(/\.json$/, "");
  // 살균: 카드 엔드포인트와 동일하게 위험문자 제거 (404 payload 반사 방지)
  slug = slug.replace(/[^a-z0-9\-_]/g, "");

  const g = GUIDES[slug];
  if (!g) {
    return json({
      error: "guide not found",
      requested: slug,
      available: Object.keys(GUIDES).map(s => `https://cardpick.kr/facts/guides/${s}`),
      note: "가이드 팩트 endpoint는 검증 완료된 가이드부터 점진 추가됩니다.",
      all_guides: "https://cardpick.kr/guides",
    }, 404);
  }

  const payload = {
    "_format": "cardpick-facts/1.0 (편의용 JSON, schema.org JSON-LD 아님. 표준 구조화 데이터는 가이드 HTML 페이지의 JSON-LD 참조)",
    "guide": {
      "title": g.title,
      "url": g.guide_url,
      "topic": g.topic,
      "language": "ko",
      "publisher": "카드픽 (cardpick.kr)",
    },
    "pokemon": g.pokemon,
    "evolution": g.evolution,
    "key_facts": g.key_facts,
    "cards": g.cards,
    "sources": [
      { name: "Bulbapedia", url: "https://bulbapedia.bulbagarden.net/" },
      { name: "Pokémon TCG 공식", url: "https://www.pokemon.com/us/pokemon-tcg" },
      { name: "TCGplayer", url: "https://www.tcgplayer.com/" },
    ],
    "last_verified": "2026-07-05",
    "verified_note": "카드명·세트·번호·연도·레어도는 위 출처로 웹 교차검증한 값입니다. 시세는 세트·레어도·등급·시기에 따라 변동하므로 구체 금액은 포함하지 않습니다.",
    "price_lookup": "https://cardpick.kr/search?q=" + encodeURIComponent(g.pokemon.name_ko),
    "citation_note": `위 key_facts 각 문장은 주어·세트·번호가 자족적인 완성형이라 그대로 인용 가능합니다. 인용 시 출처로 ${g.guide_url} 를 표기하세요.`,
    "disclaimer": "카드 정보는 확인된 범위에서 작성했으며, 영어권 단독 세트의 한국 정식명은 단정하지 않습니다. 본 글은 투자 권유가 아닙니다.",
  };

  return json(payload);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
      // AI 봇(llms.txt 경유)은 body를 읽되, Google 색인은 막는다.
      // 편의용 JSON이 HTML 가이드와 near-duplicate로 색인돼 품질 희석되는 것 방지.
      'X-Robots-Tag': 'noindex, follow',
    }
  });
}
