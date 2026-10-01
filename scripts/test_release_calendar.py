"""Network-free regression tests for the curated release-calendar renderer."""

import contextlib
import datetime
import html
import importlib.util
import io
import json
import pathlib
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock

MODULE_PATH = pathlib.Path(__file__).with_name("build_release_calendar.py")
SPEC = importlib.util.spec_from_file_location("release_calendar", MODULE_PATH)
calendar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(calendar)
TODAY = datetime.date(2026, 9, 30)


def entry(name="Example", date="2026-10-01", **changes):
    result = {"region": "en", "name": name, "date": date, "source": "Official",
              "url": "https://example.org/release", "source_type": "official",
              "verification": "verified", "verified_on": "2026-09-01"}
    result.update(changes)
    return result


def template():
    faq = {
        "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": calendar.FAQ_QUESTION,
             "acceptedAnswer": {"@type": "Answer", "text": "OLD"}},
            {"@type": "Question", "name": "Other question?",
             "acceptedAnswer": {"@type": "Answer", "text": "KEEP & quoted \"text\""}},
        ],
    }
    regions = "\n".join(f"<!-- CAL:{tag}:START -->\nold {tag}\n<!-- CAL:{tag}:END -->" for tag in calendar.MARKERS)
    return ('<html><head><meta property="article:modified_time" content="2026-08-01">'
            '<script type="application/ld+json">' + json.dumps(faq) + '</script></head><body>'
            + regions + '<div id="third-party">UNCHANGED LOWER BROWSER</div></body></html>')


def region(page, tag):
    return page.split(f"<!-- CAL:{tag}:START -->", 1)[1].split(f"<!-- CAL:{tag}:END -->", 1)[0].strip()


def schemas(page):
    return [json.loads(match["body"]) for match in calendar.SCRIPT_RE.finditer(page)
            if calendar.JSON_TYPE_RE.search(match["attrs"])]


def modified_date(page):
    for match in calendar.META_RE.finditer(page):
        if calendar.MODIFIED_PROPERTY_RE.search(match.group(0)):
            return calendar.CONTENT_RE.search(match.group(0))[3]
    raise AssertionError("modified time absent")


