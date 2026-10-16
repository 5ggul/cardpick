/* Existing guide tables supply labels; this helper does not identify cards or prices.
 * Symbol scope: Scarlet & Violet plus Japanese MEGA MUR/MA, reviewed 2026-10-16.
 * https://www.pokemon.com/us/pokemon-news/pokemon-tcg-scarlet-and-violet-revamps-pokemon-tcg-card-aesthetic
 * https://www.pokemon-card.com/info/003695.html
 * https://www.pokemon-card.com/card-search/
 * https://www.pokemon-card.com/info/005168.html
 * https://www.pokemon-card.com/ex/m2a/index.html
 */
(function (root) {
  'use strict';
  const sources = Object.freeze({
    ko: ['https://pokemoncard.co.kr/cards', '한글판 공식 카드검색'],
    ja: ['https://www.pokemon-card.com/card-search/', '일본판 공식 카드검색'],
    en: ['https://www.pokemon.com/us/pokemon-tcg/pokemon-cards', '영문판 공식 카드검색']
  });
  function resolve(selection, entries) {
    const state = selection || {};
    const source = Object.hasOwn(sources, state.language) ? sources[state.language] : sources.ko;
    const result = {
      text: '언어판과 시리즈를 먼저 확인하세요. 같은 약어나 별 기호라도 다른 시리즈에 그대로 적용할 수 없습니다.',
      href: '#identify', label: '실물 카드 확인 순서', sourceHref: source[0], sourceLabel: source[1]
    };
    if (state.purpose === 'condition') return {...result,
      text: 'PSA 같은 상태등급은 제출한 실물 카드의 상태 평가입니다. SAR·SIR 같은 레어도와 높낮이를 비교할 수 없습니다. 센터링만으로 종합 등급을 확정할 수도 없습니다.',
      href: '/guide-psa-grades', label: 'PSA 상태등급 의미',
      sourceHref: '/tools/centering-checker', sourceLabel: '센터링 참고 측정'};
    if (state.purpose !== 'rarity' || !Object.hasOwn(sources, state.language)) return result;
    if (state.series === 'mega' && state.language !== 'ja') return {...result,
      text: '이 도우미의 MEGA 설명은 일본판 MUR·MA만 확인한 범위입니다. 한글판·영문판으로 자동 대응하지 않습니다. 해당 언어판의 공식 카드검색에서 제품과 번호를 대조하세요.'};
    if (state.series !== 'sv' && state.series !== 'mega') return {...result,
      text: '이 선택 도우미는 스칼렛&바이올렛 표기와 일본판 MEGA의 MUR·MA를 다룹니다. 다른 시리즈·프로모·특수 제품은 해당 언어판의 공식 카드검색에서 제품과 번호를 대조하세요.'};
    const list = state.series === 'mega' ? entries?.jaMega : state.language === 'en' ? entries?.en : entries?.krjp;
    if (!Array.isArray(list)) return result;
    const entry = state.series === 'mega' && !['MUR', 'MA'].includes(state.mark) ? undefined
      : list.find(item => item && item.key === state.mark);
    if (!entry) return {...result, text: '카드 하단 코드·기호를 선택하세요. 목록에 없거나 확실하지 않다면 공식 카드검색에서 카드명·제품·번호를 함께 확인하세요.'};
    return {...result,
      text: entry.label + ': ' + entry.detail + ' 제품별 공식 분류를 다시 대조하세요. 다른 언어판으로 자동 치환하거나 가격 순위를 정하는 기준이 아닙니다.',
      href: state.series === 'mega' ? '#mega-jp' : state.language === 'en' ? '#english' : '#kr-jp', label: '해당 언어판 레어도 표 보기'};
  }
  root.CPRarityHelper = Object.freeze({resolve});
  if (typeof document === 'undefined') return;
  const controls = document.getElementById('cp-rarity-controls');
  if (!controls) return;
  const byId = id => document.getElementById('cp-rarity-' + id);
  function rows(selector, english) {
    const table = document.querySelector(selector);
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr'), row => {
      const cells = Array.from(row.querySelectorAll('th,td'), cell => cell.textContent.trim());
      return {key: cells[english ? 1 : 0], label: cells[0] + (english ? '' : ' (' + cells[1] + ')'), detail: cells[2]};
    }).filter(item => item.key && item.label && item.detail);
  }
  const entries = {
    krjp: rows('[aria-label="한글판과 일본판 레어도 약어 표"] table', false),
    en: rows('[aria-label="영문판 스칼렛 바이올렛 레어도 기호 표"] table', true),
    jaMega: rows('[aria-label="일본판 MEGA MUR MA 확인 표"] table', false)
  };
  function options() {
    const select = byId('mark');
    select.replaceChildren();
    const add = (value, label) => {const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);};
    add('', '선택하지 않음 / 목록에 없음');
    const language = byId('language').value, series = byId('series').value;
    const list = series === 'mega' ? (language === 'ja' ? entries.jaMega : [])
      : series === 'sv' ? (language === 'en' ? entries.en : language === 'ko' || language === 'ja' ? entries.krjp : []) : [];
    for (const entry of list) add(entry.key, entry.key);
  }
  function render() {
    const selection = Object.fromEntries(['purpose','language','series','mark'].map(id => [id, byId(id).value]));
    for (const id of ['language','series','mark']) byId(id).disabled = selection.purpose === 'condition';
    const result = resolve(selection, entries);
    byId('answer').textContent = result.text;
    for (const [id, href, label] of [['guide-link',result.href,result.label],['source-link',result.sourceHref,result.sourceLabel]]) {
      const link = byId(id); link.setAttribute('href', href); link.textContent = label;
      if (href.startsWith('https://')) {link.setAttribute('target','_blank');link.setAttribute('rel','noopener nofollow');}
      else {link.removeAttribute('target');link.removeAttribute('rel');}
    }
  }
  byId('language').addEventListener('change', () => {options();render();});
  byId('series').addEventListener('change', () => {options();render();});
  for (const id of ['purpose','mark']) byId(id).addEventListener('change', render);
  options(); render(); controls.hidden = false;
})(typeof window === 'undefined' ? globalThis : window);
