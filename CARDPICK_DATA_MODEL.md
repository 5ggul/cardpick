# Cardpick 데이터 모델 · 진실 원천 (SSOT)

> 이 문서는 카드픽 가격 데이터 흐름의 단일 진실 원천이다.
> 같은 문제가 반복되지 않도록 모든 가격 관련 작업은 이 문서를 먼저 참조한다.
>
> 작성: 2026-05-19 (반복된 변동률 0% 사고 후 정립)

---

## 1. 데이터 소스 2개와 각 특성

| 출처 | 어디서 | 통화 | 갱신 빈도 | 변동성 | 용도 |
|---|---|---|---|---|---|
| **TCGCSV** | tcgcsv.com (TCGplayer 미러) | USD | 매일 새 스냅샷 | **극히 평탄** (TCGplayer market price가 거래 없으면 안 움직임) | "기준가" 표시 + 카드 카탈로그 |
| **Cardmarket** | Pokémon TCG API (`cardmarket.prices`) | EUR | API 자체에 avg1/avg7/avg30 내장 | **실 변동 있음** | "7일 변화율" 표시 |

### 1.1 절대로 섞으면 안 되는 것

- **USD prices**와 **EUR prices**를 같은 `variant`로 같은 행에 넣지 말 것
- 같은 카드의 두 출처 가격은 다른 `source` 컬럼으로만 구분 (`tcgplayer` vs `pokemontcg-cardmarket`)
- MV(`card_price_summary`)는 **USD 단일 통화만** 사용. EUR Cardmarket은 별도 `price_metrics_external`에 분리

### 1.2 과거 사고 사례 (반복 금지)

- 백필 시 Cardmarket prices를 USD 변환률로 `prices` 테이블에 함께 insert → MV가 같은 variant에 EUR/USD 섞어 +14,521% 같은 가짜 변동률 발생
- TCGCSV historical만으로 변동률 계산 → 인기 카드 변동률 모두 0% ("보합" 표시 폭주)

---

## 2. UI 요소 ↔ 데이터 소스 매핑 (필수)

| UI 영역 | 데이터 출처 | 컬럼 / 뷰 |
|---|---|---|
| 카드 카탈로그 검색 | DB cards | game='pokemon' (RLS) |
| 홈 시세표 **기준가** (KRW) | MV `card_price_summary_best.latest_krw` (TCGCSV USD × 환율) | `latest_krw` |
| 홈 시세표 **24H/7D 변동률** | **Cardmarket** `card_movement_cardmarket.change_7d_vs_30d_pct` | 단, 없으면 NULL → UI "데이터 수집 중" |
| 홈 시세표 **7일 흐름 sparkline** | TCGCSV `prices` 일별 (30일) | 평탄 = 평탄 (정직) |
| **상승 탭** | Cardmarket movement 양수 | `change_7d_vs_30d_pct > 0.5` desc |
| **하락 탭** | Cardmarket movement 음수 | `change_7d_vs_30d_pct < -0.5` asc |
| **전체 탭** | TCGCSV samples_7d ≥ 3 + 가격 desc | `card_price_summary_best` |
| **관심 탭** | TCGCSV 표본 ≥ 5 AND 기준가 ≥ 5만원 | `samples_7d >= 5 AND latest_krw >= 50000` |
| 카드 상세 7/14/30 박스 중앙값 | MV `median_7d/14d/30d` | TCGCSV 기반 |
| 카드 상세 변동률 | **Cardmarket** 우선, 없으면 MV change_*_pct | merge 로직 |
| 카드 상세 가격 추이 차트 | TCGCSV `prices` 30일 historical | 평탄해도 렌더 |
| `/hot` 페이지 rising_7d | Cardmarket movement (`change_7d_vs_30d_pct`) | top 10 |
| `/hot` 페이지 rising_30d | TCGCSV MV `change_30d_pct` | abs desc |

---

## 3. 절대 불변 규칙 (Invariants)

