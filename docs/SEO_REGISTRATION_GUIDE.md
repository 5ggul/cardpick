# 카드픽 SEO 검색엔진 등록 가이드 (사용자 액션)

자숙 중 안전하게 진행 가능한 외부 등록 작업. 모두 사용자가 직접 해야 함 (인증 필요).

## 1. ✅ Google Search Console (이미 완료)

```
https://search.google.com/search-console
```
- cardpick.kr 속성 등록됨
- HTML 태그 verification: `K3Ep7d7JjB4YKZqOsRgTBC92vn9B2WJqipiEjxWlupg`
- Sitemap 제출됨

**액션:** 매주 GSC → "Performance" 탭에서 노출 키워드 확인 → 사용자 답변용 자료

## 2. ✅ 네이버 서치어드바이저 (이미 완료)

```
https://searchadvisor.naver.com
```
- HTML 태그 verification: `7798d3ad52686bfb1db23aa95dcaf0e8700e3ead`
- Sitemap 제출 권장

**액션:** 사이트맵 다시 제출 (월 1회)

## 3. ❌ Bing Webmaster Tools (미완료, 추천)

### Step 1. 등록
```
https://www.bing.com/webmasters
```
"Add Site" → cardpick.kr 입력

### Step 2. Verification (3가지 방법 중 1개)

**옵션 A — GSC 연동 (가장 빠름)**
- "Import from Google Search Console" 클릭
- GSC 계정 연결 → 자동 verification

**옵션 B — HTML 태그**
- Bing이 주는 코드 (예: `XXXXXXXXXXX`) 복사
- `index.html` line 16 수정:
  ```html
  <meta name="msvalidate.01" content="REPLACE_WITH_BING_CODE">
  ```
  → REPLACE_WITH_BING_CODE를 받은 코드로 교체
- commit + push → Bing dashboard "Verify" 클릭

**옵션 C — XML 파일**
- Bing이 주는 BingSiteAuth.xml 다운로드
- cardpick.kr root에 업로드

### Step 3. Sitemap 제출
- Bing dashboard → "Sitemaps" → `https://cardpick.kr/sitemap.xml` 추가

## 4. ❌ 카카오 다음 검색 (미완료, 추천)

```
https://register.search.daum.net/index.daum
```
- 사이트 등록 → cardpick.kr
- 한국어 사이트 등록 시 비교적 빠르게 색인됨

## 5. ❌ Wikipedia / 위키 — Authority 강화

### 나무위키
- "카드픽" 또는 "한국 포켓몬 TCG 사이트" 항목에 자연 인용
- 본인 직접 작성은 self-promotion 위반. 자연스러운 외부 인용 유도.

### 위키백과 (Wikipedia 한국어)
- "포켓몬 TCG" 또는 "카드 게임" 관련 페이지 외부링크 섹션 검토

## 6. ❌ IndexNow API (Bing/Yandex 즉시 색인)

⚠ **자숙 중에는 사용 금지** (CLAUDE.md §2 색인 요청 절대 금지 룰).
자숙 끝나면 (1~3개월 후) 활성화 가능.

```
https://www.indexnow.org
```

활성화 시:
- API key 생성 (32자)
- cardpick.kr/{key}.txt 호스팅
- POST 시 즉시 색인 (Bing, Yandex, Seznam)

## 7. ❌ 소셜 자연 노출 (백링크 자연 획득)

### 한국 포켓몬 게이머 커뮤니티
- **디시인사이드 포켓몬 갤러리**: 자연스러운 가격 정보 인용 (도구 추천)
- **네이버 카페**: "포켓몬 카드 모임" 같은 카페에 정보 공유 (스팸 X)
- **유튜브 포켓몬 카드 채널**: 댓글이나 영상 내 자연 인용 유도

### 가이드 작성 + 외부 공유
- "PSA 그레이딩 신청 방법" 같은 가이드 작성
- 디시/카페에 자연 게재 (영업 X, 정보 공유 톤)

## 자숙 종료 후 (1~3개월) 확장 작업

1. IndexNow 활성화
2. Bing Sitemap 적극 푸시
3. 세트별 카테고리 페이지 (`/sets/sv8` 등) 발행
4. 인기 카드 트렌드 페이지 (`/top-pokemon-cards-2026`)
5. PSA 그레이딩 가이드 시리즈 (월 1편)
6. 일본 직구 가이드 (월 1편)
7. 인플루언서 협업 / 데이터 제공

## 현재 자숙 상태 진단

매주 GSC에서 다음 지표 확인 → 자숙 종료 시그널:
- **노출 수** > 100/일 (회복 시작)
- **클릭 수** > 5/일 (실제 트래픽 회복)
- **평균 게재 순위** < 50위 (랭킹 회복)

위 3개 모두 충족 시 자숙 종료 → 신규 페이지 발행 가능.

---

*마지막 업데이트: 2026-05-21*
