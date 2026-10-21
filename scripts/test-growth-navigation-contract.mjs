// Exact inverse of the reviewed growth17 fragments only. Old body/SEO/price hashes stay unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {restoreSearchCompare} from './test-search-compare-contract.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const base='3050534ec05860d32f67be6014a662ec7aff13e0';
const before=file=>execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/').replace(/\/$/,''),'show',base+':'+file],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
export const growth17Pairs={
  "index.html": [
    [
      "    <div class=\"panel-foot\" style=\"font-size:11.5px;color:var(--dim);padding:10px 16px\">\n      로그인 없이 이 브라우저에 저장됩니다. 확인 당시 참고가이며, 가격 기준일과 조회일은 별개입니다. 최신 값은 카드 상세에서 확인하세요. 브라우저 데이터 삭제 시 기록도 사라집니다.\n    </div>\n",
      "    <div class=\"panel-foot\" style=\"font-size:11.5px;color:var(--dim);padding:10px 16px\">\n      이 브라우저에서 최근 열어본 카드. 로그인 없이 저장되며 브라우저 데이터 삭제 시 사라집니다.\n    </div>\n"
    ],
    [
      "      <span class=\"ttl\">포켓몬 카드 레어도 정리: SAR · SIR · UR · HR</span>\n      <span class=\"sum\">언어판·시리즈별 레어도 표기와 일본판 MEGA의 MUR·MA를 구분하고, 코드별 설명을 확인하는 레어도 도우미.</span>\n      <span class=\"meta\"><span>2026-05-24 · 11분</span><span>가이드 →</span></span>\n",
      "      <span class=\"ttl\">포켓몬 카드 레어도 정리: SAR · SIR · UR · HR</span>\n      <span class=\"sum\">SAR · SIR · UR · HR · IR · AR · RR 등급별 가격 차이, 카드 표기 식별법, SV 시리즈 신규 등급까지.</span>\n      <span class=\"meta\"><span>2026-05-24 · 11분</span><span>가이드 →</span></span>\n"
    ],
    [
      "  var KEY = 'cardpick:recently_viewed';\n  function text(value){ return typeof value === 'string' ? value.slice(0, 500) : ''; }\n  function priceDate(value){\n    if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return null;\n    var day = new Date(value.slice(0, 10) + 'T00:00:00Z');\n    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10) ? value : null;\n  }\n  function read(){\n    try {\n      var list = JSON.parse(localStorage.getItem(KEY) || '[]');\n      if (!Array.isArray(list)) return [];\n      var seen = Object.create(null);\n      return list.filter(function(it){\n        if (!it || typeof it !== 'object' || Array.isArray(it) || typeof it.slug !== 'string' || !it.slug || it.slug === '.' || it.slug === '..' || it.slug.length > 240 || /[\\/\\\\?#\\s\\u0000-\\u001f\\u007f]/.test(it.slug) || !text(it.name).trim() || seen[it.slug]) return false;\n        seen[it.slug] = true; return true;\n      }).slice(0, 20).map(function(it){\n        var hasBasis = (it.price_basis === 'latest' && it.price_trust_level === 'HIGH') || (it.price_basis === 'median30d' && ['MEDIUM','LOW'].indexOf(it.price_trust_level) !== -1);\n        return { slug:it.slug, name:text(it.name), name_ko:text(it.name_ko), set_name:text(it.set_name), number:text(it.number), rarity:text(it.rarity),\n          krw:typeof it.krw === 'number' && Number.isSafeInteger(it.krw) && it.krw > 0 ? it.krw : null,\n          viewed_at:priceDate(it.viewed_at), price_basis:hasBasis ? it.price_basis : null,\n          price_source_date:hasBasis ? priceDate(it.price_source_date) : null, price_trust_level:hasBasis ? it.price_trust_level : null };\n      });\n    } catch(e){ return []; }\n  }\n  function write(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch(e){} }\n",
      "  var KEY = 'cardpick:recently_viewed';\n  function read(){ try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e){ return []; } }\n  function write(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch(e){} }\n"
    ],
    [
      "      var setLabel = [esc(it.set_name), esc(it.number)].filter(Boolean).join(' · ');\n      var priceLabel = it.krw ? '<span style=\"display:block;font-size:10px;color:#8B96A8\">확인 당시 참고가</span>₩'+it.krw.toLocaleString('ko-KR') : '<span style=\"color:#8B96A8\">가격 없음</span>';\n      var priceInfo = it.krw ? '가격 기준일 ' + (it.price_source_date ? it.price_source_date.slice(0,10).replace(/-/g,'.') : '미기록')\n        + ' · ' + (it.price_basis === 'median30d' ? '30일 중앙값' : it.price_basis === 'latest' ? '해외 참고가' : '산출 기준 미기록')\n        + (it.price_trust_level === 'LOW' ? ' · 표본 부족' : '') : '';\n      return '<li style=\"display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid var(--line)\">'\n        + '<span style=\"font-family:var(--mono);font-size:11px;color:#5B6577;width:22px;text-align:right\">'+(String(i+1).padStart(2,\"0\"))+'</span>'\n        + '<span style=\"font-family:var(--mono);font-size:10px;color:'+col+';border:1px solid '+col+';padding:1px 6px;letter-spacing:.04em;flex:none\">'+esc(rar||'—')+'</span>'\n        + '<a href=\"/cards/'+encodeURIComponent(it.slug)+'\" style=\"flex:1 1 120px;min-width:0;color:inherit;text-decoration:none;overflow:hidden\">'\n        +   '<div style=\"font-size:13.5px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">'+esc(it.name)+koLabel+'</div>'\n        +   '<div style=\"font-size:11px;color:#8B96A8;font-family:var(--mono);margin-top:2px;letter-spacing:.02em\">'+setLabel+'</div>'\n        +   (priceInfo ? '<div style=\"font-size:11px;color:#8B96A8;margin-top:3px;line-height:1.5\">'+esc(priceInfo)+'</div>' : '')\n        + '</a>'\n        + '<span style=\"display:inline-flex;align-items:center;gap:14px;margin-left:auto\">'\n        +   '<span style=\"font-family:var(--mono);font-size:13px;color:var(--fg);text-align:right;white-space:nowrap\">'+priceLabel+'</span>'\n        +   '<button type=\"button\" data-hrv-remove=\"'+esc(it.slug)+'\" aria-label=\"삭제\" style=\"background:transparent;border:1px solid var(--line);color:#5B6577;padding:4px 8px;border-radius:2px;font-size:11px;cursor:pointer;flex:none\">✕</button>'\n        + '</span>'\n        + '</li>';\n",
      "      var setLabel = [esc(it.set_name), esc(it.number)].filter(Boolean).join(' · ');\n      var priceLabel = it.krw ? '₩'+it.krw.toLocaleString('ko-KR') : '<span style=\"color:#5B6577\">가격 없음</span>';\n      return '<li style=\"display:flex;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid var(--line)\">'\n        + '<span style=\"font-family:var(--mono);font-size:11px;color:#5B6577;width:22px;text-align:right\">'+(String(i+1).padStart(2,\"0\"))+'</span>'\n        + '<span style=\"font-family:var(--mono);font-size:10px;color:'+col+';border:1px solid '+col+';padding:1px 6px;letter-spacing:.04em;flex:none\">'+esc(rar||'—')+'</span>'\n        + '<a href=\"/cards/'+encodeURIComponent(it.slug)+'\" style=\"flex:1;min-width:0;color:inherit;text-decoration:none;overflow:hidden\">'\n        +   '<div style=\"font-size:13.5px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">'+esc(it.name)+koLabel+'</div>'\n        +   '<div style=\"font-size:11px;color:#8B96A8;font-family:var(--mono);margin-top:2px;letter-spacing:.02em\">'+setLabel+'</div>'\n        + '</a>'\n        + '<span style=\"font-family:var(--mono);font-size:13px;color:var(--fg);text-align:right;white-space:nowrap\">'+priceLabel+'</span>'\n        + '<button type=\"button\" data-hrv-remove=\"'+esc(it.slug)+'\" aria-label=\"삭제\" style=\"background:transparent;border:1px solid var(--line);color:#5B6577;padding:4px 8px;border-radius:2px;font-size:11px;cursor:pointer;flex:none\">✕</button>'\n        + '</li>';\n"
    ]
  ],
  "card-detail.html": [
    [
      "      <h2 class=\"h2 text-[22px] lg:text-[26px]\">최근 본 카드</h2>\n      <p class=\"mt-1 text-[12.5px] text-muted\">로그인 없이 이 브라우저에 저장됩니다. 확인 당시 참고가이며, 가격 기준일과 조회일은 별개입니다. 최신 값은 카드 상세에서 확인하세요.</p>\n    </div>\n",
      "      <h2 class=\"h2 text-[22px] lg:text-[26px]\">최근 본 카드</h2>\n      <p class=\"mt-1 text-[12.5px] text-muted\">이 브라우저에서 최근 열어본 카드 (로그인 불필요)</p>\n    </div>\n"
    ],
    [
      "  var MAX = 20;\n  function text(value){ return typeof value === 'string' ? value.slice(0, 500) : ''; }\n  function validSlug(value){ return typeof value === 'string' && value.length > 0 && value.length <= 240 && value !== '.' && value !== '..' && !/[\\/\\\\?#\\s\\u0000-\\u001f\\u007f]/.test(value); }\n  function priceDate(value){\n    if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return null;\n    var day = new Date(value.slice(0, 10) + 'T00:00:00Z');\n    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10) ? value : null;\n  }\n  function read(){\n    try {\n      var list = JSON.parse(localStorage.getItem(KEY) || '[]');\n      if (!Array.isArray(list)) return [];\n      var seen = Object.create(null);\n      return list.filter(function(it){\n        if (!it || typeof it !== 'object' || Array.isArray(it) || !validSlug(it.slug) || !text(it.name).trim() || seen[it.slug]) return false;\n        seen[it.slug] = true; return true;\n      }).slice(0, MAX).map(function(it){\n        var hasBasis = (it.price_basis === 'latest' && it.price_trust_level === 'HIGH') || (it.price_basis === 'median30d' && ['MEDIUM','LOW'].indexOf(it.price_trust_level) !== -1);\n        return { slug:it.slug, name:text(it.name), name_ko:text(it.name_ko), set_name:text(it.set_name), number:text(it.number), rarity:text(it.rarity),\n          krw:typeof it.krw === 'number' && Number.isSafeInteger(it.krw) && it.krw > 0 ? it.krw : null,\n          viewed_at:priceDate(it.viewed_at), price_basis:hasBasis ? it.price_basis : null,\n          price_source_date:hasBasis ? priceDate(it.price_source_date) : null, price_trust_level:hasBasis ? it.price_trust_level : null };\n      });\n    } catch(e){ return []; }\n  }\n  function write(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch(e){} }\n",
      "  var MAX = 20;\n  function read(){ try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e){ return []; } }\n  function write(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch(e){} }\n"
    ],
    [
      "    var b = window.CARDPICK_BEST || {};\n    var d = window.CARDPICK_PRICE_DISPLAY || b.price_display || {};\n    var slug = c.slug || (location.pathname.match(/\\/cards?\\/([^\\/?]+)/) || [])[1];\n    if (!validSlug(slug) || !text(c.name).trim()) return;\n    var hasPrice = Number.isSafeInteger(d.amountKrw) && d.amountKrw > 0\n      && ((d.basis === 'latest' && d.trustLevel === 'HIGH') || (d.basis === 'median30d' && ['MEDIUM','LOW'].indexOf(d.trustLevel) !== -1));\n    var list = read().filter(function(x){ return x.slug !== slug; });\n",
      "    var b = window.CARDPICK_BEST || {};\n    var slug = c.slug || (location.pathname.match(/\\/cards?\\/([^\\/?]+)/) || [])[1];\n    if (!slug || !c.name) return;\n    var list = read().filter(function(x){ return x.slug !== slug; });\n"
    ],
    [
      "      slug: slug,\n      name: text(c.name),\n      name_ko: text(c.name_ko),\n      set_name: text(c.set_name) || text(c.set_code),\n      number: text(c.number),\n      rarity: text(c.rarity_class) || text(c.rarity),\n      krw: hasPrice ? d.amountKrw : null,\n      price_basis: hasPrice ? d.basis : null,\n      price_source_date: hasPrice ? priceDate(d.sourceDate) : null,\n      price_trust_level: hasPrice ? d.trustLevel : null,\n      viewed_at: new Date().toISOString()\n",
      "      slug: slug,\n      name: c.name || '',\n      name_ko: c.name_ko || '',\n      set_name: c.set_name || c.set_code || '',\n      number: c.number || '',\n      rarity: c.rarity_class || c.rarity || '',\n      krw: b && b.latest_krw ? Math.round(Number(b.latest_krw)) : null,\n      viewed_at: new Date().toISOString()\n"
    ],
    [
      "      var koLabel = it.name_ko ? '<span style=\"color:var(--cp-sub);font-size:11.5px;margin-left:6px\">'+esc(it.name_ko)+'</span>' : '';\n      var priceLabel = it.krw ? '<span style=\"display:block;font-size:10px;color:var(--cp-sub)\">확인 당시 참고가</span>₩'+it.krw.toLocaleString('ko-KR') : '<span style=\"color:var(--cp-sub)\">가격 정보 없음</span>';\n      var setLabel = [esc(it.set_name), esc(it.number)].filter(Boolean).join(' · ');\n      var priceInfo = it.krw ? '가격 기준일 ' + (it.price_source_date ? it.price_source_date.slice(0,10).replace(/-/g,'.') : '미기록')\n        + ' · ' + (it.price_basis === 'median30d' ? '30일 중앙값' : it.price_basis === 'latest' ? '해외 참고가' : '산출 기준 미기록')\n        + (it.price_trust_level === 'LOW' ? ' · 표본 부족' : '') : '';\n      return '<li style=\"display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:12px 16px;background:var(--cp-bg)\">'\n        +   '<a href=\"/cards/'+encodeURIComponent(it.slug)+'\" style=\"flex:1 1 120px;min-width:0;color:inherit;text-decoration:none\">'\n        +     '<div style=\"font-size:13.5px;font-weight:600;color:var(--cp-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">'+esc(it.name)+koLabel+'</div>'\n        +     '<div style=\"font-size:11.5px;color:var(--cp-sub);font-family:var(--mono);margin-top:2px;letter-spacing:.02em\">'+setLabel+(it.rarity?' · '+esc(it.rarity):'')+'</div>'\n        +     (priceInfo ? '<div style=\"font-size:11px;color:var(--cp-sub);margin-top:3px;line-height:1.5\">'+esc(priceInfo)+'</div>' : '')\n        +   '</a>'\n        +   '<span style=\"display:inline-flex;align-items:center;gap:14px;margin-left:auto\">'\n        +     '<span style=\"font-family:var(--mono);font-size:13px;color:var(--cp-fg);white-space:nowrap\">'+priceLabel+'</span>'\n        +     '<button type=\"button\" data-rv-remove=\"'+esc(it.slug)+'\" aria-label=\"삭제\" style=\"background:transparent;border:1px solid var(--cp-line);color:var(--cp-sub);padding:4px 8px;border-radius:2px;font-size:11px;cursor:pointer;flex:none\">✕</button>'\n        +   '</span>'\n        + '</li>';\n",
      "      var koLabel = it.name_ko ? '<span style=\"color:var(--cp-sub);font-size:11.5px;margin-left:6px\">'+esc(it.name_ko)+'</span>' : '';\n      var priceLabel = it.krw ? '₩'+it.krw.toLocaleString('ko-KR') : '<span style=\"color:var(--cp-sub)\">가격 정보 없음</span>';\n      var setLabel = [esc(it.set_name), esc(it.number)].filter(Boolean).join(' · ');\n      return '<li style=\"display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--cp-bg)\">'\n        +   '<a href=\"/cards/'+encodeURIComponent(it.slug)+'\" style=\"flex:1;min-width:0;color:inherit;text-decoration:none\">'\n        +     '<div style=\"font-size:13.5px;font-weight:600;color:var(--cp-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">'+esc(it.name)+koLabel+'</div>'\n        +     '<div style=\"font-size:11.5px;color:var(--cp-sub);font-family:var(--mono);margin-top:2px;letter-spacing:.02em\">'+setLabel+(it.rarity?' · '+esc(it.rarity):'')+'</div>'\n        +   '</a>'\n        +   '<span style=\"font-family:var(--mono);font-size:13px;color:var(--cp-fg);white-space:nowrap\">'+priceLabel+'</span>'\n        +   '<button type=\"button\" data-rv-remove=\"'+esc(it.slug)+'\" aria-label=\"삭제\" style=\"background:transparent;border:1px solid var(--cp-line);color:var(--cp-sub);padding:4px 8px;border-radius:2px;font-size:11px;cursor:pointer;flex:none\">✕</button>'\n        + '</li>';\n"
    ]
  ],
  "functions/search.js": [
    [
      "  const url = new URL(context.request.url);\n  const { original: q, queryNormalized: normalized, queryTokens: tokens, hasGradingIntent } = planSearchQuery(url.searchParams.get('q') || '');\n  const hasPrice = url.searchParams.get('has_price') === '1';\n",
      "  const url = new URL(context.request.url);\n  const { original: q, queryNormalized: normalized, queryTokens: tokens } = planSearchQuery(url.searchParams.get('q') || '');\n  const hasPrice = url.searchParams.get('has_price') === '1';\n"
    ],
    [
      "      <h1 class=\"text-[24px] font-bold mb-1\">${esc(q)}</h1>\n      <p class=\"text-[13px] text-muted\">${hasGradingIntent ? '그레이딩 검색 안내' : (queryError ? '검색 결과를 불러오지 못했습니다.' : (!tokens.length ? '검색어 확인 필요' : resultCountLabel))}</p>\n      ${reachedCandidateLimit ? '<p data-search-candidate-limit class=\"text-[13px] text-muted mt-2\">검색 결과는 최대 200장을 조회해 필터·정렬합니다. 표시된 건수와 순위는 조회한 카드 기준입니다.</p>' : ''}\n",
      "      <h1 class=\"text-[24px] font-bold mb-1\">${esc(q)}</h1>\n      <p class=\"text-[13px] text-muted\">${queryError ? '검색 결과를 불러오지 못했습니다.' : (!tokens.length ? '검색어 확인 필요' : resultCountLabel)}</p>\n      ${reachedCandidateLimit ? '<p data-search-candidate-limit class=\"text-[13px] text-muted mt-2\">검색 결과는 최대 200장을 조회해 필터·정렬합니다. 표시된 건수와 순위는 조회한 카드 기준입니다.</p>' : ''}\n"
    ],
    [
      "    ${partialDataError ? '<p role=\"status\" class=\"text-[13px] text-muted mb-4\">일부 참고가·변동 정보를 불러오지 못했습니다. 카드 정보는 계속 확인할 수 있습니다.</p>' : ''}\n    ${hasGradingIntent ? `\n      <div data-search-grading-intent class=\"border hairline panel p-5\">\n        <h2 class=\"text-[14px] text-ink\">그레이딩 카드 거래가격은 제공하지 않습니다.</h2>\n        <p class=\"text-[13px] text-muted mt-2 leading-relaxed\">Raw 카드 참고가로 대신 검색하지 않습니다. 비용·손익 계산이나 PSA 인증번호 확인이 필요하면 아래 도구를 이용하세요.</p>\n        <div class=\"mt-3\">\n          <a href=\"/tools/grading-cost-compare\" class=\"block px-4 py-3 text-[13px] text-up\">그레이딩 비용 비교</a>\n          <a href=\"/tools/psa-grading-break-even\" class=\"block px-4 py-3 text-[13px] text-up\">PSA 손익 계산</a>\n          <a href=\"/tools/psa-cert-checker\" class=\"block px-4 py-3 text-[13px] text-up\">PSA 인증번호 조회 도우미</a>\n        </div>\n      </div>\n    ` : queryError ? `\n      <div role=\"alert\" class=\"border hairline panel p-8 text-center\">\n",
      "    ${partialDataError ? '<p role=\"status\" class=\"text-[13px] text-muted mb-4\">일부 참고가·변동 정보를 불러오지 못했습니다. 카드 정보는 계속 확인할 수 있습니다.</p>' : ''}\n    ${queryError ? `\n      <div role=\"alert\" class=\"border hairline panel p-8 text-center\">\n"
    ]
  ],
  "search.js": [
    [
      "    }\n    // CARDPICK_GRADING_BRIDGE_START\n    function gradingNotice() {\n      box.innerHTML = '';\n      var panel = document.createElement('div');\n      panel.setAttribute('data-search-grading-intent', '');\n      panel.style.cssText = 'padding:20px 16px;font-size:12.5px;line-height:1.6;color:#8B96A8';\n      var title = document.createElement('p');\n      title.textContent = '그레이딩 카드 거래가격은 제공하지 않습니다.';\n      title.style.cssText = 'color:#E8EDF5;margin:0 0 8px';\n      panel.appendChild(title);\n      var description = document.createElement('p');\n      description.textContent = 'Raw 카드 참고가로 대신 검색하지 않습니다. 비용·손익 계산이나 PSA 인증번호 확인이 필요하면 아래 도구를 이용하세요.';\n      description.style.cssText = 'margin:0 0 8px';\n      panel.appendChild(description);\n      [\n        ['/tools/grading-cost-compare', '그레이딩 비용 비교'],\n        ['/tools/psa-grading-break-even', 'PSA 손익 계산'],\n        ['/tools/psa-cert-checker', 'PSA 인증번호 조회 도우미']\n      ].forEach(function (item) {\n        var link = document.createElement('a');\n        link.setAttribute('href', item[0]);\n        link.textContent = item[1];\n        link.style.cssText = 'display:block;box-sizing:border-box;min-height:44px;padding:12px 0;color:#26E0C2;text-decoration:underline;text-underline-offset:3px';\n        panel.appendChild(link);\n      });\n      box.appendChild(panel);\n      show();\n    }\n    // CARDPICK_GRADING_BRIDGE_END\n    function escapeHtml(value) {\n",
      "    }\n    function escapeHtml(value) {\n"
    ],
    [
      "        var queryText = policy.planSearchQuery(q);\n        if (queryText.hasGradingIntent) { gradingNotice(); return; }\n        if (!queryText.queryTokens.length) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }\n",
      "        var queryText = policy.planSearchQuery(q);\n        if (!queryText.queryTokens.length) { notice('카드명·세트 코드·번호를 입력해 주세요.'); return; }\n"
    ]
  ],
  "functions/guides.js": [
    [
      "      catColor: '#FFE07A',\n      excerpt: 'PSA 10 후보를 발송 전 점검하는 9단계. 센터링·모서리·표면·인쇄 상태를 확인하며, 신품 카드도 PSA 10이 보장되지 않는 이유와 발송 전 확인 사항을 정리합니다.',\n      date: '2026-05-29',\n",
      "      catColor: '#FFE07A',\n      excerpt: 'PSA 10 후보를 발송 전 직접 점검하는 9단계. 센터링 50/50 기준, 모서리 화이트닝, 표면 스크래치, 카드 휨, 인쇄 결함. 신품 카드도 PSA 10이 안 나오는 이유와 PSA 9/10 가격 차이.',\n      date: '2026-05-29',\n"
    ],
    [
      "      catColor: '#FFE07A',\n      excerpt: 'BRG와 미국 BGS의 차이, 공식 접수·비용·등급 안내를 구분합니다. 국내 배송과 추가 비용, 소요 기간의 확인 방법을 정리하며 회사별 판매가나 유리한 등급을 단정하지 않습니다.',\n      date: '2026-06-22',\n",
      "      catColor: '#FFE07A',\n      excerpt: 'BRG(브레이크)는 미국 BGS와 다른 한국 카드 그레이딩 회사. 포켓몬 카드·포토카드를 1~10 등급으로 평가하며 국내 택배 접수가 강점. 신청 방법·비용·기간·등급 체계, PSA·BGS·CGC와 차이, 국내에서 BRG가 유리한 경우까지 정리.',\n      date: '2026-06-22',\n"
    ],
    [
      "      TCG가 처음인 분, 거래에서 한 번 데인 분, 시세를 더 정확히 보고 싶은 분 모두를 위한 한국어 가이드 모음입니다.\n      입문부터 거래 안전, 그레이딩, 해외 직구까지 단계별로 정리했습니다. <a href=\"/guide-card-rarities#rarity-helper\" class=\"tool-links-all\">레어도 표기 도우미 →</a>\n    </p>\n",
      "      TCG가 처음인 분, 거래에서 한 번 데인 분, 시세를 더 정확히 보고 싶은 분 모두를 위한 한국어 가이드 모음입니다.\n      입문부터 거래 안전, 그레이딩, 해외 직구까지 단계별로 정리했습니다.\n    </p>\n"
    ],
    [
      "        <span class=\"tool-link-name\">그레이딩 비용 비교</span>\n        <span class=\"tool-link-desc\">입력한 견적 비교·결과 PNG 저장</span>\n      </a>\n",
      "        <span class=\"tool-link-name\">그레이딩 비용 비교</span>\n        <span class=\"tool-link-desc\">PSA·BGS·CGC 예상 비용 비교</span>\n      </a>\n"
    ],
    [
      "        <span class=\"tool-link-name\">PSA 손익 계산</span>\n        <span class=\"tool-link-desc\">입력한 예상 판매가로 손익 계산·PNG 저장</span>\n      </a>\n",
      "        <span class=\"tool-link-name\">PSA 손익 계산</span>\n        <span class=\"tool-link-desc\">등급별 예상 가치와 손익 확인</span>\n      </a>\n"
    ]
  ],
  "tools.html": [
    [
      "          <div class=\"tool-card-title\">PSA 그레이딩 손익분기 계산기</div>\n          <div class=\"tool-card-desc\">Raw 카드 매입가 + PSA 10·9·8 이하 예상 판매가 + 비용 → 등급별 예상 손익과 손익분기 PSA 10 판매가 산출. 입력 조건·결과를 복사하거나 PNG로 저장.</div>\n          <div class=\"tool-card-meta\">/tools/psa-grading-break-even</div>\n",
      "          <div class=\"tool-card-title\">PSA 그레이딩 손익분기 계산기</div>\n          <div class=\"tool-card-desc\">Raw 카드 매입가 + PSA 10·9·8 이하 예상 판매가 + 비용 → 등급별 예상 손익과 손익분기 PSA 10 판매가 즉시 산출.</div>\n          <div class=\"tool-card-meta\">/tools/psa-grading-break-even</div>\n"
    ],
    [
      "          <div class=\"tool-card-title\">그레이딩 비용·대행 비교 계산기</div>\n          <div class=\"tool-card-desc\">PSA · BGS(Beckett) · CGC · SGC의 입력 견적과 직접 발송·한국 대행 비용을 비교. 장당·총 비용 계산, 선택한 두 견적 비교와 결과 PNG 저장.</div>\n          <div class=\"tool-card-meta\">/tools/grading-cost-compare</div>\n",
      "          <div class=\"tool-card-title\">그레이딩 비용·대행 비교 계산기</div>\n          <div class=\"tool-card-desc\">PSA · BGS(Beckett) · CGC · SGC 4사 그레이딩 비용과 직접 발송 vs 한국 대행 비용을 입력값 기준으로 비교. 장당 비용·총 비용·최저 옵션 자동 산출.</div>\n          <div class=\"tool-card-meta\">/tools/grading-cost-compare</div>\n"
    ],
    [
      "          <div class=\"tool-card-title\">해외 포켓몬 카드 직구 비용 계산기</div>\n          <div class=\"tool-card-desc\">카드 가격·환율·배송비·결제 수수료와 입력한 관세·부가세로 한국 도착 예상액 계산. 입력 조건·제외 비용·결과를 복사하거나 PNG로 저장.</div>\n          <div class=\"tool-card-meta\">/tools/overseas-card-cost</div>\n",
      "          <div class=\"tool-card-title\">해외 포켓몬 카드 직구 비용 계산기</div>\n          <div class=\"tool-card-desc\">TCGplayer·Cardmarket 가격 + 환율 + 현지배송 + 국제배송 + 결제 수수료 + 관세·부가세를 합산해 한국 도착 예상액 계산.</div>\n          <div class=\"tool-card-meta\">/tools/overseas-card-cost</div>\n"
    ],
    [
      "      <p>4. 계산 결과는 카드 상태·환율·수수료 변동으로 실제와 다를 수 있습니다. <span class=\"term-amber\">수익을 보장하지 않습니다.</span></p>\n      <p>PSA 손익·그레이딩 비용·해외 직구 계산기의 PNG에는 입력 금액과 조건이 포함됩니다. 저장은 브라우저에서 처리하며, 다른 사람에게 보내기 전 내용을 확인하세요.</p>\n    </div>\n",
      "      <p>4. 계산 결과는 카드 상태·환율·수수료 변동으로 실제와 다를 수 있습니다. <span class=\"term-amber\">수익을 보장하지 않습니다.</span></p>\n    </div>\n"
    ],
    [
      "      <p>→ <a href=\"/guide-grading-comparison\">PSA · BGS · CGC 비교</a></p>\n      <p>→ <a href=\"/guide-card-rarities#rarity-helper\">레어도 표기 도우미 : 언어판·시리즈별 코드 확인</a></p>\n      <p>→ <a href=\"/guide-japan-import\">일본 직구 가이드</a></p>\n",
      "      <p>→ <a href=\"/guide-grading-comparison\">PSA · BGS · CGC 비교</a></p>\n      <p>→ <a href=\"/guide-japan-import\">일본 직구 가이드</a></p>\n"
    ]
  ]
};
export function restoreGrowth17(source,file){
  return restorePriorGrowth17(restoreSearchCompare(source,file),file);
}
function restorePriorGrowth17(source,file){
  let restored=source;
  for(const [after,prior] of growth17Pairs[file]||[]){
    assert.equal(restored.split(after).length-1,1,'exactly one reviewed growth17 fragment: '+file);
    restored=restored.replace(after,prior);
  }
  return restored;
}
export function restoreGrowth17GuideHtml(source){
  let restored=source;
  for(const [after,before] of growth17Pairs['functions/guides.js']){
    const excerptAfter=[...after.matchAll(/excerpt: '([^']*)'/g)],excerptBefore=[...before.matchAll(/excerpt: '([^']*)'/g)];
    assert.equal(excerptAfter.length,excerptBefore.length);
    for(let i=0;i<excerptAfter.length;i++){
      assert.equal(restored.split(excerptAfter[i][1]).length-1,2,'visible guide excerpt and Article description');
      restored=restored.replaceAll(excerptAfter[i][1],excerptBefore[i][1]);
    }
    const descAfter=[...after.matchAll(/<span class="tool-link-desc">([^<]*)<\/span>/g)],descBefore=[...before.matchAll(/<span class="tool-link-desc">([^<]*)<\/span>/g)];
    for(let i=0;i<descBefore.length;i++){
      assert.equal(restored.split(descAfter[i][0]).length-1,1);
      restored=restored.replace(descAfter[i][0],descBefore[i][0]);
    }
  }
  const link=' <a href="/guide-card-rarities#rarity-helper" class="tool-links-all">레어도 표기 도우미 →</a>';
  assert.equal(restored.split(link).length-1,1,'one existing rarity helper navigation, no invented tool');
  return restored.replace(link,'');
}
// Importing this protection helper does not register duplicate tests in other suites.
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  test('the new home rarity excerpt reuses the existing local font without a new subset request',()=>{
    const home=read('index.html'),css=read('styles/home-text-font.css');
    const excerpt=home.match(/<a href="\/guide-card-rarities">[\s\S]*?<span class="sum">([^<]*)<\/span>/)[1];
    const ranges=[...css.matchAll(/u\+([\da-f]+)(?:-([\da-f]+))?/gi)].map(([,a,b])=>[parseInt(a,16),parseInt(b||a,16)]);
    for(const ch of excerpt){const code=ch.codePointAt(0);if(code>127)assert.ok(ranges.some(([a,b])=>code>=a&&code<=b),'new home excerpt glyph '+ch);}
  });
  for(const file of Object.keys(growth17Pairs)){
    test(file+' restores the full pre-task source using only exact approved fragments',()=>assert.equal(restoreGrowth17(read(file),file),before(file)));
    test(file+' rejects altered, duplicate, missing or moved fragments and unrelated changes',()=>{
      const source=restoreSearchCompare(read(file),file),original=before(file);
      for(const [after] of growth17Pairs[file]){
        for(const changed of [source.replace(after,after+'unapproved\n'),source.replace(after,after+after),source.replace(after,''),source.replace(after,'')+after]){
          assert.notEqual(changed,source);assert.throws(()=>assert.equal(restorePriorGrowth17(changed,file),original));
        }
      }
      for(const changed of [source+'\n<!-- unapproved body -->',source.replace('rel="canonical"','rel="unapproved"'),source.replace('data-ad-slot="','data-unapproved-slot="')]){
        if(changed!==source)assert.throws(()=>assert.equal(restorePriorGrowth17(changed,file),original));
      }
    });
  }
}
