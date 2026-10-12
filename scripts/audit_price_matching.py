#!/usr/bin/env python3
"""Offline, read-only review of the price pipeline's legacy matching keys.

Usage: python -B scripts/audit_price_matching.py --input catalog-export.json
       python -B scripts/audit_price_matching.py --input - < catalog-export.json

Accept a JSON array, or an object with a ``cards`` array. Only the public
identity fields below are inspected or emitted. Unknown fields and export
metadata are ignored. No credentials, environment variables, network, database,
provider API, or output files are used. A group is a review candidate, NEVER a
duplicate determination, a merge instruction, or proof of a wrong price.
"""

import argparse
import json
from pathlib import Path, PureWindowsPath
import re
import sys


MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_RECORDS = 100000
IDENTITY_FIELDS = (
    'slug', 'name', 'number', 'set_id', 'set_code', 'set_name', 'external_id',
    'external_id_provider', 'language', 'variant', 'rarity',
)
SET_FIELDS = ('set_id', 'set_code', 'set_name')
REQUIRED_FIELDS = ('slug', 'name', 'number')


class AuditInputError(ValueError):
    """A fixed error code; never includes raw input, paths, or credentials."""


# Keep these two functions identical to refresh_pokemon_tcg_api.py. Tests compare
# their ASTs without importing that production script or reading its environment.
def norm_num(n):
    if not n: return '0'
    s = str(n).split('/')[0].strip().lstrip('0') or '0'
    return s


