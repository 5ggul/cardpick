#!/usr/bin/env python3
"""Apply the idempotent card metadata schema using the protected DB secret."""

import os
import sys
from pathlib import Path

import psycopg2


def main():
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not password:
        raise RuntimeError("SUPABASE_DB_PASSWORD is required")
    sql_path = Path(__file__).resolve().parent.parent / "supabase" / "schema_v7_card_metadata.sql"
    sql = sql_path.read_text(encoding="utf-8")
    connection = psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-northeast-2.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "6543")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.aqxrmdratnkffvivguqs"),
        password=password, dbname="postgres", sslmode="require", connect_timeout=30,
    )
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql)
            cursor.execute("""select column_name from information_schema.columns
                              where table_schema='public' and table_name='cards'
                                and column_name in ('hp','supertype','subtypes')
                              order by column_name""")
            columns = [row[0] for row in cursor.fetchall()]
        if columns != ["hp", "subtypes", "supertype"]:
            raise RuntimeError(f"metadata columns verification failed: {columns}")
        print("metadata_columns=hp,subtypes,supertype")
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERR: {error}", file=sys.stderr)
        sys.exit(1)
