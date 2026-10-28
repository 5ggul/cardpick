// Exact tools-hub24 inverse only. Earlier body, metadata and search/compare hashes stay unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { restoreToolsHubLoading } from './test-tools-hub-loading.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const normalized=value=>value.replaceAll('\r\n','\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
export const TOOLS_HUB_BASE_SHA256='17fadb45eef08727e07c985ca219b939857e78931e937f31f52596b157d5d898';
export const TOOLS_HUB_OLD_SIZES='sizes="(max-width:720px) 100vw, 540px"';
export const TOOLS_HUB_SIZES='sizes="(max-width:720px) calc(100vw - 42px), (max-width:1100px) calc(50vw - 30px), 520px"';
const oldFont='<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">';
const newFont='<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional" rel="stylesheet" media="print" onload="this.media=\'all\'">\n'
  +'<noscript><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional" rel="stylesheet"></noscript>';
const oldScripts='<script src="/auth.js?v=v3clean"></script>\n<script src="/search.js?v=20260519ko"></script>';
const newScripts='<script defer src="/auth.js?v=v3clean"></script>\n<script defer src="/search.js?v=20260519ko"></script>';
const oldFilter='  .cat-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 18px; font-size: 11px; }\n'
  +'  .cat-filter button {\n'
  +'    background: transparent; color: var(--term-muted); border: 1px solid var(--term-dim);\n'
  +'    padding: 4px 10px; cursor: pointer; font-family: var(--term-mono); letter-spacing: 0.08em;\n'
  +'    transition: all 0.12s ease; font-size: 11px;\n'
  +'  }\n'
  +'  .cat-filter button:hover { color: var(--term-green); border-color: var(--term-green); }\n';
const newFilter='  .cat-filter { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 18px; font-size: 11px; }\n'
  +'  .cat-filter button {\n'
  +'    background: transparent; color: var(--term-muted); border: 1px solid var(--term-dim);\n'
  +'    padding: 4px 10px; min-height: 44px; min-width: 44px; cursor: pointer; font-family: var(--term-mono); letter-spacing: 0.08em;\n'
  +'    transition: all 0.12s ease; font-size: 11px;\n'
  +'  }\n'
  +'  .cat-filter button:hover { color: var(--term-green); border-color: var(--term-green); }\n'
  +'  .cat-filter button:focus-visible { outline: 2px solid var(--term-green); outline-offset: 3px; }\n';
export const toolsHubPerformancePairs=[[newFont,oldFont],[newScripts,oldScripts],[newFilter,oldFilter]];

export function restoreToolsHubPerformance(source){
  return restoreLegacyToolsHubPerformance(restoreToolsHubLoading(source));
}

