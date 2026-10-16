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
// Exact, additive growth20 blocks restore the already verified dirty checkpoint.
// Keep all original full-document comparisons and corruption rejection below.
const growthToolProof = {
  'psa-grading-break-even': {panel:'2cab9b93cd0a48d38cd204922d3f22d182e140f73fd7bc8cd0ab516da7ef4ded',assetIndex:18843,panelIndex:32329,before:'5bd2bf41adeec677dfebda2b31d002a0f33ad3c9038620c334191eb4de22fec2'},
  'grading-cost-compare': {panel:'28f579ba8eaf2718193f6553815471f821f0336ea11078a4b7504d1df18e7416',assetIndex:18213,panelIndex:36888,before:'3ec934ed7ad4d546b67f6ebecb63355f2a93f5711039d34df9e58bbbfe5500c1'},
  'overseas-card-cost': {panel:'d16b7a9ebee8ec3ccc4d718a3f22f02d12f506629fa522cad9b7d11687053bb7',assetIndex:16579,panelIndex:24580,before:'e38bc0ab9e428e7b17b41e9cce9bac27309602794452038656376824fd069924'},
};
const growthToolAssets = '<!-- calculator-results assets -->\n<link rel="stylesheet" href="/styles/tool-results.css">\n<script src="/js/cp-tool-results.js" defer></script>\n';
// Approved growth22 PNG additions only. Restore them before every legacy hash.
function restoreCalculatorPng(source) {
  const hashes = {button:'786642380cefcd0f3343941b0f64bb548984afcd2a7427ac69730fa422463c09',
    fallback:'7f0e0b256de095d747a145ba659ae8037f119fe38d50be12d33239de0eb2bf17'};
  for (const kind of ['button','fallback']) {
    const spaces = kind === 'button' ? '        ' : '      ';
    const pattern = new RegExp(spaces+'<!-- calculator-png '+kind+' start -->\\n[\\s\\S]*?'+spaces+'<!-- calculator-png '+kind+' end -->\\n','g');
    const blocks = [...source.matchAll(pattern)];
    assert.equal(blocks.length,1,'one exact PNG '+kind+' block');
    const block=blocks[0][0];
    assert.equal(createHash('sha256').update(block).digest('hex'),hashes[kind],'reviewed PNG '+kind+' bytes');
    if (kind === 'button') {
      const anchor='        <button type="button" data-results-action="copy-link" disabled>입력 조건 포함 링크 복사</button>\\n'.replace('\\n','\n');
      assert.ok(source.slice(0,blocks[0].index).endsWith(anchor),'PNG follows the existing condition-link button');
    } else {
      assert.ok(source.slice(blocks[0].index+block.length).startsWith('      <section data-results="preview" hidden aria-labelledby="cp-results-preview-title">'),'PNG fallback precedes the existing condition preview');
    }
    source=source.replace(block,'');
  }
  const after='<input type="checkbox" data-results="include-a" disabled>복사·저장할 내용에 조건 A도 포함';
  const before='<input type="checkbox" data-results="include-a" disabled>복사할 내용에 조건 A도 포함';
  assert.equal(source.split(after).length-1,1,'one reviewed A copy/save label');
  assert.equal(source.split(before).length-1,0,'no duplicate stale A label');
  return source.replace(after,before);
}
function restoreGrowthTool(source,name) {
  if(!Object.hasOwn(growthToolProof,name))return source;
  source=restoreCalculatorPng(source);
  const proof=growthToolProof[name];
  assert.equal(source.split(growthToolAssets).length-1,1,'one exact growth20 asset block');
  assert.equal(source.indexOf(growthToolAssets),proof.assetIndex,'asset block cannot move');
  let restored=source.replace(growthToolAssets,'');
  const panels=[...restored.matchAll(/    <!-- calculator-results start: [a-z]+ -->[\s\S]*?    <!-- calculator-results end: [a-z]+ -->\n/g)];
  assert.equal(panels.length,1,'one result panel');
  assert.equal(sha(panels[0][0]),proof.panel,'only the approved panel content');
  assert.equal(panels[0].index,proof.panelIndex,'result panel cannot move');
  restored=restored.replace(panels[0][0],'');
  if(name!=='overseas-card-cost'){
    const fixed="cpShare({url:'https://cardpick.kr/tools/"+name+"'})";
    const fixedCopy="cpShareCopy('https://cardpick.kr/tools/"+name+"')";
    assert.equal(restored.split(fixed).length-1,1);assert.equal(restored.split(fixedCopy).length-1,1);
    restored=restored.replace(fixed,'cpShare()').replace(fixedCopy,'cpShareCopy()');
    if(name==='grading-cost-compare'){
      const after='onclick="cpShare()">[ 도구 공유 ]';
      assert.equal(restored.split(after).length-1,1);
      restored=restored.replace(after,'onclick="cpShare()">[ 카카오톡 공유 ]');
    }
  }
  assert.equal(sha(restored),proof.before,'all original calculator code, ads, SEO and layout remain unchanged');
  return restored;
}
function restoreGrowthSearch(source,file) {
  if(file==='search-query.mjs'){
    const blocks=[...source.matchAll(/\n\/\/ CARDPICK_SEARCH_INTENT_START\n[\s\S]*?\/\/ CARDPICK_SEARCH_INTENT_END\n/g)];
    assert.equal(blocks.length,1);assert.ok(source.endsWith(blocks[0][0]));
    assert.equal(sha(blocks[0][0]),'ddde6b8c5e6b8e6d19702352567b9019175544e668b3be5aa3c6daa91d336b7c');
    return source.replace(blocks[0][0],'');
  }
  if(file!=='functions/search.js')return source;
  let restored=source;
  for(const [after,before] of [
    ["import { planSearchQuery, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-query.mjs';","import { normalizeSearchQuery, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-query.mjs';"],
    ["  const { original: q, queryNormalized: normalized, queryTokens: tokens } = planSearchQuery(url.searchParams.get('q') || '');","  const { original: q, normalized, tokens } = normalizeSearchQuery(url.searchParams.get('q') || '');"],
  ]){assert.equal(source.split(after).length-1,1);assert.equal(source.split(before).length-1,0);restored=restored.replace(after,before);}
  return restored;
}
const acceptedCss = '0d4d03eeb3f6d325d0bc5dcaae7ebf7d83aed8ed61f16f2442bc93f8eb65619e';
const acceptedCalculator = '88407e02ee21351e2f562cbb3e783dadb4e851a677fb148de2bcd842a77be17e';
function assertApprovedCss(source, before) {
  const blocks=[...source.matchAll(/<style id="cp-tool-header-usability">[\s\S]*?<\/style>/g)];
  assert.equal(blocks.length,1,'one approved owner block only');
  assert.equal(sha(blocks[0][0]),acceptedCss,'exact reviewed header CSS, not arbitrary normalization');
  assert.equal(blocks[0].index,before.indexOf('</style>')+'</style>\n'.length,'approved insertion position');
  return blocks[0][0];
}

