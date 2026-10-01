#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the curated release calendar without fetching or inferring dates.

The lower third-party set browser is independent. TCGCSV publishedOn is not
evidence of a release date and is never imported here.
"""

import datetime
import html as html_module
import json
import os
import re
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "release-calendar.json")
HTML = os.path.join(ROOT, "releases.html")
KST = datetime.timezone(datetime.timedelta(hours=9))
REGION = {"en": ("영문판", "en"), "jp": ("일본판", "jp"), "kr": ("한국판", "kr"), "global": ("글로벌", "jp en")}
GAME = {"pokemon": "포켓몬", "riftbound": "Riftbound", "onepiece": "원피스", "yugioh": "유희왕"}
SOURCE_TYPES = {"official": "공식 발표", "press": "보도자료", "news": "뉴스 보도", "community": "커뮤니티 자료"}
MARKERS = ("UPCOMING", "RECENT", "INTRO", "HERO", "LD-UPCOMING", "FAQ1", "PENDING", "RECENT-INTRO", "RENDERED")
FAQ_QUESTION = "포켓몬 카드 다음 발매일은 언제인가요?"
NO_OFFICIAL_UPCOMING = "현재 이 목록에는 공식 원문에서 날짜를 확인한 포켓몬 카드 발매 예정 상품이 없습니다. 전체 공식 발표 목록을 뜻하지 않으므로 지역별 공식 안내에서 최신 일정을 확인해 주세요."
FULL_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
MONTH_RE = re.compile(r"[0-9]{4}-[0-9]{2}\Z")
SCRIPT_RE = re.compile(r"<script\b(?P<attrs>[^>]*)>(?P<body>.*?)</script\s*>", re.I | re.S)
JSON_TYPE_RE = re.compile(r"\btype\s*=\s*(['\"])application/ld\+json\1", re.I)
META_RE = re.compile(r"<meta\b[^>]*>", re.I)
MODIFIED_PROPERTY_RE = re.compile(r"\bproperty\s*=\s*(['\"])article:modified_time\1", re.I)
CONTENT_RE = re.compile(r"(\bcontent\s*=\s*)(['\"])(.*?)\2", re.I | re.S)


def today_kst(now=None):
    """Use Korea's date, independent of the cron host timezone."""
    current = now if now is not None else datetime.datetime.now(KST)
    if current.tzinfo is None:
        raise ValueError("now must include a timezone")
    return current.astimezone(KST).date()


def esc(value):
    return html_module.escape(str(value) if value is not None else "", quote=True)


def _full_date(value):
    if not isinstance(value, str) or not FULL_DATE_RE.fullmatch(value):
        raise ValueError("expected a YYYY-MM-DD date")
    return datetime.date.fromisoformat(value)


def _date_kind(value):
    if not isinstance(value, str):
        raise ValueError("release date must be a string")
    if FULL_DATE_RE.fullmatch(value):
        _full_date(value)
        return "day"
    if MONTH_RE.fullmatch(value):
        year, month = map(int, value.split("-"))
        # Validate a real month, but never publish or classify it as day one.
        datetime.date(year, month, 1)
        return "month"
    if value == "":
        return "unknown"
    raise ValueError("release date must be YYYY-MM-DD, YYYY-MM, or empty when unverified")


