// Exact tools-hub28 additions. Earlier full-source hashes are immutable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const normalized=value=>value.replaceAll('\r\n','\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
export const TOOLS_HUB_LOADING_BASE_SHA256='22789d995d86bb9c2426c6c926e6f0d2be4833b0c7ae544e56341b039a4231d0';
const choiceStyle='\n'+[
  '  .tool-choice { padding: 20px; }',
  '  .tool-choice table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }',
  '  .tool-choice caption { text-align: left; color: var(--term-fg); font-weight: 700; margin-bottom: 12px; }',
  '  .tool-choice th, .tool-choice td { padding: 12px; border-top: 1px solid var(--term-dim); text-align: left; vertical-align: top; overflow-wrap: anywhere; }',
  '  .tool-choice th:first-child { width: 30%; }',
  '  .tool-choice th a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: underline; text-underline-offset: 3px; }',
  '  .tool-choice td p { margin: 0; font-size: inherit; line-height: inherit; }',
  '  .tool-choice td p + p { margin-top: 8px; }',
  '  .tool-choice a:focus-visible { outline: 2px solid var(--term-green); outline-offset: 3px; }',
  '  @media (max-width: 720px) { .tool-choice { padding: 16px; } .tool-choice th, .tool-choice td { padding: 10px 6px; } }',
].join('\n')+'\n';
const choiceTable=[
  '    <h2 id="tool-choice-title">// 비용 계산기 비교</h2>',
  '    <div class="ascii-box tool-choice">',
  '      <table aria-labelledby="tool-choice-title">',
  '        <caption>그레이딩 비용·손익·해외 직구 비용에 필요한 입력과 결과의 차이</caption>',
  '        <thead><tr><th scope="col">계산할 내용</th><th scope="col">준비할 입력과 결과 읽기</th></tr></thead>',
  '        <tbody>',
  '          <tr>',
  '            <th scope="row"><a href="/tools/grading-cost-compare">그레이딩 비용 비교</a></th>',
  '            <td><p><strong>입력:</strong> 제출 장수, 업체별 등급료, 환율, 배송·보험료와 대행 수수료.</p><p><strong>결과:</strong> 입력 견적의 총비용과 장당 비용을 비교합니다. 실제 견적·추가 요금은 업체에 확인하세요.</p></td>',
  '          </tr>',
  '          <tr>',
  '            <th scope="row"><a href="/tools/psa-grading-break-even">PSA 등급별 손익</a></th>',
  '            <td><p><strong>입력:</strong> Raw 매입가, PSA 10·9·8 이하 예상 판매가, 등급료·배송비·판매 수수료.</p><p><strong>결과:</strong> 등급을 가정한 손익과 PSA 10 손익분기 판매가입니다. 등급이나 실제 판매가를 예측하지 않습니다.</p></td>',
  '          </tr>',
  '          <tr>',
  '            <th scope="row"><a href="/tools/overseas-card-cost">해외 도착 비용</a></th>',
  '            <td><p><strong>입력:</strong> 카드 가격, 통화·환율, 현지·국제 배송비, 결제 수수료와 세금 조건.</p><p><strong>결과:</strong> 입력한 비용으로 도착 예상액을 계산합니다. 빠뜨린 비용이나 실제 통관 결과가 자동 반영되는 것은 아닙니다.</p></td>',
  '          </tr>',
  '        </tbody>',
  '      </table>',
  '    </div>',
  '',
  '',
].join('\n');
const oldUsage=[
  '      <p>2. 입력 필드에 값을 넣으면 결과가 즉시 갱신됩니다. 별도 "계산하기" 버튼은 없습니다.</p>',
  '      <p>3. 계산 입력값은 서버로 전송하지 않고 브라우저 안에서만 처리됩니다.</p>',
  '      <p>4. 계산 결과는 카드 상태·환율·수수료 변동으로 실제와 다를 수 있습니다. <span class="term-amber">수익을 보장하지 않습니다.</span></p>',
].join('\n');
const newUsage=[
  '      <p>2. PSA 손익·그레이딩 비용·해외 직구 비용 등 자동 계산형은 입력·선택을 바꾸면 결과가 갱신됩니다.</p>',
  '      <p>3. 관세 계산기는 [ 계산하기 ], 슬리브·탑로더는 [ 추천 보기 ], 박스 기대값은 [ 기대값 계산 ], 팩 시뮬레이터는 [ 팩 열기 ]를 누릅니다.</p>',
  '      <p>4. 센터링 측정기는 카드 사진이나 연습용 샘플을 불러온 뒤 외곽 4점·내부 4점을 선택하면 결과가 나옵니다.</p>',
  '      <p>5. 계산 입력값은 서버로 전송하지 않고 브라우저 안에서만 처리됩니다.</p>',
  '      <p>6. 계산 결과는 카드 상태·환율·수수료 변동으로 실제와 다를 수 있습니다. <span class="term-amber">수익을 보장하지 않습니다.</span></p>',
].join('\n');
const oldCenter='<div class="tool-card-desc">카드 사진을 업로드해 외곽 4점과 내부 4점을 찍고 좌우·상하 센터링 비율, PSA·BGS 기준 통과 가능성을 계산. 이미지는 브라우저에서만 처리.</div>';
const newCenter='<div class="tool-card-desc">카드 사진의 외곽 4점·내부 4점으로 좌우·상하 비율을 측정하고 PSA 앞면 참고 범위와 비교합니다. BGS 최신 공식 기준은 미확인이며 실제 등급 판정이 아닙니다. 이미지는 브라우저에서만 처리합니다.</div>';
const titles=[
  'PSA 그레이딩 손익분기 계산기','셀프 그레이딩 예상 등급 추정기','포켓몬 카드 가품 자가 체크리스트',
  '포켓몬 박스·팩 가품 위험도 체커','포켓몬 카드 가상 팩깡 시뮬레이터','그레이딩 비용·대행 비교 계산기',
  '포켓몬 카드 센터링 측정기','포켓몬 카드 영↔한 이름 변환기','포켓몬 카드 관세 계산기',
  '해외 포켓몬 카드 직구 비용 계산기','PSA 인증번호 조회 도우미','슬리브·탑로더 고르기','박스 기대값(EV) 계산기',
];
export const toolsHubLoadingPairs=[
  [choiceStyle+'\n  .term-footer {','\n  .term-footer {'],
  [choiceTable+'    <h2>// 사용 방법</h2>','    <h2>// 사용 방법</h2>'],
  [newUsage,oldUsage],[newCenter,oldCenter],
  ...titles.map(title=>['<h3 class="tool-card-title">'+title+'</h3>','<div class="tool-card-title">'+title+'</div>']),
  ['/images/tools/card-name-translator-hero.webp?v=2 1280w','/images/tools/card-name-translator-hero.webp?v=2 1200w'],
  ['/images/tools/import-tax-calculator-hero.webp 1280w','/images/tools/import-tax-calculator-hero.webp 1200w'],
];
export const toolsHubPriorityPairs=[
  '셀프 그레이딩 예상 등급 추정기','포켓몬 카드 가품 자가 체크리스트','포켓몬 박스·팩 가품 위험도 체커',
].map(alt=>[
  'alt="'+alt+'" loading="eager" width="800" height="450">',
  'alt="'+alt+'" loading="eager" fetchpriority="high" width="800" height="450">',
]);

