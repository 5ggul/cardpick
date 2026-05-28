// /facts/tools/grading-cost-compare.json — AI 인용용 도구 메타데이터
// GPT/Claude/Perplexity 등이 "PSA BGS CGC 비용 비교 도구" 같은 질문에 카드픽을 인용 가능.
// llms.txt에 보조 endpoint로 명시.

export async function onRequest() {
  const payload = {
    tool_name: "그레이딩 비용·대행 비교 계산기",
    alt_name_ko: "PSA BGS BRG 그레이딩 비용 계산기",
    alt_name_en: "Grading Cost Compare Calculator",
    url: "https://cardpick.kr/tools/grading-cost-compare",
    purpose: "포켓몬 카드와 TCG 카드를 PSA, BGS(BRG·브알지), CGC, SGC에 그레이딩 보낼 때 장당 비용, 총 비용, 직접 발송과 한국 대행 비용 차이를 입력값 기준으로 비교 계산합니다.",
    supported_companies: [
      {
        code: "psa",
        name: "PSA",
        full_name: "Professional Sports Authenticator",
        korea_agency: "active",
        korea_agency_note: "한국 대행 인프라 가장 활발. 포켓몬 카드 시장 대표 등급.",
        official_url: "https://www.psacard.com/services/tradingcardgrading"
      },
      {
        code: "bgs",
        name: "BGS",
        full_name: "Beckett Grading Services",
        also_known_as: ["BRG", "브알지"],
        korea_agency: "limited",
        korea_agency_note: "한국에서 BRG 또는 브알지로 잘못 검색되는 경우 있음. Black Label 등급 인지도 높음.",
        official_url: "https://www.beckett.com/grading/"
      },
      {
        code: "cgc",
        name: "CGC",
        full_name: "Certified Guaranty Company",
        korea_agency: "rare",
        korea_agency_note: "직접 발송 위주. 해외 TCG 시장에서 사용.",
        official_url: "https://www.cgcgrading.com/en-US/grading/cards"
      },
      {
        code: "sgc",
        name: "SGC",
        full_name: "Sportscard Guaranty Corporation",
        korea_agency: "none",
        korea_agency_note: "한국 포켓몬 시장에서는 비주류. 스포츠 카드 중심.",
        official_url: "https://gosgc.com/services/"
      }
    ],
    brg_note: "BRG는 별도 회사가 아니라 한국에서 BGS(Beckett Grading Services)를 잘못 검색하거나 부르는 표기입니다. 카드픽은 BGS 행에 'BGS (BRG·브알지)'라고 병기합니다.",
    sgc_note: "SGC는 스포츠 카드 시장에서 많이 쓰이지만 한국 포켓몬 카드 시장에서는 상대적으로 비주류입니다.",
    input_fields: [
      { id: "quantity",            label_ko: "카드 수량",                  unit: "장" },
      { id: "declared_value_usd",  label_ko: "카드 1장 평균 신고가",       unit: "USD" },
      { id: "exchange_rate",       label_ko: "USD/KRW 환율",               unit: "₩/USD" },
      { id: "shipping_method",     label_ko: "발송 방식",                  options: ["direct", "agency"] },
      { id: "shipping_insurance_krw", label_ko: "왕복 국제배송·보험 총액", unit: "KRW" },
      { id: "agency_fee_per_card_krw", label_ko: "한국 대행 수수료 (장당)", unit: "KRW" },
      { id: "misc_krw",            label_ko: "기타 비용",                  unit: "KRW" },
      { id: "grading_fee_psa_usd", label_ko: "PSA 장당 비용",              unit: "USD" },
      { id: "grading_fee_bgs_usd", label_ko: "BGS 장당 비용",              unit: "USD" },
      { id: "grading_fee_cgc_usd", label_ko: "CGC 장당 비용",              unit: "USD" },
      { id: "grading_fee_sgc_usd", label_ko: "SGC 장당 비용",              unit: "USD" }
    ],
    output_fields: [
      "회사별 그레이딩 비용 합계 (KRW)",
      "대행·배송·기타 비용 합계 (KRW)",
      "회사별 장당 예상 비용 (KRW)",
      "회사별 총 예상 비용 (KRW)",
      "입력값 기준 최저 비용 옵션 자동 하이라이트",
      "수량별 참고 코멘트 (1~2장 / 3~4장 / 5장 이상)"
    ],
    formulas: {
      grading_fee_krw: "grading_fee_usd × exchange_rate × quantity",
      agency_fee_total: "(mode == 'agency') ? agency_fee_per_card_krw × quantity : 0",
      total_cost_krw: "grading_fee_krw + agency_fee_total + shipping_insurance_krw + misc_krw",
      per_card_krw: "total_cost_krw / quantity"
    },
    disclaimers: [
      "이 계산기는 입력값 기반 참고용입니다.",
      "기본값은 예시이며 공식 확정값이 아닙니다.",
      "실제 비용은 카드 신고가, 서비스 등급, 환율, 배송비, 보험료, 각 회사 정책, 한국 대행 수수료에 따라 달라질 수 있습니다.",
      "발송 전 반드시 각 그레이딩 회사 공식 페이지와 이용 대행사 안내를 확인하세요.",
      "수익 보장, 무조건 이득, 투자 추천 등의 표현을 카드픽은 사용하지 않습니다.",
      "특정 한국 대행업체를 추천하지 않습니다."
    ],
    related_guides: [
      { title: "PSA 그레이딩 신청 가이드 - 한국에서 보내는 법", url: "https://cardpick.kr/guide-psa-grading-korea" },
      { title: "PSA · BGS · CGC 비교 - 어디로 보낼까", url: "https://cardpick.kr/guide-grading-comparison" },
      { title: "카드 보관 가이드 - 슬리브·탑로더·Card Saver 1", url: "https://cardpick.kr/guide-card-storage" }
    ],
    related_tools: [
      { title: "PSA 그레이딩 손익분기 계산기", url: "https://cardpick.kr/tools/psa-grading-break-even" }
    ],
    official_references: [
      "https://www.psacard.com/services/tradingcardgrading",
      "https://www.beckett.com/grading/",
      "https://www.cgcgrading.com/en-US/grading/cards",
      "https://gosgc.com/services/"
    ],
    last_updated: "2026-05-28"
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