def validate_entries(entries, today, source_updated=None):
    if type(today) is not datetime.date:
        raise ValueError("today must be a date without a time")
    if source_updated is not None and _full_date(source_updated) > today:
        raise ValueError("source update date cannot be in the future")
    if not isinstance(entries, list):
        raise ValueError("entries must be a list")
    validated = []
    for index, original in enumerate(entries):
        if not isinstance(original, dict):
            raise ValueError(f"entry {index}: expected an object")
        entry = dict(original)
        for field in ("name", "source", "url"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"entry {index}: {field} is required")
        for field in ("sub", "products"):
            if field in entry and not isinstance(entry[field], str):
                raise ValueError(f"entry {index}: {field} must be a string")
        if entry.get("region") not in REGION:
            raise ValueError(f"entry {index}: unsupported region")
        entry.setdefault("game", "pokemon")
        if entry["game"] not in GAME:
            raise ValueError(f"entry {index}: unsupported game")
        if entry.get("source_type") not in SOURCE_TYPES:
            raise ValueError(f"entry {index}: source_type is required")
        if entry.get("verification") not in ("verified", "unverified"):
            raise ValueError(f"entry {index}: verification is required")
        kind = _date_kind(entry.get("date", ""))
        entry.setdefault("date", "")
        verified_on = entry.get("verified_on")
        if verified_on is not None and _full_date(verified_on) > today:
            raise ValueError(f"entry {index}: verification date cannot be in the future")
        if entry["verification"] == "verified":
            if verified_on is None:
                raise ValueError(f"entry {index}: verified entries need verified_on")
            if kind == "unknown":
                raise ValueError(f"entry {index}: verified entries need a recorded date or month")
        parsed_url = urlsplit(entry["url"])
        if parsed_url.scheme != "https" or not parsed_url.hostname or parsed_url.username or parsed_url.password:
            raise ValueError(f"entry {index}: source URL must be an HTTPS URL without credentials")
        validated.append(entry)
    return validated


def _sort_key(entry):
    return (entry["date"], entry["region"], entry["game"], entry["name"])


def classify_entries(entries, today):
    """Classify validated entries; retain distinct products on the same day."""
    upcoming, recent, pending = [], [], []
    for entry in entries:
        if entry["verification"] != "verified" or _date_kind(entry["date"]) != "day":
            pending.append(entry)
        elif _full_date(entry["date"]) >= today:
            upcoming.append(entry)
        else:
            recent.append(entry)
    return (sorted(upcoming, key=_sort_key), sorted(recent, key=_sort_key, reverse=True), sorted(pending, key=_sort_key))


def row_html(entry, pending=False):
    label, region_filter = REGION[entry["region"]]
    game_label = "" if entry["game"] == "pokemon" else GAME[entry["game"]] + " · "
    kind = _date_kind(entry["date"])
    display_date = entry["date"].replace("-", ".") if entry["date"] else "미확정"
    date_html = esc(display_date)
    if kind == "month":
        date_html += '<span class="block text-[11px] text-muted">일자 미확정</span>'
    iso_date = entry["date"] if kind == "day" and not pending else ""
    subtitle = f' <span class="text-muted text-[12px]">{esc(entry["sub"])}</span>' if entry.get("sub") else ""
    details = []
    if entry.get("products"):
        details.append(esc(entry["products"]))
    details.append(
        f'{SOURCE_TYPES[entry["source_type"]]}: '
        f'<a href="{esc(entry["url"])}" target="_blank" rel="noopener nofollow" '
        f'class="underline-mint">{esc(entry["source"])} ↗</a>'
    )
    if entry["verification"] == "verified":
        review_label = "공식 원문 확인" if entry["source_type"] == "official" else "출처 확인"
        details.append(f'{review_label}: {esc(entry["verified_on"].replace("-", "."))}')
    if pending:
        status = "출처 재확인 필요" if entry["verification"] != "verified" else "정확한 발매일 확인 필요"
        details.append(f'<strong>{status}</strong>')
        last_cell = '<td class="text-right mono text-[11px] text-muted">확인 필요</td>'
    else:
        last_cell = '<td class="text-right" data-dday></td>'
    return (
        f'<tr class="cal-row" data-region="{region_filter}" data-game="{esc(entry["game"])}" data-date="{esc(iso_date)}">'
        f'<td class="mono whitespace-nowrap">{date_html}</td>'
        f'<td><span class="chip">{esc(game_label + label)}</span></td>'
        f'<td><div class="text-ink font-medium">{esc(entry["name"])}{subtitle}</div>'
        f'<div class="text-muted text-[12px] mt-0.5">{" · ".join(details)}</div></td>{last_cell}</tr>'
    )


def _table_rows(entries, empty_message, pending=False):
    if entries:
        return "\n".join(row_html(entry, pending=pending) for entry in entries)
    return f'<tr class="cal-empty"><td colspan="4" class="text-muted">{esc(empty_message)}</td></tr>'