### 3.1 통화 분리
- `prices.source = 'tcgplayer'`: USD 가격 (TCGCSV)
- `prices.source = 'pokemontcg-cardmarket'`: **금지** — 별도 `price_metrics_external`로만 보관
- MV `card_price_summary`는 `WHERE source='tcgplayer'`만 포함

### 3.2 RLS (게임 격리)
- `cards` 테이블 SELECT policy: `game = 'pokemon'` 만 anon에 노출
- `prices` 테이블 SELECT policy: pokemon 카드의 행만 노출
- `price_latest` 동일
- MV는 자체 `WHERE c.game='pokemon'` 절 (RLS 우회되는 MV 대비 이중방어)

### 3.3 변동률 NULL 정책
- distinct day < 2 → NULL (가짜 복제 데이터 방지)
- UI: NULL → "데이터 수집 중" / 0% → "변동 없음 (0.0%)" / 그 외 ▲▼ %

### 3.4 캐시
- 모든 `/api/*`, `/cards/*`, `/hot`: `Cache-Control: no-store, max-age=0`
- 정적 HTML: `no-cache, must-revalidate` (MVP 안정화 전)
- 안정화 후엔 5분 캐시로 완화 가능

### 3.5 데이터 백필 금지 패턴
- 같은 현재가를 과거 날짜로 복제 → **금지**
- TCGCSV `/prices?date=YYYY-MM-DD`만 사용 (각 날짜의 실제 그 날 시점 marketPrice)
- 백필 후 MV refresh **필수**

### 3.6 ★★★ Mock / Sample / 가짜 데이터 절대 금지 (2026-05-19, 반복 사고 후 추가)

**모든 사용자 노출 데이터는 진짜 출처에서 온 진짜 값이어야 한다.**

#### 절대 금지
- 같은 가격을 N일에 복제하여 "history"로 위장 → distinct price 값이 N일 동안 1~2개면 즉시 사고
- "예시", "샘플", "mock", "demo" 명목으로 본문 / API 응답에 박힌 숫자
- 표본 수, 등락률, 가격을 임의 생성 (random / faker / 고정 더미 값)
- 통화 환산 시 환율을 임의 가정 (반드시 실시간 환율 또는 명시 환율)
- UI에 placeholder 일러스트 / 카드 이미지로 임시 박는 행위

#### 검증 의무 (모든 가격 작업 후)
다음 쿼리 결과가 **모두 통과**해야 commit / deploy:

```sql
-- Q1 [중복 행 검증]: 같은 (card_slug, fetched_at::date, variant) 중복 0
select count(*) from (
  select card_slug, fetched_at::date, variant, count(*) as c
  from prices group by 1,2,3 having count(*) > 1
) t;
-- 목표: 0

-- Q2 [source 단일화]: pokemontcg-tcgplayer 같은 중복 source 0
select source, count(*) from prices group by source;
-- 목표: tcgplayer 만 존재 (TCGCSV) + EUR 데이터는 price_metrics_external 에만

-- Q3 [latest_krw 누락]: pokemon 카드 중 NULL latest_krw 비율 < 5%
select count(*) filter (where s.latest_krw is null) * 100.0 / count(*) as null_pct
from cards c
left join card_price_summary_best s on s.card_slug=c.slug
where c.game='pokemon';
-- 목표: <5% (Cardmarket 전용 카드는 NULL일 수 있음)

-- Q4 [sparkline 진짜 변동 검증]: Cardmarket 4-point 가진 카드 수 ≥ 1500
select count(*) from price_metrics_external 
where source='pokemontcg-cardmarket' 
  and ext_avg_30d is not null and ext_avg_7d is not null;
-- 목표: ≥1500 (sparkline 진짜 변동 시각화 가능)

-- Q5 [Cardmarket 4-point distinct 비율]: 평균값 4개가 모두 같은 카드 비율 < 20%
select count(*) filter (where (ext_avg_24h=ext_avg_7d and ext_avg_7d=ext_avg_30d)) * 100.0 / count(*)
from price_metrics_external where source='pokemontcg-cardmarket' and ext_avg_30d is not null;
-- 목표: <20% (대부분 카드가 실제 시계열 변동을 보여줌)
```

