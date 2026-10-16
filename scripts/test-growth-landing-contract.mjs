// Offline regression contracts for the four approved 2026-10-15 growth landings.
// Baseline hashes were taken before this work from HEAD 22713fdf's existing pages.
// Primary-source verification is separate: these checks do not measure ranking,
// traffic, indexing, current external prices, real grading outcomes or performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pageFontCss } from './page-font-css.mjs';
import growthBuild from './growth-guides-tailwind.config.cjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim();
const schema = source => [...source.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .flatMap(([, text]) => { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed]; });
const one = (source, type) => { const values = schema(source).filter(entry => entry['@type'] === type); assert.equal(values.length, 1, type); return values[0]; };
const match = (source, regex) => source.match(regex)?.[0] || '';

// Exact inverse of the 2026-10-15 approved resource-only candidate. Preserve the
// earlier content hashes below, and additionally protect the entire pre-candidate
// document. Generated CSS must equal its reviewed source, not merely match an id.
const resourceCheckpoint = {
  'guide-psa-turnaround.html': '6c7068b4ac93988970ace4e2af6663d90dda0c18fa044059245d40e3c7b0a96a',
  'guide-brg-grading.html': '2bf0fdf62d22f165de491fab0a51ffaedff0da1b275193bfbe355911ad60433c',
  'guide-card-rarities.html': '8648d82a490aabd8e6728892a99181398f8560f72bf576b1aa93446a458626a4',
  'tools/sleeve-toploader-finder.html': '999f1405be27c751fa2a01e69c384a78d5ff387a05748f941c4253f335fc3de0',
};
const generatedFonts = pageFontCss(read('styles/releases-fonts.css'), read('styles/growth-guides-text-font.css'));
const generatedBase = read('styles/growth-guides-base.css');
assert.equal(hash(generatedBase), '9cb3ecf6fb8a230f7e5bdb79534fd08ada0a0ff44259ae24e82fde0875c974f1', 'Reviewed compiled guide utilities and licensed Mono declarations');
const oldTailwind = '<script src="https://cdn.tailwindcss.com"></script>\n'
  + '<script>tailwind.config={theme:{extend:{colors:{bg:\'#05080D\',panel:\'#0D121B\',panel2:\'#111722\',line:\'rgba(255,255,255,0.08)\',ink:\'#E8EDF5\',muted:\'#8B96A8\',up:\'#26E0C2\',down:\'#FF4D6D\',brand:\'#26E0C2\',warn:\'#E0B84A\'},fontFamily:{sans:[\'Pretendard\',\'system-ui\',\'sans-serif\'],mono:[\'"IBM Plex Mono"\',\'ui-monospace\',\'monospace\']}}}}</script>';
const sleeveOptional = '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional" rel="stylesheet" media="print" onload="this.media=\'all\'">\n'
  + '<noscript><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional" rel="stylesheet"></noscript>';