def _markers(html, tag):
    start, end = f"<!-- CAL:{tag}:START -->", f"<!-- CAL:{tag}:END -->"
    if html.count(start) != 1 or html.count(end) != 1:
        raise ValueError(f"CAL:{tag} requires exactly one start and end marker")
    left, right = html.index(start), html.index(end)
    if right < left:
        raise ValueError(f"CAL:{tag} markers are reversed")
    return start, end, left, right


def replace_region(html, tag, inner):
    start, end, left, right = _markers(html, tag)
    return html[:left] + start + "\n" + inner + "\n" + end + html[right + len(end):]


def _official_upcoming(upcoming):
    return [entry for entry in upcoming if entry["game"] == "pokemon" and entry["source_type"] == "official"][:3]


def _upcoming_items(entries, strong=False):
    items = []
    for entry in entries:
        day = _full_date(entry["date"])
        date_label = f"{day.year}년 {day.month}월 {day.day}일"
        region = REGION[entry["region"]][0]
        if strong:
            items.append(f'{region} <strong>{esc(entry["name"])}</strong>(<strong>{date_label}</strong>)')
        else:
            items.append(f'{region} {entry["name"]}({date_label})')
    return items


def faq_answer_text(official_upcoming):
    if not official_upcoming:
        return NO_OFFICIAL_UPCOMING
    return ("이 목록에서 공식 원문으로 확인한 포켓몬 카드 발매 예정 상품은 "
            + ", ".join(_upcoming_items(official_upcoming))
            + "입니다. 지역별 일정과 원문 확인일을 아래 표에서 확인하세요.")


def hero_paragraph(official_upcoming):
    if not official_upcoming:
        return esc(NO_OFFICIAL_UPCOMING)
    return ("이 목록에서 공식 원문으로 확인한 포켓몬 카드 발매 예정 상품은 "
            + ", ".join(_upcoming_items(official_upcoming, strong=True))
            + "입니다. 지역별 일정과 원문 확인일을 아래 표에서 확인하세요.")


