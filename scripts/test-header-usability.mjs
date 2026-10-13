import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..',import.meta.url));
const base = '53d5e4f34adde53d59d34fd75ae2fad04b6525c2';
const read = file => fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const original = file => execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/').replace(/\/$/,''),'show',base+':'+file],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
const tools = ['grading-cost-compare','overseas-card-cost','psa-cert-checker','centering-checker'];
const sha = text => createHash('sha256').update(text).digest('hex');
const acceptedCss = '0d4d03eeb3f6d325d0bc5dcaae7ebf7d83aed8ed61f16f2442bc93f8eb65619e';
const acceptedCalculator = '88407e02ee21351e2f562cbb3e783dadb4e851a677fb148de2bcd842a77be17e';
function assertApprovedCss(source, before) {
  const blocks=[...source.matchAll(/<style id="cp-tool-header-usability">[\s\S]*?<\/style>/g)];
  assert.equal(blocks.length,1,'one approved owner block only');
  assert.equal(sha(blocks[0][0]),acceptedCss,'exact reviewed header CSS, not arbitrary normalization');
  assert.equal(blocks[0].index,before.indexOf('</style>')+'</style>\n'.length,'approved insertion position');
  return blocks[0][0];
}

for(const name of tools) test(name+' has a real search destination and isolated header-only layout changes',()=>{
  const file='tools/'+name+'.html', before=original(file), after=read(file);
  const header = after.match(/<header\b[\s\S]*?<\/header>/)[0];
  assert.match(header,/<a class="cp-search" href="\/catalog">/);
  assert.match(header,/<nav\b[\s\S]*?<a href="\/catalog">카드 검색<\/a>/);
  assert.doesNotMatch(header,/<label class="cp-search"|<kbd>/);
  const css=assertApprovedCss(after,before);
  assert.ok(css);assert.match(css,/min-height:44px/);assert.match(css,/:focus-visible/);
  assert.match(css,/overflow-x:auto/);assert.match(css,/padding-left:16px;padding-right:16px/);
  assert.doesNotMatch(css,/url\(|@import|!important|overflow-x:hidden/);
  let expectedHeader=before.match(/<header\b[\s\S]*?<\/header>/)[0]
    .replace('<a href="/#prices">카드 시세</a>','<a href="/#prices">카드 시세</a>'+(name==='grading-cost-compare'?'\n      ':'')+'<a href="/catalog">카드 검색</a>')
    .replace(/<label class="cp-search"[\s\S]*?<\/label>/,'<a class="cp-search" href="/catalog"><span aria-hidden="true" style="font-family:var(--cp-mono)">⌕</span><span>카드명·세트·번호 검색</span></a>');
  if(name==='centering-checker')expectedHeader=expectedHeader.replace('<button type="button" class="cp-login-google">Google 로그인</button>','<a class="cp-login-google" href="/login">Google 로그인</a>');
  assert.equal(header,expectedHeader,'only approved navigation semantics may change');
  let normalized=after.replace(css+'\n','').replace(header,before.match(/<header\b[\s\S]*?<\/header>/)[0]);
  if(name==='grading-cost-compare'){
    const calculator=source=>[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const COMPANIES'))[0];
    assert.equal(sha(calculator(normalized)),acceptedCalculator,'only the reviewed calculation safety patch is accepted');
    normalized=normalized.replace(calculator(normalized),calculator(before));
  }
  assert.equal(normalized,before,'body, SEO, fonts, thumbnails, ads and unrelated tool logic remain byte-identical');
});

test('header normalization rejects injected, duplicate, moved and changed CSS',()=>{
  const before=original('tools/grading-cost-compare.html'),after=read('tools/grading-cost-compare.html');
  const css=assertApprovedCss(after,before);
  for(const changed of [
    after.replace(css,css.replace('</style>','body{display:none}</style>')),
    after.replace(css,css+'\n'+css),
    after.replace(css+'\n','').replace('</head>',css+'\n</head>'),
    after.replace(css,css.replace('min-height:44px','min-height:12px')),
  ])assert.throws(()=>assertApprovedCss(changed,before));
  const changed=after.replace('const total = gradeKrw + overhead;','const total = 0;');
  const calc=[...changed.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const COMPANIES'))[0];
  assert.notEqual(sha(calc),acceptedCalculator,'formula mutation cannot be normalized away');
});

test('centering login is an existing route without adding an auth SDK',()=>{
  const source=read('tools/centering-checker.html');
  assert.match(source,/<a class="cp-login-google" href="\/login">/);
  assert.doesNotMatch(source,/<script[^>]+src=["'][^"']*(?:auth\.js|supabase)/);
});

for(const file of ['functions/_lib/card-price-display.js','functions/api/card-summary.js','functions/search.js',
  'search-query.mjs','scripts/refresh_cold_pokemon.py','card-detail.html','methodology.html',
  'robots.txt','_headers','_redirects','_routes.json','sitemap.xml','styles/ads.css','cp-ads.js',
  '.github/workflows/refresh-prices.yml','.github/workflows/deploy-cloudflare-pages.yml']){
  if(!fs.existsSync(path.join(root,file)))continue;
  test(file+' keeps its approved production policy/data/advertising baseline',()=>assert.equal(read(file),original(file)));
}
