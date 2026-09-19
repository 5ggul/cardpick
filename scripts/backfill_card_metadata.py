#!/usr/bin/env python3
"""Pokemon card metadata backfill planner.

Default mode is read-only and writes a CSV plan. Database writes require both
--apply and --confirm=BACKFILL_CARD_METADATA plus SUPABASE_DB_PASSWORD.
"""

import argparse
import csv
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

SUPA = "https://aqxrmdratnkffvivguqs.supabase.co"
KEY = "sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = ROOT / ".cache" / "card-quality" / "source-cards.json"
DEFAULT_OUTPUT = ROOT / "artifacts" / "card-quality" / "card-metadata-backfill-plan.csv"


def normalize(value):
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return re.sub(r"[^a-z0-9가-힣]+", "", text)


def source_key(card):
    set_id = (card.get("set") or {}).get("id") or card.get("set_id")
    return f"{normalize(card.get('name'))}|{normalize(card.get('number'))}|{normalize(set_id)}"


def rest_cards():
    base = "slug,external_id,name,set_id,number"
    fields = f"{base},hp,supertype,subtypes"
    rows = []
    metadata_schema = True
    for attempt_fields in (fields, base):
        rows.clear()
        try:
            for offset in range(0, 100000, 1000):
                query = urllib.parse.urlencode({
                    "select": attempt_fields, "order": "slug.asc", "limit": 1000, "offset": offset
                })
                request = urllib.request.Request(
                    f"{SUPA}/rest/v1/cards?{query}", headers={"apikey": KEY, "User-Agent": "CardpickMetadataBackfill/1.0"}
                )
                with urllib.request.urlopen(request, timeout=60) as response:
                    page = json.loads(response.read())
                rows.extend(page)
                if len(page) < 1000:
                    return rows, metadata_schema
        except Exception:
            if attempt_fields == base:
                raise
            metadata_schema = False
    return rows, metadata_schema


def load_source(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    cards = payload if isinstance(payload, list) else payload.get("cards", [])
    if not cards:
        raise RuntimeError(f"source cache is empty: {path}")
    return cards


def hp_value(card):
    raw = card.get("hp")
    try:
        return int(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None


def build_plan(db_cards, source_cards):
    by_id = {card.get("id"): card for card in source_cards if card.get("id")}
    by_key = {source_key(card): card for card in source_cards}
    plan = []
    unmatched = 0
    for db in db_cards:
        source = by_id.get(db.get("external_id")) or by_key.get(source_key(db))
        if not source:
            unmatched += 1
            continue
        plan.append({
            "slug": db["slug"],
            "source_id": source.get("id") or "",
            "hp": hp_value(source),
            "supertype": source.get("supertype") or "",
            "subtypes": "|".join(source.get("subtypes") or []),
            "old_hp": db.get("hp") if "hp" in db else "",
            "old_supertype": db.get("supertype") if "supertype" in db else "",
            "old_subtypes": "|".join(db.get("subtypes") or []) if "subtypes" in db else "",
        })
    return plan, unmatched


def write_plan(path, plan):
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["slug", "source_id", "hp", "supertype", "subtypes", "old_hp", "old_supertype", "old_subtypes"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(plan)


def apply_plan(plan):
    if not os.environ.get("SUPABASE_DB_PASSWORD"):
        raise RuntimeError("SUPABASE_DB_PASSWORD is required in apply mode")
    import psycopg2
    from psycopg2.extras import execute_values

    connection = psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
        password=os.environ["SUPABASE_DB_PASSWORD"], dbname="postgres", sslmode="require", connect_timeout=30,
    )
    connection.autocommit = False
    try:
        with connection.cursor() as cursor:
            cursor.execute("""select count(*) from information_schema.columns
                              where table_schema='public' and table_name='cards'
                                and column_name in ('hp','supertype','subtypes')""")
            if cursor.fetchone()[0] != 3:
                raise RuntimeError("schema_v7_card_metadata.sql must be applied first")
            values = [
                (row["slug"], row["hp"], row["supertype"] or None,
                 row["subtypes"].split("|") if row["subtypes"] else [])
                for row in plan
            ]
            execute_values(cursor, """update cards as c set
                hp=v.hp, supertype=v.supertype, subtypes=v.subtypes::text[], updated_at=now()
                from (values %s) as v(slug,hp,supertype,subtypes)
                where c.slug=v.slug""", values, page_size=500)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm", default="")
    options = parser.parse_args()

    db_cards, metadata_schema = rest_cards()
    source_cards = load_source(options.source_cache)
    plan, unmatched = build_plan(db_cards, source_cards)
    write_plan(options.output, plan)
    pokemon = sum(1 for row in plan if row["supertype"] in ("Pokémon", "Pokemon"))
    trainers = sum(1 for row in plan if row["supertype"] == "Trainer")
    energy = sum(1 for row in plan if row["supertype"] == "Energy")
    with_hp = sum(1 for row in plan if row["hp"] not in (None, ""))
    print(f"mode={'apply' if options.apply else 'dry-run'}")
    print(f"database_cards={len(db_cards)} source_cards={len(source_cards)} matched={len(plan)} unmatched={unmatched}")
    print(f"pokemon={pokemon} trainer={trainers} energy={energy} with_hp={with_hp}")
    print(f"metadata_schema={'ready' if metadata_schema else 'pending'}")
    print(f"plan={options.output}")
    if options.apply:
        if options.confirm != "BACKFILL_CARD_METADATA":
            raise RuntimeError("apply mode requires --confirm=BACKFILL_CARD_METADATA")
        apply_plan(plan)
        print(f"updated={len(plan)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERR: {error}", file=sys.stderr)
        sys.exit(1)
