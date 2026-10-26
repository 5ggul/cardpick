// Reviewed search/compare14 fragments only; preserve every earlier hash and growth17 pair.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {restoreToolsHubPerformance} from './test-tools-hub-performance.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
export const searchComparePairs={
  "functions/search.js": [
    [
      "// 필터: q=검색어, has_price=1, sort=recent|up_7d|up_30d\nimport { planSearchQuery, identityFilterEntries, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-identity.mjs';\n\n",
      "// 필터: q=검색어, has_price=1, sort=recent|up_7d|up_30d\nimport { planSearchQuery, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-query.mjs';\n\n"
    ],
    [
      "  const url = new URL(context.request.url);\n  const searchPlan = planSearchQuery(url.searchParams.get('q') || '');\n  const { original: q, queryNormalized: normalized, queryTokens: tokens, hasGradingIntent, canSearch, identityError, hasIdentityFilters } = searchPlan;\n  const hasPrice = url.searchParams.get('has_price') === '1';\n",
      "  const url = new URL(context.request.url);\n  const { original: q, queryNormalized: normalized, queryTokens: tokens, hasGradingIntent } = planSearchQuery(url.searchParams.get('q') || '');\n  const hasPrice = url.searchParams.get('has_price') === '1';\n"
    ],
    [
      "\n  if (canSearch) {\n    try {\n      const ilikeFilters = tokens.map(t => `search_text=ilike.${encodeURIComponent('%' + escapeSearchToken(t) + '%')}`).join('&');\n      const exactFilters = identityFilterEntries(searchPlan).map(([field,value]) => `${field}=ilike.${encodeURIComponent(value)}`).join('&');\n      const filters = [ilikeFilters, exactFilters].filter(Boolean).join('&');\n\n      // 카드 fetch (포켓몬만, RLS 적용)\n      const rawCards = await fetchRows(`cards?select=slug,name,name_en,name_ko,game,set_name,set_code,number,rarity_class,popularity_rank,external_id&game=eq.pokemon&${filters}&limit=200`);\n      totalCount = rawCards.length;\n",
      "\n  if (tokens.length > 0) {\n    try {\n      const ilikeFilters = tokens.map(t => `search_text=ilike.${encodeURIComponent('%' + escapeSearchToken(t) + '%')}`).join('&');\n\n      // 카드 fetch (포켓몬만, RLS 적용)\n      const rawCards = await fetchRows(`cards?select=slug,name,name_en,name_ko,game,set_name,set_code,number,rarity_class,popularity_rank,external_id&game=eq.pokemon&${ilikeFilters}&limit=200`);\n      totalCount = rawCards.length;\n"
    ],
    [
      "  };\n  const isEmptySearch = canSearch && !queryError && matchedCardCount === 0;\n  const isFilteredEmpty = hasPrice && matchedCardCount > 0 && cards.length === 0;\n  const reportSearch = canSearch && !queryError && !partialDataError && !isFilteredEmpty && allowSearchWrites\n    && !(hasIdentityFilters && matchedCardCount === 0);\n  const reachedCandidateLimit = !queryError && matchedCardCount >= 200;\n",
      "  };\n  const isEmptySearch = tokens.length > 0 && !queryError && matchedCardCount === 0;\n  const isFilteredEmpty = hasPrice && matchedCardCount > 0 && cards.length === 0;\n  const reportSearch = tokens.length > 0 && !queryError && !partialDataError && !isFilteredEmpty && allowSearchWrites;\n  const reachedCandidateLimit = !queryError && matchedCardCount >= 200;\n"
    ],
    [
      "<link rel=\"stylesheet\" href=\"/styles/search-base.css?v=20261012\">\n<link rel=\"stylesheet\" href=\"/styles/card-compare.css?v=20261020\">\n<link rel=\"stylesheet\" href=\"/styles/releases-fonts.css\" media=\"print\" onload=\"this.media='all'\">\n",
      "<link rel=\"stylesheet\" href=\"/styles/search-base.css?v=20261012\">\n<link rel=\"stylesheet\" href=\"/styles/releases-fonts.css\" media=\"print\" onload=\"this.media='all'\">\n"
    ],
    [
      "<main class=\"max-w-[1280px] mx-auto px-5 lg:px-8 py-8\">\n  ${!hasGradingIntent ? `\n  <form id=\"cp-search-identity-form\" class=\"cp-search-identity-form\" action=\"/search\" method=\"get\" hidden aria-labelledby=\"cp-search-identity-title\">\n    <h2 id=\"cp-search-identity-title\">번호·세트로 좁히기</h2>\n    <div class=\"cp-search-identity-fields\">\n      <div class=\"cp-search-identity-field\"><label for=\"cp-identity-query\">카드명·검색어</label><input id=\"cp-identity-query\" name=\"q\" type=\"search\" maxlength=\"80\" value=\"${esc(searchPlan.freeQuery)}\"></div>\n      <div class=\"cp-search-identity-field\"><label for=\"cp-identity-set-code\">세트 코드</label><input id=\"cp-identity-set-code\" type=\"text\" maxlength=\"24\" value=\"${esc(searchPlan.identity.set_code || '')}\" autocomplete=\"off\" aria-describedby=\"cp-identity-help\"></div>\n      <div class=\"cp-search-identity-field\"><label for=\"cp-identity-set-id\">세트 ID</label><input id=\"cp-identity-set-id\" type=\"text\" maxlength=\"24\" value=\"${esc(searchPlan.identity.set_id || '')}\" autocomplete=\"off\" aria-describedby=\"cp-identity-help\"></div>\n      <div class=\"cp-search-identity-field\"><label for=\"cp-identity-number\">카드 번호</label><input id=\"cp-identity-number\" type=\"text\" maxlength=\"25\" value=\"${esc(searchPlan.identity.number || '')}\" autocomplete=\"off\" aria-describedby=\"cp-identity-help\"></div>\n    </div>\n    <p id=\"cp-identity-help\">카드에 적힌 번호를 그대로 입력하세요. 분모·앞자리 0·문자는 생략하지 않습니다. 세트 코드와 ID는 서로 다른 조건입니다.</p>\n    <button type=\"submit\">조건으로 검색</button>\n    <p id=\"cp-identity-form-error\" class=\"cp-search-identity-error\" role=\"alert\" hidden></p>\n  </form>\n  <script>\n  (function(){\n    var form=document.getElementById('cp-search-identity-form');\n    if(!form)return;\n    var submitting=false;\n    form.addEventListener('submit',function(event){\n      event.preventDefault();\n      if(submitting)return;\n      var error=document.getElementById('cp-identity-form-error');\n      var button=form.querySelector('button[type=\"submit\"]');\n      var timer;\n      submitting=true;error.hidden=true;button.disabled=true;\n      var deadline=new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error('identity_form_timeout'));},6000);});\n      var prepared=import('/search-identity.mjs?v=20261020').then(function(policy){\n        return policy.serializeIdentityQuery({query:document.getElementById('cp-identity-query').value,\n          set_code:document.getElementById('cp-identity-set-code').value,set_id:document.getElementById('cp-identity-set-id').value,\n          number:document.getElementById('cp-identity-number').value});\n      });\n      Promise.race([prepared,deadline]).then(function(result){\n        if(result.error){error.textContent=result.error;error.hidden=false;return;}\n        var target=new URL('/search',location.origin);target.searchParams.set('q',result.query);\n        var current=new URL(location.href);['has_price','sort'].forEach(function(key){if(current.searchParams.has(key))target.searchParams.set(key,current.searchParams.get(key));});\n        location.href=target.pathname+target.search;\n      }).catch(function(){error.textContent='검색 조건을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';error.hidden=false;})\n        .finally(function(){clearTimeout(timer);submitting=false;button.disabled=false;});\n    });\n    form.hidden=false;\n  })();\n  </script>\n  <noscript><p class=\"cp-search-identity-summary\">상단 검색창에서 #번호, set:세트코드, id:세트ID 조건을 함께 입력할 수 있습니다. 카드 비교는 JavaScript를 켜야 사용할 수 있습니다.</p></noscript>\n  ${hasIdentityFilters && !identityError ? `<p class=\"cp-search-identity-summary\" data-search-identity-conditions>적용한 조건: ${searchPlan.identityConditions.map(item => esc(item.label)+ ' ' +esc(item.value)).join(' · ')}. 번호의 분모나 언어판을 추정해 다른 카드로 연결하지 않습니다.</p>` : ''}\n  ` : ''}\n  ${q ? `\n",
      "<main class=\"max-w-[1280px] mx-auto px-5 lg:px-8 py-8\">\n  ${q ? `\n"
    ],
    [
      "      <h1 class=\"text-[24px] font-bold mb-1\">${esc(q)}</h1>\n      <p class=\"text-[13px] text-muted\">${hasGradingIntent ? '그레이딩 검색 안내' : (queryError ? '검색 결과를 불러오지 못했습니다.' : (!canSearch ? '검색어 확인 필요' : resultCountLabel))}</p>\n      ${reachedCandidateLimit ? '<p data-search-candidate-limit class=\"text-[13px] text-muted mt-2\">검색 결과는 최대 200장을 조회해 필터·정렬합니다. 표시된 건수와 순위는 조회한 카드 기준입니다.</p>' : ''}\n",
      "      <h1 class=\"text-[24px] font-bold mb-1\">${esc(q)}</h1>\n      <p class=\"text-[13px] text-muted\">${hasGradingIntent ? '그레이딩 검색 안내' : (queryError ? '검색 결과를 불러오지 못했습니다.' : (!tokens.length ? '검색어 확인 필요' : resultCountLabel))}</p>\n      ${reachedCandidateLimit ? '<p data-search-candidate-limit class=\"text-[13px] text-muted mt-2\">검색 결과는 최대 200장을 조회해 필터·정렬합니다. 표시된 건수와 순위는 조회한 카드 기준입니다.</p>' : ''}\n"
    ],
    [
      "      </div>\n    ` : identityError ? `\n      <div class=\"cp-search-identity-error\" role=\"alert\"><p>${esc(identityError)}</p><p>조건을 수정해 다시 검색해 주세요. 입력한 조건을 빼고 다른 카드를 대신 검색하지 않습니다.</p></div>\n    ` : queryError ? `\n",
      "      </div>\n    ` : queryError ? `\n"
    ],
    [
      "        ${cards.map(c => `\n          <div class=\"cp-search-result-row\">\n          <a href=\"/cards/${esc(c.slug)}\" class=\"cp-search-card-link flex items-center gap-4 px-4 py-3 hover:bg-panel2 transition\">\n            <div class=\"flex-1 min-w-0\">\n",
      "        ${cards.map(c => `\n          <a href=\"/cards/${esc(c.slug)}\" class=\"flex items-center gap-4 px-4 py-3 hover:bg-panel2 transition\">\n            <div class=\"flex-1 min-w-0\">\n"
    ],
    [
      "          </a>\n          <button type=\"button\" class=\"cp-compare-add\" data-cp-compare-add=\"${esc(c.slug)}\" hidden aria-pressed=\"false\" aria-label=\"${esc(c.name_ko || c.name)} 비교에 추가\">비교에 추가</button>\n          </div>\n        `).join('')}\n",
      "          </a>\n        `).join('')}\n"
    ],
    [
      "      <div class=\"border hairline panel p-8 text-center\">\n        <p class=\"text-[14px] text-muted\">${!canSearch ? '검색할 카드명·세트 코드·번호를 입력해 주세요.' : (isEmptySearch ? '검색어와 일치하는 카드를 찾지 못했습니다.' : (reachedCandidateLimit ? '조회한 카드 중에서는 선택한 조건에 맞는 카드가 없습니다.' : '선택한 조건에 맞는 카드가 없습니다.'))}</p>\n        <p class=\"mono text-[11px] text-muted mt-2\">${!canSearch ? '예: 코코리, Mewtwo ex, SSP, 205' : (isEmptySearch ? (hasIdentityFilters ? '번호·세트 조건을 그대로 적용한 결과입니다. 분모가 저장되지 않은 카드는 일치한다고 판단하지 않습니다. 조건을 확인하거나 직접 수정해 주세요.' : '카드명·세트 코드·번호를 확인하거나 영문명으로도 검색해 보세요.') : '가격 정보 있음 조건을 해제하거나 검색 조건을 바꿔 보세요.')}</p>\n        ${canSearch && !isEmptySearch && hasPrice ? `<a href=\"/search${esc(baseQs({has_price:''}))}\" class=\"inline-block text-[13px] text-up mt-3\">가격 조건 해제</a>` : ''}\n      </div>\n",
      "      <div class=\"border hairline panel p-8 text-center\">\n        <p class=\"text-[14px] text-muted\">${!tokens.length ? '검색할 카드명·세트 코드·번호를 입력해 주세요.' : (isEmptySearch ? '검색어와 일치하는 카드를 찾지 못했습니다.' : (reachedCandidateLimit ? '조회한 카드 중에서는 선택한 조건에 맞는 카드가 없습니다.' : '선택한 조건에 맞는 카드가 없습니다.'))}</p>\n        <p class=\"mono text-[11px] text-muted mt-2\">${!tokens.length ? '예: 코코리, Mewtwo ex, SSP, 205' : (isEmptySearch ? '카드명·세트 코드·번호를 확인하거나 영문명으로도 검색해 보세요.' : '가격 정보 있음 조건을 해제하거나 검색 조건을 바꿔 보세요.')}</p>\n        ${tokens.length && !isEmptySearch && hasPrice ? `<a href=\"/search${esc(baseQs({has_price:''}))}\" class=\"inline-block text-[13px] text-up mt-3\">가격 조건 해제</a>` : ''}\n      </div>\n"
    ],
    [
      "\n  ${!hasGradingIntent ? `\n  <section id=\"card-compare\" class=\"cp-card-compare\" data-cp-card-compare hidden aria-labelledby=\"card-compare-title\">\n    <h2 id=\"card-compare-title\">카드 비교</h2>\n    <p>선택한 두 카드의 식별 정보와 해외 참고가를 비교합니다. 언어판·상태가 다르면 같은 거래가격으로 볼 수 없습니다.</p>\n    <p data-cp-compare-status role=\"status\" aria-live=\"polite\"></p>\n    <div data-cp-compare-slots></div>\n    <button type=\"button\" data-cp-compare-clear>비교 비우기</button>\n  </section>\n  <script defer src=\"/js/cp-card-compare.js?v=20261020\"></script>\n  ` : ''}\n  <div class=\"mt-10 panel p-5 text-[11px] text-muted leading-relaxed\">\n",
      "\n  <div class=\"mt-10 panel p-5 text-[11px] text-muted leading-relaxed\">\n"
    ]
  ],
  "search.js": [
    [
      "    if (!policyPromise) {\n      policyPromise = import('/search-identity.mjs?v=20261020').catch(function (error) {\n        policyPromise = null; throw error;\n",
      "    if (!policyPromise) {\n      policyPromise = import('/search-query.mjs?v=20261015').catch(function (error) {\n        policyPromise = null; throw error;\n"
    ],
    [
      "    }\n    function render(rows, totalCount, partial, candidateCount, identityConditions) {\n      if (!rows.length) return notice(identityConditions && identityConditions.length\n        ? '입력한 번호·세트 조건과 일치하는 카드가 없습니다. 분모를 생략하거나 다른 카드로 대신 연결하지 않습니다.'\n        : '검색 결과가 없습니다. 카드명·세트 코드·번호를 다시 확인해 주세요.');\n      var countLabel = totalCount == null ? '표시 ' + rows.length + '장' : '총 ' + totalCount + '건';\n",
      "    }\n    function render(rows, totalCount, partial, candidateCount) {\n      if (!rows.length) return notice('검색 결과가 없습니다. 카드명·세트 코드·번호를 다시 확인해 주세요.');\n      var countLabel = totalCount == null ? '표시 ' + rows.length + '장' : '총 ' + totalCount + '건';\n"
    ],
    [
      "      box.innerHTML = '<div style=\"padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.06);background:#0A0F17;font-size:11px;color:#8B96A8;display:flex;justify-content:space-between\"><span>' + countLabel + '</span><span>' + extra + '</span></div>'\n        + (identityConditions && identityConditions.length ? '<div data-search-identity-conditions style=\"padding:10px 16px;color:#8B96A8;font-size:11px\">적용한 조건: ' + identityConditions.map(function (item) { return escapeHtml(item.label + ' ' + item.value); }).join(' · ') + '</div>' : '')\n        + (candidateCount >= 200 ? '<div data-search-candidate-limit style=\"padding:10px 16px;color:#8B96A8;font-size:11px\">최대 200장을 조회해 정렬합니다. 표시 순서는 조회한 카드 기준입니다.</div>' : '')\n",
      "      box.innerHTML = '<div style=\"padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.06);background:#0A0F17;font-size:11px;color:#8B96A8;display:flex;justify-content:space-between\"><span>' + countLabel + '</span><span>' + extra + '</span></div>'\n        + (candidateCount >= 200 ? '<div data-search-candidate-limit style=\"padding:10px 16px;color:#8B96A8;font-size:11px\">최대 200장을 조회해 정렬합니다. 표시 순서는 조회한 카드 기준입니다.</div>' : '')\n"
    ],
    [
      "        if (queryText.hasGradingIntent) { gradingNotice(); return; }\n        if (queryText.identityError) { notice(queryText.identityError); return; }\n        if (!queryText.canSearch) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }\n        var client = await bounded(waitClient());\n",
      "        if (queryText.hasGradingIntent) { gradingNotice(); return; }\n        if (!queryText.queryTokens.length) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }\n        var client = await bounded(waitClient());\n"
    ],
    [
      "          });\n          policy.identityFilterEntries(queryText).forEach(function (entry) {\n            query = query.ilike(entry[0], entry[1]);\n          });\n          return query.abortSignal(active.signal);\n",
      "          });\n          return query.abortSignal(active.signal);\n"
    ],
    [
      "        var count = queries[0].error ? null : queries[0].count;\n        if (!cards.length) { render([], 0, false, 0, queryText.identityConditions); return; }\n        var trustResult;\n",
      "        var count = queries[0].error ? null : queries[0].count;\n        if (!cards.length) { render([], 0, false); return; }\n        var trustResult;\n"
    ],
    [
      "        });\n        render(cards, count, partial, queries[1].data.length, queryText.identityConditions);\n        // Local QA never writes production search logs or update requests.\n",
      "        });\n        render(cards, count, partial, queries[1].data.length);\n        // Local QA never writes production search logs or update requests.\n"
    ]
  ],
  "tools.html": [
    [
      "      <p>→ <a href=\"/guides\">가이드 허브 전체 보기</a></p>\n      <p>→ <a href=\"/search#card-compare\">카드 검색에서 두 카드의 식별 정보·해외 참고가 비교</a></p>\n    </div>\n",
      "      <p>→ <a href=\"/guides\">가이드 허브 전체 보기</a></p>\n    </div>\n"
    ]
  ]
};
const checkpointDigests={
  "functions/search.js": "923d0817ba40d4e9804d089e1af0b7793a5383dd7c77c8123e6e3c72910b7953",
  "search.js": "a790244401cf9b68de90efebbf775d9c48a14cb00631b124be9c53562930cbe9",
  "tools.html": "b553fe01ae7682717ce1b194d1dc212a95fe6b3170c7a5d36f07c2eb262aceef"
};
export const searchUsability24Pairs=[
  [
    "\n  const compareShortcut = !hasGradingIntent ? `<div class=\"cp-compare-shortcut\" data-cp-compare-shortcut hidden><span data-cp-compare-count>0/2장 선택</span><a href=\"#card-compare\" data-cp-compare-jump>비교 보기</a></div>` : '';\n  const html = `<!doctype html>\n",
    "\n  const html = `<!doctype html>\n"
  ],
  [
    "<link rel=\"stylesheet\" href=\"/styles/search-base.css?v=20261012\">\n<link rel=\"stylesheet\" href=\"/styles/card-compare.css?v=20261024\">\n<link rel=\"stylesheet\" href=\"/styles/releases-fonts.css\" media=\"print\" onload=\"this.media='all'\">\n",
    "<link rel=\"stylesheet\" href=\"/styles/search-base.css?v=20261012\">\n<link rel=\"stylesheet\" href=\"/styles/card-compare.css?v=20261020\">\n<link rel=\"stylesheet\" href=\"/styles/releases-fonts.css\" media=\"print\" onload=\"this.media='all'\">\n"
  ],
  [
    "    </div>\n    ${compareShortcut}\n    <div class=\"flex flex-wrap gap-2 mb-6\">\n",
    "    </div>\n    <div class=\"flex flex-wrap gap-2 mb-6\">\n"
  ],
  [
    "    </div>\n    ${compareShortcut}\n  `}\n",
    "    </div>\n  `}\n"
  ],
  [
    "  </section>\n  <script defer src=\"/js/cp-card-compare.js?v=20261024\"></script>\n  ` : ''}\n",
    "  </section>\n  <script defer src=\"/js/cp-card-compare.js?v=20261020\"></script>\n  ` : ''}\n"
  ]
];
const searchUsability24Digest="f8d7d943e62ad66a966b451e9fab2ae23462322c6e32c8efcc7f72d78c5f422e";
export function restoreSearchUsability24(source,file){
  if(file==='tools.html')return restoreToolsHubPerformance(source);
  if(file!=='functions/search.js')return source;
  let value=source;
  for(const [after,before] of searchUsability24Pairs){assert.equal(value.split(after).length-1,1,'one exact approved search24 fragment');value=value.replace(after,before);}
  assert.equal(hash(value),searchUsability24Digest,'entire search source equals immutable pre24 checkpoint');
  return value;
}
export function restoreSearchCompare(source,file){return restoreLegacySearchCompare(restoreSearchUsability24(source,file),file);}
function restoreLegacySearchCompare(source,file){
  let value=source;
  for(const [after,before] of searchComparePairs[file]||[]){assert.equal(value.split(after).length-1,1,'one exact approved search/compare fragment: '+file);value=value.replace(after,before);}
  if(Object.hasOwn(checkpointDigests,file))assert.equal(hash(value),checkpointDigests[file],'full source equals pre14 checkpoint: '+file);
  return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  for(const file of Object.keys(searchComparePairs)){
    test(file+' restores the entire current17 checkpoint, not a changed old baseline',()=>assert.equal(hash(restoreSearchCompare(read(file),file)),checkpointDigests[file]));
    test(file+' rejects fragment tampering, duplicates, removal, movement and unrelated edits',()=>{
      const source=restoreSearchUsability24(read(file),file);
      for(const [after] of searchComparePairs[file])for(const changed of [source.replace(after,after+'unapproved\n'),source.replace(after,after+after),source.replace(after,''),source.replace(after,'')+after]){assert.notEqual(changed,source);assert.throws(()=>restoreLegacySearchCompare(changed,file));}
      for(const changed of [source+'\n<!-- unapproved -->',source.replace('rel="canonical"','rel="unapproved"'),source.replace('noindex,follow','index,follow'),source.replace('data-ad-slot="','data-unapproved="')])if(changed!==source)assert.throws(()=>restoreLegacySearchCompare(changed,file));
    });
  }
  test('search24 inverse preserves the complete e35934fa source and rejects new-fragment or unrelated tampering',()=>{
    const source=read('functions/search.js');
    assert.equal(hash(restoreSearchUsability24(source,'functions/search.js')),searchUsability24Digest);
    for(const [after] of searchUsability24Pairs)for(const changed of [source.replace(after,after+'unapproved\n'),source.replace(after,after+after),source.replace(after,''),source.replace(after,'')+after]){assert.notEqual(changed,source);assert.throws(()=>restoreSearchUsability24(changed,'functions/search.js'));}
    for(const [from,to] of [['rel="canonical"','rel="unapproved"'],['noindex,follow','index,follow']]){const changed=source.replace(from,to);assert.notEqual(changed,source);assert.throws(()=>restoreSearchUsability24(changed,'functions/search.js'));}
    assert.throws(()=>restoreSearchUsability24(source+'\n<!-- unapproved -->','functions/search.js'));
  });
}