const approvedToolQualityPairs = {
  "centering-checker": [
    [
      "\n<!-- JSON-LD: FAQPage -->\n<script type=\"application/ld+json\">\n{\"@context\": \"https://schema.org\", \"@type\": \"FAQPage\", \"mainEntity\": [{\"@type\": \"Question\", \"name\": \"카드 센터링이란?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"카드 외곽과 내부 디자인 영역 사이의 여백이 좌우·상하로 얼마나 균형 잡혀 있는지를 뜻합니다. 50/50에 가까울수록 정중앙 정렬입니다.\"}}, {\"@type\": \"Question\", \"name\": \"PSA 10 센터링 기준은?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"PSA 공식 등급 기준은 앞면 약 55/45 이내, 뒷면 약 75/25 이내를 안내합니다. 근사 허용치이며 실제 등급은 카드 전체 상태와 검수자의 판단에 따라 달라집니다. 이 도구의 결과 표는 앞면 기준만 비교합니다.\"}}, {\"@type\": \"Question\", \"name\": \"BGS 10 Black Label 센터링 기준은?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"이 도구의 50/50 ±1은 측정용 참고값이며 최신 BGS 공식 합격 기준으로 확인하지 못했습니다. 결과 표의 BGS 비교를 공식 판정이나 Black Label 가능성으로 해석하지 마세요.\"}}, {\"@type\": \"Question\", \"name\": \"이 도구 결과가 실제 등급을 보장하나요?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"보장하지 않습니다. 좌우·상하 비율만 계산하는 참고 도구이며 실제 등급은 PSA·BGS의 검수자가 표면·모서리 등을 함께 평가해 결정합니다.\"}}, {\"@type\": \"Question\", \"name\": \"이미지는 서버에 업로드되나요?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"업로드되지 않습니다. 100% 브라우저 처리이며 서버 전송·저장·외부 API 호출이 없습니다. 페이지를 닫으면 이미지는 즉시 사라집니다.\"}}, {\"@type\": \"Question\", \"name\": \"뒷면도 측정해야 하나요?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"PSA 10 공식 기준은 앞면과 뒷면의 허용치를 따로 안내합니다. 뒷면 사진도 비율을 측정할 수 있지만 이 도구의 결과 표는 앞면 기준만 비교합니다. 뒷면 비율은 공식 뒷면 기준과 별도로 대조하세요.\"}}]}\n</script>\n  <script src=\"/cp-share.js\" defer></script>\n</head>",
      "\n<!-- JSON-LD: FAQPage -->\n<script type=\"application/ld+json\">\n{\"@context\": \"https://schema.org\", \"@type\": \"FAQPage\", \"mainEntity\": [{\"@type\": \"Question\", \"name\": \"카드 센터링이란?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"카드 외곽과 내부 디자인 영역 사이의 여백이 좌우·상하로 얼마나 균형 잡혀 있는지를 뜻합니다. 50/50에 가까울수록 정중앙 정렬입니다.\"}}, {\"@type\": \"Question\", \"name\": \"PSA 10 센터링 기준은?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"일반적으로 알려진 참고 기준으로 앞면 55/45 이내, 뒷면 75/25 이내입니다. PSA 공식 발표가 아닌 시장 통용 기준입니다.\"}}, {\"@type\": \"Question\", \"name\": \"BGS 10 Black Label 센터링 기준은?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"참고 기준으로 50/50 ±1 수준입니다. 센터링뿐 아니라 모서리·엣지·표면 서브그레이드가 모두 10이어야 부여되므로 실제 비율은 매우 낮습니다.\"}}, {\"@type\": \"Question\", \"name\": \"이 도구 결과가 실제 등급을 보장하나요?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"보장하지 않습니다. 좌우·상하 비율만 계산하는 참고 도구이며 실제 등급은 PSA·BGS의 검수자가 표면·모서리 등을 함께 평가해 결정합니다.\"}}, {\"@type\": \"Question\", \"name\": \"이미지는 서버에 업로드되나요?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"업로드되지 않습니다. 100% 브라우저 처리이며 서버 전송·저장·외부 API 호출이 없습니다. 페이지를 닫으면 이미지는 즉시 사라집니다.\"}}, {\"@type\": \"Question\", \"name\": \"뒷면도 측정해야 하나요?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"PSA·BGS는 앞면과 뒷면을 모두 평가합니다. 앞면을 측정한 뒤 카드를 뒤집어 같은 방식으로 측정하세요. 뒷면 기준은 앞면보다 관대합니다.\"}}]}\n</script>\n  <script src=\"/cp-share.js\" defer></script>\n</head>"
    ],
    [
      "        </div>\n      </div>\n\n      <h3>앞면 센터링 참고 비교 (등급 판정 아님)</h3>\n      <p>결과 표는 앞면 비율만 비교합니다. 뒷면 사진을 측정했다면 비율만 참고하고 PSA 공식 뒷면 기준과 별도로 대조하세요. BGS 수치는 최신 공식 기준을 확인하지 못한 참고값입니다.</p>\n      <div id=\"grade-list\"></div>\n\n      <div class=\"copy-block\" id=\"copy-preview\">결과 텍스트가 여기에 표시됩니다.</div>",
      "        </div>\n      </div>\n\n      <h3>등급별 통과 가능성 (앞면 기준)</h3>\n      <div id=\"grade-list\"></div>\n\n      <div class=\"copy-block\" id=\"copy-preview\">결과 텍스트가 여기에 표시됩니다.</div>"
    ],
    [
      "      </div>\n\n      <h2>PSA 10 센터링 기준</h2>\n      <p><a href=\"https://www.psacard.com/gradingstandards\" rel=\"nofollow noopener external\" target=\"_blank\">PSA 공식 등급 기준</a>은 PSA 10 센터링을 <strong>앞면 약 55/45 이내</strong>, <strong>뒷면 약 75/25 이내</strong>로 안내합니다. 이는 근사 허용치이며 센터링만으로 PSA 10을 판정하는 기준은 아닙니다.</p>\n      <ul>\n        <li>PSA 10 Gem Mint: 앞면 약 55/45 이내 · 뒷면 약 75/25 이내 (공식 안내의 근사 허용치)</li>\n        <li>PSA 9 Mint: 앞면 60/40 이내 · 뒷면 90/10 이내 (참고)</li>\n        <li>PSA 8 NM-MT: 앞면 65/35 이내 (참고)</li>\n      </ul>\n      <p>PSA는 센터링 외에 표면·모서리·인쇄 결함과 카드의 전체적인 상태도 평가합니다. 경계에 걸친 카드는 검수자의 판단이 개입할 수 있으며, 이 도구의 수동 측정과 반올림 결과가 실제 등급을 보장하지 않습니다. 아래 결과 표는 앞면 기준만 비교합니다.</p>\n\n      <h2>BGS 10과 Black Label 센터링 기준</h2>\n      <p>BGS(Beckett Grading Services)는 센터링·모서리·엣지·표면을 각각 0.5 단위 서브그레이드로 평가하고 최종 등급을 산정합니다. <strong>BGS 10 Pristine(Black Label)</strong>은 네 서브그레이드가 모두 10점일 때만 부여되며 센터링은 50/50 ±1 수준의 거의 완벽한 정렬을 참고 기준으로 봅니다.</p>",
      "      </div>\n\n      <h2>PSA 10 센터링 기준</h2>\n      <p>PSA 10은 일반적으로 <strong>앞면 55/45 이내</strong>, <strong>뒷면 75/25 이내</strong>의 센터링을 참고 기준으로 봅니다. 즉 앞면은 한쪽 여백이 다른 쪽 대비 55:45를 넘으면 PSA 10 가능성이 떨어집니다.</p>\n      <ul>\n        <li>PSA 10 Gem Mint: 앞면 55/45 이내 · 뒷면 75/25 이내 (참고)</li>\n        <li>PSA 9 Mint: 앞면 60/40 이내 · 뒷면 90/10 이내 (참고)</li>\n        <li>PSA 8 NM-MT: 앞면 65/35 이내 (참고)</li>\n      </ul>\n      <p>다만 PSA는 센터링 외에 표면 스크래치, 모서리 흰 점, 각 눌림, 홀로 카드의 인쇄 결함 등도 함께 평가하므로 센터링만 통과한다고 PSA 10이 보장되지는 않습니다. 위 수치는 공식 발표가 아닌 시장에서 일반적으로 알려진 참고 기준입니다.</p>\n\n      <h2>BGS 10과 Black Label 센터링 기준</h2>\n      <p>BGS(Beckett Grading Services)는 센터링·모서리·엣지·표면을 각각 0.5 단위 서브그레이드로 평가하고 최종 등급을 산정합니다. <strong>BGS 10 Pristine(Black Label)</strong>은 네 서브그레이드가 모두 10점일 때만 부여되며 센터링은 50/50 ±1 수준의 거의 완벽한 정렬을 참고 기준으로 봅니다.</p>"
    ],
    [
      "        <li>BGS 9.5 Gem Mint: 약 55/45 이내, 다른 항목 9.5 이상 (참고)</li>\n        <li>BGS 9 Mint: 약 60/40 이내 (참고)</li>\n      </ul>\n      <p>위 BGS 수치는 이 도구에 사용된 참고값이며 최신 공식 기준으로 확인하지 못했습니다. 결과 표의 비교를 BGS의 공식 판정이나 Black Label 가능성으로 해석하지 마세요. 발송 전 Beckett 공식 안내를 별도로 확인해야 합니다.</p>\n\n      <h2>센터링 측정기 사용 방법</h2>\n      <p>본 도구는 100% 브라우저에서 동작합니다. 이미지가 서버로 전송되거나 저장되지 않으며 외부 API 호출도 없습니다.</p>",
      "        <li>BGS 9.5 Gem Mint: 약 55/45 이내, 다른 항목 9.5 이상 (참고)</li>\n        <li>BGS 9 Mint: 약 60/40 이내 (참고)</li>\n      </ul>\n      <p>BGS Black Label은 센터링을 포함한 모든 서브그레이드가 매우 엄격하게 평가되므로 50/50에 가까울수록 유리합니다. 카드 한 장에 Black Label이 부여되는 비율은 매우 낮습니다.</p>\n\n      <h2>센터링 측정기 사용 방법</h2>\n      <p>본 도구는 100% 브라우저에서 동작합니다. 이미지가 서버로 전송되거나 저장되지 않으며 외부 API 호출도 없습니다.</p>"
    ],
    [
      "      <p>실수로 잘못 클릭한 경우 [ 마지막 점 삭제 ]로 한 점씩 되돌릴 수 있고, [ 리셋 ]으로 점만 초기화하여 다시 측정할 수 있습니다.</p>\n\n      <h2>앞면과 뒷면 센터링 차이</h2>\n      <p>PSA 10 공식 기준은 앞면과 뒷면의 허용치를 따로 안내합니다. 앞면 사진과 뒷면 사진을 각각 측정한 뒤 해당 면의 기준과 대조해야 합니다.</p>\n      <div class=\"answer-box\">\n        PSA 10은 앞면 약 55/45, 뒷면 약 75/25가 공식 안내의 근사 허용치입니다. 뒷면 사진도 비율을 측정할 수 있지만 이 도구의 결과 표는 앞면 기준만 비교하므로 뒷면 판정에 사용하면 안 됩니다.\n      </div>\n\n      <h2>센터링은 통과했는데 PSA 10이 안 나오는 이유</h2>",
      "      <p>실수로 잘못 클릭한 경우 [ 마지막 점 삭제 ]로 한 점씩 되돌릴 수 있고, [ 리셋 ]으로 점만 초기화하여 다시 측정할 수 있습니다.</p>\n\n      <h2>앞면과 뒷면 센터링 차이</h2>\n      <p>PSA와 BGS는 카드의 앞면과 뒷면 센터링을 모두 평가합니다. 인쇄 공정 상 앞면과 뒷면이 동시에 잘 정렬되는 경우가 적기 때문에 PSA는 뒷면을 더 관대하게 봅니다.</p>\n      <div class=\"answer-box\">\n        앞면 기준이 더 엄격(PSA 10은 55/45)이고, 뒷면 기준은 더 관대(PSA 10은 75/25)합니다. 따라서 본 도구로 앞면을 먼저 측정하고, 카드를 뒤집어 같은 방식으로 뒷면도 별도 측정하는 것을 권장합니다.\n      </div>\n\n      <h2>센터링은 통과했는데 PSA 10이 안 나오는 이유</h2>"
    ],
    [
      "      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">PSA 10 센터링 기준은?</div>\n        <div class=\"faq-a\">PSA 공식 등급 기준은 앞면 약 55/45 이내, 뒷면 약 75/25 이내를 안내합니다. 근사 허용치이며 실제 등급은 카드 전체 상태와 검수자의 판단에 따라 달라집니다. 이 도구의 결과 표는 앞면 기준만 비교합니다.</div>\n      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">BGS 10 Black Label 센터링 기준은?</div>\n        <div class=\"faq-a\">이 도구의 50/50 ±1은 측정용 참고값이며 최신 BGS 공식 합격 기준으로 확인하지 못했습니다. 결과 표의 BGS 비교를 공식 판정이나 Black Label 가능성으로 해석하지 마세요.</div>\n      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">이 도구 결과가 실제 등급을 보장하나요?</div>",
      "      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">PSA 10 센터링 기준은?</div>\n        <div class=\"faq-a\">일반적으로 알려진 참고 기준으로 앞면 55/45 이내, 뒷면 75/25 이내입니다. PSA 공식 발표가 아닌 시장 통용 기준입니다.</div>\n      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">BGS 10 Black Label 센터링 기준은?</div>\n        <div class=\"faq-a\">참고 기준으로 50/50 ±1 수준입니다. 센터링뿐 아니라 모서리·엣지·표면 서브그레이드가 모두 10이어야 부여되므로 실제 비율은 매우 낮습니다.</div>\n      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">이 도구 결과가 실제 등급을 보장하나요?</div>"
    ],
    [
      "      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">뒷면도 측정해야 하나요?</div>\n        <div class=\"faq-a\">PSA 10 공식 기준은 앞면과 뒷면의 허용치를 따로 안내합니다. 뒷면 사진도 비율을 측정할 수 있지만 이 도구의 결과 표는 앞면 기준만 비교합니다. 뒷면 비율은 공식 뒷면 기준과 별도로 대조하세요.</div>\n      </div>\n\n      <h2>공식 기준 확인</h2>\n      <p>PSA 10 수치는 공식 등급 기준의 근사 허용치를 인용했습니다. BGS 비교값은 최신 공식 기준을 확인하지 못한 참고값입니다. 실제 등급은 각 회사가 결정하므로 발송 전 공식 기준·요금·정책을 다시 확인하세요.</p>\n      <div class=\"ext-links\">\n        <div class=\"lbl\">+--- OFFICIAL REFERENCES ---+</div>\n        <a href=\"https://www.psacard.com/services/tradingcards\" rel=\"nofollow noopener external\" target=\"_blank\">PSA 공식</a>",
      "      </div>\n      <div class=\"faq-item\">\n        <div class=\"faq-q\">뒷면도 측정해야 하나요?</div>\n        <div class=\"faq-a\">PSA·BGS는 앞면과 뒷면을 모두 평가합니다. 앞면을 측정한 뒤 카드를 뒤집어 같은 방식으로 측정하세요. 뒷면 기준은 앞면보다 관대합니다.</div>\n      </div>\n\n      <h2>공식 기준 확인</h2>\n      <p>본 도구의 등급 기준은 시장에서 통용되는 참고 수치입니다. 정확한 최신 기준·요금·정책은 각 그레이딩 회사 공식 페이지에서 확인하세요. 공식 요금·기준은 변동될 수 있으므로 발송 전 반드시 확인을 권장합니다.</p>\n      <div class=\"ext-links\">\n        <div class=\"lbl\">+--- OFFICIAL REFERENCES ---+</div>\n        <a href=\"https://www.psacard.com/services/tradingcards\" rel=\"nofollow noopener external\" target=\"_blank\">PSA 공식</a>"
    ],
    [
      "    const worst = Math.max(ratioL, ratioR, ratioT, ratioB);\n\n    const grades = [\n      {name:'BGS 10 Pristine',  cutoff:51, note:'50/50 ±1 참고·공식 미확인'},\n      {name:'BGS 9.5 Gem Mint', cutoff:55, note:'≈ 55/45 참고·공식 미확인'},\n      {name:'PSA 10 Gem Mint',  cutoff:55, note:'앞면 약 55/45·등급 판정 아님'},\n      {name:'PSA 9 Mint',       cutoff:60, note:'앞면 60/40 참고'},\n      {name:'PSA 8 NM-MT',      cutoff:65, note:'앞면 65/35 참고'},\n    ];",
      "    const worst = Math.max(ratioL, ratioR, ratioT, ratioB);\n\n    const grades = [\n      {name:'BGS 10 Pristine',  cutoff:51, note:'50/50 ±1 참고'},\n      {name:'BGS 9.5 Gem Mint', cutoff:55, note:'≈ 55/45 참고'},\n      {name:'PSA 10 Gem Mint',  cutoff:55, note:'앞면 55/45 참고'},\n      {name:'PSA 9 Mint',       cutoff:60, note:'앞면 60/40 참고'},\n      {name:'PSA 8 NM-MT',      cutoff:65, note:'앞면 65/35 참고'},\n    ];"
    ],
    [
      "    // 통과 가장 좋은(엄격한) 등급 — grades는 엄격→관대 순. 첫 번째 통과를 topPass로.\n    const passed = grades.filter(g => worst <= g.cutoff);\n    const topPass = passed.length ? passed[0].name : null;\n    const passLine = topPass ? `앞면 참고 비교: ${topPass} 기준 범위 내 (${topPass.startsWith('BGS') ? '공식 미확인 참고값·' : ''}등급 판정 아님)` : '앞면 참고 비교: PSA 8 참고 범위 밖 (65/35 초과, 등급 판정 아님)';\n\n    lastResult = {\n      lr, tb,",
      "    // 통과 가장 좋은(엄격한) 등급 — grades는 엄격→관대 순. 첫 번째 통과를 topPass로.\n    const passed = grades.filter(g => worst <= g.cutoff);\n    const topPass = passed.length ? passed[0].name : null;\n    const passLine = topPass ? `${topPass}까지 센터링 기준 통과 가능` : 'PSA 8 센터링 기준 미통과 (앞면 65/35 초과)';\n\n    lastResult = {\n      lr, tb,"
    ]
  ],
  "overseas-card-cost": [
    [
      "  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px}\n  @media(max-width:720px){.form-grid{grid-template-columns:1fr}}\n  .field{display:block}\n  .field[hidden]{display:none}\n  .input-message{margin-top:16px;padding:20px;border:1px dashed var(--term-amber);color:var(--term-amber);font-size:12px;line-height:1.7}\n  .input-message:empty{display:none}\n  @media(max-width:720px){.input-message{padding:16px}}\n  .field-label{display:block;font-size:11px;color:var(--term-green);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;text-shadow:0 0 4px rgba(51,255,0,.25)}\n  .field-row{display:flex;align-items:center;gap:8px;position:relative}\n  .field-row .term-prompt{font-size:13px;flex:none}",
      "  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px}\n  @media(max-width:720px){.form-grid{grid-template-columns:1fr}}\n  .field{display:block}\n  .field-label{display:block;font-size:11px;color:var(--term-green);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;text-shadow:0 0 4px rgba(51,255,0,.25)}\n  .field-row{display:flex;align-items:center;gap:8px;position:relative}\n  .field-row .term-prompt{font-size:13px;flex:none}"
    ],
    [
      "    <h1>OVERSEAS CARD COST<span class=\"cursor\"></span></h1>\n    <p class=\"subtitle\">TCGplayer·Cardmarket 가격을 한국 도착 예상액으로 바꾸는 입력값 기반 참고 계산기.</p>\n    <p class=\"pubdate\" style=\"color:var(--term-muted);font-size:11px;letter-spacing:0.1em;margin:-14px 0 16px\">CARDPICK TOOL · 2026-05-31</p>\n    <div class=\"notice\">[중요] 이 도구는 실거래 가격 제공 서비스가 아닙니다. 사용자가 입력한 해외 카드 가격·배송비·수수료·세율을 바탕으로 한국 도착 예상액을 계산합니다. 처음 표시된 금액·환율·면세 기준·세율은 기능 설명용 예시이며 현재 시세나 법정 기준이 아닙니다. 실제 구매 조건으로 바꿔 입력하세요.</div>\n\n    <section class=\"ascii-box\">\n      <div class=\"ascii-box-title\">+--- INPUT PURCHASE DATA ---+</div>",
      "    <h1>OVERSEAS CARD COST<span class=\"cursor\"></span></h1>\n    <p class=\"subtitle\">TCGplayer·Cardmarket 가격을 한국 도착 예상액으로 바꾸는 입력값 기반 참고 계산기.</p>\n    <p class=\"pubdate\" style=\"color:var(--term-muted);font-size:11px;letter-spacing:0.1em;margin:-14px 0 16px\">CARDPICK TOOL · 2026-05-31</p>\n    <div class=\"notice\">[중요] 이 도구는 실거래 가격 제공 서비스가 아닙니다. 사용자가 입력한 해외 카드 가격·배송비·수수료·세율을 바탕으로 한국 도착 예상액을 계산합니다.</div>\n\n    <section class=\"ascii-box\">\n      <div class=\"ascii-box-title\">+--- INPUT PURCHASE DATA ---+</div>"
    ],
    [
      "          <div class=\"field-hint\">판매자 → 배송대행지/현지 주소 배송</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">구매 통화 환율 (KRW / <span id=\"fx-currency\">USD</span>)</span>\n          <div class=\"field-row\"><input id=\"i-fx\" type=\"number\" min=\"0\" step=\"0.01\" value=\"1380\" autocomplete=\"off\" aria-describedby=\"fx-help\"><span class=\"field-suffix\">₩</span></div>\n          <div class=\"field-hint\" id=\"fx-help\">1통화당 원화 금액을 직접 입력하세요. 처음 표시된 환율은 설명용 예시이며 실시간 환율이 아닙니다.</div>\n        </label>\n        <label class=\"field\" id=\"usd-fx-field\" hidden>\n          <span class=\"field-label\">면세 기준 환산용 환율 (KRW / USD)</span>\n          <div class=\"field-row\"><input id=\"i-usd-fx\" type=\"number\" min=\"0\" step=\"0.01\" value=\"\" autocomplete=\"off\" aria-describedby=\"usd-fx-help\" disabled><span class=\"field-suffix\">₩</span></div>\n          <div class=\"field-hint\" id=\"usd-fx-help\">EUR 금액을 입력한 USD 기준과 비교할 때 사용합니다. 같은 시점의 1 USD당 원화 금액을 직접 입력하세요. 자동 조회하지 않습니다.</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">국제배송비 + 배송대행 수수료</span>",
      "          <div class=\"field-hint\">판매자 → 배송대행지/현지 주소 배송</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">환율 (KRW / 통화)</span>\n          <div class=\"field-row\"><input id=\"i-fx\" type=\"number\" min=\"100\" step=\"0.01\" value=\"1380\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">국제배송비 + 배송대행 수수료</span>"
    ],
    [
      "        <button class=\"btn\" id=\"btnEurope\" type=\"button\">[ CARDMARKET 예시 ]</button>\n        <button class=\"btn btn-ghost\" id=\"btnReset\" type=\"button\">[ 초기화 ]</button>\n      </div>\n      <div class=\"input-message\" id=\"inputError\" role=\"alert\"></div>\n    </section>\n\n    <section class=\"summary-card\" role=\"status\" aria-live=\"polite\">",
      "        <button class=\"btn\" id=\"btnEurope\" type=\"button\">[ CARDMARKET 예시 ]</button>\n        <button class=\"btn btn-ghost\" id=\"btnReset\" type=\"button\">[ 초기화 ]</button>\n      </div>\n    </section>\n\n    <section class=\"summary-card\" role=\"status\" aria-live=\"polite\">"
    ],
    [
      "\n      <h2>관세·부가세는 어떻게 봐야 하나?</h2>\n      <p>관세와 부가세는 국가, 품목 분류, 신고가, 배송 방식, 환율 기준에 따라 달라질 수 있습니다. 이 계산기의 기본 면세 기준과 세율은 참고값이며, 실제 통관 전에는 관세청·배송대행사 안내를 확인해야 합니다.</p>\n      <p>자동 적용 모드는 카드 가격과 현지 배송비의 합계를 입력한 USD 기준과 비교하는 단순 계산입니다. EUR는 구매 통화 환율로 원화로 바꾼 뒤, 별도로 입력한 USD 환율로 나눕니다. 법정 면세 여부나 실제 통관 세액을 판정하지 않으며 세금 적용 안 함을 선택하면 세금은 계산에서 제외됩니다.</p>\n\n      <h2>해외 참고가와 한국 도착가가 다른 이유</h2>\n      <p>카드픽의 해외 참고가는 해외 마켓의 가격 흐름을 이해하기 위한 기준입니다. 하지만 실제 구매 비용은 결제 수수료, 배송비, 환율, 세금, 카드 상태 리스크가 합쳐진 도착가로 봐야 합니다. 특히 PSA나 BGS 그레이딩까지 고려한다면 직구 도착가에 그레이딩 비용과 판매 수수료까지 추가로 계산해야 합니다.</p>",
      "\n      <h2>관세·부가세는 어떻게 봐야 하나?</h2>\n      <p>관세와 부가세는 국가, 품목 분류, 신고가, 배송 방식, 환율 기준에 따라 달라질 수 있습니다. 이 계산기의 기본 면세 기준과 세율은 참고값이며, 실제 통관 전에는 관세청·배송대행사 안내를 확인해야 합니다.</p>\n\n      <h2>해외 참고가와 한국 도착가가 다른 이유</h2>\n      <p>카드픽의 해외 참고가는 해외 마켓의 가격 흐름을 이해하기 위한 기준입니다. 하지만 실제 구매 비용은 결제 수수료, 배송비, 환율, 세금, 카드 상태 리스크가 합쳐진 도착가로 봐야 합니다. 특히 PSA나 BGS 그레이딩까지 고려한다면 직구 도착가에 그레이딩 비용과 판매 수수료까지 추가로 계산해야 합니다.</p>"
    ],
    [
      "(function(){\n  'use strict';\n  const $ = id => document.getElementById(id);\n  const money = n => '₩ ' + Math.round(n).toLocaleString('ko-KR');\n  const parseNum = v => {\n    const text = String(v == null ? '' : v).trim().replace(/,/g, '');\n    if (!/^(?:\\d+(?:\\.\\d*)?|\\.\\d+)$/.test(text)) return NaN;\n    const n = Number(text);\n    return Number.isFinite(n) ? n : NaN;\n  };\n  const currencyEls = ['s-cur1','s-cur2'];\n  const fxByCurrency = {USD: $('i-fx').value, EUR: ''};\n  let activeCurrency = $('i-currency').value;\n  const amountIds = ['o-landed','o-base','o-pay','o-intl','o-tax','o-buffer','o-break'];\n  function formatNumericInput(el){\n    const raw = el.value.replace(/,/g, '');\n    if (/^\\d+$/.test(raw) && Number.isFinite(Number(raw))) el.value = Number(raw).toLocaleString('ko-KR');\n  }\n  document.querySelectorAll('input[inputmode=\"numeric\"]').forEach(el => {\n    el.addEventListener('input', () => { formatNumericInput(el); recalc(); });\n  });\n  document.querySelectorAll('input[inputmode=\"decimal\"], input[type=\"number\"], select').forEach(el => {\n    if (el.id === 'i-currency') return;\n    el.addEventListener('input', recalc);\n    el.addEventListener('change', recalc);\n  });\n  $('i-currency').addEventListener('change', () => {\n    const cur = $('i-currency').value;\n    fxByCurrency[activeCurrency] = $('i-fx').value;\n    $('i-fx').value = fxByCurrency[cur] || '';\n    activeCurrency = cur;\n    recalc();\n  });\n\n  function recalc(){\n    const cur = $('i-currency').value;\n    const taxMode = $('i-tax-mode').value;\n    const needsUsdFx = cur === 'EUR' && taxMode === 'auto';\n    currencyEls.forEach(id => $(id).textContent = cur);\n    $('fx-currency').textContent = cur;\n    $('usd-fx-field').hidden = !needsUsdFx;\n    $('i-usd-fx').disabled = !needsUsdFx;\n    const required = ['i-card','i-local-ship','i-fx','i-intl','i-pay-fee','i-buffer'];\n    if (taxMode !== 'off') required.push('i-tax-rate');\n    if (taxMode === 'auto') required.push('i-threshold');\n    if (needsUsdFx) required.push('i-usd-fx');\n    const optionalLocal = $('i-local-price').value.trim();\n    if (optionalLocal !== '') required.push('i-local-price');\n    const positive = new Set(['i-card','i-fx','i-usd-fx']);\n    const invalid = required.filter(id => {\n      const n = parseNum($(id).value);\n      return !Number.isFinite(n) || n < 0 || (positive.has(id) && n <= 0);\n    });\n    if (!['USD','EUR'].includes(cur)) invalid.push('i-currency');\n    if (!['auto','always','off'].includes(taxMode)) invalid.push('i-tax-mode');\n    ['i-card','i-local-ship','i-fx','i-intl','i-pay-fee','i-buffer','i-tax-rate','i-threshold','i-usd-fx','i-local-price','i-currency','i-tax-mode'].forEach(id => {\n      $(id).setAttribute('aria-invalid', String(invalid.includes(id)));\n    });\n    function clearResult(message){\n      amountIds.forEach(id => $(id).textContent = '입력 확인');\n      $('o-compare').textContent = '입력값을 확인하면 도착 예상액과 차액을 계산합니다.';\n      $('o-tax-note').textContent = '세금 계산 보류';\n      $('inputError').textContent = message;\n    }\n    if (invalid.length) {\n      clearResult('카드 가격과 필요한 환율은 0보다 큰 금액을, 배송비·수수료·예비비와 적용할 세금 값은 0 이상의 유한한 숫자로 입력하세요. EUR 자동 적용에는 USD 환산용 환율도 필요합니다.');\n      return;\n    }\n    $('inputError').textContent = '';\n    const card = parseNum($('i-card').value);\n    const localShip = parseNum($('i-local-ship').value);\n    const fx = parseNum($('i-fx').value);\n    const intl = parseNum($('i-intl').value);\n    const payRate = parseNum($('i-pay-fee').value) / 100;\n    const thresholdUsd = taxMode === 'auto' ? parseNum($('i-threshold').value) : 0;\n    const taxRate = taxMode === 'off' ? 0 : parseNum($('i-tax-rate').value) / 100;\n    const localPrice = optionalLocal === '' ? 0 : parseNum(optionalLocal);\n    const bufferRate = parseNum($('i-buffer').value) / 100;\n\n    const foreignTotal = card + localShip;\n    const baseKrw = foreignTotal * fx;\n    const payFee = baseKrw * payRate;\n    const buffer = (baseKrw + payFee + intl) * bufferRate;\n    const usdEquivalent = taxMode !== 'auto' ? 0 : (cur === 'USD' ? foreignTotal : baseKrw / parseNum($('i-usd-fx').value));\n    const shouldTax = taxMode === 'always' || (taxMode === 'auto' && usdEquivalent > thresholdUsd);\n    const taxableBase = baseKrw + payFee + intl;\n    const tax = shouldTax ? taxableBase * taxRate : 0;\n    const landed = baseKrw + payFee + intl + tax + buffer;\n    const diff = localPrice > 0 ? localPrice - landed : 0;\n    const pct = localPrice > 0 ? (diff / localPrice) * 100 : 0;\n    if (![foreignTotal,baseKrw,payFee,buffer,usdEquivalent,taxableBase,tax,landed,diff,pct].every(Number.isFinite)) {\n      clearResult('입력값이 너무 커 계산할 수 없습니다. 금액과 환율을 확인하세요.');\n      return;\n    }\n\n    $('o-landed').textContent = money(landed);\n    $('o-base').textContent = money(baseKrw);",
      "(function(){\n  'use strict';\n  const $ = id => document.getElementById(id);\n  const money = n => '₩ ' + Math.round(Math.max(0, n || 0)).toLocaleString('ko-KR');\n  const parseNum = v => {\n    const n = parseFloat(String(v == null ? '' : v).replace(/[^\\d.\\-]/g, ''));\n    return isFinite(n) ? Math.max(0, n) : 0;\n  };\n  const currencyEls = ['s-cur1','s-cur2'];\n  function formatNumericInput(el){\n    const raw = el.value.replace(/[^\\d]/g, '');\n    el.value = raw ? parseInt(raw,10).toLocaleString('ko-KR') : '';\n  }\n  document.querySelectorAll('input[inputmode=\"numeric\"]').forEach(el => {\n    el.addEventListener('input', () => { formatNumericInput(el); recalc(); });\n  });\n  document.querySelectorAll('input[inputmode=\"decimal\"], input[type=\"number\"], select').forEach(el => {\n    el.addEventListener('input', recalc);\n    el.addEventListener('change', recalc);\n  });\n  $('i-currency').addEventListener('change', () => {\n    const cur = $('i-currency').value;\n    currencyEls.forEach(id => $(id).textContent = cur);\n    if (cur === 'EUR' && parseNum($('i-fx').value) < 1500) $('i-fx').value = 1500;\n    if (cur === 'USD' && parseNum($('i-fx').value) > 1450) $('i-fx').value = 1380;\n    recalc();\n  });\n\n  function recalc(){\n    const cur = $('i-currency').value;\n    const card = parseNum($('i-card').value);\n    const localShip = parseNum($('i-local-ship').value);\n    const fx = Math.max(100, parseNum($('i-fx').value));\n    const intl = parseNum($('i-intl').value);\n    const payRate = parseNum($('i-pay-fee').value) / 100;\n    const taxMode = $('i-tax-mode').value;\n    const thresholdUsd = parseNum($('i-threshold').value);\n    const taxRate = parseNum($('i-tax-rate').value) / 100;\n    const localPrice = parseNum($('i-local-price').value);\n    const bufferRate = parseNum($('i-buffer').value) / 100;\n\n    const foreignTotal = card + localShip;\n    const baseKrw = foreignTotal * fx;\n    const payFee = baseKrw * payRate;\n    const buffer = (baseKrw + payFee + intl) * bufferRate;\n    const usdEquivalent = cur === 'USD' ? foreignTotal : (baseKrw / 1380);\n    const shouldTax = taxMode === 'always' || (taxMode === 'auto' && usdEquivalent > thresholdUsd);\n    const taxableBase = baseKrw + payFee + intl;\n    const tax = shouldTax ? taxableBase * taxRate : 0;\n    const landed = baseKrw + payFee + intl + tax + buffer;\n\n    $('o-landed').textContent = money(landed);\n    $('o-base').textContent = money(baseKrw);"
    ],
    [
      "    $('o-tax').textContent = money(tax);\n    $('o-buffer').textContent = money(buffer);\n    $('o-break').textContent = money(landed);\n    $('o-tax-note').textContent = taxMode === 'off'\n      ? '세금 제외: 사용자가 적용 안 함을 선택했습니다. 면세 판정이 아니며 실제 통관과 다를 수 있습니다.'\n      : taxMode === 'always'\n        ? '세금 적용: 사용자가 항상 적용을 선택했습니다. 입력 세율 기준의 참고 계산입니다.'\n        : shouldTax\n          ? '세금 적용: 입력한 USD 기준을 초과해 입력 세율을 적용했습니다. 실제 통관과 다를 수 있습니다.'\n          : '세금 미적용: 입력한 USD 기준 이하로 계산했습니다. 실제 통관과 다를 수 있습니다.';\n\n    if (localPrice > 0) {\n      if (diff > 0) $('o-compare').textContent = `국내 참고 가격 대비 약 ${money(diff)} 낮음 (${pct.toFixed(1)}% 절약 참고)`;\n      else if (diff < 0) $('o-compare').textContent = `국내 참고 가격보다 약 ${money(Math.abs(diff))} 높음 (${Math.abs(pct).toFixed(1)}% 추가 부담)`;\n      else $('o-compare').textContent = '국내 참고 가격과 거의 동일합니다.';",
      "    $('o-tax').textContent = money(tax);\n    $('o-buffer').textContent = money(buffer);\n    $('o-break').textContent = money(landed);\n    $('o-tax-note').textContent = shouldTax\n      ? '세금 적용: 입력한 면세 기준을 초과했거나 항상 적용을 선택했습니다.'\n      : '세금 미적용: 입력한 면세 기준 이하로 계산했습니다. 실제 통관과 다를 수 있습니다.';\n\n    if (localPrice > 0) {\n      const diff = localPrice - landed;\n      const pct = localPrice ? (diff / localPrice) * 100 : 0;\n      if (diff > 0) $('o-compare').textContent = `국내 참고 가격 대비 약 ${money(diff)} 낮음 (${pct.toFixed(1)}% 절약 참고)`;\n      else if (diff < 0) $('o-compare').textContent = `국내 참고 가격보다 약 ${money(Math.abs(diff))} 높음 (${Math.abs(pct).toFixed(1)}% 추가 부담)`;\n      else $('o-compare').textContent = '국내 참고 가격과 거의 동일합니다.';"
    ],
    [
      "    }\n  }\n\n  const EX_US = {'i-market':'tcgplayer','i-currency':'USD','i-card':'120','i-local-ship':'5','i-fx':'1380','i-usd-fx':'','i-intl':'25,000','i-pay-fee':'3.0','i-tax-mode':'auto','i-threshold':'150','i-tax-rate':'10','i-local-price':'220,000','i-buffer':'1.5'};\n  const EX_EU = {'i-market':'cardmarket','i-currency':'EUR','i-card':'90','i-local-ship':'12','i-fx':'1500','i-usd-fx':'1380','i-intl':'35,000','i-pay-fee':'3.5','i-tax-mode':'auto','i-threshold':'150','i-tax-rate':'10','i-local-price':'210,000','i-buffer':'2.0'};\n  const EMPTY = {'i-market':'tcgplayer','i-currency':'USD','i-card':'','i-local-ship':'0','i-fx':'','i-usd-fx':'','i-intl':'0','i-pay-fee':'0','i-tax-mode':'auto','i-threshold':'','i-tax-rate':'','i-local-price':'','i-buffer':'0'};\n  function apply(obj){\n    Object.entries(obj).forEach(([id,v]) => { if ($(id)) $(id).value = v; });\n    activeCurrency = $('i-currency').value;\n    fxByCurrency.USD = activeCurrency === 'USD' ? $('i-fx').value : '';\n    fxByCurrency.EUR = activeCurrency === 'EUR' ? $('i-fx').value : '';\n    recalc();\n  }\n  $('btnExample').addEventListener('click', () => apply(EX_US));",
      "    }\n  }\n\n  const EX_US = {'i-market':'tcgplayer','i-currency':'USD','i-card':'120','i-local-ship':'5','i-fx':'1380','i-intl':'25,000','i-pay-fee':'3.0','i-tax-mode':'auto','i-threshold':'150','i-tax-rate':'10','i-local-price':'220,000','i-buffer':'1.5'};\n  const EX_EU = {'i-market':'cardmarket','i-currency':'EUR','i-card':'90','i-local-ship':'12','i-fx':'1500','i-intl':'35,000','i-pay-fee':'3.5','i-tax-mode':'auto','i-threshold':'150','i-tax-rate':'10','i-local-price':'210,000','i-buffer':'2.0'};\n  const EMPTY = {'i-market':'tcgplayer','i-currency':'USD','i-card':'0','i-local-ship':'0','i-fx':'1380','i-intl':'0','i-pay-fee':'0','i-tax-mode':'auto','i-threshold':'150','i-tax-rate':'10','i-local-price':'0','i-buffer':'0'};\n  function apply(obj){\n    Object.entries(obj).forEach(([id,v]) => { if ($(id)) $(id).value = v; });\n    currencyEls.forEach(id => $(id).textContent = $('i-currency').value);\n    recalc();\n  }\n  $('btnExample').addEventListener('click', () => apply(EX_US));"
    ]
  ]
};
// Additional scope-copy corrections only. Every exact replacement is reversed
// before the existing whole-document immutable-baseline comparison.
approvedToolQualityPairs['centering-checker'].push(
  [
    '<meta name="description" content="포켓몬 카드 사진으로 좌우·상하 비율과 앞면 센터링 참고 범위를 비교하세요. 등급 판정 도구가 아니며 BGS 최신 공식 기준은 확인하지 못했습니다. 이미지는 브라우저에서만 처리됩니다.">',
    '<meta name="description" content="포켓몬 카드 사진을 업로드해 좌우·상하 센터링 비율을 측정하고 PSA 10·BGS 10 기준 통과 가능성을 확인하세요. 이미지는 브라우저에서만 처리되며 서버에 업로드되지 않습니다.">',
  ],
  [
    '<meta property="og:description" content="카드 사진의 좌우·상하 비율과 앞면 센터링 참고 비교. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 이미지 로컬 처리.">',
    '<meta property="og:description" content="카드 사진을 업로드해 좌우·상하 센터링 비율을 측정하고 PSA 10·BGS 10 통과 가능성을 자가 점검. 이미지는 브라우저에서만 처리됩니다.">',
  ],
  [
    '<meta name="twitter:description" content="앞면 센터링 참고 비교 도구. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 이미지는 브라우저에서만 처리됩니다.">',
    '<meta name="twitter:description" content="PSA 10·BGS 10 센터링 기준 자가 점검 도구. 100% 브라우저 처리.">',
  ],
  [
    '"description":"포켓몬 카드 사진의 좌우·상하 비율과 앞면 센터링 참고 범위를 비교하는 도구. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 이미지는 브라우저에서만 처리됩니다.","applicationCategory"',
    '"description":"포켓몬 카드 사진을 업로드해 좌우·상하 센터링 비율을 측정하고 PSA 10·BGS 10 기준 통과 가능성을 자가 점검하는 도구. 이미지는 브라우저에서만 처리됩니다.","applicationCategory"',
  ],
  [
    '"PSA 10·9·8 앞면 센터링 참고 비교 (등급 판정 아님)","BGS 10 Pristine·9.5 참고 비교 (최신 공식 기준 미확인)"',
    '"PSA 10·9·8 기준 통과 여부 표시","BGS 10 Pristine·9.5 기준 표시"',
  ],
  [
    '"description":"카드 이미지를 업로드해 외곽 4점과 내부 4점을 클릭하면 좌우·상하 비율과 앞면 센터링 참고 비교를 확인합니다. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다.","totalTime"',
    '"description":"카드 이미지를 업로드해 외곽 4점과 내부 4점을 클릭하면 좌우·상하 센터링 비율과 PSA/BGS 기준 통과 가능성을 즉시 계산합니다.","totalTime"',
  ],
  [
    '{"@type":"HowToStep","position":5,"name":"결과 확인","text":"좌우·상하 비율과 앞면 센터링 참고 비교를 확인합니다. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 결과 PNG 저장 또는 텍스트 복사가 가능합니다."}',
    '{"@type":"HowToStep","position":5,"name":"결과 확인","text":"좌우·상하 센터링 비율과 PSA 10·BGS 10 통과 가능성이 자동 계산됩니다. 결과 PNG 저장 또는 텍스트 복사가 가능합니다."}',
  ],
  [
    '        <li><strong>5단계:</strong> 좌우·상하 비율과 앞면 센터링 참고 비교를 확인합니다. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 결과 PNG 저장 또는 텍스트 복사가 가능합니다.</li>',
    '        <li><strong>5단계:</strong> 좌우·상하 비율과 PSA·BGS 등급 통과 가능성이 자동으로 표시됩니다.</li>',
  ],
);

const approvedToolFinishPairs = {
  "centering-checker": [
    [
      "\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional\" rel=\"stylesheet\" media=\"print\" onload=\"this.media='all'\">\n<noscript><link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional\" rel=\"stylesheet\"></noscript>\n\n<style>\n  :root{\n",
      "\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap\" rel=\"stylesheet\">\n\n<style>\n  :root{\n"
    ],
    [
      "  .btn-red{border-color:var(--term-red);color:var(--term-red)}\n  .btn-red:hover{background:var(--term-red);color:#fff}\n  .btn[disabled]{opacity:.35;cursor:not-allowed;pointer-events:none}\n  input[type=file]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}\n\n  /* 줌 토글 */\n  .zoom-row{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}\n",
      "  .btn-red{border-color:var(--term-red);color:var(--term-red)}\n  .btn-red:hover{background:var(--term-red);color:#fff}\n  .btn[disabled]{opacity:.35;cursor:not-allowed;pointer-events:none}\n  input[type=file]{display:none}\n\n  /* 줌 토글 */\n  .zoom-row{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}\n"
    ],
    [
      "  }\n</style>\n\n<style id=\"cp-tool-finish-usability\">\n  .term-inner .btn,.term-inner .zoom-btn{min-height:44px;min-width:44px;justify-content:center}\n  .term-inner .ascii-box{padding:20px}\n  .term-inner a:focus-visible,.term-inner button:focus-visible,.term-inner canvas:focus-visible,footer a:focus-visible{outline:2px solid var(--term-green);outline-offset:3px}\n  #file-input:focus-visible + label{outline:2px solid var(--term-green);outline-offset:3px}\n  .content p a{ text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px }\n  .ext-links{display:flex;flex-wrap:wrap;gap:8px;padding:20px}\n  .ext-links .lbl{flex-basis:100%;margin-bottom:0}\n  .ext-links a{display:inline-flex;align-items:center;min-height:44px;min-width:44px;padding:8px;margin-right:0;text-decoration:underline;text-underline-offset:3px}\n  .keyboard-help{font-size:12px;line-height:1.7;color:var(--term-fg)}\n  .keyboard-status{font-size:12px;min-height:1.7em;color:var(--term-amber)}\n  @media(max-width:720px){.term-inner{padding-left:16px;padding-right:16px}.term-inner .ascii-box,.ext-links{padding:16px}}\n</style>\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n",
      "  }\n</style>\n\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n"
    ],
    [
      "      <div class=\"ascii-box-title\">+--- INPUT / CONTROLS ---+</div>\n\n      <div class=\"btn-row\">\n        <input type=\"file\" id=\"file-input\" accept=\"image/*\">\n        <label class=\"btn\" for=\"file-input\">[ 카드 이미지 업로드 ]</label>\n        <button class=\"btn btn-amber\" id=\"btn-sample\" type=\"button\">[ 샘플 카드로 연습 ]</button>\n        <button class=\"btn btn-ghost\" id=\"btn-undo\" type=\"button\" disabled>[ 마지막 점 삭제 ]</button>\n        <button class=\"btn btn-red\" id=\"btn-reset\" type=\"button\" disabled>[ 리셋 ]</button>\n",
      "      <div class=\"ascii-box-title\">+--- INPUT / CONTROLS ---+</div>\n\n      <div class=\"btn-row\">\n        <label class=\"btn\" for=\"file-input\">[ 카드 이미지 업로드 ]</label>\n        <input type=\"file\" id=\"file-input\" accept=\"image/*\">\n        <button class=\"btn btn-amber\" id=\"btn-sample\" type=\"button\">[ 샘플 카드로 연습 ]</button>\n        <button class=\"btn btn-ghost\" id=\"btn-undo\" type=\"button\" disabled>[ 마지막 점 삭제 ]</button>\n        <button class=\"btn btn-red\" id=\"btn-reset\" type=\"button\" disabled>[ 리셋 ]</button>\n"
    ],
    [
      "      <div class=\"ascii-box-title\">+--- CARD CANVAS ---+</div>\n      <div class=\"canvas-wrap\" id=\"canvas-wrap\">\n        <div class=\"canvas-empty\" id=\"canvas-empty\">위 컨트롤에서 이미지를 업로드하거나 샘플 카드를 불러오세요.</div>\n        <canvas id=\"cv\" tabindex=\"0\" role=\"application\" aria-label=\"센터링 측정 캔버스\" aria-describedby=\"keyboard-help\" style=\"display:none\">카드 사진을 측정하는 영역입니다. 방향키로 위치를 옮기고 Enter로 점을 선택합니다.</canvas>\n      </div>\n      <p class=\"keyboard-help\" id=\"keyboard-help\">키보드: Tab으로 측정 영역에 들어간 뒤 방향키로 십자선을 1픽셀씩 이동하고 Enter로 점을 선택하세요. Shift와 방향키를 함께 누르면 10픽셀씩 이동합니다. 외곽 4점, 내부 4점 순서입니다.</p>\n      <div class=\"keyboard-status\" id=\"keyboard-status\" role=\"status\" aria-live=\"polite\"></div>\n    </section>\n\n    <!-- ============== 결과 ============== -->\n",
      "      <div class=\"ascii-box-title\">+--- CARD CANVAS ---+</div>\n      <div class=\"canvas-wrap\" id=\"canvas-wrap\">\n        <div class=\"canvas-empty\" id=\"canvas-empty\">위 컨트롤에서 이미지를 업로드하거나 샘플 카드를 불러오세요.</div>\n        <canvas id=\"cv\" style=\"display:none\"></canvas>\n      </div>\n    </section>\n\n    <!-- ============== 결과 ============== -->\n"
    ],
    [
      "    <section class=\"ascii-box\" aria-label=\"공유\" style=\"margin-top:24px\">\n      <div class=\"ascii-box-title\">+--- SHARE ---+</div>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-amber\" onclick=\"cpShare()\">[ 도구 공유 ]</button>\n        <button type=\"button\" class=\"btn\" onclick=\"cpShareCopy()\">[ 링크 복사 ]</button>\n      </div>\n      <p class=\"keyboard-help\">도구 페이지 주소만 공유합니다. 업로드 이미지와 측정값은 포함되지 않습니다. 측정 결과는 위의 결과 복사 또는 PNG 저장을 이용하세요.</p>\n    </section>\n\n  </div>\n",
      "    <section class=\"ascii-box\" aria-label=\"공유\" style=\"margin-top:24px\">\n      <div class=\"ascii-box-title\">+--- SHARE ---+</div>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-amber\" onclick=\"cpShare()\">[ 카카오톡 공유 ]</button>\n        <button type=\"button\" class=\"btn\" onclick=\"cpShareCopy()\">[ 링크 복사 ]</button>\n      </div>\n    </section>\n\n  </div>\n"
    ],
    [
      "  let zoom = 1;          // 1 / 1.5 / 2 / 3\n  let baseScale = 1;     // image-to-canvas base scale (fit-to-800px)\n  let lastResult = null;\n  let keyboardPoint = {x:0, y:0};\n\n  const stepLabels = [\n    '외곽 좌상단 (Outer ↖)',\n",
      "  let zoom = 1;          // 1 / 1.5 / 2 / 3\n  let baseScale = 1;     // image-to-canvas base scale (fit-to-800px)\n  let lastResult = null;\n\n  const stepLabels = [\n    '외곽 좌상단 (Outer ↖)',\n"
    ],
    [
      "    const finalScale = baseScale * zoom;\n    canvas.width  = Math.round(img.naturalWidth  * finalScale);\n    canvas.height = Math.round(img.naturalHeight * finalScale);\n    keyboardPoint = {x:Math.floor(canvas.width / 2), y:Math.floor(canvas.height / 2)};\n    drawAll();\n  }\n\n",
      "    const finalScale = baseScale * zoom;\n    canvas.width  = Math.round(img.naturalWidth  * finalScale);\n    canvas.height = Math.round(img.naturalHeight * finalScale);\n    drawAll();\n  }\n\n"
    ],
    [
      "      ctx.setLineDash([]);\n    }\n\n    if (document.activeElement === canvas && points.length < 8){\n      ctx.strokeStyle = '#ffffff';\n      ctx.lineWidth = 1;\n      ctx.beginPath();\n      ctx.moveTo(keyboardPoint.x - 12, keyboardPoint.y);\n      ctx.lineTo(keyboardPoint.x + 12, keyboardPoint.y);\n      ctx.moveTo(keyboardPoint.x, keyboardPoint.y - 12);\n      ctx.lineTo(keyboardPoint.x, keyboardPoint.y + 12);\n      ctx.stroke();\n    }\n\n    // 점·번호\n    points.forEach((p, i) => {\n      const isOuter = i < 4;\n",
      "      ctx.setLineDash([]);\n    }\n\n    // 점·번호\n    points.forEach((p, i) => {\n      const isOuter = i < 4;\n"
    ],
    [
      "    if (img) drawAll();\n    resultEl.style.display = 'none';\n    lastResult = null;\n    document.getElementById('keyboard-status').textContent = '';\n    updateSteps();\n  }\n\n",
      "    if (img) drawAll();\n    resultEl.style.display = 'none';\n    lastResult = null;\n    updateSteps();\n  }\n\n"
    ],
    [
      "  });\n\n  // ===== 포인터 입력 (마우스 + 터치 통합) =====\n  function addPoint(point){\n    if (!img || points.length >= 8) return;\n    points.push({x:Math.max(0,Math.min(canvas.width,point.x)), y:Math.max(0,Math.min(canvas.height,point.y))});\n    drawAll();\n    updateSteps();\n    if (points.length === 8) compute();\n  }\n  canvas.addEventListener('focus', drawAll);\n  canvas.addEventListener('blur', drawAll);\n  canvas.addEventListener('keydown', function(e){\n    if (!img || points.length >= 8) return;\n    const moves = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};\n    const move = moves[e.key];\n    if (move){\n      e.preventDefault();\n      const step = e.shiftKey ? 10 : 1;\n      keyboardPoint = {x:Math.max(0,Math.min(canvas.width,keyboardPoint.x + move[0]*step)), y:Math.max(0,Math.min(canvas.height,keyboardPoint.y + move[1]*step))};\n      drawAll();\n      document.getElementById('keyboard-status').textContent = `위치: ${keyboardPoint.x}, ${keyboardPoint.y}픽셀. 다음 점 ${points.length+1}/8.`;\n    } else if (e.key === 'Enter'){\n      e.preventDefault();\n      addPoint(keyboardPoint);\n      document.getElementById('keyboard-status').textContent = points.length === 8 ? '8점 선택 완료. 결과를 확인하세요.' : `${points.length}/8점 선택 완료. 다음 점으로 이동하세요.`;\n    }\n  });\n  canvas.addEventListener('pointerdown', function(e){\n    if (!img || points.length >= 8) return;\n    e.preventDefault();\n    const rect = canvas.getBoundingClientRect();\n    const scaleX = canvas.width / rect.width;\n    const scaleY = canvas.height / rect.height;\n    addPoint({\n      x: (e.clientX - rect.left) * scaleX,\n      y: (e.clientY - rect.top)  * scaleY,\n    });\n  });\n\n  // 캔버스 영역에서 페이지 스크롤 튐 방지\n",
      "  });\n\n  // ===== 포인터 입력 (마우스 + 터치 통합) =====\n  canvas.addEventListener('pointerdown', function(e){\n    if (!img || points.length >= 8) return;\n    e.preventDefault();\n    const rect = canvas.getBoundingClientRect();\n    const scaleX = canvas.width / rect.width;\n    const scaleY = canvas.height / rect.height;\n    points.push({\n      x: (e.clientX - rect.left) * scaleX,\n      y: (e.clientY - rect.top)  * scaleY,\n    });\n    drawAll();\n    updateSteps();\n    if (points.length === 8) compute();\n  });\n\n  // 캔버스 영역에서 페이지 스크롤 튐 방지\n"
    ],
    [
      "  btnDownload.addEventListener('click', function(){\n    if (!img || !lastResult) return;\n    const out = document.createElement('canvas');\n    const pad = 24;\n    out.width = Math.max(320, canvas.width);\n    const o = out.getContext('2d');\n    const rows = [\n      {text:`L/R ${lastResult.lr}   T/B ${lastResult.tb}`,font:'bold 22px JetBrains Mono, monospace',color:'#33ff00',lineHeight:30},\n      {text:lastResult.passLine,font:'14px JetBrains Mono, monospace',color:'#ffb000',lineHeight:22},\n      {text:'Measured by cardpick.kr/tools/centering-checker',font:'12px JetBrains Mono, monospace',color:'#a7b4c9',lineHeight:20},\n    ];\n    function wrapText(text, maxWidth){\n      const lines = [];\n      let line = '';\n      for (const character of Array.from(text)){\n        if (line && o.measureText(line + character).width > maxWidth){lines.push(line);line = character;}\n        else line += character;\n      }\n      if (line) lines.push(line);\n      return lines;\n    }\n    for (const row of rows){o.font = row.font;row.lines = wrapText(row.text, out.width - pad*2);}\n    const textH = rows.reduce((height,row) => height + row.lines.length*row.lineHeight + 10, 0);\n    out.height = canvas.height + textH + pad*2;\n    o.fillStyle = '#0a0a0a';\n    o.fillRect(0,0,out.width,out.height);\n    o.drawImage(canvas, (out.width - canvas.width)/2, 0);\n    o.textAlign = 'left';\n    o.textBaseline = 'top';\n    let textY = canvas.height + pad;\n    for (const row of rows){\n      o.fillStyle = row.color;\n      o.font = row.font;\n      for (const line of row.lines){o.fillText(line, pad, textY);textY += row.lineHeight;}\n      textY += 10;\n    }\n\n    const link = document.createElement('a');\n    link.download = 'cardpick-centering.png';\n    link.href = out.toDataURL('image/png');\n",
      "  btnDownload.addEventListener('click', function(){\n    if (!img || !lastResult) return;\n    const out = document.createElement('canvas');\n    const pad = 24, textH = 90;\n    out.width  = canvas.width;\n    out.height = canvas.height + textH + pad*2;\n    const o = out.getContext('2d');\n    o.fillStyle = '#0a0a0a';\n    o.fillRect(0,0,out.width,out.height);\n    o.drawImage(canvas, 0, 0);\n\n    o.fillStyle = '#33ff00';\n    o.font = 'bold 22px JetBrains Mono, monospace';\n    o.textAlign = 'left';\n    o.fillText(`L/R ${lastResult.lr}   T/B ${lastResult.tb}`, pad, canvas.height + pad + 28);\n\n    o.fillStyle = '#ffb000';\n    o.font = '14px JetBrains Mono, monospace';\n    o.fillText(lastResult.passLine, pad, canvas.height + pad + 54);\n\n    o.fillStyle = '#5b6577';\n    o.font = '12px JetBrains Mono, monospace';\n    o.fillText('Measured by cardpick.kr/tools/centering-checker', pad, canvas.height + pad + 78);\n\n    const link = document.createElement('a');\n    link.download = 'cardpick-centering.png';\n    link.href = out.toDataURL('image/png');\n"
    ]
  ],
  "overseas-card-cost": [
    [
      "\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional\" rel=\"stylesheet\" media=\"print\" onload=\"this.media='all'\">\n<noscript><link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional\" rel=\"stylesheet\"></noscript>\n\n<style>\n  :root {\n",
      "\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap\" rel=\"stylesheet\">\n\n<style>\n  :root {\n"
    ],
    [
      "  }\n</style>\n\n<style id=\"cp-tool-finish-usability\">\n  .term-inner button:focus-visible,.term-inner a:focus-visible,.term-inner input:focus-visible,.term-inner select:focus-visible{outline:2px solid var(--term-green);outline-offset:3px}\n  .content p a{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}\n  .term-inner .ascii-box{padding:20px}\n  @media(max-width:720px){.term-inner{padding-left:16px;padding-right:16px}.term-inner .ascii-box{padding:16px}.term-inner .form-grid{grid-template-columns:minmax(0,1fr)}.term-inner .field,.term-inner .field-row{min-width:0;max-width:100%}.term-inner .field-row input{font-size:16px;min-width:0;width:0}.term-inner .field-row select{font-size:16px;min-width:0;width:100%;max-width:100%}}\n</style>\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n",
      "  }\n</style>\n\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n"
    ],
    [
      "  gtag('js', new Date());\n  gtag('config', 'G-S1QY1436WG');\n</script>\n<script src=\"/auth.js?v=v3clean\" defer></script>\n\n<script type=\"application/ld+json\">\n{\"@context\":\"https://schema.org\",\"@type\":\"BreadcrumbList\",\"itemListElement\":[{\"@type\":\"ListItem\",\"position\":1,\"name\":\"카드픽\",\"item\":\"https://cardpick.kr/\"},{\"@type\":\"ListItem\",\"position\":2,\"name\":\"도구\",\"item\":\"https://cardpick.kr/tools\"},{\"@type\":\"ListItem\",\"position\":3,\"name\":\"해외 카드 직구 비용 계산기\",\"item\":\"https://cardpick.kr/tools/overseas-card-cost\"}]}\n",
      "  gtag('js', new Date());\n  gtag('config', 'G-S1QY1436WG');\n</script>\n<script src=\"/auth.js?v=v3clean\"></script>\n\n<script type=\"application/ld+json\">\n{\"@context\":\"https://schema.org\",\"@type\":\"BreadcrumbList\",\"itemListElement\":[{\"@type\":\"ListItem\",\"position\":1,\"name\":\"카드픽\",\"item\":\"https://cardpick.kr/\"},{\"@type\":\"ListItem\",\"position\":2,\"name\":\"도구\",\"item\":\"https://cardpick.kr/tools\"},{\"@type\":\"ListItem\",\"position\":3,\"name\":\"해외 카드 직구 비용 계산기\",\"item\":\"https://cardpick.kr/tools/overseas-card-cost\"}]}\n"
    ],
    [
      "        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">카드 가격</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" id=\"cur-symbol1\" aria-hidden=\"true\">$</span><input id=\"i-card\" type=\"text\" inputmode=\"decimal\" value=\"120\" autocomplete=\"off\"><span class=\"field-suffix\" id=\"s-cur1\">USD</span></div>\n          <div class=\"field-hint\">TCGplayer/Cardmarket 표시 가격 또는 판매자 합계</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">해외 내 배송비</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" id=\"cur-symbol2\" aria-hidden=\"true\">$</span><input id=\"i-local-ship\" type=\"text\" inputmode=\"decimal\" value=\"5\" autocomplete=\"off\"><span class=\"field-suffix\" id=\"s-cur2\">USD</span></div>\n          <div class=\"field-hint\">판매자 → 배송대행지/현지 주소 배송</div>\n        </label>\n        <label class=\"field\">\n",
      "        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">카드 가격</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-card\" type=\"text\" inputmode=\"decimal\" value=\"120\" autocomplete=\"off\"><span class=\"field-suffix\" id=\"s-cur1\">USD</span></div>\n          <div class=\"field-hint\">TCGplayer/Cardmarket 표시 가격 또는 판매자 합계</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">해외 내 배송비</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-local-ship\" type=\"text\" inputmode=\"decimal\" value=\"5\" autocomplete=\"off\"><span class=\"field-suffix\" id=\"s-cur2\">USD</span></div>\n          <div class=\"field-hint\">판매자 → 배송대행지/현지 주소 배송</div>\n        </label>\n        <label class=\"field\">\n"
    ],
    [
      "    const taxMode = $('i-tax-mode').value;\n    const needsUsdFx = cur === 'EUR' && taxMode === 'auto';\n    currencyEls.forEach(id => $(id).textContent = cur);\n    ['cur-symbol1','cur-symbol2'].forEach(id => $(id).textContent = cur === 'EUR' ? '€' : '$');\n    $('fx-currency').textContent = cur;\n    $('usd-fx-field').hidden = !needsUsdFx;\n    $('i-usd-fx').disabled = !needsUsdFx;\n",
      "    const taxMode = $('i-tax-mode').value;\n    const needsUsdFx = cur === 'EUR' && taxMode === 'auto';\n    currencyEls.forEach(id => $(id).textContent = cur);\n    $('fx-currency').textContent = cur;\n    $('usd-fx-field').hidden = !needsUsdFx;\n    $('i-usd-fx').disabled = !needsUsdFx;\n"
    ],
    [
      "    if (!['auto','always','off'].includes(taxMode)) invalid.push('i-tax-mode');\n    ['i-card','i-local-ship','i-fx','i-intl','i-pay-fee','i-buffer','i-tax-rate','i-threshold','i-usd-fx','i-local-price','i-currency','i-tax-mode'].forEach(id => {\n      $(id).setAttribute('aria-invalid', String(invalid.includes(id)));\n      const helpIds = id === 'i-fx' ? 'fx-help inputError' : id === 'i-usd-fx' ? 'usd-fx-help inputError' : 'inputError';\n      $(id).setAttribute('aria-describedby', helpIds);\n    });\n    function clearResult(message){\n      amountIds.forEach(id => $(id).textContent = '입력 확인');\n",
      "    if (!['auto','always','off'].includes(taxMode)) invalid.push('i-tax-mode');\n    ['i-card','i-local-ship','i-fx','i-intl','i-pay-fee','i-buffer','i-tax-rate','i-threshold','i-usd-fx','i-local-price','i-currency','i-tax-mode'].forEach(id => {\n      $(id).setAttribute('aria-invalid', String(invalid.includes(id)));\n    });\n    function clearResult(message){\n      amountIds.forEach(id => $(id).textContent = '입력 확인');\n"
    ]
  ],
  "psa-grading-break-even": [
    [
      "\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional\" rel=\"stylesheet\" media=\"print\" onload=\"this.media='all'\">\n<noscript><link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional\" rel=\"stylesheet\"></noscript>\n\n<!-- 카드픽 헤더/푸터 토큰 (사이트 일관성) -->\n<style>\n",
      "\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=VT323&display=swap\" rel=\"stylesheet\">\n\n<!-- 카드픽 헤더/푸터 토큰 (사이트 일관성) -->\n<style>\n"
    ],
    [
      "  .crumb .sep { color: var(--term-dim); margin: 0 6px; }\n</style>\n\n<style id=\"cp-tool-finish-usability\">\n  .cp-topbar .cp-brand,.cp-topbar .cp-login-google,.cp-topbar .cp-nav a,.cp-topbar .cp-search,.term-inner .btn{min-height:44px}\n  .cp-topbar .cp-nav a{display:inline-flex;align-items:center}\n  .cp-topbar .cp-search{text-decoration:none;flex:none}\n  .cp-topbar a:focus-visible,.term-inner button:focus-visible,.term-inner a:focus-visible,.term-inner input:focus-visible{outline:2px solid var(--term-green);outline-offset:3px}\n  .term-inner .ascii-box,.term-inner .input-message{padding:20px}\n  .explain-box p a,.field-hint a,.faq-a a{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}\n  @media(max-width:1180px){.cp-topbar .cp-topbar-inner{flex-wrap:wrap;height:auto;gap:12px;padding-top:6px;padding-bottom:6px}.cp-topbar .cp-login-google{margin-left:auto}.cp-topbar .cp-search{display:none}.cp-topbar .cp-nav{display:flex;order:99;flex-basis:100%;overflow-x:auto;gap:2px;padding:4px 0;margin-top:0}.cp-topbar .cp-nav a{flex:none;white-space:nowrap}}\n  @media(max-width:720px){.term-inner .ascii-box,.term-inner .input-message{padding:16px}.term-inner .form-grid{grid-template-columns:minmax(0,1fr)}.term-inner .field,.term-inner .field-row{min-width:0;max-width:100%}.term-inner .field-row input{font-size:16px;min-width:0;width:0}}\n  @media(max-width:520px){.cp-topbar .cp-shell{padding-left:16px;padding-right:16px}.cp-topbar .cp-en{display:none}}\n</style>\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n",
      "  .crumb .sep { color: var(--term-dim); margin: 0 6px; }\n</style>\n\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-S1QY1436WG\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n"
    ],
    [
      "  gtag('js', new Date());\n  gtag('config', 'G-S1QY1436WG');\n</script>\n<script src=\"/auth.js?v=v3clean\" defer></script>\n<script src=\"/search.js?v=20260519ko\" defer></script>\n\n<script type=\"application/ld+json\">\n{\n",
      "  gtag('js', new Date());\n  gtag('config', 'G-S1QY1436WG');\n</script>\n<script src=\"/auth.js?v=v3clean\"></script>\n<script src=\"/search.js?v=20260519ko\"></script>\n\n<script type=\"application/ld+json\">\n{\n"
    ],
    [
      "    </a>\n    <nav class=\"cp-nav\" aria-label=\"주 메뉴\">\n      <a href=\"/#prices\">카드 시세</a>\n      <a href=\"/catalog\">카드 검색</a>\n      <a href=\"/hot\">트렌드</a>\n      <a href=\"/board\">게시판</a>\n      <a href=\"/guides\">가이드</a>\n      <a href=\"/tools\" class=\"on\">도구</a>\n      <a href=\"/releases\">발매정보</a>\n    </nav>\n    <label class=\"cp-search\" aria-label=\"카드명 검색\">\n      <span aria-hidden=\"true\" style=\"font-family:var(--cp-mono)\">⌕</span>\n      <span style=\"flex:1;color:var(--cp-dim)\">카드명, 세트 코드</span>\n      <kbd>⌘K</kbd>\n    </label>\n    <a href=\"/login\" class=\"cp-login-google\" aria-label=\"Google 계정으로 로그인\">\n      <svg viewBox=\"0 0 18 18\" aria-hidden=\"true\" focusable=\"false\">\n        <path fill=\"#4285F4\" d=\"M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z\"/>\n        <path fill=\"#34A853\" d=\"M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z\"/>\n",
      "    </a>\n    <nav class=\"cp-nav\" aria-label=\"주 메뉴\">\n      <a href=\"/#prices\">카드 시세</a>\n      <a href=\"/hot\">트렌드</a>\n      <a href=\"/board\">게시판</a>\n      <a href=\"/guides\">가이드</a>\n      <a href=\"/tools\" class=\"on\">도구</a>\n      <a href=\"/releases\">발매정보</a>\n    </nav>\n    <label class=\"cp-search\" aria-label=\"카드명 검색\">\n      <span aria-hidden=\"true\" style=\"font-family:var(--cp-mono)\">⌕</span>\n      <span style=\"flex:1;color:var(--cp-dim)\">카드명, 세트 코드</span>\n      <kbd>⌘K</kbd>\n    </label>\n    <button type=\"button\" class=\"cp-login-google\" aria-label=\"Google 계정으로 로그인\">\n      <svg viewBox=\"0 0 18 18\" aria-hidden=\"true\" focusable=\"false\">\n        <path fill=\"#4285F4\" d=\"M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z\"/>\n        <path fill=\"#34A853\" d=\"M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z\"/>\n"
    ],
    [
      "        <path fill=\"#EA4335\" d=\"M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z\"/>\n      </svg>\n      <span>Google로 로그인</span>\n    </a>\n  </div>\n</header>\n\n",
      "        <path fill=\"#EA4335\" d=\"M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z\"/>\n      </svg>\n      <span>Google로 로그인</span>\n    </button>\n  </div>\n</header>\n\n"
    ],
    [
      "      <div class=\"form-grid\">\n        <label class=\"field\">\n          <span class=\"field-label\">RAW 카드 매입가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-raw\" type=\"text\" inputmode=\"numeric\" value=\"480,000\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">PSA 10 예상 판매가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-p10\" type=\"text\" inputmode=\"numeric\" value=\"1,800,000\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">PSA 9 예상 판매가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-p9\" type=\"text\" inputmode=\"numeric\" value=\"720,000\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">PSA 8 이하 / 실패 시 판매가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-plow\" type=\"text\" inputmode=\"numeric\" value=\"350,000\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">그레이딩 비용</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-grade\" type=\"text\" inputmode=\"numeric\" value=\"50,000\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n          <div class=\"field-hint\">PSA 등급 서비스료는 서비스(Value·Regular·Express)와 신고가·회원 등급으로 다릅니다. <a href=\"https://www.psacard.com/services/tradingcardgrading\" target=\"_blank\" rel=\"nofollow noopener\" style=\"color:var(--term-amber);text-decoration:underline\">PSA 공식 요금표</a>에서 등급료만 확인해 입력하세요. 대행 수수료와 왕복 배송·보험료는 아래 별도 칸에 입력합니다.</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">대행 수수료</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-agent\" type=\"text\" inputmode=\"numeric\" value=\"0\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n          <div class=\"field-hint\">직접 발송은 0, 대행은 받은 견적의 장당 수수료를 입력하세요.</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">왕복 배송·보험</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-ship\" type=\"text\" inputmode=\"numeric\" value=\"20,000\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">기타 비용 (관세·환차손 등)</span>\n          <div class=\"field-row\"><span class=\"term-prompt\" aria-hidden=\"true\">₩</span><input id=\"i-misc\" type=\"text\" inputmode=\"numeric\" value=\"0\" autocomplete=\"off\"><span class=\"field-suffix\">KRW</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">판매 수수료 (%)</span>\n",
      "      <div class=\"form-grid\">\n        <label class=\"field\">\n          <span class=\"field-label\">RAW 카드 매입가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-raw\" type=\"text\" inputmode=\"numeric\" value=\"480,000\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">PSA 10 예상 판매가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-p10\" type=\"text\" inputmode=\"numeric\" value=\"1,800,000\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">PSA 9 예상 판매가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-p9\" type=\"text\" inputmode=\"numeric\" value=\"720,000\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">PSA 8 이하 / 실패 시 판매가</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-plow\" type=\"text\" inputmode=\"numeric\" value=\"350,000\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">그레이딩 비용</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-grade\" type=\"text\" inputmode=\"numeric\" value=\"50,000\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n          <div class=\"field-hint\">PSA 등급 서비스료는 서비스(Value·Regular·Express)와 신고가·회원 등급으로 다릅니다. <a href=\"https://www.psacard.com/services/tradingcardgrading\" target=\"_blank\" rel=\"nofollow noopener\" style=\"color:var(--term-amber);text-decoration:underline\">PSA 공식 요금표</a>에서 등급료만 확인해 입력하세요. 대행 수수료와 왕복 배송·보험료는 아래 별도 칸에 입력합니다.</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">대행 수수료</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-agent\" type=\"text\" inputmode=\"numeric\" value=\"0\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n          <div class=\"field-hint\">직접 발송은 0, 대행은 받은 견적의 장당 수수료를 입력하세요.</div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">왕복 배송·보험</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-ship\" type=\"text\" inputmode=\"numeric\" value=\"20,000\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">기타 비용 (관세·환차손 등)</span>\n          <div class=\"field-row\"><span class=\"term-prompt\">$</span><input id=\"i-misc\" type=\"text\" inputmode=\"numeric\" value=\"0\" autocomplete=\"off\"><span class=\"field-suffix\">₩</span></div>\n        </label>\n        <label class=\"field\">\n          <span class=\"field-label\">판매 수수료 (%)</span>\n"
    ],
    [
      "    <section class=\"ascii-box\" aria-label=\"공유\" style=\"margin-top:24px\">\n      <div class=\"ascii-box-title\">+--- SHARE ---+</div>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-amber\" onclick=\"cpShare()\">[ 도구 공유 ]</button>\n        <button type=\"button\" class=\"btn\" onclick=\"cpShareCopy()\">[ 링크 복사 ]</button>\n      </div>\n      <p>도구 페이지 주소만 공유합니다. 입력한 금액과 계산 결과는 공유 링크에 포함되지 않습니다.</p>\n    </section>\n\n\n",
      "    <section class=\"ascii-box\" aria-label=\"공유\" style=\"margin-top:24px\">\n      <div class=\"ascii-box-title\">+--- SHARE ---+</div>\n      <div class=\"btn-row\">\n        <button type=\"button\" class=\"btn btn-amber\" onclick=\"cpShare()\">[ 카카오톡 공유 ]</button>\n        <button type=\"button\" class=\"btn\" onclick=\"cpShareCopy()\">[ 링크 복사 ]</button>\n      </div>\n    </section>\n\n\n"
    ],
    [
      "    return abs.toLocaleString('ko-KR');\n  };\n  const parseNum = v => {\n    const text = String(v == null ? '' : v).trim();\n    if (!/^(?:\\d+|\\d{1,3}(?:,\\d{3})+)$/.test(text)) return NaN;\n    const n = Number(text.replace(/,/g, ''));\n    return Number.isSafeInteger(n) && n >= 0 ? n : NaN;\n  };\n\n  // 천단위 콤마 입력\n",
      "    return abs.toLocaleString('ko-KR');\n  };\n  const parseNum = v => {\n    const c = String(v == null ? '' : v).replace(/[^\\d.\\-]/g, '');\n    const n = parseFloat(c);\n    return isFinite(n) ? Math.max(0, n) : 0;\n  };\n\n  // 천단위 콤마 입력\n"
    ],
    [
      "    inp.addEventListener('input', e => {\n      const cursor = e.target.selectionStart || 0;\n      const before = e.target.value;\n      const amount = parseNum(before);\n      if (!Number.isSafeInteger(amount)) { recalc(); return; }\n      const formatted = amount.toLocaleString('ko-KR');\n      e.target.value = formatted;\n      try {\n        const diff = formatted.length - before.length;\n",
      "    inp.addEventListener('input', e => {\n      const cursor = e.target.selectionStart || 0;\n      const before = e.target.value;\n      const isNegative = /^\\s*-/.test(before);\n      const cleaned = before.replace(/[^\\d]/g, '');\n      if (!cleaned) { e.target.value = ''; recalc(); return; }\n      const formatted = (isNegative ? '-' : '') + parseInt(cleaned, 10).toLocaleString('ko-KR');\n      e.target.value = formatted;\n      try {\n        const diff = formatted.length - before.length;\n"
    ],
    [
      "    const invalid = [];\n    for (const id of requiredNonNegative) {\n      const value = $(id).value.trim();\n      if (!Number.isSafeInteger(parseNum(value))) invalid.push(id);\n    }\n    for (const id of requiredPositive) {\n      const value = $(id).value.trim();\n      if (!Number.isSafeInteger(parseNum(value)) || parseNum(value) <= 0) invalid.push(id);\n    }\n    const feeText = $('i-fee').value.trim();\n    const feeValue = Number(feeText);\n    if (feeText === '' || !Number.isFinite(feeValue) || feeValue < 0 || feeValue >= 100) invalid.push('i-fee');\n    [...requiredNonNegative, ...requiredPositive, 'i-fee'].forEach(id => {\n      $(id).setAttribute('aria-invalid', String(invalid.includes(id)));\n      $(id).setAttribute('aria-describedby', 'inputError scenarioWarn');\n    });\n    const inputError = $('inputError');\n    function showError(message){\n      inputError.textContent = message;\n      inputError.classList.add('show');\n      $('scenarioWarn').classList.remove('show');\n      ['oCost','oP10','oP9','oPlow','oBreakeven'].forEach(id => $(id).textContent = '입력 확인');\n      $('resultHelp').textContent = '필수 입력값을 채우면 결과가 표시됩니다.';\n      $('bigBox').classList.remove('neg');\n    }\n    if (invalid.length) {\n      showError('원화 금액은 0 이상의 정수로 입력하세요. PSA 10·9 예상 판매가와 그레이딩 비용은 0보다 커야 합니다. 소수·지수 표기나 숫자가 아닌 문자는 사용할 수 없습니다. 판매 수수료는 0 이상 100% 미만입니다.');\n      return;\n    }\n    inputError.classList.remove('show');\n",
      "    const invalid = [];\n    for (const id of requiredNonNegative) {\n      const value = $(id).value.trim();\n      if (value === '' || /^-/.test(value) || !Number.isFinite(Number(value.replace(/,/g, '')))) invalid.push(id);\n    }\n    for (const id of requiredPositive) {\n      const value = $(id).value.trim();\n      if (value === '' || /^-/.test(value) || parseNum(value) <= 0) invalid.push(id);\n    }\n    const feeText = $('i-fee').value.trim();\n    const feeValue = Number(feeText);\n    if (feeText === '' || !Number.isFinite(feeValue) || feeValue < 0 || feeValue >= 100) invalid.push('i-fee');\n    [...requiredNonNegative, ...requiredPositive, 'i-fee'].forEach(id => {\n      $(id).setAttribute('aria-invalid', String(invalid.includes(id)));\n    });\n    const inputError = $('inputError');\n    if (invalid.length) {\n      inputError.textContent = '가격·비용에는 0 이상의 금액을, PSA 10·9 예상 판매가와 그레이딩 비용에는 0보다 큰 금액을 입력하세요. 판매 수수료는 0~99%입니다.';\n      inputError.classList.add('show');\n      $('scenarioWarn').classList.remove('show');\n      $('oCost').textContent = '—';\n      $('oP10').textContent = '—';\n      $('oP9').textContent = '—';\n      $('oPlow').textContent = '—';\n      $('oBreakeven').textContent = '—';\n      $('resultHelp').textContent = '필수 입력값을 채우면 결과가 표시됩니다.';\n      $('bigBox').classList.remove('neg');\n      return;\n    }\n    inputError.classList.remove('show');\n"
    ],
    [
      "    const profit9   = net9   - totalCost;\n    const profitLow = netLow - totalCost;\n    const breakeven = feeMul > 0 ? (totalCost / feeMul) : 0;\n    if (![totalCost,net10,net9,netLow,profit10,profit9,profitLow,breakeven].every(value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) {\n      showError('입력한 금액이나 수수료로 계산한 결과가 안전한 숫자 범위를 넘습니다. 금액과 수수료를 확인하세요.');\n      return;\n    }\n\n    $('oCost').textContent = '₩ ' + fmt(totalCost);\n    setSigned('oP10',  profit10);\n",
      "    const profit9   = net9   - totalCost;\n    const profitLow = netLow - totalCost;\n    const breakeven = feeMul > 0 ? (totalCost / feeMul) : 0;\n\n    $('oCost').textContent = '₩ ' + fmt(totalCost);\n    setSigned('oP10',  profit10);\n"
    ]
  ]
};
function normalizeApprovedToolFinish(source, name, includeGrowth = true) {
  if(includeGrowth)source = restoreGrowthTool(source,name);
  if (!Object.hasOwn(approvedToolFinishPairs, name)) return source;
  let normalized = source;
  for (const [after, before] of approvedToolFinishPairs[name]) {
    assert.equal(source.split(after).length - 1, 1, 'one exact approved accessibility/input/performance block');
    normalized = normalized.replace(after, before);
  }
  return normalized;
}

function normalizeApprovedToolQuality(source, name, includeFinish = true) {
  if (includeFinish) source = normalizeApprovedToolFinish(source, name);
  if (!Object.hasOwn(approvedToolQualityPairs, name)) return source;
  let normalized = source;
  for (const [after, before] of approvedToolQualityPairs[name]) {
    assert.equal(source.split(after).length - 1, 1, 'one exact approved tool quality block');
    normalized = normalized.replace(after, before);
  }
  return normalized;
}

for(const name of tools) test(name+' has a real search destination and isolated header-only layout changes',()=>{
  const file='tools/'+name+'.html', before=original(file), after=normalizeApprovedToolQuality(read(file), name);
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

test('tool quality normalization accepts only exact approved blocks and rejects unrelated drift',()=>{
  for (const [name, pairs] of Object.entries(approvedToolQualityPairs)) {
    const source = normalizeApprovedToolFinish(read('tools/'+name+'.html'), name);
    const approvedBaseline = normalizeApprovedToolQuality(source, name, false);
    for (const [after, before] of pairs) {
      for (const changed of [
        source.replace(after, before),
        source.replace(after, after + '\n<p>unapproved</p>'),
        source.replace(after, after + '\n' + after),
        source.replace(after, '').replace('</body>', after + '\n</body>'),
      ]) {
        assert.notEqual(changed, source, 'negative fixture must change the source');
        assert.throws(() => assert.equal(normalizeApprovedToolQuality(changed,name,false),approvedBaseline));
      }
    }
    for (const changed of [
      source.replace('rel="canonical"', 'rel="unapproved"'),
      source.replace('</body>', '<script>unapproved()</script></body>'),
      source.replace('name="robots"', 'name="unapproved-robots"'),
      ...(source.includes('data-ad-slot=') ? [source.replace('data-ad-slot=', 'data-unapproved-slot=')] : []),
    ]) {
      assert.notEqual(changed, source);
      assert.throws(() => assert.equal(normalizeApprovedToolQuality(changed,name,false),approvedBaseline));
    }
  }
});

test('finishing normalization rejects reverted, moved, duplicated and injected blocks',()=>{
  for (const [name,pairs] of Object.entries(approvedToolFinishPairs)) {
    const source = restoreGrowthTool(read('tools/'+name+'.html'),name);
    const approvedBaseline = normalizeApprovedToolFinish(source,name,false);
    for (const [after,before] of pairs) for (const changed of [
      source.replace(after,before),
      source.replace(after,after+'\n<p>unapproved</p>'),
      source.replace(after,after+'\n'+after),
      source.replace(after,'').replace('</body>',after+'\n</body>'),
    ]) {
      assert.notEqual(changed,source);
      assert.throws(()=>assert.equal(normalizeApprovedToolFinish(changed,name,false),approvedBaseline));
    }
    for (const changed of [source.replace('name="robots"','name="wrong-robots"'),source.replace('rel="canonical"','rel="wrong-canonical"'),source.replace('</body>','<script>unapproved()</script></body>')]) {
      assert.notEqual(changed,source);
      assert.throws(()=>assert.equal(normalizeApprovedToolFinish(changed,name,false),approvedBaseline));
    }
  }
});

test('PSA finishing restores the immutable full document with only the approved cost-help correction',()=>{
  const file='tools/psa-grading-break-even.html';
  const snapshot=execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/').replace(/\/$/,''),'show','49168b908b023ca934f574e7f7f1dcc68569dfe9:'+file],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
  const oldHelp='에서 등급료를 확인한 뒤 배송·보험료를 더해 입력하세요.';
  const newHelp='에서 등급료만 확인해 입력하세요. 대행 수수료와 왕복 배송·보험료는 아래 별도 칸에 입력합니다.';
  assert.equal(snapshot.split(oldHelp).length-1,1);
  assert.equal(normalizeApprovedToolFinish(read(file),'psa-grading-break-even'),snapshot.replace(oldHelp,newHelp));
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
  test(file+' keeps its approved production policy/data/advertising baseline',()=>assert.equal(restoreGrowthSearch(read(file),file),original(file)));
}

test('growth20 result exceptions reject moved, duplicated, altered panels and unrelated formula/SEO drift',()=>{
  for(const name of Object.keys(growthToolProof)){
    const source=read('tools/'+name+'.html');
    restoreGrowthTool(source,name);
    const panel=source.match(/    <!-- calculator-results start: [a-z]+ -->[\s\S]*?    <!-- calculator-results end: [a-z]+ -->\n/)[0];
    for(const changed of [
      source.replace(panel,panel+panel),
      source.replace(panel,'').replace('</body>',panel+'</body>'),
      source.replace('입력값·계산 결과 복사','unapproved result text'),
      source.replace(growthToolAssets,'').replace('<head>','<head>\n'+growthToolAssets),
      source.replace('rel="canonical"','rel="unapproved"'),
      source.replace('</body>','<script>unapproved()</script></body>'),
    ]){assert.notEqual(changed,source);assert.throws(()=>restoreGrowthTool(changed,name));}
  }
});
test('growth20 query-policy exceptions retain immutable legacy source and reject planner tampering',()=>{
  const source=read('search-query.mjs');
  for(const changed of [source+'\nexport const unapproved=true;\n',source.replace('CARDPICK_SEARCH_INTENT_START','unapproved-start'),source.replace('result.queryTokens = [];',"result.queryTokens = ['pikachu'];")]){
    assert.notEqual(changed,source);assert.throws(()=>restoreGrowthSearch(changed,'search-query.mjs'));
  }
});
test('growth22 PNG exceptions reject altered, duplicate, moved blocks and A-label or SEO drift',()=>{
  for(const name of Object.keys(growthToolProof)){
    const source=read('tools/'+name+'.html'),baseline=restoreGrowthTool(source,name);
    const button=source.match(/        <!-- calculator-png button start -->\n[\s\S]*?        <!-- calculator-png button end -->\n/)[0];
    const fallback=source.match(/      <!-- calculator-png fallback start -->\n[\s\S]*?      <!-- calculator-png fallback end -->\n/)[0];
    for(const changed of [
      source.replace(button,button+button),
      source.replace(button,button.replace('PNG 저장','PNG 외부 전송')),
      source.replace(button,'').replace('      <!-- calculator-png fallback start -->',button+'      <!-- calculator-png fallback start -->'),
      source.replace(fallback,'').replace('</body>',fallback+'</body>'),
      source.replace(fallback,fallback.replace('브라우저','외부 서버')),
      source.replace('복사·저장할 내용에 조건 A도 포함','자동 저장'),
      source.replace('rel="canonical"','rel="unapproved"'),
    ]){
      assert.notEqual(changed,source);
      assert.throws(()=>assert.equal(restoreGrowthTool(changed,name),baseline));
    }
  }
});
