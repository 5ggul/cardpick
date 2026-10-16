/* Three calculator adapters only. No network, storage, analytics or URL writes. */
(function (root) {
  'use strict';
  const MAX_FRAGMENT = 2048;
  const MAX_FIELD = 48;
  const money = (id, label, positive) => ({id, label, integer:true, min:positive ? Number.MIN_VALUE : 0, unit:'원'});
  const decimal = (id, label, unit, extra) => Object.assign({id, label, min:0, unit:unit || ''}, extra);
  const choice = (id, label, values) => ({id, label, choices:values});
  const configs = {
    psa: {
      path:'/tools/psa-grading-break-even', title:'PSA 손익분기 계산', trigger:'i-fee',
      fields:[money('i-raw','Raw 매입가'),money('i-p10','PSA 10 예상 판매가',true),money('i-p9','PSA 9 예상 판매가',true),money('i-plow','PSA 8 이하 예상 판매가'),money('i-grade','그레이딩 비용',true),money('i-agent','대행 수수료'),money('i-ship','왕복 배송·보험료'),money('i-misc','기타 비용'),decimal('i-fee','판매 수수료','%',{max:100,exclusiveMax:true})],
      outputs:[['oCost','총 투입 비용'],['oBreakeven','손익분기 판매가'],['oP10','PSA 10 시 순손익'],['oP9','PSA 9 시 순손익'],['oPlow','PSA 8 이하 시 순손익']],
      caveats:['예상 판매가는 사용자가 입력한 값이며 실제 거래가나 등급을 보장하지 않습니다.','그레이딩 비용·대행 수수료·왕복 배송비를 별도로 입력한 계산입니다.'],
    },
    grading: {
      path:'/tools/grading-cost-compare', title:'그레이딩 비용 비교', trigger:'i-qty',
      fields:[Object.assign(money('i-qty','카드 수량',true),{unit:'장'}),money('i-decl','장당 예상 신고가'),decimal('i-fx','USD 원화 환율','원/USD',{min:Number.MIN_VALUE}),choice('i-mode','발송 방식',{agency:'한국 대행',direct:'직접 발송'}),money('i-ship','왕복 국제배송·보험 총액'),money('i-agent','장당 대행 수수료'),money('i-misc','기타 비용'),...['psa','bgs','cgc','sgc'].map(co => decimal('g-'+co,co.toUpperCase()+' 장당 요금','USD',{optional:true,min:Number.MIN_VALUE}))],
      outputs:[],
      caveats:['회사별 요금은 입력한 견적입니다. 공식 최신 요금을 자동 조회하지 않습니다.','배송·보험·대행·기타 비용은 입력한 발송 조건으로 계산합니다. 신고가는 요금에 자동 반영되지 않습니다.','SGC도 비용에 표시되지만 기존 최저 비용 비교 후보는 PSA·BGS·CGC입니다.'],
    },
    overseas: {
      path:'/tools/overseas-card-cost', title:'해외 카드 직구 비용 계산', trigger:'i-fx',
      fields:[choice('i-market','구매처',{tcgplayer:'TCGplayer',cardmarket:'Cardmarket',other:'기타 해외몰'}),choice('i-currency','구매 통화',{USD:'USD',EUR:'EUR'}),decimal('i-card','카드 가격','구매 통화',{min:Number.MIN_VALUE}),decimal('i-local-ship','현지 배송비','구매 통화'),decimal('i-fx','구매 통화 원화 환율','원/구매 통화',{min:Number.MIN_VALUE}),decimal('i-usd-fx','USD 환산용 환율','원/USD',{optional:true,min:Number.MIN_VALUE}),money('i-intl','국제배송·대행 비용'),decimal('i-pay-fee','결제 수수료','%'),choice('i-tax-mode','세금 모드',{auto:'입력 기준으로 자동 계산',always:'항상 적용',off:'계산에서 제외'}),decimal('i-threshold','세금 적용 비교 기준','USD',{optional:true}),decimal('i-tax-rate','입력 세율','%',{optional:true}),money('i-local-price','국내 비교용 입력 가격'),decimal('i-buffer','예비비·환차손','%')],
      outputs:[['o-landed','한국 도착 예상액'],['o-base','카드·현지배송 원화'],['o-pay','결제 수수료'],['o-intl','국제배송·대행'],['o-tax','입력 조건 기준 세금'],['o-buffer','예비비']],
      caveats:['입력 환율·비용·세율 기준 참고 계산입니다. 실제 결제액이나 통관 세액을 보장하지 않습니다.','세금 제외는 사용자의 계산 선택이며 면세 판정이 아닙니다. 국내 비교 가격도 사용자가 입력한 값입니다.'],
    },
  };
  configs.grading.fields.find(field => field.id === 'i-decl').unit = 'USD';
  configs.overseas.fields.find(field => field.id === 'i-local-price').optional = true;
  function config(tool) {
    if (!Object.prototype.hasOwnProperty.call(configs,tool)) throw Error('tool');
    return configs[tool];
  }
  function isInactive(tool,id,raw) {
    const mode=String(raw['i-mode'] || '').trim(), currency=String(raw['i-currency'] || '').trim(), tax=String(raw['i-tax-mode'] || '').trim();
    return (tool === 'grading' && id === 'i-agent' && mode === 'direct') ||
      (tool === 'overseas' && ((id === 'i-usd-fx' && !(currency === 'EUR' && tax === 'auto')) ||
        (id === 'i-threshold' && tax !== 'auto') || (id === 'i-tax-rate' && tax === 'off')));
  }
  function normalize(tool,raw) {
    const cfg = config(tool), result = Object.create(null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('fields');
    if (Object.keys(raw).length !== cfg.fields.length || Object.keys(raw).some(key => !cfg.fields.some(field => field.id === key))) throw Error('fields');
    for (const field of cfg.fields) {
      if (!Object.prototype.hasOwnProperty.call(raw,field.id) || typeof raw[field.id] !== 'string' || raw[field.id].length > MAX_FIELD) throw Error('field');
      const text = raw[field.id].trim();
      if (field.choices) {
        if (!Object.prototype.hasOwnProperty.call(field.choices,text)) throw Error('choice');
        result[field.id] = text;
        continue;
      }
      const inactive = isInactive(tool,field.id,raw);
      let optional = field.optional || inactive;
      if (!inactive && tool === 'overseas' && ['i-usd-fx','i-threshold','i-tax-rate'].includes(field.id)) optional = false;
      if (text === '' && optional) { result[field.id] = ''; continue; }
      // Full grammar only: no exponent, sign, hex, coercion, malformed grouping or HTML.
      const grammar = field.integer ? /^(?:\d+|\d{1,3}(?:,\d{3})+)$/ : /^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/;
      if (!grammar.test(text)) throw Error('number');
      const value = Number(text.replace(/,/g,''));
      if (!Number.isFinite(value) || value < (inactive ? 0 : field.min) || value > Number.MAX_SAFE_INTEGER ||
          (field.integer && !Number.isSafeInteger(value)) ||
          (field.max !== undefined && (field.exclusiveMax ? value >= field.max : value > field.max))) throw Error('range');
      // Keep ordinary decimal strings instead of producing exponent notation.
      const ordinary = text.replace(/,/g,'').replace(/^0+(?=\d)/,'').replace(/^\./,'0.').replace(/\.$/,'');
      result[field.id] = inactive ? '' : ordinary;
    }
    if (tool === 'grading' && !['psa','bgs','cgc','sgc'].some(co => result['g-'+co] !== '')) throw Error('empty-quotes');
    return result;
  }
  function readFragment(hash,tool) {
    config(tool);
    if (!hash || !hash.startsWith('#cpcalc')) return null;
    if (hash.length > MAX_FRAGMENT || !hash.startsWith('#cpcalc=') || /%(?![\da-f]{2})/i.test(hash)) throw Error('fragment');
    const params = new URLSearchParams(hash.slice(1)), seen = new Set(), fields = config(tool).fields;
    const allowed = new Set(['cpcalc','tool',...fields.flatMap(field => ['b.'+field.id,'a.'+field.id])]);
    for (const [key,value] of params) {
      if (!allowed.has(key) || seen.has(key) || value.length > MAX_FIELD) throw Error('parameter');
      seen.add(key);
    }
    if (params.get('cpcalc') !== '1' || params.get('tool') !== tool) throw Error('version-or-tool');
    const read = prefix => {
      const raw = Object.create(null);
      for (const field of fields) {
        if (!params.has(prefix+field.id)) throw Error('missing-field');
        raw[field.id] = params.get(prefix+field.id);
      }
      return normalize(tool,raw);
    };
    const current = read('b.');
    const baseline = fields.some(field => params.has('a.'+field.id)) ? read('a.') : null;
    return {current,baseline};
  }
  function makeLink(tool,current,baseline) {
    const cfg = config(tool), params = new URLSearchParams();
    params.set('cpcalc','1'); params.set('tool',tool);
    for (const [prefix,raw] of [['b.',current],['a.',baseline]]) if (raw) {
      const values = normalize(tool,raw);
      for (const field of cfg.fields) params.set(prefix+field.id,values[field.id]);
    }
    const hash = '#'+params.toString();
    if (hash.length > MAX_FRAGMENT) throw Error('length');
    return 'https://cardpick.kr'+cfg.path+hash;
  }
  function rawInputs(doc,tool) {
    const raw = Object.create(null);
    for (const field of config(tool).fields) {
      const el = doc.getElementById(field.id);
      if (!el) throw Error('mount');
      raw[field.id] = el.value;
    }
    return raw;
  }
  function outputRows(doc,tool,inputs) {
    const cfg = config(tool), rows = [];
    const read = (key,label,selector) => {
      const el = selector ? doc.querySelector(selector) : doc.getElementById(key);
      const value = el && el.textContent.trim();
      if (!value || !/^[+\-]?\s*₩\s*[\d,]+$/.test(value)) throw Error('invalid-result');
      const n = Number(value.replace(/[₩,\s]/g,''));
      if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) throw Error('result-range');
      rows.push({key,label,value});
    };
    if (tool === 'grading') {
      for (const co of ['psa','bgs','cgc','sgc']) if (inputs['g-'+co] !== '') {
        for (const [part,label] of [['total','총 비용'],['per','장당 비용']]) {
          read(part+'-'+co,co.toUpperCase()+' '+label,'[data-out="'+part+'-'+co+'"]');
        }
      }
    } else for (const [id,label] of cfg.outputs) read(id,label);
    return rows;
  }
  function snapshot(doc,tool) {
    const inputs = normalize(tool,rawInputs(doc,tool)), outputs = outputRows(doc,tool,inputs), notes = [...config(tool).caveats];
    if (tool === 'overseas') {
      for (const id of ['o-tax-note','o-compare']) {
        const value = doc.getElementById(id).textContent.trim();
        if (value && value.length <= 600) notes.push(value);
      }
    }
    if (tool === 'psa') {
      const warning = doc.getElementById('scenarioWarn');
      if (warning && warning.classList.contains('show')) notes.push(warning.textContent.trim());
    }
    return {inputs,outputs,notes};
  }
  function inputLabel(field,inputs) {
    const value = inputs[field.id];
    if (field.choices) return field.choices[value];
    if (value === '') return '미입력 또는 이번 계산에서 제외';
    const unit = field.unit === '구매 통화' ? inputs['i-currency'] : field.unit === '원/구매 통화' ? '원/'+inputs['i-currency'] : field.unit;
    return value+(unit ? ' '+unit : '');
  }
  function textResult(tool,current,baseline) {
    const cfg = config(tool), lines = [cfg.title,'사용자가 입력한 조건의 참고 계산입니다.'];
    for (const [label,item] of baseline ? [['조건 A',baseline],['현재 조건 B',current]] : [['현재 조건',current]]) {
      lines.push('',label,'입력 조건');
      for (const field of cfg.fields) lines.push(field.label+': '+inputLabel(field,item.inputs));
      lines.push('계산 결과');
      for (const row of item.outputs) lines.push(row.label+': '+row.value);
      lines.push(...item.notes);
    }
    lines.push('도구: https://cardpick.kr'+cfg.path);
    return lines.join('\n');
  }
  // Text-only, on-demand rendering. No DOM capture, external fonts or images.
  const PNG_LIMITS = Object.freeze({width:1080,maxHeight:7200,maxPixels:8000000,maxText:18000,maxBytes:8000000});
  function pngLayout(ctx,text) {
    if (typeof text !== 'string' || !text || text.length > PNG_LIMITS.maxText) throw Error('png-text-limit');
    const pad=48, maxWidth=PNG_LIMITS.width-pad*2, rows=[];
    let y=42;
    const add=(text,size,color,gap=12) => {
      const font=(size >= 34 ? '700 ' : '400 ')+size+'px system-ui, -apple-system, "Malgun Gothic", sans-serif';
      ctx.font=font;
      const lineHeight=Math.ceil(size*1.5), wrapped=[];
      let line='';
      for (const char of Array.from(text)) {
        const width=ctx.measureText(line+char).width;
        if (!Number.isFinite(width) || width < 0 || ctx.measureText(char).width > maxWidth) throw Error('png-measure');
        if (line && width > maxWidth) { wrapped.push(line); line=char; }
        else line+=char;
      }
      if (line) wrapped.push(line);
      for (const value of wrapped) { rows.push({text:value,x:pad,y,font,color,lineHeight}); y+=lineHeight; }
      y+=gap;
      if (y+pad > PNG_LIMITS.maxHeight) throw Error('png-height-limit');
    };
    add('CARDPICK · 입력값 기반 계산',24,'#26e0c2',18);
    text.split('\n').forEach((line,index) => {
      if (!line) { y+=12; return; }
      const section=/^(?:조건 A|현재 조건 B|현재 조건|입력 조건|계산 결과)$/.test(line);
      add(line,index===0 ? 42 : section ? 34 : 28,index===0 ? '#ffffff' : section ? '#26e0c2' : '#d5deeb');
    });
    const height=Math.ceil(y+pad);
    if (height > PNG_LIMITS.maxHeight || height*PNG_LIMITS.width > PNG_LIMITS.maxPixels) throw Error('png-pixel-limit');
    return {width:PNG_LIMITS.width,height,rows};
  }
  function renderPng(doc,text) {
    const canvas=doc.createElement('canvas');
    try {
      const ctx=canvas.getContext('2d');
      if (!ctx) throw Error('png-context');
      const layout=pngLayout(ctx,text);
      canvas.width=layout.width; canvas.height=layout.height;
      ctx.fillStyle='#05080d'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.textAlign='left'; ctx.textBaseline='top';
      for (const row of layout.rows) { ctx.font=row.font;ctx.fillStyle=row.color;ctx.fillText(row.text,row.x,row.y); }
      return canvas;
    } catch (error) { canvas.width=0;canvas.height=0;throw error; }
  }
  function pngBlob(win,canvas) {
    return new Promise((resolve,reject) => {
      let done=false;
      const timer=win.setTimeout(() => finish(Error('png-timeout')),5000);
      function finish(error,blob) {
        if (done) return; done=true;win.clearTimeout(timer);
        if (error) reject(error);else resolve(blob);
      }
      try {
        canvas.toBlob(blob => {
          if (!blob || blob.type !== 'image/png' || !Number.isFinite(blob.size) || blob.size <= 0 || blob.size > PNG_LIMITS.maxBytes) finish(Error('png-blob'));
          else finish(null,blob);
        },'image/png');
      } catch (error) { finish(error); }
    });
  }
  function applyRaw(win,tool,values) {
    const doc = win.document;
    // Let the original currency listener update its active-currency cache first.
    if (tool === 'overseas') {
      const currency = doc.getElementById('i-currency');
      currency.value = values['i-currency'];
      currency.dispatchEvent(new win.Event('change',{bubbles:true}));
    }
    for (const field of config(tool).fields) doc.getElementById(field.id).value = values[field.id];
    doc.getElementById(config(tool).trigger).dispatchEvent(new win.Event('input',{bubbles:true}));
  }
  function applyPackage(win,tool,payload) {
    const original = rawInputs(win.document,tool);
    const current = normalize(tool,payload.current), baseline = payload.baseline ? normalize(tool,payload.baseline) : null;
    let previousOtherFx;
    if (tool === 'overseas') {
      const currency=win.document.getElementById('i-currency');
      currency.value=original['i-currency']==='USD' ? 'EUR' : 'USD';
      currency.dispatchEvent(new win.Event('change',{bubbles:true}));
      previousOtherFx=win.document.getElementById('i-fx').value;
      applyRaw(win,tool,original);
    }
    try {
      let saved = null;
      if (baseline) { applyRaw(win,tool,baseline); saved = snapshot(win.document,tool); }
      applyRaw(win,tool,current);
      return {current:snapshot(win.document,tool),baseline:saved};
    } catch (error) {
      if (tool === 'overseas') applyRaw(win,tool,Object.assign({},original,{'i-currency':original['i-currency']==='USD' ? 'EUR' : 'USD','i-fx':previousOtherFx}));
      applyRaw(win,tool,original);
      throw error;
    }
  }
  function mount(win) {
    const doc = win.document, panel = doc.querySelector('[data-cp-tool-results]');
    if (!panel) return;
    const tool = panel.getAttribute('data-cp-tool-results'), cfg = config(tool);
    const part = name => panel.querySelector('[data-results="'+name+'"]');
    const button = name => panel.querySelector('[data-results-action="'+name+'"]');
    const status = part('status'), include = part('include-a');
    let saved = null, pending = null, applying = false, pngBusy = false, pngUrl = null, pngVersion = 0;
    const say = text => { status.textContent = text; };
    function clearPng() {
      pngVersion++;
      if (pngUrl) { win.URL.revokeObjectURL(pngUrl);pngUrl=null; }
      part('png-fallback').hidden=true;
      part('png-image').removeAttribute('src');part('png-link').replaceChildren();
      part('png-details').open=false;
    }
    function cells(container,headings,rows) {
      container.replaceChildren();
      const table = doc.createElement('table'), caption = doc.createElement('caption');
      // No untrusted markup enters the table.
      caption.textContent = headings.length === 3 ? '입력 조건 또는 계산 결과 비교' : '공유받은 입력 조건';
      table.appendChild(caption);
      const thead = doc.createElement('thead'), header = doc.createElement('tr');
      for (const heading of headings) { const th = doc.createElement('th'); th.scope = 'col'; th.textContent = heading; header.appendChild(th); }
      thead.appendChild(header); table.appendChild(thead);
      const tbody = doc.createElement('tbody');
      for (const row of rows) {
        const tr = doc.createElement('tr');
        row.forEach((value,index) => { const cell = doc.createElement(index ? 'td' : 'th'); if (!index) cell.scope = 'row'; cell.textContent = value; tr.appendChild(cell); });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody); container.appendChild(table);
    }
    function refresh() {
      if (applying) return;
      let current;
      try { current = snapshot(doc,tool); } catch (_) {}
      for (const action of ['save-a','copy-result','copy-link']) button(action).disabled = !current;
      button('save-png').disabled = !current || pngBusy;
      include.disabled = !saved; button('clear-a').disabled = !saved;
      part('availability').textContent = current ? '결과와 입력 조건을 확인한 뒤 복사하세요.' : '입력값을 확인하면 결과 복사와 조건 비교를 사용할 수 있습니다.';
      part('comparison').hidden = !saved;
      if (saved) {
        const outputs = new Map(saved.outputs.map(row => [row.key,row]));
        if (current) for (const row of current.outputs) if (!outputs.has(row.key)) outputs.set(row.key,row);
        const rows=cfg.fields.map(field => [field.label,inputLabel(field,saved.inputs),current ? inputLabel(field,current.inputs) : '입력 확인']);
        rows.push(...[...outputs.values()].map(row => [row.label,saved.outputs.find(item => item.key === row.key)?.value || '미입력',current ? current.outputs.find(item => item.key === row.key)?.value || '미입력/비교 제외' : '입력 확인']));
        cells(part('comparison-table'),['항목','저장한 조건 A','현재 조건 B'],rows);
      }
    }
    function preview() {
      pending = null; part('preview').hidden = true;
      try {
        pending = readFragment(win.location.hash,tool);
        if (!pending) return;
        const inputs = pending.current, a = pending.baseline;
        cells(part('preview-table'),a ? ['입력 항목','조건 A','조건 B'] : ['입력 항목','공유받은 조건'],cfg.fields.map(field => a ? [field.label,inputLabel(field,a),inputLabel(field,inputs)] : [field.label,inputLabel(field,inputs)]));
        part('preview').hidden = false;
        say('공유받은 조건이 있습니다. 아직 입력값을 바꾸지 않았습니다. 확인 후 적용하세요.');
      } catch (_) { say('공유 조건을 읽을 수 없습니다. 기존 입력값은 변경하지 않았습니다.'); }
    }
    async function copy(value) {
      part('fallback').hidden = true;
      try {
        if (!win.navigator.clipboard || !win.navigator.clipboard.writeText) throw Error('clipboard');
        await win.navigator.clipboard.writeText(value);
        say('복사했습니다. 공유할 상대와 포함된 금액을 확인하세요.');
      } catch (_) {
        part('fallback-text').value = value;
        part('fallback').hidden = false;
        part('fallback-text').focus(); part('fallback-text').select();
        say('자동 복사를 사용할 수 없습니다. 아래 내용을 직접 선택해 복사하세요.');
      }
    }
    function focusVisibleAction() {
      const target=button('copy-result');
      if (!target.disabled) target.focus();
      else { status.setAttribute('tabindex','-1'); status.focus(); }
    }
    button('save-a').addEventListener('click',() => {
      try { saved = snapshot(doc,tool); refresh(); say('현재 입력과 결과를 조건 A로 보관했습니다. 입력을 바꾸면 현재 조건 B와 비교합니다.'); }
      catch (_) { refresh(); say('유효한 계산 결과를 먼저 확인하세요.'); }
    });
    button('clear-a').addEventListener('click',() => { saved = null; include.checked = false; refresh(); say('조건 A를 지웠습니다. 현재 입력값은 유지합니다.'); });
    for (const action of ['copy-result','copy-link']) button(action).addEventListener('click',() => {
      try {
        const current = snapshot(doc,tool), baseline = include.checked ? saved : null;
        const value = action === 'copy-link' ? makeLink(tool,current.inputs,baseline?.inputs) : textResult(tool,current,baseline);
        void copy(value);
      } catch (_) { refresh(); say('입력값과 계산 결과를 확인하세요. 일반 숫자로 입력한 유효한 조건만 복사할 수 있습니다.'); }
    });
    button('save-png').addEventListener('click',async () => {
      if (pngBusy) return;
      let canvas;
      const version=pngVersion;
      try {
        const current=snapshot(doc,tool), baseline=include.checked ? saved : null;
        const text=textResult(tool,current,baseline);
        pngBusy=true;refresh();say('입력값과 계산 결과로 PNG를 만들고 있습니다.');
        canvas=renderPng(doc,text);
        const blob=await pngBlob(win,canvas);
        // Never attach an async export to changed, invalid or newly applied inputs.
        if (version !== pngVersion || textResult(tool,snapshot(doc,tool),include.checked ? saved : null) !== text) throw Error('png-stale');
        if (!win.URL || !win.URL.createObjectURL || !win.URL.revokeObjectURL) throw Error('png-url');
        const nextUrl=win.URL.createObjectURL(blob);
        if (typeof nextUrl !== 'string' || !nextUrl.startsWith('blob:')) throw Error('png-url');
        clearPng();pngUrl=nextUrl;
        const pngLink=doc.createElement('a');
        pngLink.href=pngUrl;pngLink.download='cardpick-'+tool+'-calculation.png';pngLink.textContent='PNG 파일 저장';
        part('png-link').replaceChildren(pngLink);
        part('png-image').src=pngUrl;part('png-fallback').hidden=false;
        try { pngLink.click(); } catch (_) { /* The visible link remains available. */ }
        say('PNG를 만들었습니다. 저장이 시작되지 않으면 아래 PNG 파일 저장 링크를 이용하세요.');
      } catch (_) {
        clearPng();
        say('PNG를 만들지 못했습니다. 입력값을 확인하거나 결과 복사를 이용하세요. 긴 결과는 조건 A를 제외하고 다시 시도할 수 있습니다.');
      } finally { if (canvas) { canvas.width=0;canvas.height=0; }pngBusy=false;refresh(); }
    });
    button('apply').addEventListener('click',() => {
      if (!pending) return;
      applying = true;
      let applied=false;
      try {
        const result = applyPackage(win,tool,pending);
        saved = result.baseline; include.checked = false;
        pending = null; part('preview').hidden = true;
        applied=true;
        say('공유받은 조건을 적용했습니다. 기존 계산기로 다시 계산한 결과입니다.');
      } catch (_) { say('이 조건으로 계산할 수 없어 이전 입력값을 유지했습니다.'); }
      finally { applying = false; refresh(); if(applied) focusVisibleAction(); }
    });
    button('dismiss').addEventListener('click',() => { pending = null; part('preview').hidden = true; say('공유 조건을 적용하지 않았습니다. 기존 입력값을 유지합니다.'); focusVisibleAction(); });
    for (const name of ['input','change']) doc.addEventListener(name,event => {
      if (cfg.fields.some(field => field.id === event.target.id)) { clearPng();part('fallback').hidden = true; refresh(); }
    });
    include.addEventListener('change',clearPng);
    for (const action of ['save-a','clear-a','apply']) button(action).addEventListener('click',clearPng);
    for (const id of ['btnExample','btnEurope','btnReset']) doc.getElementById(id)?.addEventListener('click',() => {clearPng();refresh();});
    win.addEventListener('pagehide',clearPng);
    win.addEventListener('hashchange',preview);
    refresh(); preview();
  }
  const api = Object.freeze({MAX_FRAGMENT,PNG_LIMITS,normalize,readFragment,makeLink,snapshot,textResult,pngLayout,renderPng,pngBlob,applyPackage,mount});
  root.CardpickToolResults = api;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded',() => mount(root),{once:true});
    else mount(root);
  }
})(typeof window === 'undefined' ? globalThis : window);
