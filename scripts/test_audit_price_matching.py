"""Isolated fixtures only: no real provider, database, or production writes."""

import ast
import copy
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).with_name('audit_price_matching.py')
SPEC = importlib.util.spec_from_file_location('audit_price_matching', MODULE_PATH)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
PRIVATE = 'PRIVATE_TEST_TOKEN_must_never_be_printed'


def card(slug='fixture-a', **changes):
    record = {
        'slug': slug, 'name': 'Fixture Pokémon ex', 'number': '001/100',
        'set_id': 'fixture-set-a', 'set_code': 'FXA', 'set_name': 'Fixture Set A',
        'external_id': 'fixture-source-1', 'external_id_provider': 'fixture-provider',
        'language': 'en', 'variant': 'normal', 'rarity': 'Fixture Rarity',
    }
    record.update(changes)
    return record


class OfflineMatchingAuditTests(unittest.TestCase):
    def test_normalizers_exactly_match_production_ast_without_importing_it(self):
        production = ast.parse(MODULE_PATH.with_name('refresh_pokemon_tcg_api.py').read_text(encoding='utf-8'))
        own = ast.parse(MODULE_PATH.read_text(encoding='utf-8'))
        for name in ('norm_name', 'norm_num'):
            with self.subTest(name=name):
                left = next(n for n in production.body if isinstance(n, ast.FunctionDef) and n.name == name)
                right = next(n for n in own.body if isinstance(n, ast.FunctionDef) and n.name == name)
                self.assertEqual(ast.dump(left, include_attributes=False), ast.dump(right, include_attributes=False))

    def test_literal_number_contract_retains_prefixes_suffixes_and_case(self):
        cases = [(None, '0'), ('', '0'), ('000', '0'), ('001/100', '1'),
                 (' 0001 / 200 ', '1'), ('TG01/TG30', 'TG01'), ('001a/100', '1a'),
                 ('001A/100', '1A'), ('SWSH001', 'SWSH001')]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(audit.norm_num(value), expected)

    def test_literal_name_contract_is_not_a_new_fuzzy_matcher(self):
        cases = [('  Fixture   Pokémon EX - 001/100 ', 'fixture pokemon ex'),
                 ('Pikachu - 25', 'pikachu'), ('Mr. Mime*', 'mr mime'),
                 ('Ho-Oh', 'ho-oh'), ('Nidoran♀', 'nidoran♀'), ('Flabébé★', 'flabebe')]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(audit.norm_name(value), expected)

    def test_different_sets_are_candidates_not_confirmed_wrong_prices(self):
        records = [card(), card('fixture-b', number='1', set_id='fixture-set-b',
                               set_code='FXB', set_name='Fixture Set B')]
        report = audit.audit_catalog(records)
        self.assertEqual(report['summary']['groups_with_different_set_identifiers'], 1)
        group = report['legacy_key_groups'][0]
        self.assertEqual(group['legacy_key'], {'name': 'fixture pokemon ex', 'number': '1'})
        self.assertTrue({'SET_ID_CONFLICT', 'SET_CODE_CONFLICT', 'SET_NAME_DIFFERENCE'}
                        .issubset(group['issue_codes']))
        self.assertFalse(report['scope']['source_prices_compared'])
        self.assertIn('not confirmed duplicates or wrong prices', ' '.join(report['limitations']))
        self.assertNotIn('merge', group)

    def test_denominator_language_variant_and_rarity_are_never_dropped(self):
        records = [card(), card('fixture-b', number='001/200', language='ja',
                               variant='reverseHolofoil', rarity='Other Fixture Rarity')]
        group = audit.audit_catalog(records)['legacy_key_groups'][0]
        self.assertTrue({'NUMBER_SPELLING_DIFFERENCE', 'LANGUAGE_DIFFERENCE',
                         'VARIANT_DIFFERENCE', 'RARITY_DIFFERENCE'}.issubset(group['issue_codes']))
        self.assertEqual([row['number'] for row in group['members']], ['001/100', '001/200'])
        self.assertEqual([row['variant'] for row in group['members']], ['normal', 'reverseHolofoil'])
        self.assertEqual(group['record_count'], 2)

    def test_missing_set_fields_are_incomplete_not_conflicting(self):
        records = [card(), card('fixture-b', set_id=None, set_code='', set_name=None)]
        report = audit.audit_catalog(records)
        codes = report['legacy_key_groups'][0]['issue_codes']
        self.assertIn('SET_IDENTITY_INCOMPLETE', codes)
        self.assertNotIn('SET_ID_CONFLICT', codes)
        self.assertEqual(report['summary']['groups_with_different_set_identifiers'], 0)
        self.assertEqual(report['incomplete_records'][0]['missing_set_fields'], list(audit.SET_FIELDS))

    def test_id_difference_is_reported_even_with_equal_codes(self):
        group = audit.audit_catalog([card(), card('fixture-b', set_id='another-namespace')])['legacy_key_groups'][0]
        self.assertIn('SET_ID_CONFLICT', group['issue_codes'])
        self.assertNotIn('SET_CODE_CONFLICT', group['issue_codes'])
        self.assertIn('independent verification', ' '.join(audit.audit_catalog([])['limitations']))

    def test_same_key_does_not_assert_same_print_or_canonical(self):
        group = audit.audit_catalog([card(), card('fixture-b')])['legacy_key_groups'][0]
        self.assertEqual(group['issue_codes'], ['MULTIPLE_RECORDS_SHARE_LEGACY_KEY'])
        self.assertEqual(len(group['members']), 2)
        self.assertNotIn('canonical', group)

    def test_external_id_provider_is_never_inferred_from_numeric_value(self):
        records = [card(external_id='12345', external_id_provider=None),
                   card('fixture-b', external_id='12345', external_id_provider=None, set_id='other-set')]
        report = audit.audit_catalog(records)
        group = report['external_id_groups'][0]
        self.assertIsNone(group['provider'])
        self.assertFalse(group['provider_verified'])
        self.assertTrue(group['identity_ambiguity'])
        self.assertIn('EXTERNAL_ID_PROVIDER_UNKNOWN', group['issue_codes'])
        self.assertEqual(report['summary']['external_id_provider_unknown_records'], 2)

    def test_distinct_explicit_provider_namespaces_are_not_joined(self):
        records = [card(external_id='same-id', external_id_provider='provider-a'),
                   card('fixture-b', external_id='same-id', external_id_provider='provider-b')]
        report = audit.audit_catalog(records)
        self.assertEqual(report['external_id_groups'], [])
        self.assertEqual(report['summary']['external_id_provider_unknown_records'], 0)

    def test_external_id_reuse_without_identity_difference_is_not_ambiguity(self):
        report = audit.audit_catalog([card(), card('fixture-b')])
        self.assertFalse(report['external_id_groups'][0]['identity_ambiguity'])
        self.assertEqual(report['summary']['external_id_ambiguity_groups'], 0)

    def test_missing_required_values_do_not_become_zero_number_collisions(self):
        report = audit.audit_catalog([card(number=None), card('fixture-b', number='0'),
                                     card('fixture-c', name=''), card(None)])
        self.assertEqual(report['scope']['records_with_legacy_key'], 1)
        self.assertEqual(report['legacy_key_groups'], [])
        self.assertEqual(report['summary']['incomplete_identity_records'], 3)

    def test_unsupported_and_sensitive_fields_and_export_metadata_are_not_echoed(self):
        record = card()
        record.update({'api_key': PRIVATE, 'email': PRIVATE, 'price_krw': 999999,
                       'private': {'nested': PRIVATE}})
        report = audit.audit_catalog({'cards': [record, card('fixture-b')],
                                      'complete': True, 'export_path': PRIVATE, 'token': PRIVATE})
        text = json.dumps(report)
        self.assertNotIn(PRIVATE, text)
        self.assertNotIn('price_krw', text)
        self.assertEqual(report['scope']['catalog_completeness'], 'not_verified')
        for group in report['legacy_key_groups']:
            for row in group['members']:
                self.assertEqual(set(row), {'row_index', *audit.IDENTITY_FIELDS})

    def test_input_is_not_mutated_and_results_are_deterministic(self):
        records = [card(), card('fixture-b', set_id='fixture-set-b')]
        before = copy.deepcopy(records)
        first = audit.audit_catalog(records)
        self.assertEqual(records, before)
        self.assertEqual(first, audit.audit_catalog(records))
        self.assertEqual(first, audit.audit_catalog({'cards': records}))

    def test_empty_export_does_not_claim_a_clean_complete_catalog(self):
        report = audit.audit_catalog([])
        self.assertEqual(report['scope']['records_received'], 0)
        self.assertEqual(report['scope']['catalog_completeness'], 'not_verified')
        self.assertEqual(report['legacy_key_groups'], [])
        self.assertEqual(report['external_id_groups'], [])

    def test_wrong_root_row_and_identity_types_fail_without_raw_values(self):
        invalid = [None, {}, {'cards': {}}, 'private', [None], [True],
                   [card(number=1)], [card(set_id={PRIVATE: 1})], [card(name=['x'])],
                   [card(name='line\n' + PRIVATE)], [card(name='x' * 1001)]]
        for payload in invalid:
            with self.subTest(payload_type=type(payload).__name__):
                with self.assertRaises(audit.AuditInputError) as caught:
                    audit.audit_catalog(payload)
                self.assertNotIn(PRIVATE, str(caught.exception))

    def test_catalog_limit_is_bounded(self):
        with mock.patch.object(audit, 'MAX_RECORDS', 1):
            with self.assertRaisesRegex(audit.AuditInputError, '^CATALOG_TOO_LARGE$'):
                audit.audit_catalog([card(), card('fixture-b')])

    def test_stdlib_imports_have_no_network_database_or_environment_dependency(self):
        tree = ast.parse(MODULE_PATH.read_text(encoding='utf-8'))
        imports = {node.name.split('.')[0] for entry in tree.body if isinstance(entry, ast.Import)
                   for node in entry.names}
        imports.update(entry.module.split('.')[0] for entry in tree.body if isinstance(entry, ast.ImportFrom))
        self.assertEqual(imports, {'argparse', 'json', 'pathlib', 're', 'sys'})
        forbidden = ['environ', 'getenv', 'write_text', 'write_bytes', 'urlopen', 'requests', 'psycopg2']
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                self.assertNotIn(node.attr, forbidden)

    def test_cli_executes_with_no_network_calls_or_file_writes(self):
        raw = json.dumps([card(), card('fixture-b', set_id='fixture-set-b')])
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, 'stdin', io.StringIO(raw)), \
             mock.patch.object(sys, 'stdout', out), mock.patch.object(sys, 'stderr', err), \
             mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')), \
             mock.patch.object(Path, 'open', side_effect=AssertionError('file I/O forbidden')):
            self.assertEqual(audit.main(['--input', '-']), 0)
        self.assertEqual(err.getvalue(), '')
        report = json.loads(out.getvalue())
        self.assertEqual(report['scope']['network_requests'], 0)
        self.assertFalse(report['scope']['database_read'])
        self.assertEqual(report['summary']['legacy_key_review_groups'], 1)

    def cli(self, raw, extra=()):
        return subprocess.run([sys.executable, '-B', str(MODULE_PATH), '--input', '-', *extra],
                              input=raw.encode('utf-8'), capture_output=True, check=False,
                              timeout=10)

    def test_real_cli_stdin_handles_korean_and_bom(self):
        records = [card(name='테스트 Pokémon'), card('fixture-b', name='테스트 Pokémon')]
        result = self.cli('\ufeff' + json.dumps(records, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8'))
        report = json.loads(result.stdout)
        self.assertEqual(report['legacy_key_groups'][0]['legacy_key']['name'], '테스트 pokemon')
        self.assertEqual(result.stderr, b'')

    def test_real_cli_rejects_invalid_json_types_constants_and_duplicate_keys(self):
        for raw in ('{broken' + PRIVATE, '{"cards":{}}', '[null]',
                    '[{"name":NaN}]', '[{"name":Infinity}]', '{"cards":[],"cards":[]}'):
            with self.subTest(raw_prefix=raw[:12]):
                result = self.cli(raw)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, b'')
                self.assertNotIn(PRIVATE, result.stderr.decode('utf-8'))
                self.assertEqual(set(json.loads(result.stderr)), {'error'})

    def test_real_cli_argument_error_does_not_echo_accidental_secret(self):
        result = self.cli('[]', ['--token', PRIVATE])
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(PRIVATE.encode(), result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr), {'error': 'INVALID_ARGUMENTS'})

    def test_missing_input_path_is_generic_and_not_echoed(self):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(Path, 'open', side_effect=OSError(PRIVATE)), \
             mock.patch.object(sys, 'stdout', out), mock.patch.object(sys, 'stderr', err):
            self.assertEqual(audit.main(['--input', PRIVATE]), 2)
        self.assertEqual(out.getvalue(), '')
        self.assertEqual(json.loads(err.getvalue()), {'error': 'INPUT_READ_FAILED'})

    def test_remote_url_unc_and_device_paths_are_rejected_before_file_io(self):
        paths = [r'\\server\share\catalog.json', '//server/share/catalog.json',
                 r'\\.\pipe\catalog', r'\\?\UNC\server\share\catalog.json',
                 '/\\server/share/catalog.json', '\\/server/share/catalog.json',
                 'https://example.invalid/catalog.json', 'file:///C:/catalog.json',
                 's3://bucket/catalog.json', r'\??\C:\catalog.json',
                 'NUL', 'CON.json', r'C:\exports\COM1', '  //server/share/' + PRIVATE]
        for path in paths:
            with self.subTest(path=path):
                out, err = io.StringIO(), io.StringIO()
                with mock.patch.object(Path, 'open', side_effect=AssertionError('must reject before I/O')), \
                     mock.patch.object(sys, 'stdout', out), mock.patch.object(sys, 'stderr', err):
                    self.assertEqual(audit.main(['--input', path]), 2)
                self.assertEqual(out.getvalue(), '')
                self.assertEqual(json.loads(err.getvalue()), {'error': 'LOCAL_FILE_REQUIRED'})
                self.assertNotIn(PRIVATE, err.getvalue())

    def test_normal_local_absolute_and_relative_paths_can_be_read(self):
        for path in (r'C:\exports\catalog.json', 'C:/exports/catalog.json',
                     'exports/catalog.json', './catalog.json', 'C:catalog.json'):
            with self.subTest(path=path):
                stream = mock.MagicMock()
                stream.__enter__.return_value.read.return_value = b'[]'
                with mock.patch.object(Path, 'open', return_value=stream) as opened:
                    self.assertEqual(audit.read_catalog(path), [])
                opened.assert_called_once_with('rb')

    def test_integer_digit_limit_is_a_generic_json_error(self):
        with mock.patch.object(sys, 'stdin', io.StringIO('[0]')), \
             mock.patch.object(audit.json, 'loads', side_effect=ValueError(PRIVATE)):
            with self.assertRaisesRegex(audit.AuditInputError, '^INVALID_JSON$'):
                audit.read_catalog('-')
        # Exercise the real parser limit as well, without changing the process
        # setting. Skip only when this interpreter explicitly disables it.
        limit = sys.get_int_max_str_digits()
        if limit:
            result = self.cli('[' + '9' * (limit + 1) + ']')
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, b'')
            self.assertEqual(json.loads(result.stderr), {'error': 'INVALID_JSON'})

    def test_explicit_json_validation_errors_keep_their_fixed_codes(self):
        for raw, code in (('{"cards":[],"cards":[]}', 'DUPLICATE_JSON_KEY'),
                          ('[NaN]', 'INVALID_JSON')):
            with self.subTest(code=code), mock.patch.object(sys, 'stdin', io.StringIO(raw)):
                with self.assertRaisesRegex(audit.AuditInputError, '^' + code + '$'):
                    audit.read_catalog('-')

    def test_byte_limit_and_invalid_utf8_fail_generically(self):
        with mock.patch.object(audit, 'MAX_INPUT_BYTES', 2), \
             mock.patch.object(sys, 'stdin', io.StringIO('[1]')):
            with self.assertRaisesRegex(audit.AuditInputError, '^INPUT_TOO_LARGE$'):
                audit.read_catalog('-')
        with mock.patch.object(sys, 'stdin', io.BytesIO(b'\xff')):
            with self.assertRaisesRegex(audit.AuditInputError, '^INVALID_JSON$'):
                audit.read_catalog('-')


if __name__ == '__main__':
    unittest.main()
