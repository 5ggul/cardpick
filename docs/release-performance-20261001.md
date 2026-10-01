# 발매 페이지 로컬 성능 보완 (2026-10-01)

운영 미배포. 기존 `codex/release-accuracy-20260930` 작업공간의 발매 정확성 수정 위에 성능 보완만 추가했다. 가격·카드 상세·DB·색인 정책·자동 갱신 워크플로는 이번 성능 작업에서 수정하지 않았다.

## 변경

- `releases.html`: 브라우저 Tailwind 생성기를 제거하고 동일 색상·클래스의 미리 생성한 CSS를 head에 포함. 검색·인증 스크립트는 순서를 유지한 `defer`로 로드.
- `scripts/releases-tailwind.config.cjs`, `styles/releases-base.css`, `scripts/inline-release-styles.mjs`: 발매 페이지 전용 빌드. 캘린더 생성기·클라이언트 동적 클래스도 수집하고, 이전 인라인 결과물은 스캔에서 제외하여 재빌드가 같은 결과를 내도록 했다.
- `scripts/build-release-fonts.mjs`, `styles/releases-fonts.css`: 고정 버전 Pretendard v1.3.9의 가변·분할 글꼴 선언 사용. 글꼴 바이너리는 수정하지 않았고, 모든 제공 문자 범위를 유지했다. IBM Plex Mono는 이미 저장소에 있는 파일을 재사용.
- 글꼴 선언은 비차단 로드와 noscript fallback을 제공. Pretendard에 `font-display: optional`을 적용하여 느린 첫 방문에서는 시스템 글꼴을 유지하고, 캐시 등으로 준비된 경우 기존 글꼴을 표시한다. 늦은 글꼴 교체로 읽던 내용이 밀리는 현상을 줄이기 위한 절충이다.
- `scripts/test-release-performance.mjs`: 본문·링크·동작 코드 보존, 색상, 반응형 클래스, 글꼴 경로·문자 범위, 스크립트 순서, canonical/robots/JSON-LD 검사.

## 측정

로컬 `http://127.0.0.1:4205/releases`, 높이 900px/DPR 1. 폭 320/375/768은 모바일 simulate, 1280/1440은 desktop preset. 운영 실사용자 지표가 아닌 실험실 측정이다.

| 폭 | 성능 | SEO | 접근성 | LCP | CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 320 | 96 | 100 | 95 | 2.476초 | 0.00013 |
| 375 | 97 | 100 | 95 | 2.468초 | 0.02298 |
| 768 | 97 | 100 | 95 | 2.526초 | 0.00052 |
| 1280 | 100 | 100 | 95 | 0.683초 | 0.00068 |
| 1440 | 100 | 100 | 95 | 0.680초 | 0.00057 |

수정 전 데스크톱 CLS는 1280px 0.200, 1440px 0.170. 태블릿 LCP는 2.992초였다. 수정 후 모든 폭에서 CLS < 0.1을 확인했다. **태블릿 LCP < 2.5초 기준은 아직 미달이며, 전체 배포 게이트 통과로 처리하지 않는다.** 모바일도 경계에 가까워 운영 성능을 보장하지 않는다.

효과가 없던 하단 목록 `content-visibility` 실험은 제거했다(768px 2.533초). 글꼴 선언을 차단 CSS로 읽던 중간안도 제외했다. 이전 중간 점수나 가장 빠른 단일 결과를 최종값으로 대체하지 않았다.

최종 원본 보고서: 로컬 증거 폴더의 `cardpick-releases-verified-{width}-20261001.json`. 모두 `runtimeError: null`, `runWarnings: []`. Lighthouse 종료 시 Windows 임시 폴더 정리 단계의 EPERM이 발생했으므로 CLI 전체 성공이라고 주장하지 않는다. 초기 실험 768px 한 회의 NO_NAVSTART 측정은 무효로 제외했다.

## 검증과 제한

- Node 198개 + Python 29개 = 227개 테스트 통과. 스타일 빌드 재실행 결과 동일, 스크립트 구문·diff 공백 검사 통과.
- 최초 본문 SHA-256 `425d3d37632233427f167097729e2f19288b2576b45017db2ab4de37d545b5c2` 그대로 유지. 장기 회귀 테스트는 정상적인 매일 캘린더 갱신을 허용하도록 생성 영역 밖의 본문만 고정한다.
- 320/375/768/1280/1440 실제 화면 확인 및 가로 넘침 없음. 한국판·영문판·전체 필터와 참고 목록 앵커 이동 확인.
- `umbreon` 검색 입력 후 결과 목록 표시, 검색 닫기, 참고 목록의 보관 자료·원본 수정일 표시 확인. 가격 자체의 정확성 재감사는 이번 성능 작업 범위가 아니다.
- 실제 로그인·계정 변경·실사용자 INP·실제 iOS Safari·외부 구조화 데이터 검증 서비스는 실행하지 않았다. Lighthouse 접근성 점수는 완전한 접근성 인증이 아니다.
- 운영 배포, Git 커밋/푸시, 색인 요청·사이트맵 재제출 없음.

## 재생성

```powershell
node scripts/build-release-fonts.mjs
npm exec --yes --package=tailwindcss@3.4.17 -- tailwindcss -c scripts/releases-tailwind.config.cjs -i styles/guides.input.css -o styles/releases-base.css --minify
node scripts/inline-release-styles.mjs
node --test scripts/test-release-performance.mjs scripts/test-sets-api.mjs
```

글꼴 준비는 공급자 CSS를 다시 받는 명시적 빌드 작업이며, 일일 발매 갱신에 네트워크 의존성을 추가하지 않는다. 기존 클래스만 사용하는 일반 캘린더 갱신은 스타일 재빌드가 필요 없다. 새로운 UI 클래스를 추가할 때 위 빌드와 인라인 동기화를 함께 실행한다.

## 되돌리기

이번에 추가한 발매 전용 스타일 연결·인라인 블록·defer 변경만 역패치하고 전용 빌드/검증 파일을 제외한다. 기존 미커밋 발매 정확성 수정과 다른 카드 작업은 보존한다. 저장소 전체 초기화는 하지 않는다.
