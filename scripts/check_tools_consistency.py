#!/usr/bin/env python3
"""
도구 허브 정합성 가드 (브리핑 #6 — 단일 소스 정합).
tools.html의 ready 카드 / ItemList(position·numberOfItems) / 실제 tools/*.html 파일 /
sitemap.xml의 tools 항목이 서로 일치하는지 검증한다.
불일치 시 exit 1 → 도구 추가·수정 후 이걸 돌려 드리프트(스키마 8≠12·번호중복·ItemList 누락 등)를 조기 감지.

사용: python scripts/check_tools_consistency.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_HTML = os.path.join(ROOT, "tools.html")
SITEMAP = os.path.join(ROOT, "sitemap.xml")
TOOLS_DIR = os.path.join(ROOT, "tools")

# soon(준비 중) 도구는 색인·ItemList 대상 아님 → 활성(ready) 집합에서 제외
SOON_SLUGS = {"box-compare"}  # 세트 비교(Box Compare) 등 준비 중 도구 slug


def read(p):
    return open(p, encoding="utf-8").read()


def main():
    errors = []
    html = read(TOOLS_HTML)

    # 1) ready 카드: <article class="tool-card ready" ...> ... /tools/<slug>
    ready_blocks = re.findall(r'<article class="tool-card ready"[^>]*>(.*?)</article>', html, re.S)
    ready_slugs = []
    for b in ready_blocks:
        m = re.search(r'href="/tools/([a-z0-9-]+)"', b)
        if m:
            ready_slugs.append(m.group(1))
    ready_slugs = list(dict.fromkeys(ready_slugs))  # dedupe 유지순서

    # 2) 카드 번호 [ NN ] — 중복·누락 검사 (soon 포함 전체 카드)
    nums = [int(n) for n in re.findall(r'<span class="id">\[ (\d+) \]</span>', html)]
    dup_nums = sorted({n for n in nums if nums.count(n) > 1})
    expected_seq = list(range(1, len(nums) + 1))
    if dup_nums:
        errors.append(f"카드 번호 중복: {dup_nums}")
    if sorted(nums) != expected_seq:
        errors.append(f"카드 번호 비연속: {sorted(nums)} (기대 {expected_seq})")

    # 3) ItemList position / numberOfItems
    #    Breadcrumb의 ListItem(item:) 제외 — tools url을 가진 ItemList 항목만 카운트
    item_pat = re.compile(r'"ListItem","position":(\d+),"name":"[^"]*","url":"https://cardpick\.kr/tools/([a-z0-9-]+)"')
    matches = item_pat.findall(html)
    positions = sorted(int(p) for p, _ in matches)
    item_urls = [s for _, s in matches]
    m = re.search(r'"numberOfItems":(\d+)', html)
    num_items = int(m.group(1)) if m else -1

    # 4) 실제 tools/*.html 파일 (soon 제외)
    files = [f[:-5] for f in os.listdir(TOOLS_DIR) if f.endswith(".html")]
    active_files = sorted(s for s in files if s not in SOON_SLUGS)

    # 5) sitemap tools 항목
    sm = read(SITEMAP)
    sm_tools = sorted(re.findall(r'https://cardpick\.kr/tools/([a-z0-9-]+)', sm))

    # ---- 비교 ----
    ready_set = set(ready_slugs)
    n_ready = len(ready_slugs)

    if n_ready != len(positions):
        errors.append(f"ready 카드 수({n_ready}) != ItemList position 수({len(positions)})")
    if num_items != n_ready:
        errors.append(f"numberOfItems({num_items}) != ready 카드 수({n_ready})")
    if positions and positions != list(range(1, len(positions) + 1)):
        errors.append(f"ItemList position 비연속: {positions}")
    if ready_set != set(item_urls):
        errors.append(f"ready 카드 slug != ItemList slug\n  카드만: {ready_set - set(item_urls)}\n  ItemList만: {set(item_urls) - ready_set}")
    if ready_set != set(active_files):
        errors.append(f"ready 카드 slug != 실제 파일(soon 제외)\n  카드만: {ready_set - set(active_files)}\n  파일만: {set(active_files) - ready_set}")
    if ready_set - set(sm_tools):
        errors.append(f"ready 카드인데 sitemap 누락: {ready_set - set(sm_tools)}")

    # ---- 리포트 ----
    print(f"ready 카드: {n_ready} | ItemList position: {len(positions)} | numberOfItems: {num_items} | 활성 파일: {len(active_files)} | sitemap tools: {len(sm_tools)}")
    print(f"카드 번호: {nums}")
    if errors:
        print("\n[FAIL] 정합성 불일치:")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("\n[OK] 도구 허브 정합성 통과 (카드=ItemList=파일=sitemap, 번호 연속·무중복)")


if __name__ == "__main__":
    main()