#### 데이터 출처 매핑 (재확인)
| UI 표시 | 출처 | 대체 불가 |
|---|---|---|
| sparkline (7일 흐름) | Cardmarket avg30/avg7/avg1 3-point (실 변동) 또는 TCGCSV `historical-prices/{date}` 진짜 archive | 같은 가격 복제 절대 금지 |
| 카드 상세 차트 | 위와 동일 | placeholder 가로선 금지 (대신 "데이터 수집 중" UI) |
| 24H / 7D 변동률 | Cardmarket avg1 vs avg7 vs avg30 | 임의 산출 금지 |
| 기준가 (KRW) | TCGCSV market price × 실시간 USD→KRW | 환율 가정 금지 |
| 표본 수 | DB `count()` 실측치 | "약 N개" 금지 |

#### 위반 시 절차
1. 즉시 해당 데이터 DB에서 삭제 (롤백)
2. UI는 "데이터 수집 중" placeholder로 명시 표시
3. 진짜 출처 fetch 로직 작성 → cron 등록 후 재공급
4. 사용자에게 보고 (사고 / 수정 내역 / 재발 방지)

**핵심:** 데이터가 없으면 **"없음"** 으로 표시해라. 가짜로 채우지 마라. 사용자는 "정직한 빈칸" 신뢰하고 "그럴듯한 거짓말" 분노한다.

---

## 4. 변경할 때 체크리스트

코드/스키마/배포 변경 전:

- [ ] 이 문서 읽었는가
- [ ] 변경 대상 UI 요소의 "데이터 출처"가 매핑 표에 있는가
- [ ] EUR/USD 섞지 않는가
- [ ] RLS 정책 깨지 않는가
- [ ] MV refresh 트리거 빠지지 않는가
- [ ] 캐시 정책 위반 없는가
- [ ] 사용자 화면 OP/JustTCG 문구·DB 노출 0건 검증
- [ ] `rg -i "원피스|onepiece|justtcg"` 공개 표면 0건

---

## 5. 알려진 데이터 한계 (사용자 안내)

### 5.1 TCGplayer market price = 실거래 없으면 안 움직임
TCGCSV가 그 데이터를 그대로 미러링. 인기 카드도 며칠~몇 주 같은 값. 정상.

### 5.2 Cardmarket 변동률 = EU 거래량 기반
- US 시장과 다를 수 있음
- 일부 카드(특히 미국 한정 promo)는 Cardmarket 데이터 없음 → 7D 변동률 NULL
- 사용자 화면에서 "Cardmarket 7일 평균 vs 30일 평균"임을 명시

### 5.3 "기준가"는 TCGplayer 북미
- 국내 거래가 ≠ TCGplayer market price
- 카드 상세에 disclaimer 박스 필수

---

## 6. 운영 체크 (cron 후 매일 자동)

1. Pokemon TCG API → cardmarket avg7/avg30 fetch (set 단위 쿼리, name+number 매칭)
2. TCGCSV `/prices` 오늘자 fetch → `prices` 테이블 insert (source='tcgplayer')
3. 31일 초과 prices prune
4. MV refresh (`refresh_card_price_summary()`)
5. `card_movement_cardmarket` 자동 갱신 (view라 즉시 반영)
6. `compute_hot_cards.py` 실행 → 5 카테고리 hot_cards 갱신

---

## 7. 데이터 흐름도

```
TCGCSV (USD)              Pokemon TCG API (EUR)
   ↓                              ↓
prices                  price_metrics_external
(source=tcgplayer)      (source=pokemontcg-cardmarket)
   ↓                              ↓
card_price_summary       card_movement_cardmarket (view)
(MV, change_*_pct)       (avg7 vs avg30)
   ↓                              ↓
   └──────── ticker.js (탭별 다른 view) ──────┘
                    ↓
              cardpick.kr UI
```