function once(source, exact, replacement, label) {
  assert.equal(source.split(exact).length - 1, 1, label + ': one exact resource block');
  return source.replace(exact, () => replacement);
}
// Exact inverse of the separately approved Japanese MEGA addition. Keep all
// original resource/content hashes; never discard an arbitrary section by id.
const approvedMegaCopies = [
  ['<meta name="description" content="포켓몬 카드 레어도 표기를 판본별로 구분합니다. 한글판·일본판의 AR·SAR·SR과 영문판의 IR·SIR·UR·HR을 공식 카드검색으로 확인하는 방법을 설명합니다.">', '<meta name="description" content="포켓몬 카드 레어도 표기를 판본별로 구분합니다. AR·SAR와 IR·SIR의 차이, 일본판 MEGA의 MUR·MA 코드를 공식 자료로 확인하며 다른 언어판으로 자동 대응하지 않습니다.">'],
  ['<meta property="og:description" content="AR·SAR·SR과 IR·SIR·UR·HR을 섞지 않고 공식 카드검색으로 확인하는 순서.">', '<meta property="og:description" content="AR·SAR와 IR·SIR을 구분하고 일본판 MEGA의 MUR·MA 코드를 공식 자료로 확인하는 순서.">'],
  ['<meta name="twitter:description" content="한글판·일본판·영문판 레어도 표기를 공식 카드검색과 대조하는 방법.">', '<meta name="twitter:description" content="판본별 레어도 표기와 일본판 MEGA의 MUR·MA를 공식 카드검색에서 확인하는 방법.">'],
  ['<meta property="article:modified_time" content="2026-10-15">', '<meta property="article:modified_time" content="2026-10-16">'],
  ['#kr-jp,#english,#identify{scroll-margin-top:80px}', '#kr-jp,#english,#mega-jp,#identify{scroll-margin-top:80px}'],
  ['RARITY GUIDE · 발행 2026-05-24 · 최종 수정 2026-10-15', 'RARITY GUIDE · 발행 2026-05-24 · 최종 수정 2026-10-16'],
  ['<p class="text-[15px] text-muted mb-6">한글판·일본판·영문판의 AR·SAR·SR·IR·SIR·UR·HR 구분</p>', '<p class="text-[15px] text-muted mb-6">판본별 AR·SAR·IR·SIR 구분 · 일본판 MEGA의 MUR·MA 확인</p>'],
  ['<label>시리즈<select id="cp-rarity-series"><option value="unknown">다른 시리즈 또는 아직 모름</option><option value="sv">스칼렛&amp;바이올렛</option></select></label>', '<label>시리즈<select id="cp-rarity-series"><option value="unknown">다른 시리즈 또는 아직 모름</option><option value="sv">스칼렛&amp;바이올렛</option><option value="mega">MEGA (일본판 MUR·MA 확인)</option></select></label>'],
  ['카드픽 편집부가 2026-09-23에 다시 검토했습니다.', '카드픽 편집부가 2026-09-23에 다시 검토했습니다. 일본판 MEGA의 MUR·MA 설명과 위 공식 링크는 2026-10-16에 추가 대조했습니다.'],
  ['"description": "포켓몬 카드 레어도 표기를 판본별로 구분하고 공식 카드검색에서 제품명·번호·레어도를 대조하는 방법."', '"description": "판본별 레어도 표기와 일본판 MEGA의 MUR·MA를 구분하고 공식 카드검색에서 제품명·번호·레어도를 대조하는 방법."'],
  ['"dateModified": "2026-10-15"', '"dateModified": "2026-10-16"'],
  ['"https://www.pokemon.com/us/pokemon-tcg/pokemon-cards"\n  ]', '"https://www.pokemon.com/us/pokemon-tcg/pokemon-cards",\n    "https://www.pokemon-card.com/card-search/",\n    "https://www.pokemon-card.com/info/005168.html",\n    "https://www.pokemon-card.com/ex/m2a/index.html"\n  ]'],
  ['<script src="/js/cp-rarity-helper.js?v=20261015" defer></script>', '<script src="/js/cp-rarity-helper.js?v=20261016" defer></script>'],
];
const approvedMegaSection = `  <h2 id="mega-jp">일본판 MEGA의 MUR·MA 확인</h2>
  <p><strong>MUR와 MA는 같은 코드가 아닙니다.</strong> 일본 공식 카드검색은 두 코드를 별도 레어리티로 구분하며, 공식 MA 소개는 메가진화 포켓몬이 강력한 기술을 사용하는 모습을 그린 카드라고 설명합니다. 아래는 일본판 공식 자료를 확인한 범위이며 MEGA의 모든 레어도 목록이나 가격 순위가 아닙니다.</p>
  <div class="table-wrap" tabindex="0" role="region" aria-label="일본판 MEGA MUR MA 확인 표">
    <table>
      <caption>표 4. 일본판 MEGA에서 확인할 MUR·MA(2026-10-16 공식 자료 확인)</caption>
      <thead><tr><th scope="col">코드</th><th scope="col">확인한 명칭</th><th scope="col">공식 자료에서 확인할 내용</th></tr></thead>
      <tbody>
        <tr><th scope="row">MUR</th><td>공식 카드검색의 레어리티 코드</td><td>일본 공식 카드검색에서 MUR 필터와 해당 제품·카드 번호를 대조합니다. 이 글은 풀네임을 확정하지 않습니다.</td></tr>
        <tr><th scope="row">MA</th><td>메가어택레어</td><td>일본 공식은 MA(메가어택레어)를 새로운 레어리티로 소개합니다. MEGA 드림 ex 상품 안내에서 수록 카드와 설명을 확인할 수 있습니다.</td></tr>
      </tbody>
    </table>
  </div>
  <p>근거: <a href="https://www.pokemon-card.com/card-search/" target="_blank" rel="noopener nofollow">일본 공식 카드검색</a>, <a href="https://www.pokemon-card.com/info/005168.html" target="_blank" rel="noopener nofollow">일본 공식 MA 발표</a>, <a href="https://www.pokemon-card.com/ex/m2a/index.html" target="_blank" rel="noopener nofollow">MEGA 드림 ex 공식 상품 안내</a>.</p>
  <p class="warn-box">이 표를 한글판·영문판의 같은 등급으로 자동 치환하지 않습니다. 카드의 언어판·제품·번호를 각각 확인하세요. MUR·MA라는 코드만으로 봉입률, 가격, 진품 여부나 가장 높은 등급을 판단할 수 없습니다.</p>

`;
const approvedMegaToc = '      <li><a href="#mega-jp">일본판 MEGA의 MUR·MA 확인</a></li>\n';
const approvedMegaVisibleFaq = `  <div class="faq-item"><div class="faq-q">Q. 일본판 MEGA의 MUR와 MA는 무엇인가요?</div><div class="faq-a">A. 일본 공식 카드검색은 MUR와 MA를 별도 레어리티 코드로 구분합니다. 공식 MA 소개는 메가어택레어라고 설명하며 MEGA 드림 ex에서 관련 카드를 확인할 수 있습니다. 이 글은 MUR 풀네임이나 두 코드의 가격·봉입률 순위를 확정하지 않습니다.</div></div>
  <div class="faq-item"><div class="faq-q">Q. 일본판 MEGA 설명을 한글판·영문판에도 그대로 적용하나요?</div><div class="faq-a">A. 아니요. 이 도우미의 MEGA 설명은 일본판 MUR·MA를 공식 자료와 대조한 범위입니다. 한글판·영문판의 동일 등급이나 가격으로 자동 대응하지 않으며, 해당 언어판의 공식 카드검색에서 제품·번호·레어도를 따로 확인해야 합니다.</div></div>
`;
const approvedMegaStructuredFaq = `,
    {
      "@type": "Question",
      "name": "일본판 MEGA의 MUR와 MA는 무엇인가요?",
      "acceptedAnswer": { "@type": "Answer", "text": "일본 공식 카드검색은 MUR와 MA를 별도 레어리티 코드로 구분합니다. 공식 MA 소개는 메가어택레어라고 설명하며 MEGA 드림 ex에서 관련 카드를 확인할 수 있습니다. 이 글은 MUR 풀네임이나 두 코드의 가격·봉입률 순위를 확정하지 않습니다." }
    },
    {
      "@type": "Question",
      "name": "일본판 MEGA 설명을 한글판·영문판에도 그대로 적용하나요?",
      "acceptedAnswer": { "@type": "Answer", "text": "아니요. 이 도우미의 MEGA 설명은 일본판 MUR·MA를 공식 자료와 대조한 범위입니다. 한글판·영문판의 동일 등급이나 가격으로 자동 대응하지 않으며, 해당 언어판의 공식 카드검색에서 제품·번호·레어도를 따로 확인해야 합니다." }
    }`;
