#!/usr/bin/env node
// Test the published HTML and the actual calculator script, not a copied formula.
// DOM doubles below do not establish visual layout, focus visibility, or screen-reader behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const REVISION_DATE = '2026-09-30';
const pages = [
  { name: 'guide', path: '../guide-fake-detection.html', url: 'https://cardpick.kr/guide-fake-detection' },
  { name: 'checker', path: '../tools/fake-card-checker.html', url: 'https://cardpick.kr/tools/fake-card-checker' },
].map(page => ({ ...page, html: readFileSync(new URL(page.path, import.meta.url), 'utf8') }));
const guide = pages[0];
const checker = pages[1];
const IDS = ['c-print', 'c-holo', 'c-back', 'c-weight', 'c-edge', 'c-text', 'c-source'];

function decode(text) {
  return String(text).replace(/&#(x[\da-f]+|\d+);/gi, (_, value) => String.fromCodePoint(
    value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
    })[entity]);
}

function plain(text) {
  return decode(String(text).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
    .map(([, name, double, single, bare]) => [name.toLowerCase(), decode(double ?? single ?? bare ?? '')]));
}

function tags(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*?)>`, 'gi'))].map(match => attributes(match[1]));
}

function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map(([, attrs, code]) => ({ attrs: attributes(attrs), code }));
}

function schemas(page) {
  return scripts(page.html).filter(script => script.attrs.type === 'application/ld+json')
    .map(script => JSON.parse(script.code));
}

function oneSchema(page, type) {
  const matches = schemas(page).filter(schema => schema['@type'] === type);
  assert.equal(matches.length, 1, `${page.name}: exactly one ${type} is required`);
  return matches[0];
}

function visibleFaq(page) {
  if (page.name === 'guide') {
    const section = page.html.split(/<h2\b[^>]*\bid=["']faq["'][^>]*>/i)[1];
    assert.ok(section, 'guide FAQ heading must exist');
    const faq = section.split(/<h2\b|<hr\b/i)[0];
    return [...faq.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(([, question, answer]) => ({ question: plain(question).replace(/^Q\.\s*/, ''), answer: plain(answer) }));
  }
  const faq = page.html.split(/<section\b[^>]*\bid=["']faq["'][^>]*>/i)[1]?.split(/<\/section>/i)[0];
  assert.ok(faq, 'checker FAQ section must exist');
  return [...faq.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bfaq-q\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*\bclass=["'][^"']*\bfaq-a\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map(([, question, answer]) => ({ question: plain(question), answer: plain(answer) }));
}

for (const page of pages) {
  test(`${page.name}: JSON-LD parses and the canonical, robots policy, and page identity stay unchanged`, () => {
    assert.equal(tags(page.html, 'link').find(tag => tag.rel === 'canonical')?.href, page.url);
    assert.equal(tags(page.html, 'meta').find(tag => tag.name === 'robots')?.content,
      'index,follow,max-image-preview:large,max-snippet:-1');
    assert.equal(tags(page.html, 'meta').find(tag => tag.property === 'og:url')?.content, page.url);
    const primary = oneSchema(page, page.name === 'guide' ? 'Article' : 'WebApplication');
    assert.equal(primary.url, page.url);
    assert.equal(primary.inLanguage, 'ko');
    const breadcrumb = oneSchema(page, 'BreadcrumbList');
    assert.equal(breadcrumb.itemListElement.at(-1).item, page.url);
  });

  test(`${page.name}: every visible FAQ question and answer matches FAQPage, in order`, () => {
    const visible = visibleFaq(page);
    const structured = oneSchema(page, 'FAQPage').mainEntity;
    assert.ok(visible.length >= 1, 'an empty extraction must never pass parity');
    assert.equal(structured.length, visible.length, 'no hidden-only or missing FAQ answers');
    assert.equal(new Set(visible.map(row => row.question)).size, visible.length, 'no duplicate questions');
    for (const [index, row] of visible.entries()) {
      assert.equal(structured[index]['@type'], 'Question');
      assert.equal(structured[index].acceptedAnswer['@type'], 'Answer');
      assert.equal(plain(structured[index].name), row.question, `question ${index + 1}`);
      assert.equal(plain(structured[index].acceptedAnswer.text), row.answer, `answer ${index + 1}`);
    }
  });

  test(`${page.name}: actual substantive revision date is visible and agrees with structured metadata`, () => {
    const primary = oneSchema(page, page.name === 'guide' ? 'Article' : 'WebApplication');
    assert.equal(primary.dateModified, REVISION_DATE);
    const body = page.html.split(/<body\b[^>]*>/i)[1]?.split(/<script\b/i)[0] || '';
    const revisions = [...plain(body).matchAll(/(?:최종\s*수정|수정일|최근\s*수정|검토일)\s*[:·]?\s*(\d{4}-\d{2}-\d{2})/g)].map(match => match[1]);
    assert.ok(revisions.length >= 1, 'show an explicit revision label, not only a date in a script');
    for (const revision of revisions) assert.equal(revision, REVISION_DATE);
    if (page.name === 'guide') assert.equal(primary.datePublished, '2026-05-24', 'original publication date is preserved');
  });

  test(`${page.name}: unsupported authentication, weight, ranking, and disposal claims do not return`, () => {
    // Check HTML attributes, visible copy and schema text together. These narrow
    // patterns target the removed claims, not honest warnings about their limits.
    const copy = decode(page.html);
    const forbidden = [
      [/1\.7\s*[~～–-]\s*1\.8\s*g|0\.305\s*mm|1\.84\s*g/i, 'unsupported universal weight/thickness'],
      [/위조\s*시도가\s*많은\s*카드\s*1위|가품\s*(?:순위|발생률)\s*1위/, 'counterfeit ranking'],
      [/시세의?\s*30\s*[~～–-]\s*50\s*%|시세\s*50\s*%\s*이하\s*가격은\s*거의\s*가품/, 'discount-based counterfeit likelihood'],
      [/급매[\s\S]{0,60}30\s*%\s*정도만\s*깎/, 'invented normal discount'],
      [/진품\s*검증(?:된|을\s*마친)?\s*카드\s*거래만\s*집계|모든\s*거래[\s\S]{0,30}진품\s*검증(?:을\s*)?거친/, 'all market-price records physically authenticated'],
      [/PSA가\s*검증한\s*카드\s*자체는\s*가품이\s*거의\s*없/, 'unsupported certification failure rate'],
      [/인증번호(?:가)?\s*조회(?:되면|만으로)[^.!?<]{0,40}정품(?:입니다|을\s*보장합니다)/, 'certificate lookup guarantees the offered object'],
      [/가장\s*안전한\s*처분은\s*(?:그냥\s*)?폐기|그냥\s*폐기(?:하세요|하는\s*것)/, 'discarding dispute evidence'],
      [/개인\s*보관은\s*문제\s*없|다시\s*판매하면\s*본인이\s*가해자/, 'unqualified legal claim'],
      [/실제\s*검수\s*워크플로우/, 'illustration presented as a documented real test'],
    ];
    for (const [pattern, reason] of forbidden) assert.equal(pattern.test(copy), false, `${page.name}: ${reason}`);
  });
}

test('existing guide illustrations and checker image paths are preserved, with explicit dimensions and nonempty alt', () => {
  assert.deepEqual(tags(guide.html, 'img').map(image => image.src), [
    '/images/guides/fake-detection-hero.webp?v=20260602',
    '/images/guides/fake-detection-body.webp',
  ]);
  const article = oneSchema(guide, 'Article');
  assert.deepEqual(article.image, [
    'https://cardpick.kr/images/guides/fake-detection-hero.webp?v=20260602',
    'https://cardpick.kr/images/guides/fake-detection-body.webp',
  ]);
  for (const page of pages) {
    for (const image of tags(page.html, 'img')) {
      assert.ok(Number(image.width) > 0 && Number(image.height) > 0, `${page.name}: intrinsic image dimensions`);
      assert.ok(image.alt?.trim(), `${page.name}: meaningful alt remains present`);
    }
  }
  assert.equal(tags(checker.html, 'meta').find(tag => tag.property === 'og:image')?.content,
    'https://cardpick.kr/images/tools/fake-card-checker-hero.webp');
  assert.equal(tags(guide.html, 'meta').find(tag => tag.property === 'og:image')?.content, article.image[0]);
});

test('the Charizard comparison uses 234/091 and links the official Paldean Fates card', () => {
  assert.ok(/234\s*\/\s*091/.test(plain(guide.html)), 'visible example identifies Charizard ex as 234/091');
  const links = tags(guide.html, 'a').map(link => link.href);
  const officialReferences = [
    'https://www.pokemon.com/uk/pokemon-tcg/pokemon-cards/series/sv4pt5/234',
    'https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/checklist/paf_web_cardlist_en.pdf',
  ];
  assert.ok(officialReferences.some(url => links.includes(url)), 'official card or set-list cross-check');
  assert.equal(/리자몽\s*ex\s*SAR[^.]{0,100}Paldean Fates\s*232\s*\/\s*091/.test(plain(guide.html)), false, 'do not attribute Mew ex 232 to Charizard');
});

class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag;
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.listeners = new Map();
    this.value = '';
    this.style = Object.fromEntries((attrs.style || '').split(';').filter(Boolean).map(part => {
      const colon = part.indexOf(':');
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    }));
    this.classList = {
      contains: name => this.classes().has(name),
      add: (...names) => { const set = this.classes(); names.forEach(name => set.add(name)); this.className = [...set].join(' '); },
      remove: (...names) => { const set = this.classes(); names.forEach(name => set.delete(name)); this.className = [...set].join(' '); },
      toggle: (name, force) => {
        const value = force ?? !this.classList.contains(name);
        this.classList[value ? 'add' : 'remove'](name);
        return value;
      },
    };
  }
  classes() { return new Set(this.className.split(/\s+/).filter(Boolean)); }
  get className() { return this.attrs.get('class') || ''; }
  set className(value) { this.attrs.set('class', value); }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
  get innerHTML() { return this.children.map(child => typeof child === 'string' ? child : `<${child.tagName}>${child.innerHTML}</${child.tagName}>`).join(''); }
  set innerHTML(value) { this.children = parseMarkup(String(value)).children; }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(value) { if (value) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  addEventListener(event, callback) { if (!this.listeners.has(event)) this.listeners.set(event, []); this.listeners.get(event).push(callback); }
  dispatch(event) { for (const callback of this.listeners.get(event) || []) callback({ type: event, target: this, preventDefault() {} }); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
}

function parseMarkup(markup) {
  const root = new Element('root');
  const stack = [root];
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const clean = markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const token of clean.match(/<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('</')) {
      const close = token.match(/^<\/([\w-]+)/)?.[1].toLowerCase();
      const index = stack.findLastIndex(node => node.tagName === close);
      if (index > 0) stack.splice(index);
    } else if (/^<[a-z]/i.test(token)) {
      const [, tag, source] = token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);
      const node = new Element(tag.toLowerCase(), attributes(source));
      stack.at(-1).appendChild(node);
      if (!voids.has(node.tagName) && !/\/>$/.test(token)) stack.push(node);
    } else if (!token.startsWith('<!')) stack.at(-1).children.push(decode(token));
  }
  return root;
}

function descendants(root) {
  return root.children.flatMap(child => typeof child === 'string' ? [] : [child, ...descendants(child)]);
}

function createClient() {
  const root = parseMarkup(checker.html);
  const nodes = descendants(root);
  const document = {
    getElementById: id => nodes.find(node => node.getAttribute('id') === id) || null,
    createElement: tag => new Element(tag),
  };
  for (const id of IDS) {
    const node = document.getElementById(id);
    assert.equal(node?.tagName, 'select', `the real input ${id} must exist`);
    const options = descendants(node).filter(option => option.tagName === 'option');
    node.value = (options.find(option => option.attrs.has('selected')) || options[0]).getAttribute('value');
  }
  const inline = scripts(checker.html).filter(script => !script.attrs.src && !script.attrs.type
    && /\bITEMS\b/.test(script.code) && /\brecalc\b/.test(script.code));
  assert.equal(inline.length, 1, 'execute the one actual calculator script');
  const network = [];
  const forbiddenNetwork = (...args) => { network.push(args); throw new Error('calculator must not send user selections'); };
  const context = vm.createContext({ document, fetch: forbiddenNetwork,
    XMLHttpRequest: function(...args) { return forbiddenNetwork(...args); },
    WebSocket: function(...args) { return forbiddenNetwork(...args); },
    navigator: { sendBeacon: forbiddenNetwork }, URLSearchParams, console });
  const initial = snapshot(document);
  vm.runInContext(inline[0].code, context, { timeout: 1000 });
  return {
    document, network, initial,
    get: id => document.getElementById(id),
    set(values) { IDS.forEach((id, index) => { document.getElementById(id).value = values[index]; }); document.getElementById(IDS[0]).dispatch('change'); },
    reset() { document.getElementById('btnReset').dispatch('click'); },
    snapshot: () => snapshot(document),
  };
}

function snapshot(document) {
  const get = id => { const node = document.getElementById(id); assert.ok(node, `result element ${id} exists`); return node; };
  return {
    verdict: plain(get('oVerdict').textContent),
    description: plain(get('oSub').textContent),
    counts: plain(get('oCounts').textContent),
    flags: descendants(get('oFlags')).filter(node => node.tagName === 'li').map(node => plain(node.textContent)),
    flagsText: plain(get('oFlags').textContent),
    flagsHidden: get('oFlags').hidden || get('oFlags').style.display === 'none',
    classes: [...get('bigBox').classes()].sort(),
  };
}

function expected(values) {
  const normalized = values.map((value, index) => ['ok', 'sus', 'unknown'].includes(value)
    || (IDS[index] === 'c-holo' && value === 'na') ? value : 'unknown');
  const sus = normalized.filter(value => value === 'sus').length;
  const unknown = normalized.filter(value => value === 'unknown').length;
  const na = normalized.filter(value => value === 'na').length;
  const checked = 7 - unknown - na;
  return { sus, unknown, na, checked, normalized,
    counts: `확인 ${checked}개 · 미확인 ${unknown}개 · 차이 발견 ${sus}개 · 해당 없음 ${na}개`,
    verdict: checked === 0 ? '아직 비교한 항목이 없습니다'
      : sus > 0 ? `차이·확인할 점 ${sus}개`
        : unknown > 0 ? '미확인 항목이 남아 있습니다' : '선택한 항목의 비교를 마쳤습니다',
  };
}

function assertState(client, values, label) {
  const state = client.snapshot();
  const want = expected(values);
  assert.equal(state.counts, want.counts, `${label}: counts`);
  assert.equal(state.verdict, want.verdict, `${label}: verdict`);
  assert.equal(state.flags.length, want.sus, `${label}: current differences only`);
  assert.equal(state.flagsHidden, want.sus === 0, `${label}: flag visibility`);
  assert.ok(!state.classes.includes('ok') && !state.classes.includes('danger'), `${label}: no authenticity traffic light`);
  if (!want.sus) assert.equal(state.flagsText, '', `${label}: clear old hidden flags`);
  assert.doesNotMatch(state.verdict, /가품|정품|위험도|강한\s*신호|%/, `${label}: report observations, not authentication`);
  assert.doesNotMatch([state.description, ...state.flags].join(' '), /가품\s*확률\s*\d|위험도\s*\d|정품입니다|강한\s*신호|가품으로\s*확정(?:합니다|됐)/, label);
  assert.equal(client.network.length, 0, `${label}: inputs remain local`);
  return state;
}

test('checker: native selects have associated visible labels, hint descriptions, and only holo supports not-applicable', () => {
  const root = parseMarkup(checker.html);
  const nodes = descendants(root);
  for (const id of IDS) {
    const select = nodes.find(node => node.tagName === 'select' && node.getAttribute('id') === id);
    const label = nodes.find(node => node.tagName === 'label' && node.getAttribute('for') === id);
    assert.ok(label && plain(label.textContent), `${id}: visible label association`);
    const descriptions = (select.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    assert.ok(descriptions.includes(`${id}-hint`), `${id}: the comparison hint is associated`);
    for (const description of descriptions) assert.ok(nodes.some(node => node.getAttribute('id') === description && plain(node.textContent)));
    const options = descendants(select).filter(node => node.tagName === 'option');
    const values = options.map(node => node.getAttribute('value'));
    assert.deepEqual(values.filter(value => value !== 'na').sort(), ['ok', 'sus', 'unknown']);
    assert.equal(values.includes('na'), id === 'c-holo');
    assert.deepEqual(options.filter(node => node.attrs.has('selected')).map(node => node.getAttribute('value')), ['unknown']);
  }
  const status = nodes.find(node => node.getAttribute('id') === 'bigBox');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  const reset = nodes.find(node => node.getAttribute('id') === 'btnReset');
  assert.equal(reset.tagName, 'button');
  assert.equal(reset.getAttribute('type'), 'button');
});

test('checker: static initial HTML and initialized JavaScript show the same seven unknown items', () => {
  const client = createClient();
  assert.deepEqual(client.snapshot(), client.initial);
  assertState(client, Array(7).fill('unknown'), 'initial');
});

test('checker: one completed item clearly leaves six unknown and never shows a green verdict', () => {
  const client = createClient();
  const values = ['ok', ...Array(6).fill('unknown')];
  client.set(values);
  assertState(client, values, 'one comparison');
});

test('checker: each single difference counts as one, without weighted multiple-danger wording', () => {
  const client = createClient();
  for (const [index, id] of IDS.entries()) {
    const values = Array(7).fill('unknown'); values[index] = 'sus';
    client.set(values);
    const state = assertState(client, values, id);
    assert.doesNotMatch(state.verdict, /다수|위험|강한/);
  }
});

test('checker: seven completed comparisons never promise an authentic card', () => {
  const client = createClient();
  const values = Array(7).fill('ok');
  client.set(values);
  const state = assertState(client, values, 'all compared');
  assert.match(state.description, /정품[^.]*보장하지|진위[^.]*확정[^.]*않|정품[^.]*뜻하지|정품\s*(?:확인|인증)[^.]*아닙니다/);
});

test('checker: reset removes every old difference, restores unknown selects, and matches initial HTML', () => {
  const client = createClient();
  client.set(Array(7).fill('sus'));
  assert.equal(client.snapshot().flags.length, 7);
  client.reset();
  assert.deepEqual(IDS.map(id => client.get(id).value), Array(7).fill('unknown'));
  assert.deepEqual(client.snapshot(), client.initial);
  assertState(client, Array(7).fill('unknown'), 'reset');
});

test('checker: unexpected values are unknown and non-holo not-applicable is never treated as checked', () => {
  const client = createClient();
  for (const unexpected of ['', 'tampered', '<img src=x>', null, undefined, 'na']) {
    const values = Array(7).fill(unexpected);
    client.set(values);
    assertState(client, values, `unexpected ${String(unexpected)}`);
  }
});

test('checker: all 2,916 valid selection combinations preserve counts, verdict order, flags, and local-only processing', t => {
  const client = createClient();
  const base = ['ok', 'sus', 'unknown'];
  const differenceNames = IDS.map((id, index) => {
    const values = Array(7).fill('unknown'); values[index] = 'sus';
    client.set(values);
    const state = assertState(client, values, `${id}: flag identity`);
    assert.ok(state.flags[0]);
    return state.flags[0];
  });
  assert.equal(new Set(differenceNames).size, IDS.length, 'each comparison has a distinct result label');
  let checked = 0;
  const visit = values => {
    if (values.length === IDS.length) {
      client.set(values);
      const state = assertState(client, values, values.join('/'));
      assert.deepEqual(state.flags, differenceNames.filter((_, index) => values[index] === 'sus'), 'differences follow the form order');
      checked++;
      return;
    }
    for (const value of IDS[values.length] === 'c-holo' ? [...base, 'na'] : base) visit([...values, value]);
  };
  visit([]);
  assert.equal(checked, 2916);
  t.diagnostic(`Checked ${checked} combinations against the actual inline calculator.`);
});
