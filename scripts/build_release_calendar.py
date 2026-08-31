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

# 지역 flag (게임명은 GAME dict에서 별도)
REGION_FLAG = {"en": "\U0001F1FA\U0001F1F8", "jp": "\U0001F1EF\U0001F1F5", "kr": "\U0001F1F0\U0001F1F7", "global": "\U0001F310"}

# 게임 라벨 (game 필드가 pokemon 이 아닐 때 chip 라벨).
GAME = {
    "pokemon":   None,  # 기본. REGION 라벨 사용
    "riftbound": "Riftbound",
    "onepiece":  "\U0001F3F4‍☠️ 원피스",
    "yugioh":    "\U0001F0CF 유희왕",
}

def _is_full_date(s):
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", s or ""))

def _is_month_only(s):
    return bool(re.match(r"^\d{4}-\d{2}$", s or ""))

def _valid_date(s):
    return _is_full_date(s) or _is_month_only(s)

def _sort_key(e):
    """정렬용 키. YYYY-MM 은 해당 월 말일로 취급."""
    d = e.get("date") or ""
    if _is_full_date(d): return d
    if _is_month_only(d): return d + "-31"
    return "9999-99-99"

def _display_date(d):
    if _is_full_date(d): return d.replace("-", ".")
    if _is_month_only(d): return d.replace("-", ".") + " 예정"
    return "미정"

def _row_iso_date(d):
    """data-date 속성용. YYYY-MM 은 빈 문자열 (D-day 계산 불가)."""
    return d if _is_full_date(d) else ""

def _game_of(e):
    return (e.get("game") or "pokemon").lower()

def _is_pokemon(e):
    return _game_of(e) == "pokemon"

def _chip_html(e):
    """지역+게임 chip. pokemon 은 기존과 동일 (호환)."""
    game = _game_of(e)
    label, chipcls, _dr = REGION.get(e["region"], REGION["en"])
    if game == "pokemon":
        return f'<span class="{chipcls}">{label}</span>'
    flag = REGION_FLAG.get(e["region"], "")
    game_lbl = GAME.get(game, game.title())
    return f'<span class="chip">{flag} {game_lbl}</span>'

def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

def fetch_api_en(today):
    """pokemontcg.io 공식 API로 영문판 세트 가져오기. 실패 시 빈 리스트."""
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
            d = datetime.date.fromisoformat(rd)
            if (today - d).days > 400:
                continue
            out.append({"region": "en", "name": s.get("name", ""), "sub": "",
                        "date": rd, "products": "", "source": "pokemontcg.io",
                        "url": "https://pokemontcg.io/"})
        return out
    except Exception as e:
        print(f"[warn] pokemontcg.io fetch 실패: {e}")
        return []