function restoreApprovedMegaContent(source) {
  assert.ok(source.includes('      <li><a href="#english">영문판 스칼렛&바이올렛 기호</a></li>\n' + approvedMegaToc + '      <li><a href="#identify">'), 'MEGA TOC stays at the reviewed boundary');
  assert.ok(source.includes(approvedMegaSection + '  <h2 id="identify">'), 'MEGA body stays immediately before the existing identification steps');
  assert.ok(source.includes(approvedMegaVisibleFaq + '\n  <div class="source-box">'), 'New visible FAQs stay at the end of the existing FAQ list');
  assert.ok(source.includes(approvedMegaStructuredFaq + '\n  ]\n}\n</script>\n\n<script src="/js/cp-rarity-helper.js?v=20261016"'), 'New FAQ data stays at the reviewed FAQ schema boundary');
  for (const block of [approvedMegaToc, approvedMegaSection, approvedMegaVisibleFaq, approvedMegaStructuredFaq]) source = once(source, block, '', 'Approved MEGA content');
  for (const [before, after] of approvedMegaCopies) source = once(source, after, before, 'Approved MEGA copy');
  return source;
}
function restoreResourceCandidate(file, source) {
  if (file.startsWith('guide-')) {
    assert.equal((source.match(/id="growth-guides-font-css"/g) || []).length, 1);
    assert.equal((source.match(/id="growth-guides-base-css"/g) || []).length, 1);
    const asStyle = file === 'guide-brg-grading.html' ? '' : ' as="style"';
    const original = '<link rel="preconnect" href="https://cdn.jsdelivr.net">\n'
      + '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
      + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
      + '<link rel="preconnect" href="https://cdn.tailwindcss.com">\n'
      + '<link rel="stylesheet"' + asStyle + ' href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">\n'
      + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">\n' + oldTailwind;
    source = once(source, '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n<style id="growth-guides-font-css">' + generatedFonts + '</style>', original, file);
    source = once(source, '<style id="growth-guides-base-css">' + generatedBase + '</style>\n</head>', '</head>', file);
    source = once(source, "font-family:'Cardpick Text',Pretendard,system-ui,sans-serif}", 'font-family:Pretendard,system-ui,sans-serif}', file);
    source = once(source, "  button[onclick=\"cpShare()\"]{font-family:'Cardpick Text',Pretendard,system-ui,sans-serif!important}\n", '', file);
  } else {
    source = once(source, sleeveOptional, '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">', file);
  }
  assert.equal(hash(source), resourceCheckpoint[file], 'Whole pre-resource document remains exact (including body, ad code, metadata and source dates)');
  return source;
}