export function restoreToolsHubLoading(source){
  let value=normalized(source);
  for(const [after,before] of toolsHubLoadingPairs){
    assert.equal(value.split(after).length-1,1,'one exact approved tools-hub28 fragment');
    value=value.replace(after,before);
  }
  const priorities=toolsHubPriorityPairs.map(([after,before])=>({after,before,a:value.split(after).length-1,b:value.split(before).length-1}));
  const original=priorities.every(row=>row.a===0&&row.b===1);
  const focused=priorities.every(row=>row.a===1&&row.b===0);
  assert.ok(original||focused,'all three priority hints must remain original or all three must be removed; no mixed variant');
  if(focused)for(const row of priorities)value=value.replace(row.after,row.before);
  assert.equal(hash(value),TOOLS_HUB_LOADING_BASE_SHA256,'entire tools source equals immutable 5b093fb checkpoint after exact inverse');
  return value;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const read=file=>normalized(fs.readFileSync(path.join(root,file),'utf8'));
  const source=read('tools.html');
  const baseline=normalized(execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/').replace(/\/$/,''),'show','5b093fb3a68b4106b94a9af30940ca86d746aab0:tools.html'],{cwd:root,encoding:'utf8'}));
  const occurrence=(value,fragment)=>value.split(fragment).length-1;
  const images=html=>[...html.matchAll(/<img\b[^>]*>/g)].map(match=>match[0]);
  const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
  const asVariant=(value,original)=>{for(const [after,before] of toolsHubPriorityPairs){assert.equal(occurrence(value,after)+occurrence(value,before),1);value=value.replace(original?after:before,original?before:after);}return value;};
  function webpDimensions(url){
    const parsed=new URL(url,'https://cardpick.kr');
    assert.equal(parsed.origin,'https://cardpick.kr');assert.ok(parsed.pathname.startsWith('/images/tools/'));
    const file=path.resolve(root,decodeURIComponent(parsed.pathname).slice(1));
    assert.ok(file.startsWith(path.resolve(root,'images/tools')+path.sep));
    const bytes=fs.readFileSync(file);
    assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
    for(let offset=12;offset+8<=bytes.length;){
      const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8;
      assert.ok(start+size<=bytes.length,'complete WebP chunk');
      if(kind==='VP8X'){assert.ok(size>=10);return{width:bytes.readUIntLE(start+4,3)+1,height:bytes.readUIntLE(start+7,3)+1};}
      if(kind==='VP8 '){assert.ok(size>=10);assert.equal(bytes.toString('hex',start+3,start+6),'9d012a');return{width:bytes.readUInt16LE(start+6)&0x3fff,height:bytes.readUInt16LE(start+8)&0x3fff};}
      if(kind==='VP8L'){assert.ok(size>=5);assert.equal(bytes[start],0x2f);const bits=bytes.readUInt32LE(start+1);return{width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
      offset=start+size+(size&1);
    }
    assert.fail('WebP dimensions not found');
  }

  test('tools-hub28 restores the complete immutable 5b093fb document in both permitted priority variants',()=>{
    assert.equal(hash(baseline),TOOLS_HUB_LOADING_BASE_SHA256);
    for(const original of [false,true])assert.equal(hash(restoreToolsHubLoading(asVariant(source,original))),TOOLS_HUB_LOADING_BASE_SHA256);
  });
  test('only two corrected width descriptors differ from the original image source sets',()=>{
    const restored=restoreToolsHubLoading(source);
    assert.deepEqual(images(restored),images(baseline));
    assert.equal(occurrence(source,'card-name-translator-hero.webp?v=2 1280w'),1);
    assert.equal(occurrence(source,'import-tax-calculator-hero.webp 1280w'),1);
  });
  test('every candidate in all thirteen tool srcsets declares its actual intrinsic WebP width',()=>{
    const cards=images(source).map(attributes).filter(a=>a.src?.startsWith('/images/tools/'));
    assert.equal(cards.length,13);let candidates=0;
    for(const image of cards){
      const values=image.srcset.split(',').map(value=>value.trim().split(/\s+/));
      assert.equal(new Set(values.map(([url])=>url)).size,values.length);
      assert.equal(new Set(values.map(([,width])=>width)).size,values.length);
      for(const [url,descriptor] of values){
        assert.match(descriptor,/^\d+w$/);const size=webpDimensions(url);
        assert.equal(Number(descriptor.slice(0,-1)),size.width,url+' width');
        if(size.width===480)assert.equal(size.height,270);if(size.width===800)assert.equal(size.height,450);
        candidates++;
      }
    }
    assert.equal(candidates,37);
  });
  test('the first PSA thumbnail remains eager and high while every original loading mode is preserved',()=>{
    const current=images(source).map(attributes).filter(a=>a.src?.startsWith('/images/tools/'));
    const old=images(baseline).map(attributes).filter(a=>a.src?.startsWith('/images/tools/'));
    assert.equal(current[0].loading,'eager');assert.equal(current[0].fetchpriority,'high');
    assert.deepEqual(current.map(a=>a.loading),old.map(a=>a.loading));
    assert.equal(current.filter(a=>a.loading==='eager').length,4);
    assert.equal(current.filter(a=>a.loading==='lazy').length,9);
    assert.ok([1,4].includes(current.filter(a=>a.fetchpriority==='high').length));
  });
  test('all thirteen unchanged card titles are h3 headings with the same class and owned visual rule',()=>{
    assert.deepEqual([...source.matchAll(/<h3 class="tool-card-title">([^<]+)<\/h3>/g)].map(match=>match[1]),titles);
    assert.equal(occurrence(source,'<div class="tool-card-title">'),0);
    assert.deepEqual([...baseline.matchAll(/<div class="tool-card-title">([^<]+)<\/div>/g)].map(match=>match[1]),titles);
    assert.equal(source.match(/  \.tool-card-title \{[^\n]+/)[0],baseline.match(/  \.tool-card-title \{[^\n]+/)[0]);
    assert.doesNotMatch(choiceStyle,/(?:^|\n)\s*(?:h3|body|header|\.tool-card)\s*\{/);
  });
  test('the static comparison table has exactly three existing calculator links and useful input/result scope',()=>{
    assert.equal(occurrence(source,choiceTable),1);
    assert.equal(occurrence(choiceTable,'scope="col"'),2);assert.equal(occurrence(choiceTable,'scope="row"'),3);
    assert.match(choiceTable,/<caption>[^<]+입력과 결과/);
    const targets=['grading-cost-compare','psa-grading-break-even','overseas-card-cost'];
    assert.deepEqual([...choiceTable.matchAll(/href="\/tools\/([^"]+)"/g)].map(match=>match[1]),targets);
    for(const target of targets){const html=read('tools/'+target+'.html');assert.match(html,new RegExp('rel="canonical" href="https://cardpick.kr/tools/'+target+'"'));assert.match(html,/addEventListener\('input'/);}
    for(const field of ['i-qty','i-fx','i-ship','i-agent'])assert.match(read('tools/grading-cost-compare.html'),new RegExp('id="'+field+'"'));
    for(const field of ['i-raw','i-p10','i-p9','i-plow'])assert.match(read('tools/psa-grading-break-even.html'),new RegExp('id="'+field+'"'));
    for(const field of ['i-card','i-fx','i-intl','i-pay-fee'])assert.match(read('tools/overseas-card-cost.html'),new RegExp('id="'+field+'"'));
    assert.match(choiceTable,/입력 견적의 총비용과 장당 비용/);
    assert.match(choiceTable,/등급이나 실제 판매가를 예측하지 않습니다/);
    assert.match(choiceTable,/빠뜨린 비용이나 실제 통관 결과가 자동 반영되는 것은 아닙니다/);
    assert.doesNotMatch(choiceTable,/<script|<img|<form|<fieldset|(?:정품|등급|수익)을 보장/);
    const gridEnd=source.indexOf('\n    <h2 id="tool-choice-title">');assert.ok(gridEnd>source.lastIndexOf('</article>'));
    assert.ok(gridEnd<source.indexOf('    <h2>// 사용 방법</h2>'));
  });
  test('comparison styles own padding, wrapping and focus without a minimum table width or page overflow rule',()=>{
    assert.match(choiceStyle,/\.tool-choice \{ padding: 20px; \}/);
    assert.match(choiceStyle,/@media \(max-width: 720px\) \{ \.tool-choice \{ padding: 16px; \}/);
    assert.match(choiceStyle,/width: 100%;.*table-layout: fixed/);
    assert.match(choiceStyle,/overflow-wrap: anywhere/);
    assert.match(choiceStyle,/padding: 12px;/);assert.match(choiceStyle,/padding: 10px 6px/);
    assert.match(choiceStyle,/min-height: 44px/);assert.match(choiceStyle,/a:focus-visible/);
    assert.doesNotMatch(choiceStyle,/min-width|white-space: nowrap|position: fixed|overflow-x: hidden/);
  });
  test('usage distinguishes automatic inputs, actual execution buttons and the eight-point photo workflow',()=>{
    assert.equal(occurrence(source,newUsage),1);assert.equal(occurrence(source,oldUsage),0);
    assert.doesNotMatch(source,/별도 "계산하기" 버튼은 없습니다/);
    for(const [file,id,label,handler] of [
      ['import-tax-calculator','btn-calc','계산하기',/\$\('btn-calc'\)\.addEventListener\('click', compute\)/],
      ['sleeve-toploader-finder','btn-calc','추천 보기',/\$\('btn-calc'\)\.addEventListener\('click', compute\)/],
      ['box-ev-calculator','btn-calc','기대값 계산',/\$\('btn-calc'\)\.addEventListener\('click', compute\)/],
      ['pack-simulator','openBtn','팩 열기',/getElementById\("openBtn"\)\.onclick=openPack/],
    ]){
      const html=read('tools/'+file+'.html');
      assert.match(html,new RegExp('<button\\b[^>]*id="'+id+'"[^>]*>\\[ '+label+' \\]</button>'));
      assert.match(html,handler);assert.ok(newUsage.includes('[ '+label+' ]'));
    }
    const center=read('tools/centering-checker.html');
    assert.match(center,/if \(points\.length === 8\) compute\(\)/);
    assert.match(center,/type="file" id="file-input"/);assert.match(center,/id="btn-sample"/);
    assert.match(newUsage,/외곽 4점·내부 4점/);
  });
  test('centering card copy matches the actual front-only reference comparison and unverified BGS scope',()=>{
    const center=read('tools/centering-checker.html');
    assert.equal(occurrence(source,newCenter),1);assert.equal(occurrence(source,oldCenter),0);
    assert.match(newCenter,/PSA 앞면 참고 범위/);assert.match(newCenter,/BGS 최신 공식 기준은 미확인/);assert.match(newCenter,/실제 등급 판정이 아닙니다/);
    assert.match(center,/결과 표는 앞면 기준만 비교합니다/);
    assert.match(center,/최신 BGS 공식 합격 기준으로 확인하지 못했습니다/);
    assert.match(center,/이미지는 브라우저에서만 처리됩니다/);
  });
  test('unapproved card descriptions, scripts, metadata, advertising and filter logic remain protected by the full source',()=>{
    const restored=restoreToolsHubLoading(source);
    assert.equal(hash(restored),hash(baseline));
    const scriptBlocks=html=>[...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(match=>match[0]);
    assert.deepEqual(scriptBlocks(source),scriptBlocks(baseline));
    assert.deepEqual(source.match(/<meta\b[^>]*>/g),baseline.match(/<meta\b[^>]*>/g));
    assert.equal(source.match(/<link rel="canonical"[^>]*>/)[0],baseline.match(/<link rel="canonical"[^>]*>/)[0]);
    const fakeCard=html=>html.match(/<div class="tool-card-desc">인쇄 도트[^]*?<\/div>/)[0];
    assert.equal(fakeCard(source),fakeCard(baseline),'additional fake-card copy correction was not approved in this bundle');
  });
  for(const [index,[after]] of toolsHubLoadingPairs.entries()){
    test('tools-hub28 exact fragment '+index+' rejects removal, duplication, mutation and relocation',()=>{
      for(const changed of [source.replace(after,''),source.replace(after,after+after),source.replace(after,after+'unapproved'),source.replace(after,'')+after]){
        assert.notEqual(changed,source);assert.throws(()=>restoreToolsHubLoading(changed));
      }
    });
  }
  test('priority alternatives reject mixed sets, altered hints, duplicate fragments and first-thumbnail changes',()=>{
    const focused=asVariant(source,false);
    for(const [after,before] of toolsHubPriorityPairs){
      for(const changed of [focused.replace(after,before),focused.replace(after,after+after),focused.replace(after,after.replace('loading="eager"','loading="lazy"'))]){
        assert.notEqual(changed,focused);assert.throws(()=>restoreToolsHubLoading(changed));
      }
    }
    const changed=focused.replace('alt="PSA 그레이딩 손익분기 계산기" loading="eager" fetchpriority="high"','alt="PSA 그레이딩 손익분기 계산기" loading="eager" fetchpriority="low"');
    assert.notEqual(changed,focused);assert.throws(()=>restoreToolsHubLoading(changed));
  });
  test('unrelated body, canonical, robots, font and filter changes cannot be hidden by exact restoration',()=>{
    for(const changed of [source+'\n<!-- unapproved -->',source.replace('rel="canonical"','rel="unapproved"'),source.replace('index,follow','noindex,follow'),source.replace('display=optional','display=swap'),source.replace('min-height: 44px; min-width: 44px','min-height: 40px; min-width: 44px')]){
      assert.notEqual(changed,source);assert.throws(()=>restoreToolsHubLoading(changed));
    }
  });
  test('importing the tools-hub28 inverse performs no source reads, Git operations or test registration',()=>{
    const probe='import fs from "node:fs";import cp from "node:child_process";for(const k of ["readFileSync","readdirSync","statSync","existsSync"])fs[k]=()=>{throw Error("import source IO")};for(const k of ["execFileSync","spawnSync","execSync"])cp[k]=()=>{throw Error("import Git/process")};await import('+JSON.stringify(import.meta.url)+');process.stdout.write("imported");';
    const result=spawnSync(process.execPath,['--input-type=module','-e',probe],{cwd:root,encoding:'utf8',timeout:10000});
    assert.equal(result.status,0);assert.equal(result.stdout,'imported');assert.equal(result.stderr,'');
  });
}
