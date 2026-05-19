# 카드픽 (CARDPICK)

포켓몬·원피스 카드 가격, 발매정보, 커뮤니티 사이트.

- **도메인**: https://cardpick.kr
- **호스팅**: Cloudflare Pages
- **DB + Auth**: Supabase
- **가격 자동화**: GitHub Actions (1시간 cron)
- **이미지**: Cloudflare R2

## 디렉토리

```
/
├── index.html              # 메인 (가격 + 커뮤니티 허브)
├── card-detail.html        # 카드 상세 (가격 추이 차트)
├── set-detail.html         # 세트 상세 (박스 회수율)
├── releases.html           # 발매 정보
├── market.html             # 변동성·갭·PSA·캘린더·봉입률
├── tools.html              # 박스 ROI·직구·PSA 계산기
├── reports.html            # 주간 통계·발매·대회·메타 덱
├── board.html              # 게시판
├── guide-trade-safety.html # 거래 안전 가이드
├── robots.txt              # 검색엔진 크롤링 규칙
├── sitemap.xml             # 사이트맵
├── llms.txt                # AI 검색엔진용 사이트 정보
├── _headers                # Cloudflare Pages 보안/캐시 헤더
├── _redirects              # Cloudflare Pages 리다이렉트
├── .github/workflows/      # GitHub Actions cron
└── scripts/                # 가격 갱신 Node 스크립트
```

## 로컬 미리보기

```bash
# Python이 있으면
python -m http.server 8000
# 그러고 http://localhost:8000 접속
```

## 배포

GitHub `main` 브랜치에 push하면 Cloudflare Pages가 자동 배포.

## 데이터 출처

- 가격: eBay Browse API (30분 cron)
- 환율: exchangerate.host (1시간 cron)
- 카드 메타: pokemontcg.io / APITCG (1일 cron)
- 발매 일정: 포켓몬·반다이 공식 (1일 cron)

## 비용

연 15,000원 (가비아 도메인). 나머지 전부 무료 티어.

## 라이선스

- 자체 작성 텍스트: CC BY 4.0
- 카드 메타·가격 데이터: 각 원천 출처 정책 준수
