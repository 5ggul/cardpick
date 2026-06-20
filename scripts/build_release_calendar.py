#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
발매 캘린더 정적 HTML 자동 생성 (매일 cron).
- data/release-calendar.json (공식 검증 JP/KR/global) 읽기
- pokemontcg.io API로 신규 영문판(en) 발매 자동 보강 (실패해도 비치명)
- 오늘 기준 다가오는/최근 자동 분리 + 날짜순 정렬
- releases.html 의 CAL:UPCOMING / CAL:RECENT 마커 사이를 교체
정직(§4): 추정일 생성 금지. 큐레이션 JSON + 공식 API만 사용.
"""
import json, os, re, sys, datetime, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "release-calendar.json")
HTML = os.path.join(ROOT, "releases.html")

REGION = {
    "en":     ("\U0001F1FA\U0001F1F8 영문판", "chip",          "en"),
    "jp":     ("\U0001F1EF\U0001F1F5 일본판", "chip",          "jp"),
    "kr":     ("\U0001F1F0\U0001F1F7 한국판", "chip",          "kr"),
    "global": ("\U0001F310 글로벌 동시",       "chip chip-pokemon", "jp en"),
}

def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

def fetch_api_en(today):
    """pokemontcg.io 공식 API로 영문판 세트 가져오기 (신규 자동 보강). 실패 시 빈 리스트."""
    try:
        req = urllib.request.Request(
            "https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=60",
            headers={"User-Agent": "cardpick-calendar/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.load(r)
        out = []
        for s in body.get("data", []):
            rd = (s.get("releaseDate") or "").replace("/", "-")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", rd):
                continue
            # 최근 120일 ~ 미래만
            d = datetime.date.fromisoformat(rd)
            if (today - d).days > 120:
                continue
            out.append({"region": "en", "name": s.get("name", ""), "sub": "",
                        "date": rd, "products": "", "source": "pokemontcg.io",
                        "url": "https://pokemontcg.io/"})
        return out
    except Exception as e:
        print(f"[warn] pokemontcg.io fetch 실패 (큐레이션만 사용): {e}")
        return []

def row_html(e):
    label, chipcls, dr = REGION.get(e["region"], REGION["en"])
    date_dot = e["date"].replace("-", ".") if e.get("date") else "미정"
    sub = f' <span class="text-muted text-[12px]">{esc(e["sub"])}</span>' if e.get("sub") else ""
    src = ""
    if e.get("url") and e.get("source"):
        src = (f' · <a href="{esc(e["url"])}" target="_blank" rel="noopener nofollow" '
               f'class="underline-mint">{esc(e["source"])} ↗</a>')
    prod = esc(e.get("products", ""))
    meta = (prod + src) if (prod or src) else ""
    meta_div = f'<div class="text-muted text-[12px] mt-0.5">{meta}</div>' if meta else ""
    return (
        f'<tr class="cal-row" data-region="{dr}" data-date="{esc(e.get("date",""))}">'
        f'<td class="mono whitespace-nowrap">{date_dot}</td>'
        f'<td><span class="{chipcls}">{label}</span></td>'
        f'<td><div class="text-ink font-medium">{esc(e["name"])}{sub}</div>{meta_div}</td>'
        f'<td class="text-right" data-dday></td>'
        f'</tr>'
    )

KR_PENDING = (
    '<tr class="cal-row" data-region="kr" data-date="">'
    '<td class="mono whitespace-nowrap text-muted">미정</td>'
    '<td><span class="chip">\U0001F1F0\U0001F1F7 한국판</span></td>'
    '<td><div class="text-ink font-medium">다음 한국판 정식 발매 미확정</div>'
    '<div class="text-muted text-[12px] mt-0.5">포켓몬코리아 공식 발표 전까지 추정 발매일은 게시하지 않습니다 · '
    '<a href="https://pokemonkorea.co.kr/" target="_blank" rel="noopener nofollow" class="underline-mint">pokemonkorea.co.kr ↗</a></div></td>'
    '<td class="text-right mono text-[11px] text-muted">대기</td></tr>'
)

def replace_region(html, tag, inner):
    start, end = f"<!-- CAL:{tag}:START -->", f"<!-- CAL:{tag}:END -->"
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pat.search(html):
        print(f"[ERROR] 마커 {tag} 없음 — 중단 (releases.html 손상 방지)")
        sys.exit(1)
    return pat.sub(start + "\n" + inner + "\n" + end, html)

def main():
    today = datetime.date.today()
    cur = json.load(open(DATA, encoding="utf-8"))["entries"]
    api = fetch_api_en(today)

    # 병합: 큐레이션 우선. API en은 (날짜) 중복 아니면 추가
    cur_en_dates = {e["date"] for e in cur if e["region"] == "en"}
    merged = list(cur)
    for e in api:
        if e["date"] not in cur_en_dates:
            merged.append(e)
            cur_en_dates.add(e["date"])

    valid = [e for e in merged if e.get("date") and re.match(r"^\d{4}-\d{2}-\d{2}$", e["date"])]
    upcoming = sorted([e for e in valid if datetime.date.fromisoformat(e["date"]) >= today],
                      key=lambda x: x["date"])
    recent = sorted([e for e in valid if datetime.date.fromisoformat(e["date"]) < today],
                    key=lambda x: x["date"], reverse=True)[:10]

    up_html = "\n".join(row_html(e) for e in upcoming) + "\n" + KR_PENDING
    re_html = "\n".join(row_html(e) for e in recent)

    html = open(HTML, encoding="utf-8").read()
    html = replace_region(html, "UPCOMING", up_html)
    html = replace_region(html, "RECENT", re_html)
    open(HTML, "w", encoding="utf-8", newline="").write(html)

    print(f"[ok] 캘린더 생성: 다가오는 {len(upcoming)}건(+KR미정) / 최근 {len(recent)}건 "
          f"/ API보강 {len([e for e in merged if e.get('source')=='pokemontcg.io'])}건 / today={today}")

if __name__ == "__main__":
    main()