def fetch_tcgcsv(today):
    """TCGCSV (TCGplayer 무료 미러) — pokemontcg.io 죽어도 미래 발매 확보.
    categoryId 3 = Pokemon. publishedOn 이 세트 발매일. supplemental 제외."""
    try:
        req = urllib.request.Request(
            "https://tcgcsv.com/tcgplayer/3/groups",
            headers={"User-Agent": "cardpick-calendar/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.load(r)
        out = []
        for g in body.get("results", []):
            if g.get("isSupplemental"):
                continue
            pub = g.get("publishedOn") or ""
            rd = pub[:10] if len(pub) >= 10 else ""
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", rd):
                continue
            d = datetime.date.fromisoformat(rd)
            days_diff = (d - today).days
            if days_diff < -400 or days_diff > 365:
                continue
            out.append({"region": "en", "name": g.get("name", ""), "sub": "",
                        "date": rd, "products": "", "source": "TCGplayer",
                        "url": "https://www.tcgplayer.com/"})
        return out
    except Exception as e:
        print(f"[warn] TCGCSV fetch 실패: {e}")
        return []

def row_html(e):
    _label, _chipcls, dr = REGION.get(e["region"], REGION["en"])
    date_disp = _display_date(e.get("date", ""))
    iso = _row_iso_date(e.get("date", ""))
    # 월-only 인 경우 mono 셀에 date_disp ("2026.08 예정") 그대로. D-day 셀은 "예정" 표기.
    date_td_class = "mono whitespace-nowrap" if _is_full_date(e.get("date", "")) else "mono whitespace-nowrap text-muted"
    sub = f' <span class="text-muted text-[12px]">{esc(e["sub"])}</span>' if e.get("sub") else ""
    src = ""
    if e.get("url") and e.get("source"):
        src = (f' · <a href="{esc(e["url"])}" target="_blank" rel="noopener nofollow" '
               f'class="underline-mint">{esc(e["source"])} ↗</a>')
    prod = esc(e.get("products", ""))
    meta = (prod + src) if (prod or src) else ""
    meta_div = f'<div class="text-muted text-[12px] mt-0.5">{meta}</div>' if meta else ""
    # 월-only 는 D-day 자동계산 불가 → "예정" 텍스트 셀
    dday_td = ('<td class="text-right" data-dday></td>' if iso
               else '<td class="text-right mono text-[11px] text-muted">예정</td>')
    return (
        f'<tr class="cal-row" data-region="{dr}" data-game="{esc(_game_of(e))}" data-date="{esc(iso)}">'
        f'<td class="{date_td_class}">{esc(date_disp)}</td>'
        f'<td>{_chip_html(e)}</td>'
        f'<td><div class="text-ink font-medium">{esc(e["name"])}{sub}</div>{meta_div}</td>'
        f'{dday_td}'
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

def intro_sentence(upcoming):
    """다가오는 상위 3건으로 인트로 문장 자동 생성 (표와 항상 동기화).
    포켓몬만 필터 — 기존 SEO 신호(포켓몬 발매 검색 유입) 유지."""
    items = []
    for e in [x for x in upcoming if _is_pokemon(x)][:3]:
        lbl = REGION.get(e["region"], REGION["en"])[0].split(" ", 1)[-1]
        items.append(f"{lbl} {esc(e['name'])}({e['date']})")
    if not items:
        return "예정된 포켓몬 카드 발매 일정을 아래 표에서 D-day와 함께 확인하세요."
    return ("다가오는 포켓몬 카드 발매는 " + ", ".join(items)
            + "입니다. 아래 표에서 한국판·일본판·영문판 발매 일정을 D-day와 함께 확인하세요. 포켓몬 외 다른 TCG(Riftbound 등) 공식 발매도 함께 표기됩니다.")


def _ko_date(iso):
    y, m, d = iso.split("-")
    return f"{int(y)}년 {int(m)}월 {int(d)}일"


def _upcoming_items(upcoming, strong=False):
    """상위 3건을 '라벨 이름(YYYY년 M월 D일)' 리스트로. 포켓몬만·구체일 확정만.
    (§4: 월-only 는 hero/FAQ/스키마에 넣지 않음)"""
    out = []
    pk_only = [x for x in upcoming if _is_pokemon(x) and _is_full_date(x.get("date",""))]
    for e in pk_only[:3]:
        lbl = REGION.get(e["region"], REGION["en"])[0].split(" ", 1)[-1]
        name = esc(e["name"])
        date_ko = _ko_date(e["date"])
        if strong:
            out.append(f"{lbl} <strong>{name}</strong>(<strong>{date_ko}</strong>)")
        else:
            out.append(f"{lbl} {name}({date_ko})")
    return out


def hero_paragraph(upcoming):
    """hero 직답 문단 (AEO 인용 타깃) — 표와 동기화."""
    items = _upcoming_items(upcoming, strong=True)
    if not items:
        return "예정된 포켓몬 카드 발매 일정을 아래 표에서 D-day와 함께 확인하세요. 카드픽은 추정 날짜 없이 공식 발표만 게시합니다."
    return ("포켓몬 카드 다음 발매일은 공식 발표 기준으로 " + ", ".join(items)
            + "입니다. 아래 표에서 한국판·일본판·영문판 발매 일정을 D-day와 함께 확인하세요.")


def faq_answer_text(upcoming):
    """FAQ 1번 답변 (JSON-LD와 화면에 동일 문자열 주입 — 글자단위 일치)."""
    items = _upcoming_items(upcoming, strong=False)
    if not items:
        return "현재 공식 발표된 다가오는 발매 일정이 없습니다. 카드픽은 추정 날짜 없이 포켓몬코리아, pokemon-card.com, pokemon.com 공식 발표만 게시합니다."
    return ("공식 발표 기준으로 다가오는 주요 발매는 " + ", ".join(items)
            + "입니다. 카드픽은 추정 날짜 없이 포켓몬코리아, pokemon-card.com, pokemon.com 공식 발표만 게시합니다.")


def itemlist_script(upcoming):
    """다가오는 발매 ItemList JSON-LD 재생성. 포켓몬·구체일 확정만 (§4)."""
    pk_only = [x for x in upcoming if _is_pokemon(x) and _is_full_date(x.get("date",""))]
    els = []
    for i, e in enumerate(pk_only[:3], 1):
        lbl = REGION.get(e["region"], REGION["en"])[0].split(" ", 1)[-1]
        els.append({"@type": "ListItem", "position": i,
                    "name": f"{e['name']} ({lbl})",
                    "item": "https://cardpick.kr/releases#cal",
                    "description": f"{lbl} 발매일 {e['date']}"})
    data = {"@context": "https://schema.org", "@type": "ItemList",
            "name": "포켓몬 카드 다가오는 발매 일정",
            "description": "공식 발표가 확인된 포켓몬 카드 신규 세트의 발매일(한국판·일본판·영문판).",
            "itemListOrder": "https://schema.org/ItemListOrderAscending",
            "itemListElement": els}
    return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + "\n</script>"

def main():
    today = datetime.date.today()
    cur = json.load(open(DATA, encoding="utf-8"))["entries"]
    api = fetch_api_en(today)
    tcg = fetch_tcgcsv(today)

    # 병합 순서: 큐레이션 → pokemontcg.io → TCGCSV (fallback). 날짜 중복 시 앞선 소스 유지.
    cur_en_pokemon_dates = {e["date"] for e in cur if e["region"] == "en" and _game_of(e) == "pokemon"}
    merged = list(cur)
    for e in api:
        e.setdefault("game", "pokemon")
        if e["date"] not in cur_en_pokemon_dates:
            merged.append(e)
            cur_en_pokemon_dates.add(e["date"])
    for e in tcg:
        e.setdefault("game", "pokemon")
        if e["date"] not in cur_en_pokemon_dates:
            merged.append(e)
            cur_en_pokemon_dates.add(e["date"])

    # 유효 날짜: YYYY-MM-DD 또는 YYYY-MM
    valid = [e for e in merged if _valid_date(e.get("date", ""))]

    def _cmp_today(e):
        d = e.get("date", "")
        if _is_full_date(d): return datetime.date.fromisoformat(d)
        # 월-only 는 그 달의 1일 기준으로 "미래인가" 판단 (이번 달·미래 → upcoming, 지난 달 → recent)
        y, m = d.split("-")
        return datetime.date(int(y), int(m), 1)

    upcoming_all = [e for e in valid if _cmp_today(e) >= datetime.date(today.year, today.month, 1)]
    # 다가오는: 정렬 (확정일 우선, 그 다음 월-only 는 해당 월 말일)
    upcoming = sorted(upcoming_all, key=_sort_key)
    # 최근: 완전 확정일만 (월-only 는 recent 로 잘 안 넘어감 — 확정 발표되면 재분류됨)
    recent = sorted(
        [e for e in valid if _is_full_date(e.get("date","")) and datetime.date.fromisoformat(e["date"]) < today],
        key=lambda x: x["date"], reverse=True)[:10]

    up_html = "\n".join(row_html(e) for e in upcoming) + "\n" + KR_PENDING
    re_html = "\n".join(row_html(e) for e in recent)

    html = open(HTML, encoding="utf-8").read()
    html = replace_region(html, "UPCOMING", up_html)
    html = replace_region(html, "RECENT", re_html)
    html = replace_region(html, "INTRO", intro_sentence(upcoming))
    # ★ 하드코딩이던 AEO 인용 타깃 4곳 동기화 (2026-07-19: 지난 발매일이 직답·FAQ·스키마에 남는 사고 방지)
    html = replace_region(html, "HERO", hero_paragraph(upcoming))
    html = replace_region(html, "LD-UPCOMING", itemlist_script(upcoming))
    faq_txt = faq_answer_text(upcoming)
    html = replace_region(html, "FAQ1", faq_txt)
    # FAQPage JSON-LD의 1번 답변을 화면과 동일 문자열로 교체 (글자단위 일치)
    html = re.sub(
        r'("name":"포켓몬 카드 다음 발매일은 언제인가요\?","acceptedAnswer":\{"@type":"Answer","text":")[^"]*(")',
        lambda m: m.group(1) + faq_txt + m.group(2),
        html)
    # 자동 갱신일 스탬프 (매일 cron이 today로 갱신 → "최종 검토 고정 날짜" stale 착시 제거)
    today_dot = today.strftime("%Y.%m.%d")
    today_iso = today.isoformat()
    html = re.sub(r'자동 갱신 \d{4}\.\d{2}\.\d{2}', f'자동 갱신 {today_dot}', html)
    html = re.sub(r'(article:modified_time" content=")[^"]*(")', rf'\g<1>{today_iso}T09:00:00+09:00\g<2>', html)
    open(HTML, "w", encoding="utf-8", newline="").write(html)

    api_n = len([e for e in merged if e.get('source')=='pokemontcg.io'])
    tcg_n = len([e for e in merged if e.get('source')=='TCGplayer'])
    print(f"[ok] 캘린더 생성: 다가오는 {len(upcoming)}건(+KR미정) / 최근 {len(recent)}건 "
          f"/ pokemontcg.io {api_n}건 / TCGCSV {tcg_n}건 / today={today}")

if __name__ == "__main__":
    main()