test('growth compiler rejects body-moved, duplicated and displaced slots before any writes', () => {
  for (const file of Object.keys(resourceCheckpoint).filter(file => file.startsWith('guide-'))) {
    const source = read(file);
    growthBuild.assertHeadSlots(file, source);
    const font = '<style id="growth-guides-font-css">' + generatedFonts + '</style>';
    const base = '<style id="growth-guides-base-css">' + generatedBase + '</style>';
    for (const changed of [
      source.replace(font, '').replace('</body>', font + '</body>'),
      source.replace(base, '').replace('</body>', base + '</body>'),
      source.replace('<head>', '<head><head>'),
      source.replace('</head>', '</head></head>'),
      source.replace(font, font + font),
      source.replace(base, base + base),
      source.replace(font, '').replace('<meta charset', font + '<meta charset'),
      source.replace(base + '\n', '').replace(font, base + '\n' + font),
    ]) {
      assert.notEqual(changed, source);
      assert.throws(() => growthBuild.assertHeadSlots(file, changed), /unique, ordered/);
    }
  }
});

const baseline = {
  'guide-psa-turnaround.html': {
    title: 'PSA 그레이딩 소요기간·진행 단계: 한국에서 며칠 걸리나 | 카드픽', canonical: 'https://cardpick.kr/guide-psa-turnaround', published: '2026-06-09T17:00:00+09:00', faq: 8,
    styles: '4ef24a9b627a5ac5999be373229a58f443c2d81bf0c2658dd47e99fa76b263a7', scripts: 'f1ee47cb2368a87433934e59d1a7730326d0287228caab3c0de58a1b2dfa8d78', images: '817e7ccbef22b118b000219fa31fecd27fb36bb458886fb1d9cd974da5566f2c', header: '269d88b210443706d346875ade2170df6654fc2faa8e83b3e3514c5da4b2bdf2', footer: '8824c74238b61d35f9668ae126ecf34294ff1f0efd85e413e3bcfb914a33c1af', share: 'fde999bae17ac5c9d793d97643c0c197cb43197c90d0a77205de2eeae933ca39', h1: '313272947ce868c8067531899c1f2f077456d47a650653fb178d19cd35389bb1',
  },
  'guide-brg-grading.html': {
    title: 'BRG 그레이딩 총정리: 한국 카드 그레이딩(브레이크) 신청·비용·PSA 차이 | 카드픽', canonical: 'https://cardpick.kr/guide-brg-grading', published: '2026-06-22T16:00:00+09:00', faq: 8,
    styles: '0dda83423dfc9b00560a241b7c379e58c02baede61d0d3d71c6649fbb1e7cb1d', scripts: 'f1ee47cb2368a87433934e59d1a7730326d0287228caab3c0de58a1b2dfa8d78', images: '185549815761c665f92b64531916a8d1c0c9f0f8d59240a23ad0fe02fd0d6354', header: '269d88b210443706d346875ade2170df6654fc2faa8e83b3e3514c5da4b2bdf2', footer: 'efeaa379aa7aef0a59a668ac01224a9154f941e50713b059fe175fac75724693', share: 'fde999bae17ac5c9d793d97643c0c197cb43197c90d0a77205de2eeae933ca39', h1: 'f9a9218fedfef27a1cd776c0d3783e651dfff70822f1b21a11f43170c826f241',
  },
  'guide-card-rarities.html': {
    title: '포켓몬 카드 레어도 읽는 법: 한글판·일본판·영문판 차이 | 카드픽', canonical: 'https://cardpick.kr/guide-card-rarities', published: '2026-05-24', faq: 7,
    styles: 'e40ded63269be57e3b11243949b3eb737a0205201bcaba5357f0d079a9df7ac7', scripts: 'f1ee47cb2368a87433934e59d1a7730326d0287228caab3c0de58a1b2dfa8d78', images: '77870d98abfb09a5445c439b5dd83508a8289c9b6cee5525fc5a98fb454fddfc', header: 'b9edda5153d9cf1902a7b87f0b159368951310668bcc6a8e024f4b35553daa34', footer: '75df07bfa18bc9ca199529fb5135e4941c90e8c11706e6791960c2437525f193', share: 'fde999bae17ac5c9d793d97643c0c197cb43197c90d0a77205de2eeae933ca39', h1: 'eedebea90992981f8df340f3131970dadee7f5aa82d3fb22c9954cee997816f0',
  },
  'tools/sleeve-toploader-finder.html': {
    title: '포켓몬 카드 슬리브·탑로더 고르기 - 보관·그레이딩 제출용 규격 추천 | 카드픽', canonical: 'https://cardpick.kr/tools/sleeve-toploader-finder', published: undefined, faq: 6,
    styles: '18fed93f05579f576af30efb9cdf35d8b753eb74cea47a0db82a3296bc231281', scripts: '4e329f5e01adce45c14809b8b55bbdf79322d14c42b1c2ad7671dda49c5b409e', images: 'afe0e14e4ea60191c3d733afe53817d1ab5b278d9481ac6df32d101953d0572b', header: '5733ae2ac2572555be020dde3cf99a2c5f3850374d42c095755db53cf5536f5d', footer: '3ae36985ee9679e8b48f743814bf6ecc70363a9ff8a956f9e36a273cdb37c609', share: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', h1: '83f90acdaed69684eff6579a3cf35418ab974f524c8be27fc77a03961d3de68f',
  },
};