function restoreLegacyToolsHubPerformance(source){
  let value=normalized(source);
  for(const [after,before] of toolsHubPerformancePairs){
    assert.equal(value.split(after).length-1,1,'one exact tools-hub24 fragment');
    assert.equal(value.split(before).length-1,0,'no stale tools-hub24 fragment');
    value=value.replace(after,before);
  }
  assert.equal(value.split(TOOLS_HUB_SIZES).length-1,13,'all thirteen reviewed thumbnail sizes');
  assert.equal(value.split(TOOLS_HUB_OLD_SIZES).length-1,0,'no mixed old thumbnail sizes');
  value=value.replaceAll(TOOLS_HUB_SIZES,TOOLS_HUB_OLD_SIZES);
  assert.equal(hash(value),TOOLS_HUB_BASE_SHA256,'entire tools hub equals immutable e35934fa source after exact inverse');
  return value;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const read=file=>normalized(fs.readFileSync(path.join(root,file),'utf8'));
  const rawSource=read('tools.html');
  const source=restoreToolsHubLoading(rawSource);
  const baseline=normalized(execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/').replace(/\/$/,''),'show','e35934fa983b57d1940b045f02fdbbfc490943cc:tools.html'],{cwd:root,encoding:'utf8'}));
  const imageTags=html=>[...html.matchAll(/<img\b[^>]*>/g)].map(match=>match[0]);
  const entries=html=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
  const scripts=html=>[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([,attributes,body])=>({attributes:attributes.replace(/\bdefer\s*/g,''),body}));

  test('tools hub restores the immutable complete e35934fa document',()=>{
    assert.equal(hash(baseline),TOOLS_HUB_BASE_SHA256);
    assert.equal(restoreToolsHubPerformance(rawSource),baseline);
  });
  test('JetBrains CSS is non-blocking with the same weights and a no-JS fallback',()=>{
    assert.equal(source.split(newFont).length-1,1);
    assert.equal(source.split(oldFont).length-1,0);
    assert.match(newFont,/family=JetBrains\+Mono:wght@400;500;700&display=optional/);
    assert.match(newFont,/media="print" onload="this\.media='all'"/);
    assert.match(newFont,/<noscript><link[^>]+rel="stylesheet"><\/noscript>/);
    assert.equal((source.match(/rel="preconnect" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com"/g)||[]).length,2);
    assert.doesNotMatch(source,/tailwindcss\.com|PretendardVariable|styles\/.*text-font/);
  });
  test('auth/search are deferred in original order with every script body and other attributes intact',()=>{
    assert.equal(source.split(newScripts).length-1,1);
    assert.deepEqual(scripts(source),scripts(baseline));
    assert.ok(source.indexOf(newScripts)<source.indexOf('</head>'));
    assert.match(read('auth.js'),/if \(document\.readyState === 'loading'\)/);
    assert.match(read('search.js'),/if \(document\.readyState === 'loading'\)/);
  });
  test('thirteen existing thumbnails retain their art, alt, srcset, geometry and loading priority',()=>{
    const current=imageTags(source),before=imageTags(baseline);
    assert.equal(current.length,14,'thirteen tool images and the existing logo');
    assert.equal(current.filter(tag=>tag.includes('/images/tools/')).length,13);
    assert.deepEqual(current.map(tag=>tag.replace(TOOLS_HUB_SIZES,TOOLS_HUB_OLD_SIZES)),before);
    assert.equal(source.split(TOOLS_HUB_SIZES).length-1,13);
    assert.equal((source.match(/loading="eager" fetchpriority="high"/g)||[]).length,4);
  });
  test('sizes arithmetic follows actual container padding, grid gap and card borders at all breakpoints',()=>{
    assert.match(source,/\.term-inner \{ max-width: 1100px; margin: 0 auto; padding: 0 20px;/);
    assert.match(source,/\.tool-grid \{ display: grid; grid-template-columns: repeat\(2, 1fr\); gap: 16px;/);
    assert.match(source,/@media \(max-width: 720px\) \{ \.tool-grid \{ grid-template-columns: 1fr; \} \}/);
    assert.match(source,/\.tool-card \{\s*border: 1px solid/);
    for(const viewport of [320,375,720,721,768,1100,1280,1440]){
      const content=Math.min(viewport,1100)-40;
      const actual=viewport<=720?content-2:(content-16)/2-2;
      const declared=viewport<=720?viewport-42:viewport<=1100?viewport*.5-30:520;
      assert.equal(declared,actual,'CSS image slot at viewport '+viewport);
      assert.ok(actual>0&&actual<=viewport);
    }
  });
  test('category filters have 44px targets, 8px gap and visible keyboard focus without changing filter logic',()=>{
    assert.equal(source.split(newFilter).length-1,1);
    assert.match(newFilter,/gap: 8px/);
    assert.match(newFilter,/min-height: 44px; min-width: 44px/);
    assert.match(newFilter,/button:focus-visible \{ outline: 2px solid var\(--term-green\); outline-offset: 3px; \}/);
    assert.deepEqual(scripts(source),scripts(baseline));
    assert.equal(source.match(/<div class="cat-filter"[^>]*>[\s\S]*?<\/div>/)[0],baseline.match(/<div class="cat-filter"[^>]*>[\s\S]*?<\/div>/)[0]);
  });
  test('thirteen tool cards, copy, metadata, schemas and body remain unchanged apart from reviewed sizes',()=>{
    assert.equal((source.match(/<article class="tool-card ready"/g)||[]).length,13);
    assert.deepEqual(entries(source),entries(baseline));
    assert.equal(source.match(/<title>[\s\S]*?<\/title>/)[0],baseline.match(/<title>[\s\S]*?<\/title>/)[0]);
    assert.deepEqual(source.match(/<meta\b[^>]*>/g),baseline.match(/<meta\b[^>]*>/g));
    assert.equal(source.match(/<link rel="canonical"[^>]*>/)[0],baseline.match(/<link rel="canonical"[^>]*>/)[0]);
    assert.equal(source.split('<body>')[1].replaceAll(TOOLS_HUB_SIZES,TOOLS_HUB_OLD_SIZES),baseline.split('<body>')[1]);
  });
  for(const [index,[after,before]] of toolsHubPerformancePairs.entries()){
    test('tools-hub24 exact fragment '+index+' rejects deletion, stale restoration, duplication, mutation and movement',()=>{
      const changes=[source.replace(after,''),source.replace(after,before),source.replace(after,after+after),source.replace(after,after+'/* unapproved */'),source.replace(after,'').replace('</head>',after+'\n</head>')];
      for(const changed of changes){assert.notEqual(changed,source);assert.throws(()=>restoreLegacyToolsHubPerformance(changed));}
    });
  }
  test('responsive image changes reject mixed, duplicate, missing, altered or unrelated attributes',()=>{
    const changes=[
      source.replace(TOOLS_HUB_SIZES,TOOLS_HUB_OLD_SIZES),source.replace(TOOLS_HUB_SIZES,''),source.replace(TOOLS_HUB_SIZES,TOOLS_HUB_SIZES+' '+TOOLS_HUB_SIZES),
      source.replace(TOOLS_HUB_SIZES,TOOLS_HUB_SIZES.replace('42px','40px')),source.replace('fetchpriority="high"','fetchpriority="low"'),source.replace('psa-grading-break-even-v3-800.webp','psa-grading-break-even-v3-hero.webp'),
    ];
    for(const changed of changes){assert.notEqual(changed,source);assert.throws(()=>restoreLegacyToolsHubPerformance(changed));}
  });
  test('unrelated copy, canonical, robots, scripts and styles drift is rejected by full-document proof',()=>{
    const changes=[source+'\n<!-- unapproved -->',source.replace('rel="canonical"','rel="unapproved"'),source.replace('index,follow','noindex,follow'),source.replace('입력값은 브라우저 안에서만','입력값은 서버에서'),source.replace('</body>','<script>unapproved()</script></body>'),source.replace('padding: 0 20px','padding: 0 18px')];
    for(const changed of changes){assert.notEqual(changed,source);assert.throws(()=>restoreLegacyToolsHubPerformance(changed));}
  });
  test('importing the inverse registers no tests and performs no application work',()=>{
    const result=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(import.meta.url)+');process.stdout.write("imported");'],{cwd:root,encoding:'utf8',timeout:10000});
    assert.equal(result.status,0);assert.equal(result.stdout,'imported');assert.equal(result.stderr,'');
  });
}