def norm_name(s):
    if not s: return ''
    t = s.lower().strip()
    t = re.sub(r'\s*-\s*\d+\s*[/]\s*\d+\s*$', '', t)
    t = re.sub(r'\s*-\s*\d+\s*$', '', t)
    for src, dst in [('é','e'),('è','e'),('ô','o'),('â','a'),('í','i'),('•',''),('★','')]:
        t = t.replace(src, dst)
    t = re.sub(r'[\.\*]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def _rows(payload):
    if isinstance(payload, dict):
        payload = payload.get('cards')
    if not isinstance(payload, list):
        raise AuditInputError('CATALOG_ARRAY_REQUIRED')
    if len(payload) > MAX_RECORDS:
        raise AuditInputError('CATALOG_TOO_LARGE')
    rows = []
    for index, original in enumerate(payload):
        if not isinstance(original, dict):
            raise AuditInputError('CATALOG_ROW_OBJECT_REQUIRED')
        row = {'row_index': index}
        for field in IDENTITY_FIELDS:
            value = original.get(field)
            if value is not None and not isinstance(value, str):
                raise AuditInputError('IDENTITY_FIELD_STRING_REQUIRED')
            if value is not None and (len(value) > 1000 or any(ord(c) < 32 for c in value)):
                raise AuditInputError('INVALID_IDENTITY_TEXT')
            row[field] = value.strip() if value is not None else ''
        rows.append(row)
    return rows


def _members(rows):
    # Original export positions aid manual review. Sorting is stable and does
    # not change, combine, or drop any source record.
    return sorted(rows, key=lambda row: tuple(row[field] for field in IDENTITY_FIELDS)
                  + (row['row_index'],))


def _differences(rows):
    codes = []
    for field, code in (
        ('set_id', 'SET_ID_CONFLICT'), ('set_code', 'SET_CODE_CONFLICT'),
        ('set_name', 'SET_NAME_DIFFERENCE'), ('number', 'NUMBER_SPELLING_DIFFERENCE'),
        ('name', 'NAME_SPELLING_DIFFERENCE'), ('language', 'LANGUAGE_DIFFERENCE'),
        ('variant', 'VARIANT_DIFFERENCE'), ('rarity', 'RARITY_DIFFERENCE'),
    ):
        if len({row[field] for row in rows if row[field]}) > 1:
            codes.append(code)
    if any(any(not row[field] for field in SET_FIELDS) for row in rows):
        codes.append('SET_IDENTITY_INCOMPLETE')
    if any(any(not row[field] for field in ('language', 'variant')) for row in rows):
        codes.append('PRINT_IDENTITY_INCOMPLETE')
    return codes


def audit_catalog(payload):
    """Return deterministic review candidates without mutating ``payload``."""
    rows = _rows(payload)
    legacy = {}
    external = {}
    incomplete = []
    eligible = 0
    for row in rows:
        missing = [field for field in REQUIRED_FIELDS if not row[field]]
        missing_set = [field for field in SET_FIELDS if not row[field]]
        if missing or missing_set:
            incomplete.append({
                'row_index': row['row_index'], 'slug': row['slug'],
                'missing_identity_fields': missing, 'missing_set_fields': missing_set,
            })
        # Production normalizes a missing number to "0". Do not turn missing
        # identifiers into a convincing collision with a genuine number 0 here.
        if not missing:
            eligible += 1
            key = (norm_name(row['name']), norm_num(row['number']))
            legacy.setdefault(key, []).append(row)
        if row['external_id']:
            # Explicit namespaces remain separate. Never infer a provider from
            # a numeric ID, slug, set code, or source API ID spelling.
            key = (row['external_id_provider'], row['external_id'])
            external.setdefault(key, []).append(row)

    legacy_groups = []
    for (name, number), group in sorted(legacy.items()):
        if len(group) < 2:
            continue
        codes = _differences(group)
        legacy_groups.append({
            'legacy_key': {'name': name, 'number': number},
            'record_count': len(group),
            'issue_codes': ['MULTIPLE_RECORDS_SHARE_LEGACY_KEY'] + codes,
            'members': _members(group),
        })

    external_groups = []
    for (provider, external_id), group in sorted(external.items()):
        if len(group) < 2:
            continue
        codes = _differences(group)
        signatures = {tuple(row[field] for field in IDENTITY_FIELDS
                            if field not in ('slug', 'external_id', 'external_id_provider'))
                      for row in group}
        external_groups.append({
            'provider': provider or None, 'external_id': external_id,
            'provider_verified': False,
            'record_count': len(group),
            'identity_ambiguity': len(signatures) > 1,
            'issue_codes': ['EXTERNAL_ID_REUSED']
                + ([] if provider else ['EXTERNAL_ID_PROVIDER_UNKNOWN']) + codes,
            'members': _members(group),
        })

    return {
        'schema_version': '1.0',
        'mode': 'offline_read_only',
        'scope': {
            'records_received': len(rows), 'records_with_legacy_key': eligible,
            'catalog_completeness': 'not_verified', 'source_prices_compared': False,
            'database_read': False, 'network_requests': 0,
        },
        'summary': {
            'legacy_key_review_groups': len(legacy_groups),
            'groups_with_different_set_identifiers': sum(
                bool({'SET_ID_CONFLICT', 'SET_CODE_CONFLICT', 'SET_NAME_DIFFERENCE'}
                     .intersection(group['issue_codes'])) for group in legacy_groups),
            'external_id_review_groups': len(external_groups),
            'external_id_ambiguity_groups': sum(group['identity_ambiguity'] for group in external_groups),
            'external_id_provider_unknown_records': sum(
                bool(row['external_id']) and not row['external_id_provider'] for row in rows),
            'external_id_missing_records': sum(not row['external_id'] for row in rows),
            'incomplete_identity_records': len(incomplete),
        },
        'legacy_key_groups': legacy_groups,
        'external_id_groups': external_groups,
        'incomplete_records': incomplete,
        'limitations': [
            'Only supplied export records were inspected; no complete-catalog claim is made.',
            'Shared legacy keys are review candidates, not confirmed duplicates or wrong prices.',
            'Set identifiers and explicitly supplied provider names require independent verification.',
            'Number denominators, languages, variants and rarities are retained; no records are merged.',
            'No prices, redirects, canonical URLs, indexing policy, or stored records were changed.',
        ],
    }


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise AuditInputError('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def _invalid_constant(_value):
    raise AuditInputError('INVALID_JSON')


def read_catalog(path):
    # A Windows UNC path can cause network I/O through an ordinary file open;
    # named pipes/device paths are not catalog files either. Reject these and
    # URL schemes before touching the filesystem. Normal drive paths, including
    # drive-relative paths, and ordinary relative paths remain supported.
    if not isinstance(path, str):
        raise AuditInputError('LOCAL_FILE_REQUIRED')
    candidate = path.lstrip()
    scheme = re.match(r'^([A-Za-z][A-Za-z0-9+.-]*):', candidate)
    if path != '-' and (
        candidate.startswith(('\\\\', '//', '/\\', '\\/'))
        or candidate.startswith(('\\??\\', '\\Device\\'))
        or (scheme is not None and len(scheme.group(1)) != 1)
        or PureWindowsPath(candidate).is_reserved()
    ):
        raise AuditInputError('LOCAL_FILE_REQUIRED')
    try:
        if path == '-':
            stream = getattr(sys.stdin, 'buffer', sys.stdin)
            raw = stream.read(MAX_INPUT_BYTES + 1)
        else:
            with Path(path).open('rb') as stream:
                raw = stream.read(MAX_INPUT_BYTES + 1)
    except (OSError, ValueError):
        raise AuditInputError('INPUT_READ_FAILED') from None
    if len(raw) > MAX_INPUT_BYTES:
        raise AuditInputError('INPUT_TOO_LARGE')
    try:
        text = raw.decode('utf-8-sig') if isinstance(raw, bytes) else raw.lstrip('\ufeff')
        return json.loads(text, object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    except AuditInputError:
        raise
    except (ValueError, RecursionError):
        # Includes decoding/JSON syntax failures and Python's integer digit
        # limit. Never print a parser traceback or the original input.
        raise AuditInputError('INVALID_JSON') from None


class _Parser(argparse.ArgumentParser):
    def error(self, _message):
        # argparse's default error includes user arguments, potentially paths
        # or accidental credentials. Keep failures deliberately generic.
        self.exit(2, '{"error":"INVALID_ARGUMENTS"}\n')


def main(argv=None):
    parser = _Parser(description=__doc__)
    parser.add_argument('--input', required=True, help='Local catalog JSON export, or - for stdin.')
    args = parser.parse_args(argv)
    try:
        report = audit_catalog(read_catalog(args.input))
    except AuditInputError as error:
        sys.stderr.write(json.dumps({'error': str(error)}) + '\n')
        return 2
    # ASCII-escaped JSON also works in Windows terminals without changing the
    # caller's encoding or leaking locale-dependent diagnostics.
    sys.stdout.write(json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
