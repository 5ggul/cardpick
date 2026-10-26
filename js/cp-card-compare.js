/* Search-only comparison. Store two slugs, never prices; read the existing display contract. */
(function () {
  'use strict';
  function mount() {
    var panel = document.querySelector('[data-cp-card-compare]');
    if (!panel || panel.getAttribute('data-cp-compare-mounted') === 'true') return;
    var slots = panel.querySelector('[data-cp-compare-slots]');
    var status = panel.querySelector('[data-cp-compare-status]');
    var clear = panel.querySelector('[data-cp-compare-clear]');
    if (!slots || !status || !clear || typeof fetch !== 'function' || typeof AbortController !== 'function') return;
    var KEY = 'cardpick:compare:v1', selected = [], entries = new Map(), storageFailed = false;
    var buttons = Array.from(document.querySelectorAll('[data-cp-compare-add]'));
    var shortcut = document.querySelector('[data-cp-compare-shortcut]');
    var shortcutCount = shortcut && shortcut.querySelector('[data-cp-compare-count]');
    var shortcutLink = shortcut && shortcut.querySelector('[data-cp-compare-jump]');
    var jumpFocusTimer;
    function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
    function slug(value) {
      return typeof value === 'string' && value.length > 0 && value.length <= 240
        && value !== '.' && value !== '..' && !/[\\/?#%\s\u0000-\u001f\u007f]/.test(value);
    }
    function text(value, limit) { return typeof value === 'string' && value.length <= (limit || 500) ? value : ''; }
    function date(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
      var day = new Date(value.slice(0, 10) + 'T00:00:00Z');
      if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
      var parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
    }
    function read() {
      try {
        var raw = sessionStorage.getItem(KEY);
        if (!raw || raw.length > 2048) return [];
        var value = JSON.parse(raw);
        if (!Array.isArray(value) || value.length > 2) return [];
        return value.filter(function (item, i) { return slug(item) && value.indexOf(item) === i; });
      } catch (_) { storageFailed = true; return []; }
    }
    function save() {
      try {
        if (selected.length) sessionStorage.setItem(KEY, JSON.stringify(selected));
        else sessionStorage.removeItem(KEY);
      } catch (_) { storageFailed = true; }
    }
    function announce(message) {
      status.textContent = message + (storageFailed ? ' 브라우저 저장을 사용할 수 없어 이 화면에서만 선택이 유지될 수 있습니다.' : '');
    }
    function announceState() {
      var counts = { loading: 0, ready: 0, missing: 0, service: 0, timeout: 0, error: 0 };
      selected.forEach(function (value) {
        var item = entries.get(value), state = item ? item.state : 'loading';
        counts[Object.prototype.hasOwnProperty.call(counts, state) ? state : 'error']++;
      });
      var messages = [selected.length + '/2장 선택했습니다.'];
      var failed = counts.missing + counts.service + counts.timeout + counts.error;
      if (failed && counts.ready) messages.push('일부 카드 정보를 확인하지 못했습니다.');
      if (counts.loading) messages.push(counts.loading + '장 정보를 확인하고 있습니다.');
      if (counts.ready) messages.push(counts.ready + '장 정보를 확인했습니다.');
      if (counts.missing) messages.push(counts.missing + '장의 카드 정보를 찾지 못했습니다. 검색 결과에서 다시 확인하세요.');
      if (counts.service) messages.push(counts.service + '장 정보를 불러오지 못했습니다. 서비스를 일시적으로 이용할 수 없습니다.');
      if (counts.timeout) messages.push(counts.timeout + '장 정보를 불러오지 못했습니다. 응답 시간이 초과되었습니다.');
      if (counts.error) messages.push(counts.error + '장 정보를 불러오지 못했습니다. 잠시 후 선택을 해제하고 다시 선택하세요.');
      if (counts.service || counts.timeout) messages.push('잠시 후 선택을 해제하고 다시 선택하세요.');
      if (counts.ready === 2) messages.push('가격의 산출 기준과 기준일을 각각 확인하세요.');
      if (selected.length === 1 && counts.ready === 1) messages.push('비교할 카드 한 장을 더 선택하세요.');
      if (!selected.length) messages.push('검색 결과에서 비교할 카드 두 장을 선택하세요.');
      announce(messages.join(' '));
    }
    function element(tag, className, content) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    }
    function field(list, label, value) {
      var row = element('div', 'cp-compare-field');
      row.appendChild(element('dt', '', label));
      row.appendChild(element('dd', '', value || '정보 없음'));
      list.appendChild(row);
    }
    function validate(payload, expected) {
      if (!record(payload) || !record(payload.card) || payload.card.slug !== expected
          || payload.card.game !== 'pokemon' || !text(payload.card.name).trim()) throw Error('invalid');
      var display = payload.price_display;
      if (!record(display)) throw Error('invalid');
      var unavailable = display.basis === 'unavailable' && display.trustLevel === 'NONE' && display.amountKrw === null;
      var available = Number.isSafeInteger(display.amountKrw) && display.amountKrw > 0
        && ((display.basis === 'latest' && display.trustLevel === 'HIGH')
          || (display.basis === 'median30d' && ['MEDIUM', 'LOW'].indexOf(display.trustLevel) !== -1));
      if (!unavailable && !available) throw Error('invalid');
      if (display.sourceDate !== null && !date(display.sourceDate)) throw Error('invalid');
      // Descriptions and price text stay inside the provider-reviewed contract, but only as text.
      for (var i = 0; i < ['label', 'priceText', 'secondaryText', 'trustText', 'basisText', 'samplesText', 'sourceDescription'].length; i++) {
        var key = ['label', 'priceText', 'secondaryText', 'trustText', 'basisText', 'samplesText', 'sourceDescription'][i];
        if (!text(display[key], 2000).trim()) throw Error('invalid');
      }
      return { card: payload.card, display: display, variant: record(payload.best) ? text(payload.best.variant, 100) : '' };
    }
    function release(item) { if (!item) return; clearTimeout(item.timer); item.controller.abort(); }
    function focusFallback() {
      var input = document.querySelector('header input[name="q"]');
      if (input && typeof input.focus === 'function') { input.focus(); return; }
      var title = panel.querySelector('#card-compare-title') || panel;
      title.setAttribute('tabindex', '-1'); title.focus();
    }
    function remove(value) {
      clearTimeout(jumpFocusTimer);
      release(entries.get(value)); entries.delete(value);
      selected = selected.filter(function (item) { return item !== value; });
      save(); render(); announceState();
      var original = buttons.find(function (button) { return button.getAttribute('data-cp-compare-add') === value; });
      if (original && !original.hidden) original.focus(); else focusFallback();
    }
    function render() {
      var focused = document.activeElement;
      var focusValue = focused && typeof focused.getAttribute === 'function' ? focused.getAttribute('data-cp-compare-remove') : null;
      var focusLink = focused && typeof focused.getAttribute === 'function' ? focused.getAttribute('data-cp-compare-detail') : null;
      var restoreFocus = null;
      slots.textContent = '';
      selected.forEach(function (value, i) {
        var item = entries.get(value), card = element('article', 'cp-compare-card');
        var head = element('div', 'cp-compare-card-head');
        head.appendChild(element('h3', '', '카드 ' + (i + 1)));
        var button = element('button', 'cp-compare-remove', '선택 해제');
        button.type = 'button'; button.setAttribute('aria-label', (item && item.data ? item.data.card.name : value) + ' 비교 선택 해제');
        button.setAttribute('data-cp-compare-remove', value);
        if (focusValue === value) restoreFocus = button;
        button.addEventListener('click', function () { remove(value); });
        head.appendChild(button); card.appendChild(head);
        if (!item || item.state === 'loading') card.appendChild(element('p', 'cp-compare-note', '카드 정보를 확인하고 있습니다.'));
        else if (item.state !== 'ready') {
          card.appendChild(element('p', 'cp-compare-note', item.state === 'missing'
            ? '해당 카드 정보를 찾지 못했습니다. 선택을 해제하고 검색 결과에서 다시 확인하세요.'
            : item.state === 'service' ? '카드 정보를 불러오지 못했습니다. 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 선택을 해제하고 다시 선택하세요.'
            : item.state === 'timeout' ? '카드 정보를 불러오지 못했습니다. 응답 시간이 초과되었습니다. 잠시 후 선택을 해제하고 다시 선택하세요.'
            : '카드 정보를 불러오지 못했습니다. 잠시 후 선택을 해제하고 다시 선택하세요.'));
        } else {
          var data = item.data, c = data.card, d = data.display;
          var link = element('a', 'cp-compare-card-link', c.name + (text(c.name_ko) ? ' · ' + c.name_ko : ''));
          link.setAttribute('href', '/cards/' + encodeURIComponent(value));
          link.setAttribute('data-cp-compare-detail', value);
          if (focusLink === value) restoreFocus = link;
          card.appendChild(link);
          var list = element('dl', 'cp-compare-fields');
          field(list, '세트', text(c.set_name)); field(list, '세트 코드', text(c.set_code));
          field(list, '카드 번호', text(c.number)); field(list, '레어도', text(c.rarity_class) || text(c.rarity));
          field(list, '대표 가격 변형', data.variant);
          field(list, '언어판', '이 응답에는 언어판 정보가 없습니다. 카드 상세와 원본 상품 정보를 확인하세요.');
          field(list, d.basis === 'unavailable' ? '해외 참고가' : d.label,
            d.basis === 'unavailable' ? '가격 정보 없음' : '₩ ' + d.amountKrw.toLocaleString('ko-KR'));
          field(list, '가격 기준일', d.sourceDate ? date(d.sourceDate).slice(0, 10).replace(/-/g, '.') + ' (UTC)' : '기준일 확인 불가');
          field(list, '신뢰도', d.trustText); field(list, '산출 기준', d.basisText); field(list, '관측 표본', d.samplesText);
          card.appendChild(list);
          if (d.trustLevel === 'LOW') card.appendChild(element('p', 'cp-compare-warning', '표본 부족 · 참고용입니다.'));
          card.appendChild(element('p', 'cp-compare-note', d.secondaryText));
          card.appendChild(element('p', 'cp-compare-note', d.sourceDescription));
        }
        slots.appendChild(card);
      });
      if (selected.length < 2) slots.appendChild(element('p', 'cp-compare-empty', selected.length ? '비교할 카드 한 장을 더 선택하세요.' : '검색 결과에서 비교할 카드 두 장을 선택하세요.'));
      buttons.forEach(function (button) {
        var on = selected.indexOf(button.getAttribute('data-cp-compare-add')) !== -1;
        button.setAttribute('aria-pressed', String(on)); button.textContent = on ? '비교 선택 해제' : '비교 선택';
      });
      clear.disabled = selected.length === 0;
      if (shortcut && shortcutCount && shortcutLink) {
        shortcut.hidden = selected.length === 0;
        shortcutCount.textContent = selected.length + '/2장 선택';
        shortcutLink.setAttribute('aria-label', '선택한 카드 ' + selected.length + '장 비교 보기');
      }
      if (restoreFocus) restoreFocus.focus();
    }
    function load(value) {
      var item = { state: 'loading', controller: new AbortController() };
      entries.set(value, item);
      var deadline = new Promise(function (_, reject) {
        item.timer = setTimeout(function () { item.timedOut = true; item.controller.abort(); reject(Error('timeout')); }, 6000);
      });
      // The deadline covers response body parsing even if a fetch implementation ignores abort.
      var request = Promise.resolve().then(function () {
        if (entries.get(value) !== item || item.controller.signal.aborted) throw Error('cancelled');
        return fetch('/api/card-summary?slug=' + encodeURIComponent(value), { method: 'GET', credentials: 'same-origin', signal: item.controller.signal });
      }).then(function (response) {
        if (response.status === 404) { var missing = Error('missing'); missing.missing = true; throw missing; }
        if (response.status === 503) { var unavailable = Error('unavailable'); unavailable.serviceUnavailable = true; throw unavailable; }
        if (!response.ok) throw Error('unavailable');
        return response.json();
      }).then(function (body) { return validate(body, value); });
      Promise.race([request, deadline]).then(function (data) {
        if (entries.get(value) !== item) return;
        item.state = 'ready'; item.data = data;
      }).catch(function (error) {
        if (entries.get(value) !== item) return;
        item.state = item.timedOut ? 'timeout' : error && error.missing ? 'missing' : error && error.serviceUnavailable ? 'service' : 'error';
      }).finally(function () {
        release(item);
        if (entries.get(value) !== item) return;
        render(); announceState();
      });
    }
    selected = read();
    selected.forEach(load);
    buttons.forEach(function (button) {
      var value = button.getAttribute('data-cp-compare-add');
      if (!slug(value)) return;
      button.addEventListener('click', function () {
        if (selected.indexOf(value) !== -1) { remove(value); return; }
        if (selected.length === 2) { announce('비교는 최대 2장입니다. 기존 선택을 해제한 뒤 추가하세요.'); return; }
        selected.push(value); save(); load(value); render(); announceState();
      });
      button.hidden = false;
    });
    clear.addEventListener('click', function () {
      clearTimeout(jumpFocusTimer);
      entries.forEach(release); entries.clear(); selected = []; save(); render(); announce('비교 선택을 모두 비웠습니다.');
      var first = buttons.find(function (button) { return slug(button.getAttribute('data-cp-compare-add')); });
      if (first) first.focus(); else focusFallback();
    });
    if (shortcut && shortcutCount && shortcutLink) shortcutLink.addEventListener('click', function (event) {
      if (!selected.length || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
          || (typeof event.button === 'number' && event.button !== 0)) return;
      var title = panel.querySelector('#card-compare-title');
      if (!title || typeof title.focus !== 'function') return;
      title.setAttribute('tabindex', '-1');
      clearTimeout(jumpFocusTimer);
      // Keep the native fragment link and history. Focus only after its user-initiated navigation.
      jumpFocusTimer = setTimeout(function () {
        if (shortcut.hidden) return;
        var focused = document.activeElement;
        if (focused === shortcutLink || focused === document.body || focused === panel) title.focus({ preventScroll: true });
      }, 0);
    });
    panel.setAttribute('data-cp-compare-mounted', 'true'); panel.hidden = false;
    render(); announceState();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