def _json_for_script(value):
    # JSON-LD is HTML raw text: never allow a title to close its script element.
    return (json.dumps(value, ensure_ascii=False, indent=2)
            .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def itemlist_script(official_upcoming):
    items = []
    for position, entry in enumerate(official_upcoming, 1):
        region = REGION[entry["region"]][0]
        items.append({"@type": "ListItem", "position": position,
                      "name": f'{entry["name"]} ({region})', "item": "https://cardpick.kr/releases#cal",
                      "description": f'{region} 발매일 {entry["date"]}'})
    payload = {"@context": "https://schema.org", "@type": "ItemList",
               "name": "포켓몬 카드 다가오는 발매 일정",
               "description": "카드픽이 공식 원문에서 확인한 포켓몬 카드 발매일입니다. 전체 발표 목록을 뜻하지 않습니다.",
               "itemListOrder": "https://schema.org/ItemListOrderAscending", "itemListElement": items}
    return '<script type="application/ld+json">\n' + _json_for_script(payload) + "\n</script>"


def _objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _objects(child)


def _is_type(value, expected):
    types = value.get("@type", [])
    return types == expected or (isinstance(types, list) and expected in types)


def _update_faq_json(html, answer):
    matched_questions = 0

    def update(match):
        nonlocal matched_questions
        if not JSON_TYPE_RE.search(match["attrs"]):
            return match.group(0)
        value = json.loads(match["body"])
        modified = False
        for obj in _objects(value):
            if not _is_type(obj, "FAQPage"):
                continue
            questions = obj.get("mainEntity", [])
            if isinstance(questions, dict):
                questions = [questions]
            if not isinstance(questions, list):
                raise ValueError("FAQPage mainEntity must be a question list")
            for question in questions:
                if not isinstance(question, dict) or question.get("name") != FAQ_QUESTION:
                    continue
                accepted_answer = question.get("acceptedAnswer")
                if not isinstance(accepted_answer, dict):
                    raise ValueError("release FAQ needs an acceptedAnswer object")
                accepted_answer["text"] = answer
                matched_questions += 1
                modified = True
        if not modified:
            return match.group(0)
        return '<script' + match["attrs"] + '>\n' + _json_for_script(value) + "\n</script>"

    result = SCRIPT_RE.sub(update, html)
    if matched_questions != 1:
        raise ValueError("expected exactly one release-date question in FAQPage JSON-LD")
    return result


def _replace_modified(html, value):
    matched = 0

    def update(match):
        nonlocal matched
        tag = match.group(0)
        if not MODIFIED_PROPERTY_RE.search(tag):
            return tag
        if len(CONTENT_RE.findall(tag)) != 1:
            raise ValueError("modified_time needs one content attribute")
        matched += 1
        return CONTENT_RE.sub(lambda content: content[1] + content[2] + value + content[2], tag)

    result = META_RE.sub(update, html)
    if matched != 1:
        raise ValueError("expected one article:modified_time meta tag")
    return result


def _substantive_content(html):
    return _replace_modified(replace_region(html, "RENDERED", ""), "CONTENT_MODIFIED_DATE")


def render_page(html, entries, today, source_updated=None):
    """Pure renderer; validate all evidence and markers before returning HTML.

    RENDERED is a classification date, not a source review or content update.
    source_updated is the edited curation-file date; source review dates come
    only from each entry's verified_on.
    """
    checked = validate_entries(entries, today, source_updated)
    for tag in MARKERS:
        _markers(html, tag)
    before = _substantive_content(html)
    upcoming, recent, pending = classify_entries(checked, today)
    official = _official_upcoming(upcoming)
    answer = faq_answer_text(official)
    intro = ("카드픽이 확인한 자료에서 날짜가 명시된 일정은 오늘 이후와 과거 기록으로 나눴습니다. "
             "월만 알려졌거나 출처를 재확인해야 하는 항목은 날짜 확인 필요 표에 따로 표시합니다. "
             "각 행에서 지역, 출처 종류와 원문 확인일을 확인하세요.")
    if source_updated:
        intro += f' 자료 편집일: <time datetime="{source_updated}">{source_updated.replace("-", ".")}</time>.'
    replacements = {
        "UPCOMING": _table_rows(upcoming, "카드픽이 확인한 자료에는 날짜가 명시된 오늘 이후 일정이 없습니다."),
        "RECENT": _table_rows(recent, "카드픽이 확인한 자료에는 날짜가 명시된 과거 기록이 없습니다."),
        "PENDING": _table_rows(pending, "현재 날짜나 출처를 재확인할 항목이 없습니다.", pending=True),
        "INTRO": intro,
        "RECENT-INTRO": "아래는 날짜가 확인된 과거 발매 기록입니다. 지역과 출처를 구분하며, 전체 발매 목록을 뜻하지 않습니다.",
        "HERO": hero_paragraph(official), "LD-UPCOMING": itemlist_script(official), "FAQ1": esc(answer),
        "RENDERED": f'<time datetime="{today.isoformat()}">{today.strftime("%Y.%m.%d")}</time>',
    }
    result = html
    for tag, inner in replacements.items():
        result = replace_region(result, tag, inner)
    result = _update_faq_json(result, answer)
    if _substantive_content(result) != before:
        result = _replace_modified(result, today.isoformat())
    return result


def build_files(data_path=DATA, html_path=HTML, today=None):
    """Render completely before an atomic replacement; bad input preserves HTML."""
    day = today if today is not None else today_kst()
    with open(data_path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict) or "entries" not in payload:
        raise ValueError("curation data must contain entries")
    with open(html_path, encoding="utf-8", newline="") as handle:
        original = handle.read()
    rendered = render_page(original, payload["entries"], day, payload.get("_updated"))
    if rendered == original:
        return False
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", delete=False,
                                         dir=os.path.dirname(os.path.abspath(html_path)),
                                         prefix=".release-calendar-", suffix=".tmp") as handle:
            temporary_path = handle.name
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, html_path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
    return True


def main():
    try:
        day = today_kst()
        changed = build_files(DATA, HTML, day)
    except (OSError, ValueError) as error:
        print(f"[ERROR] release calendar unchanged: {error}", file=sys.stderr)
        return 1
    print(f'[ok] curated calendar {"updated" if changed else "unchanged"}; classification date (KST)={day}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