function assertProtected(file, source) {
  if (file === 'guide-card-rarities.html') source = restoreApprovedMegaContent(source);
  source = restoreResourceCandidate(file, source);
  const expected = baseline[file];
  assert.equal(source.match(/<title>([\s\S]*?)<\/title>/)?.[1], expected.title, 'Existing title is preserved');
  assert.equal(source.match(/rel="canonical" href="([^"]+)"/)?.[1], expected.canonical);
  assert.equal(source.match(/name="robots" content="([^"]+)"/)?.[1], 'index,follow,max-image-preview:large,max-snippet:-1');
  assert.equal(source.match(/property="og:url" content="([^"]+)"/)?.[1], expected.canonical);
  assert.equal(source.match(/property="article:published_time" content="([^"]+)"/)?.[1], expected.published);
  assert.equal((source.match(/<h1\b/g) || []).length, 1);
  assert.equal(hash(match(source, /<h1\b[\s\S]*?<\/h1>/)), expected.h1, 'Original visible heading is preserved');
  assert.equal(hash(match(source, /<header\b[\s\S]*?<\/header>/)), expected.header, 'Header and navigation are unchanged');
  assert.equal(hash(match(source, /<footer\b[\s\S]*?<\/footer>/)), expected.footer);
  assert.equal(hash(match(source, /<section class="cp-share-bar"[\s\S]*?<\/section>/)), expected.share, 'Original share handlers and layout remain');
  const images = [...source.matchAll(/<(?:img|meta|link)\b[^>]*>/g)].map(([tag]) => tag)
    .filter(tag => /^<img\b/.test(tag) || /\b(?:property|name)="(?:og:image[^"\s]*|twitter:image[^"\s]*)"/.test(tag) || /rel="preload" as="image"/.test(tag));
  assert.equal(hash(images.join('\n')), expected.images, 'Image attributes, preview metadata and preloads remain exact');
  const allowedScript = '<script src="/js/cp-rarity-helper.js?v=20261015" defer></script>';
  const scriptsSource = file === 'guide-card-rarities.html' ? source.replace(allowedScript, '') : source;
  const scripts = [...scriptsSource.matchAll(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/g)].map(([tag]) => tag);
  assert.equal(hash(scripts.join('\n')), expected.scripts, 'Original scripts, analytics, ad code and calculator logic remain exact');
  let stylesSource = source.replace(/<style id="sleeve-choice-css">[\s\S]*?<\/style>\s*/g, '');
  let styles = [...stylesSource.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(([, css]) => css).join('\n');
  if (file === 'guide-card-rarities.html') styles = styles.replace(/\n  \/\* Page-owned rarity helper; existing guide\/table styles are unchanged\. \*\/\n  \.cp-rarity-helper\{[\s\S]*?\n  @media\(max-width:720px\)\{\.cp-rarity-helper\{[^\n]*\n/, '\n');
  else if (file.startsWith('guide-')) styles = styles.replace(/\n  \.growth-actions\{[\s\S]*?\n  @media\(max-width:720px\)\{\.growth-check\{padding:20px 16px\}\}\n/, '\n');
  assert.equal(hash(styles), expected.styles, 'Existing CSS is unchanged outside the explicitly owned additions');
  const article = one(source, file.startsWith('guide-') ? 'Article' : 'WebApplication');
  assert.equal(article.datePublished, expected.published, 'No artificial publication date is added');
  assert.equal(article.dateModified, '2026-10-15');
  if (file.startsWith('guide-')) {
    assert.equal(source.match(/property="article:modified_time" content="([^"]+)"/)?.[1], article.dateModified);
    assert.equal(article.mainEntityOfPage['@id'], expected.canonical);
  } else assert.equal(article.url, expected.canonical);
  assert.match(source, /최종 수정 2026-10-15/);
}

function assertFaq(file, source) {
  const visible = [...source.matchAll(/<div class="faq-q">([\s\S]*?)<\/div>\s*<div class="faq-a">([\s\S]*?)<\/div>/g)]
    .map(([, q, a]) => ({ name: plain(q).replace(/^Q\.\s*/, ''), text: plain(a).replace(/^A\.\s*/, '') }));
  const structured = one(source, 'FAQPage').mainEntity.map(entry => ({ name: plain(entry.name).replace(/^Q\.\s*/, ''), text: plain(entry.acceptedAnswer.text).replace(/^A\.\s*/, '') }));
  assert.equal(visible.length, baseline[file].faq + (file === 'guide-card-rarities.html' ? 2 : 0));
  assert.equal(new Set(visible.map(row => row.name)).size, visible.length, 'FAQ questions are unique');
  assert.deepEqual(structured, visible, 'FAQ schema is the visible answer, not hidden claims');
}

function assertPsa(source) {
  assert.match(source, /id="growth-answer"/);
  assert.ok(source.indexOf('id="growth-answer"') < source.indexOf('<figure'), 'Useful answer precedes original thumbnail');
  assert.match(source, /id="growth-scope"/);
  assert.match(source, /Standard<\/th><td>90~100영업일/);
  assert.match(source, /Priority<\/th><td>70~80영업일/);
  assert.match(source, /Express<\/th><td>20~30영업일/);
  assert.match(source, /Value \/ Value Bulk<\/th><td>표시 없음<\/td><td>일시 접수 중단/);
  assert.match(source, /시작 시점이 '그레이딩 시스템 등록'과 '시설 수령·스캔'으로 다르게/);
  assert.match(source, /어느 표현 하나를 모든 주문의 기준으로 확정하지 않습니다/);
  assert.match(source, /id="growth-status-check"/);
  assert.match(source, /주문번호나 개인정보를 공개 게시판에 올리지 마세요/);
  assert.match(source, /인증번호 조회는 카드 정보 확인용이며 배송 추적이나 현재 주문 진행 조회를 대신하지 않습니다/);
  assert.doesNotMatch(source, /캐나다 센터|한국에는 PSA 사무소가 없어|위로 갈수록|연말·신제품 성수기/);
  assert.match(source, /실제 주문 화면의 단계명과 순서가 우선/);
  assert.equal(one(source, 'ItemList').itemListOrder, undefined, 'Interpretation checkpoints do not claim a fixed official order');
  for (const url of ['https://www.psacard.com/services/tradingcardgrading', 'https://www.psacard.com/support/faq', '/tools/grading-cost-compare', '/tools/psa-grading-break-even']) assert.ok(source.includes('href="' + url + '"'), url);
}

function assertBrg(source) {
  assert.match(source, /id="growth-answer"/);
  assert.ok(source.indexOf('id="growth-answer"') < source.indexOf('<figure'));
  assert.match(source, /Regular<\/th><td>19,800원<\/td><td>15영업일/);
  assert.match(source, /Express<\/th><td>39,800원<\/td><td>5영업일/);
  assert.match(source, /Bulk<\/th><td>13,800원<\/td><td>30영업일 · 최소 20장/);
  assert.match(source, /입고 처리한 다음 영업일부터/);
  assert.match(source, /id="growth-cost-check"/);
  assert.match(source, /계산기<\/a>에는 BRG 항목이 없습니다/);
  assert.match(source, /BRG 요금을 다른 회사 칸에 넣어 BRG 결과처럼 해석하지 마세요/);
  assert.match(source, /번호가 조회된다는 사실만으로 눈앞의 실물 진위를 확정할 수는 없습니다/);
  assert.doesNotMatch(source, /0\.5 단위|가장 높음|중상<\/td>|인지도는 아직 낮다는 의견|한국어 기반/);
  for (const url of ['https://break.co.kr/service/grading', 'https://break.co.kr/', '/guide-card-supplies', '/guide-fake-detection']) assert.ok(source.includes('href="' + url + '"'), url);
}

function assertRarity(source) {
  assert.match(source, /<section id="rarity-helper" class="cp-rarity-helper" aria-labelledby="rarity-helper-title">/);
  assert.match(source, /<fieldset id="cp-rarity-controls" hidden>/);
  for (const id of ['purpose', 'language', 'series', 'mark']) assert.match(source, new RegExp('<select id="cp-rarity-' + id + '"'));
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /id="cp-rarity-answer">언어판과 시리즈를 먼저 확인하세요/);
  assert.match(source, /진품 여부나 가격을 판정하는 기능은 아닙니다/);
  assert.match(source, /JavaScript를 사용할 수 없어도 아래 표와 공식 링크/);
  assert.match(source, /<script src="\/js\/cp-rarity-helper\.js\?v=20261016" defer><\/script>/);
  assert.match(source, /2026-09-23/);
  assert.match(source, /id="mega-jp"/);
  assert.match(source, /이 글은 풀네임을 확정하지 않습니다/);
  assert.match(source, /이 표를 한글판·영문판의 같은 등급으로 자동 치환하지 않습니다/);
  assert.match(source, /MEGA의 모든 레어도 목록이나 가격 순위가 아닙니다/);
  for (const url of ['https://www.pokemon-card.com/card-search/', 'https://www.pokemon-card.com/info/005168.html', 'https://www.pokemon-card.com/ex/m2a/index.html']) {
    assert.ok(source.includes('href="' + url + '"'));
    assert.ok(one(source, 'Article').citation.includes(url));
  }
  assert.equal(one(source, 'Article').dateModified, '2026-10-16');
}

function assertSleeve(source) {
  assert.match(source, /id="sleeve-quick-answer" aria-labelledby="sleeve-choice-title"/);
  assert.match(source, /일반 카드인지 점보 카드인지, 보관용인지 그레이딩 제출용인지부터 구분/);
  assert.match(source, /일본판이라는 이유로 작은 카드용 ‘재팬 사이즈’를 고르는 것은 맞지 않습니다/);
  assert.match(source, /href="#sleeve-input"/);
  assert.match(source, /id="sleeve-input" aria-label="카드 종류와 보관 목적 입력"/);
  assert.match(source, /규격 자료 확인 2026-09-25/);
  assert.match(source, /<style id="sleeve-choice-css">/);
}

for (const file of Object.keys(baseline)) {
  const source = read(file);
  test(file + ': existing SEO identity, images, style, scripts and publication are protected', () => assertProtected(file, source));
  test(file + ': visible and structured FAQs remain identical', () => assertFaq(file, source));
  test(file + ': protection rejects independent SEO, thumbnail, original CSS and script changes', () => {
    const candidates = [
      source.replace('<title>', '<title>changed '),
      source.replace('rel="canonical" href="https://cardpick.kr/', 'rel="canonical" href="https://cardpick.kr/changed-'),
      source.replace('name="robots" content="index,follow', 'name="robots" content="noindex,follow'),
      source.replace('src="/images/guides/', 'src="/images/changed/'),
      source.replace('src="/logo-mark.png"', 'src="/changed-logo.png"'),
      source.replace('background:#05080D', 'background:#05080E'),
      source.replace('--term-bg:', '--changed-bg:'),
      source.replace('gtag(\'config\'', 'gtag(\'changed\''),
      source.replace('최종 수정 ' + (file === 'guide-card-rarities.html' ? '2026-10-16' : '2026-10-15'), '최종 수정 2099-01-01'),
    ].filter(changed => changed !== source);
    assert.ok(candidates.length >= 6, 'Negative tests must actually change bytes');
    for (const changed of candidates) assert.throws(() => assertProtected(file, changed), { code: 'ERR_ASSERTION' });
  });
  test(file + ': FAQ contract rejects hidden/schema-only answer drift', () => {
    const changed = source.replace(/("text"\s*:\s*")/, '$1changed ');
    assert.notEqual(changed, source);
    assert.throws(() => assertFaq(file, changed), { code: 'ERR_ASSERTION' });
  });
  test(file + ': resource inverse rejects moved, duplicate, modified blocks and unrelated head/body drift', () => {
    let candidates;
    if (file.startsWith('guide-')) {
      const font = '<style id="growth-guides-font-css">' + generatedFonts + '</style>';
      const base = '<style id="growth-guides-base-css">' + generatedBase + '</style>';
      candidates = [
        source.replace(font, font + font),
        source.replace(base, base + base),
        source.replace(font, font.replace('font-display:optional', 'font-display:swap')),
        source.replace(base, base.replace('tailwindcss v3.4.17', 'tailwindcss v0.0.0')),
        source.replace(base + '\n', '').replace('<body', base + '\n<body'),
        source.replace(font, '').replace('</head>', font + '\n</head>'),
      ];
    } else {
      candidates = [
        source.replace(sleeveOptional, sleeveOptional + sleeveOptional),
        source.replace(sleeveOptional, '').replace('</head>', sleeveOptional + '\n</head>'),
        source.replace('media="print"', 'media="all"'),
        source.replace('<noscript><link', '<noscript><link data-changed="1"'),
      ];
    }
    candidates.push(source.replace('</head>', '<meta name="changed" content="1">\n</head>'));
    candidates.push(source.replace('</body>', '<p>Changed content</p></body>'));
    for (const changed of candidates) {
      assert.notEqual(changed, source, 'Each negative fixture changes bytes');
      assert.throws(() => assertProtected(file, changed), {code:'ERR_ASSERTION'});
    }
  });
}

test('PSA landing distinguishes official estimates, real order states, private records and delivery', () => assertPsa(read('guide-psa-turnaround.html')));
test('BRG landing distinguishes basic fees, business days, delivery, grading and actual-card checks', () => assertBrg(read('guide-brg-grading.html')));
test('rarity landing progressively connects existing content without implying authenticity or price detection', () => assertRarity(read('guide-card-rarities.html')));
test('sleeve landing keeps the existing calculator and source dates while explaining the choice first', () => assertSleeve(read('tools/sleeve-toploader-finder.html')));

test('growth contracts reject estimate, cost, authentication and fallback caveat removal', () => {
  for (const [file, check, before, after] of [
    ['guide-psa-turnaround.html', assertPsa, '90~100영업일', '90일'],
    ['guide-psa-turnaround.html', assertPsa, '일시 접수 중단', '항상 접수 가능'],
    ['guide-psa-turnaround.html', assertPsa, '어느 표현 하나를 모든 주문의 기준으로 확정하지 않습니다', '모든 주문은 동일합니다'],
    ['guide-brg-grading.html', assertBrg, '13,800원', '1,380원'],
    ['guide-brg-grading.html', assertBrg, '계산기</a>에는 BRG 항목이 없습니다', '계산기</a>에서 BRG를 자동 계산합니다'],
    ['guide-brg-grading.html', assertBrg, '번호가 조회된다는 사실만으로 눈앞의 실물 진위를 확정할 수는 없습니다', '번호로 정품 확정'],
    ['guide-card-rarities.html', assertRarity, 'id="cp-rarity-controls" hidden', 'id="cp-rarity-controls"'],
    ['guide-card-rarities.html', assertRarity, '진품 여부나 가격을 판정하는 기능은 아닙니다', '진품과 가격을 판정합니다'],
    ['tools/sleeve-toploader-finder.html', assertSleeve, '규격 자료 확인 2026-09-25', '규격 자료 확인 2026-10-15'],
  ]) {
    const source = read(file), changed = source.replaceAll(before, after);
    assert.notEqual(changed, source, before);
    assert.throws(() => check(changed), { code: 'ERR_ASSERTION' });
  }
});

test('MEGA inverse rejects stale, changed, duplicated, moved and injected approved additions', () => {
  const source = read('guide-card-rarities.html');
  for (const block of [approvedMegaToc, approvedMegaSection, approvedMegaVisibleFaq, approvedMegaStructuredFaq]) {
    for (const changed of [
      source.replace(block, ''),
      source.replace(block, block + block),
      source.replace(block, block.replace('MEGA', 'MEGA unapproved')),
      source.replace(block, '').replace('</body>', block + '</body>'),
    ]) {
      assert.notEqual(changed, source);
      assert.throws(() => assertProtected('guide-card-rarities.html', changed), {code:'ERR_ASSERTION'});
    }
  }
  for (const [before, after] of approvedMegaCopies) {
    for (const changed of [source.replace(after, before), source.replace(after, after + 'unapproved')]) {
      assert.notEqual(changed, source);
      assert.throws(() => assertProtected('guide-card-rarities.html', changed), {code:'ERR_ASSERTION'});
    }
  }
  const injected = source.replace('MUR 필터와 해당 제품', 'MUR 최고 가격과 해당 제품');
  assert.notEqual(injected, source);
  assert.throws(() => assertProtected('guide-card-rarities.html', injected), {code:'ERR_ASSERTION'});
});
