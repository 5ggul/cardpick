#!/usr/bin/env python3
"""Collect public Pokemon TCG release/news candidates.

Dry-run only. This script does not write to the database.

Examples:
  python scripts/collect_tcg_trends.py --limit 20
  python scripts/collect_tcg_trends.py --json
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from xml.etree import ElementTree


SOURCES = {
    "jp_info": "https://www.pokemon-card.com/info/",
    "pokebeach_feed": "https://www.pokebeach.com/feed/",
    "elite_latest": "https://www.elitefourum.com/latest.json",
}

KEYWORDS = (
    "pokemon", "pokémon", "tcg", "card", "cards", "pack", "set", "promo",
    "release", "announced", "revealed", "graded", "psa", "market",
    "ポケモン", "カード", "発売", "商品", "拡張パック", "強化拡張パック", "プロモ", "イベント",
)


def fetch_text(url: str, timeout: int = 10) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "cardpick-trend-candidate/1.0 (+https://cardpick.kr)",
            "Accept": "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(req, timeout=timeout) as res:
        charset = res.headers.get_content_charset() or "utf-8"
        return res.read().decode(charset, errors="replace")


def clean_markup(value: str) -> str:
    value = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", value or "")
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def looks_relevant(title: str) -> bool:
    lower = (title or "").lower()
    return any(keyword.lower() in lower for keyword in KEYWORDS)


def classify(title: str) -> str:
    lower = (title or "").lower()
    if re.search(r"psa|bgs|cgc|graded|grading|グレーディング", lower):
        return "grading"
    if re.search(r"market|price|sales|auction|시세|価格|相場", lower):
        return "market"
    if re.search(r"release|announc|revealed|発売|商品|拡張パック|強化拡張パック|予約", lower):
        return "release"
    if re.search(r"promo|プロモ|event|イベント|campaign|キャンペーン", lower):
        return "event"
    if re.search(r"card list|カードリスト|reveals|revealed", lower):
        return "card_list"
    return "news"


def parse_pub_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).isoformat()
    except Exception:
        pass
    match = re.search(r"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})", value)
    if not match:
        return None
    return f"{match.group(1)}-{match.group(2).zfill(2)}-{match.group(3).zfill(2)}T00:00:00+09:00"


def collect_jp_info() -> list[dict[str, Any]]:
    text = fetch_text(SOURCES["jp_info"])
    items: list[dict[str, Any]] = []
    for href, inner in re.findall(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>", text, flags=re.I):
        title = clean_markup(inner)
        if len(title) < 6 or not looks_relevant(title):
            continue
        items.append(
            {
                "source": "pokemon-card.com",
                "source_type": "official",
                "title": title,
                "url": urljoin(SOURCES["jp_info"], href),
                "published_at": parse_pub_date(title),
                "kind": classify(title),
                "country": "JP",
            }
        )
        if len(items) >= 30:
            break
    return items


def collect_pokebeach() -> list[dict[str, Any]]:
    text = fetch_text(SOURCES["pokebeach_feed"])
    root = ElementTree.fromstring(text)
    channel = root.find("channel")
    if channel is None:
        return []
    items: list[dict[str, Any]] = []
    for node in channel.findall("item")[:24]:
        title = clean_markup(node.findtext("title") or "")
        link = clean_markup(node.findtext("link") or "")
        pub_date = clean_markup(node.findtext("pubDate") or "")
        items.append(
            {
                "source": "PokéBeach",
                "source_type": "news",
                "title": title,
                "url": link,
                "published_at": parse_pub_date(pub_date),
                "kind": classify(title),
                "country": "GLOBAL",
            }
        )
    return items


def collect_elite_fourum() -> list[dict[str, Any]]:
    data = json.loads(fetch_text(SOURCES["elite_latest"]))
    users = {user.get("id"): user.get("username") for user in data.get("users", [])}
    topics = data.get("topic_list", {}).get("topics", [])
    items: list[dict[str, Any]] = []
    for topic in topics[:35]:
        title = topic.get("title") or ""
        posters = topic.get("posters") or []
        first_user_id = posters[0].get("user_id") if posters else None
        items.append(
            {
                "source": "Elite Fourum",
                "source_type": "community",
                "title": title,
                "url": f"https://www.elitefourum.com/t/{topic.get('slug')}/{topic.get('id')}",
                "published_at": topic.get("last_posted_at") or topic.get("created_at"),
                "kind": classify(title),
                "country": "GLOBAL",
                "views": topic.get("views") or 0,
                "replies": max((topic.get("posts_count") or 1) - 1, 0),
                "author": users.get(first_user_id),
            }
        )
    return items


def score(item: dict[str, Any]) -> int:
    value = 0
    if item.get("source_type") == "official":
        value += 50
    if item.get("kind") == "release":
        value += 35
    elif item.get("kind") == "card_list":
        value += 25
    elif item.get("kind") == "event":
        value += 20
    elif item.get("kind") in {"grading", "market"}:
        value += 15
    value += min(15, int((item.get("views") or 0) / 250))
    value += min(10, int((item.get("replies") or 0) / 5))
    return value


def collect_all() -> tuple[list[dict[str, Any]], list[str]]:
    collectors = (collect_jp_info, collect_pokebeach, collect_elite_fourum)
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    for collector in collectors:
        try:
            items.extend(collector())
        except Exception as exc:
            errors.append(f"{collector.__name__}: {exc}")

    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for item in items:
        if not looks_relevant(item.get("title", "")):
            continue
        key = (item.get("url") or item.get("title") or "").lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        item["priority"] = score(item)
        item["collected_at"] = datetime.utcnow().isoformat() + "Z"
        normalized.append(item)

    normalized.sort(key=lambda item: (item.get("priority") or 0, item.get("published_at") or ""), reverse=True)
    return normalized, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    items, errors = collect_all()
    items = items[: max(1, args.limit)]

    if args.json:
        print(json.dumps({"count": len(items), "errors": errors, "items": items}, ensure_ascii=False, indent=2))
    else:
        print(f"items={len(items)} errors={len(errors)}")
        for err in errors:
            print(f"WARN {err}", file=sys.stderr)
        for item in items:
            print(f"[{item['priority']:03d}] {item['source']} · {item['kind']} · {item['title']}")
            print(f"      {item['url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