class CalendarTests(unittest.TestCase):
    def render(self, entries, today=TODAY, page=None):
        return calendar.render_page(template() if page is None else page, entries, today)

    def test_today_yesterday_future_are_exclusive(self):
        page = self.render([entry("Yesterday", "2026-09-29"), entry("Today", "2026-09-30"), entry("Tomorrow", "2026-10-01")])
        upcoming, recent = region(page, "UPCOMING"), region(page, "RECENT")
        self.assertNotIn("Yesterday", upcoming)
        self.assertIn("Yesterday", recent)
        for name in ("Today", "Tomorrow"):
            self.assertIn(name, upcoming)
            self.assertNotIn(name, recent)

    def test_month_only_never_becomes_a_guessed_day(self):
        page = self.render([entry("PastMonth", "2026-08"), entry("ThisMonth", "2026-09"), entry("FutureMonth", "2026-10")])
        pending = region(page, "PENDING")
        for name in ("PastMonth", "ThisMonth", "FutureMonth"):
            self.assertIn(name, pending)
            for tag in ("UPCOMING", "RECENT", "HERO"):
                self.assertNotIn(name, region(page, tag))
        self.assertEqual(pending.count('data-date=""'), 3)
        self.assertEqual(pending.count("정확한 발매일 확인 필요"), 3)
        self.assertNotIn("2026-10-01", pending)

    def test_month_boundary_reclassifies_only_full_dates(self):
        entries = [entry("Full", "2026-09-30"), entry("Month", "2026-09")]
        first = self.render(entries)
        second = self.render(entries, datetime.date(2026, 10, 1), first)
        self.assertIn("Full", region(first, "UPCOMING"))
        self.assertIn("Full", region(second, "RECENT"))
        self.assertIn("Month", region(second, "PENDING"))
        self.assertEqual(modified_date(second), "2026-10-01")

    def test_real_leap_day_accepted(self):
        page = self.render([entry("Leap", "2028-02-29")], datetime.date(2028, 2, 29))
        self.assertIn("Leap", region(page, "UPCOMING"))

    def test_invalid_dates_fail_instead_of_silently_dropping(self):
        for date in ("2026-02-29", "2026-04-31", "2026-13-01", "2026-00", "2026-13", "0000-01", "2026-9-1", "tomorrow"):
            with self.subTest(date=date), self.assertRaises(ValueError):
                self.render([entry(date=date)])

    def test_verified_official_pokemon_only_in_answers_and_schema(self):
        page = self.render([
            entry("OfficialPokemon"), entry("PressPokemon", source_type="press"),
            entry("NewsPokemon", source_type="news"), entry("CommunityPokemon", source_type="community"),
            entry("OfficialOtherGame", game="riftbound"),
            entry("UnverifiedPokemon", verification="unverified", verified_on=None),
        ])
        for tag in ("HERO", "FAQ1", "LD-UPCOMING"):
            self.assertIn("OfficialPokemon", region(page, tag))
            for name in ("PressPokemon", "NewsPokemon", "CommunityPokemon", "OfficialOtherGame", "UnverifiedPokemon"):
                self.assertNotIn(name, region(page, tag))
        for label in ("보도자료", "뉴스 보도", "커뮤니티 자료"):
            self.assertIn(label, region(page, "UPCOMING"))
        self.assertIn("UnverifiedPokemon", region(page, "PENDING"))
        self.assertIn("출처 재확인 필요", region(page, "PENDING"))

    def test_unverified_exact_and_unknown_dates_stay_pending(self):
        page = self.render([entry("PastUnverified", "2026-06-01", verification="unverified", verified_on=None),
                            entry("NoDate", "", verification="unverified", verified_on=None)])
        self.assertIn("PastUnverified", region(page, "PENDING"))
        self.assertIn("NoDate", region(page, "PENDING"))
        self.assertNotIn("PastUnverified", region(page, "RECENT"))
        self.assertNotIn('data-date="2026-06-01"', page)

    def test_no_verified_upcoming_is_a_scoped_not_global_claim(self):
        page = self.render([entry("OnlyThirdParty", source_type="news")])
        self.assertEqual(html.unescape(region(page, "FAQ1")), calendar.NO_OFFICIAL_UPCOMING)
        itemlist = next(value for value in schemas(page) if value["@type"] == "ItemList")
        self.assertEqual(itemlist["itemListElement"], [])
        self.assertNotIn("공식 발표된 다가오는 발매 일정이 없습니다", page)

    def test_distinct_sets_on_same_date_are_both_preserved(self):
        page = self.render([entry("SetAlpha"), entry("SetBeta")])
        upcoming = region(page, "UPCOMING")
        self.assertIn("SetAlpha", upcoming)
        self.assertIn("SetBeta", upcoming)
        self.assertEqual(upcoming.count('data-date="2026-10-01"'), 2)

    def test_upcoming_copy_is_scoped_to_curated_list(self):
        page = self.render([entry("SelectedProduct")])
        for tag in ("HERO", "FAQ1"):
            self.assertIn("이 목록에서 공식 원문으로 확인한", region(page, tag))
            self.assertNotIn("다음 포켓몬 카드 발매는", region(page, tag))
        faq = next(value for value in schemas(page) if value["@type"] == "FAQPage")
        self.assertEqual(faq["mainEntity"][0]["acceptedAnswer"]["text"], html.unescape(region(page, "FAQ1")))
        empty = self.render([])
        self.assertIn("현재 이 목록에는", region(empty, "HERO"))
        self.assertIn("전체 공식 발표 목록을 뜻하지 않으므로", region(empty, "FAQ1"))

    def test_faq_json_matches_visible_text_and_is_script_safe(self):
        name = 'A&B "quoted" \\1 </script><script>alert(1)</script>'
        page = self.render([entry(name=name, url='https://example.org/?a=1&b="x"')])
        data = schemas(page)
        faq = next(value for value in data if value["@type"] == "FAQPage")
        self.assertEqual(faq["mainEntity"][0]["acceptedAnswer"]["text"], html.unescape(region(page, "FAQ1")))
        self.assertIn(name, faq["mainEntity"][0]["acceptedAnswer"]["text"])
        self.assertEqual(faq["mainEntity"][1]["acceptedAnswer"]["text"], 'KEEP & quoted "text"')
        self.assertNotIn('</script><script>alert(1)', page)
        self.assertIn('&amp;b=&quot;x&quot;', region(page, "UPCOMING"))
        self.assertEqual(len(data), 2)

    def test_same_day_render_is_idempotent_and_does_not_mutate_entries(self):
        entries = [entry()]
        original_entries = json.dumps(entries)
        first = self.render(entries)
        self.assertEqual(first, self.render(entries, page=first))
        self.assertEqual(json.dumps(entries), original_entries)
        self.assertIn('id="third-party">UNCHANGED LOWER BROWSER', first)

    def test_classification_stamp_only_does_not_modify_content_date(self):
        entries = [entry(date="2026-12-01")]
        first = self.render(entries)
        second = self.render(entries, datetime.date(2026, 10, 1), first)
        self.assertNotEqual(region(first, "RENDERED"), region(second, "RENDERED"))
        self.assertEqual(modified_date(first), modified_date(second))
        self.assertEqual(calendar._substantive_content(first), calendar._substantive_content(second))

    def test_source_content_change_modifies_content_date(self):
        first = self.render([entry(date="2026-12-01")])
        second = self.render([entry(name="Updated", date="2026-12-01")], datetime.date(2026, 10, 1), first)
        self.assertEqual(modified_date(second), "2026-10-01")

    def test_missing_duplicate_or_reversed_marker_fails(self):
        for tag in calendar.MARKERS:
            start, end = f"<!-- CAL:{tag}:START -->", f"<!-- CAL:{tag}:END -->"
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.render([], page=template().replace(start, ""))
            with self.subTest(duplicate=tag), self.assertRaises(ValueError):
                self.render([], page=template() + start)
            reversed_page = template().replace(start, "PLACEHOLDER").replace(end, start).replace("PLACEHOLDER", end)
            with self.subTest(reversed=tag), self.assertRaises(ValueError):
                self.render([], page=reversed_page)

    def test_invalid_faq_json_or_missing_question_fails(self):
        with self.assertRaises(ValueError):
            self.render([], page=template().replace('"FAQPage"', 'BROKEN'))
        question_removed = template().replace(json.dumps(calendar.FAQ_QUESTION), '"Other name"')
        with self.assertRaises(ValueError):
            self.render([], page=question_removed)

    def test_invalid_evidence_fails(self):
        changes = [{"verified_on": None}, {"verified_on": "2026-02-29"}, {"verified_on": "2026-10-01"},
                   {"source_type": "api"}, {"verification": "maybe"}, {"url": "javascript:alert(1)"},
                   {"url": "https://user:secret@example.org/"}, {"region": "unknown"}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.render([entry(**change)])

    def test_kst_day_boundary_does_not_use_utc_date(self):
        moment = datetime.datetime(2026, 9, 30, 15, 0, tzinfo=datetime.timezone.utc)
        self.assertEqual(calendar.today_kst(moment), datetime.date(2026, 10, 1))
        self.assertEqual(calendar.today_kst(moment - datetime.timedelta(seconds=1)), TODAY)
        with self.assertRaises(ValueError):
            calendar.today_kst(datetime.datetime(2026, 9, 30))

    def test_invalid_input_preserves_existing_file_and_returns_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = pathlib.Path(temp)
            data_path, html_path = directory / "data.json", directory / "releases.html"
            original = template().encode("utf-8")
            html_path.write_bytes(original)
            for invalid in ('{"entries": [', json.dumps({"entries": [entry(date="2026-02-29")]})):
                data_path.write_text(invalid, encoding="utf-8")
                with mock.patch.object(calendar, "DATA", str(data_path)), mock.patch.object(calendar, "HTML", str(html_path)), \
                     mock.patch.object(calendar, "today_kst", return_value=TODAY), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(calendar.main(), 1)
                self.assertEqual(html_path.read_bytes(), original)
            self.assertEqual(sorted(path.name for path in directory.iterdir()), ["data.json", "releases.html"])

    def test_invalid_template_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = pathlib.Path(temp)
            data_path, html_path = directory / "data.json", directory / "releases.html"
            data_path.write_text(json.dumps({"entries": [entry()]}), encoding="utf-8")
            original = b"existing page without required markers"
            html_path.write_bytes(original)
            with self.assertRaises(ValueError):
                calendar.build_files(str(data_path), str(html_path), TODAY)
            self.assertEqual(html_path.read_bytes(), original)

    def test_build_is_network_free_and_noop_does_not_replace_file(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = pathlib.Path(temp)
            data_path, html_path = directory / "data.json", directory / "releases.html"
            data_path.write_text(json.dumps({"_updated": "2026-09-30", "entries": [entry()]}), encoding="utf-8")
            html_path.write_text(template(), encoding="utf-8")
            with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network must not run")):
                self.assertTrue(calendar.build_files(str(data_path), str(html_path), TODAY))
                with mock.patch.object(calendar.os, "replace", side_effect=AssertionError("no-op should not replace")):
                    self.assertFalse(calendar.build_files(str(data_path), str(html_path), TODAY))


class CalendarPublishTests(unittest.TestCase):
    """Execute the workflow's real Bash block with Git/sleep isolated stubs.

    No network calls, repository commits, pushes, or deployments are performed.
    """

    @classmethod
    def setUpClass(cls):
        root = MODULE_PATH.parent.parent
        cls.workflow = (root / ".github/workflows/refresh-prices.yml").read_text(encoding="utf-8")
        cls.job = cls.workflow.split("  build-calendar:\n", 1)[1]
        step = cls.job.split("      - name: Commit if changed\n", 1)[1]
        block = step.split("        run: |\n", 1)[1]
        lines = []
        for line in block.splitlines():
            if line and not line.startswith("          "):
                break
            lines.append(line)
        cls.script = textwrap.dedent("\n".join(lines))
        git = shutil.which("git")
        git_bash = pathlib.Path(git).parent.parent / "bin/bash.exe" if git else None
        cls.bash = str(git_bash) if os.name == "nt" and git_bash and git_bash.exists() else shutil.which("bash")
        if not cls.bash:
            raise RuntimeError("Bash is required to verify the calendar publication gate")

    def execute_step(self, *, unchanged=False, push_success_at=1, pull_fails=False, commit_fails=False):
        stub = r'''
cp_pushes=0
git() {
  printf '%s\n' "$*" >> "$CP_TEST_LOG"
  case "$1" in
    config|add) return 0 ;;
    diff) [ "$CP_TEST_UNCHANGED" = 1 ] ;;
    commit) [ "$CP_TEST_COMMIT_FAILS" = 0 ] ;;
    pull) [ "$CP_TEST_PULL_FAILS" = 0 ] ;;
    push)
      cp_pushes=$((cp_pushes + 1))
      [ "$cp_pushes" -eq "$CP_TEST_PUSH_SUCCESS_AT" ] ;;
    *) printf 'Unexpected Git operation\n' >&2; return 90 ;;
  esac
}
sleep() { :; }
'''
        with tempfile.TemporaryDirectory() as temp:
            env_file = pathlib.Path(temp) / "github-env"
            log_file = pathlib.Path(temp) / "git-log"
            env = dict(os.environ, GITHUB_ENV=env_file.as_posix(), CP_TEST_LOG=log_file.as_posix(),
                       CP_TEST_UNCHANGED=str(int(unchanged)), CP_TEST_PUSH_SUCCESS_AT=str(push_success_at),
                       CP_TEST_PULL_FAILS=str(int(pull_fails)), CP_TEST_COMMIT_FAILS=str(int(commit_fails)))
            result = subprocess.run([self.bash, "--noprofile", "--norc", "-c", stub + "\n" + self.script],
                                    cwd=temp, env=env, capture_output=True, encoding="utf-8", timeout=10)
            return result, env_file.read_text(encoding="utf-8"), log_file.read_text(encoding="utf-8")

    def test_main_and_success_guards_are_present(self):
        self.assertIn("if: github.ref == 'refs/heads/main' && (", self.job)
        self.assertIn("if: success() && github.ref == 'refs/heads/main' && env.calendar_changed == '1'", self.job)
        self.assertIn("shell: bash", self.job)
        self.assertTrue(self.script.startswith("set -euo pipefail"))

    def test_no_change_does_not_enable_deploy(self):
        result, env, log = self.execute_step(unchanged=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(env.strip(), "calendar_changed=0")
        self.assertNotIn("push origin", log)
        self.assertNotIn("commit -m", log)

    def test_first_push_success_enables_deploy(self):
        result, env, log = self.execute_step()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(env.splitlines(), ["calendar_changed=0", "calendar_changed=1"])
        self.assertEqual(log.count("push origin HEAD:main"), 1)

    def test_third_push_success_enables_deploy_only_after_retries(self):
        result, env, log = self.execute_step(push_success_at=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log.count("push origin HEAD:main"), 3)
        self.assertEqual(log.count("pull --rebase"), 3)
        self.assertEqual(env.splitlines(), ["calendar_changed=0", "calendar_changed=1"])

    def test_exhausted_pushes_fail_without_enabling_deploy(self):
        result, env, log = self.execute_step(push_success_at=0)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log.count("push origin HEAD:main"), 3)
        self.assertEqual(env.strip(), "calendar_changed=0")

    def test_rebase_failure_stops_before_any_push(self):
        result, env, log = self.execute_step(pull_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log.count("pull --rebase"), 1)
        self.assertNotIn("push origin", log)
        self.assertEqual(env.strip(), "calendar_changed=0")

    def test_commit_failure_stops_before_sync_and_deploy(self):
        result, env, log = self.execute_step(commit_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("pull --rebase", log)
        self.assertNotIn("push origin", log)
        self.assertEqual(env.strip(), "calendar_changed=0")


class CalendarSourceIntegrationTests(unittest.TestCase):
    def test_reviewed_binder_date_reaches_calendar_answer_and_schema(self):
        root = MODULE_PATH.parent.parent
        payload = json.loads((root / "data/release-calendar.json").read_text(encoding="utf-8"))
        original_payload = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        original = (root / "releases.html").read_text(encoding="utf-8")
        day = datetime.date(2026, 10, 1)
        name = "30th Celebration Binder Collection"
        selected = [row for row in payload["entries"] if row["name"] == name]
        self.assertEqual(len(selected), 1)
        row = selected[0]
        self.assertEqual((row["date"], row["region"], row["source_type"]), ("2026-12-04", "en", "official"))
        self.assertEqual(row["verified_on"], "2026-10-01")
        self.assertEqual(row["url"], "https://www.pokemon.com/us/news/pokemon-tcg-30th-celebration-product-showcase")
        rendered = calendar.render_page(original, payload["entries"], day, payload["_updated"])
        for tag in ("UPCOMING", "HERO", "FAQ1", "LD-UPCOMING"):
            self.assertIn(name, region(rendered, tag))
        self.assertNotIn(name, region(rendered, "RECENT"))
        self.assertIn('data-region="en"', region(rendered, "UPCOMING"))
        self.assertIn('data-date="2026-12-04"', region(rendered, "UPCOMING"))
        faq = next(value for value in schemas(rendered) if value["@type"] == "FAQPage")
        self.assertEqual(faq["mainEntity"][0]["acceptedAnswer"]["text"], html.unescape(region(rendered, "FAQ1")))
        # Do not let the calendar renderer overwrite the independently loaded set browser.
        self.assertEqual(original.split('<section class="py-12 border-b hairline" id="release-schedule">')[1].split('<section', 1)[0],
                         rendered.split('<section class="py-12 border-b hairline" id="release-schedule">')[1].split('<section', 1)[0])
        tomorrow = calendar.render_page(rendered, payload["entries"], day + datetime.timedelta(days=1), payload["_updated"])
        self.assertEqual(modified_date(rendered), modified_date(tomorrow))
        self.assertEqual(json.dumps(payload, ensure_ascii=False, sort_keys=True), original_payload)


if __name__ == "__main__":
    unittest.main()
