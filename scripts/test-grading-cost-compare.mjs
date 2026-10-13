import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../tools/grading-cost-compare.html', import.meta.url), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const COMPANIES'));
assert.ok(code, 'exercise the actual calculator, not a duplicated formula');

// Isolated DOM fixture only. No network, auth, logs, storage or database calls.
function calculator() {
  const elements = new Map();
  function element(id, value = '') {
    const attrs = {}, classes = new Set(), listeners = {};
    const el = {id, value, textContent:'', style:{}, dataset:{}, selectionStart:0,
      setAttribute(k,v){attrs[k]=v;}, getAttribute(k){return attrs[k];},
      addEventListener(k,fn){(listeners[k] ||= []).push(fn);},
      emit(k){for(const fn of listeners[k] || []) fn({target:el});},
      setSelectionRange(){}, classList:{remove(k){classes.delete(k);},
        toggle(k,on){if(on)classes.add(k);else classes.delete(k);},contains(k){return classes.has(k);}}};
    elements.set(id,el); return el;
  }
  for (const match of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    element(match[1], match[0].match(/\bvalue="([^"]*)"/)?.[1] || '');
  }
  element('i-mode','agency');
  for(const id of ['btnExample','btnReset','o-best-name','o-best-detail','o-best-warn','qty-tip'])element(id);
  const cards = ['psa','bgs','cgc','sgc'].map(co => {const el=element('card-'+co);el.dataset.co=co;return el;});
  const outs = [...html.matchAll(/<[^>]+data-out="([^"]+)"[^>]*>/g)].map(m=>element(m[1]));
  const numeric = ['i-decl','i-ship','i-agent','i-misc'].map(id=>elements.get(id));
  const decimal = ['i-fx','g-psa','g-bgs','g-cgc','g-sgc'].map(id=>elements.get(id));
  const document = {
    getElementById(id){assert.ok(elements.has(id),id);return elements.get(id);},
    querySelector(selector){return elements.get(selector.match(/data-out="([^"]+)"/)?.[1]);},
    querySelectorAll(selector){
      if(selector==='[data-out]')return outs;
      if(selector==='.co-card')return cards;
      if(selector==='input[type="text"][inputmode="numeric"]')return numeric;
      if(selector==='input[inputmode="decimal"]')return decimal;
      throw Error('Unexpected selector: '+selector);
    }
  };
  vm.runInNewContext(code,{document});
  return {get:id=>elements.get(id),set(id,value){elements.get(id).value=String(value);elements.get(id).emit('input');},
    click:id=>elements.get(id).emit('click'),outs,cards};
}
const krw = n => '₩ ' + Math.round(n).toLocaleString('ko-KR');

test('normal example preserves all four company formulas and excludes SGC from minimum',()=>{
  const c=calculator(), overhead=120000;
  for(const [co,usd] of Object.entries({psa:32.99,bgs:34.95,cgc:18,sgc:15})){
    assert.equal(c.get('grade-'+co).textContent,krw(usd*1381*3));
    assert.equal(c.get('total-'+co).textContent,krw(usd*1381*3+overhead));
    assert.equal(c.get('per-'+co).textContent,krw((usd*1381*3+overhead)/3));
  }
  assert.equal(c.get('o-best-name').textContent,'CGC');
  assert.equal(c.get('card-sgc').classList.contains('best'),false);
});
for(const [id,value] of [['i-qty',''],['i-qty','0'],['i-qty','1.5'],['i-qty','-1'],['i-qty','9007199254740992'],
  ['i-fx','Infinity'],['i-fx','1e308'],['g-psa','1e308'],['g-psa','NaN'],['g-psa','-1'],
  ['i-ship','-1'],['i-ship','1.5'],['i-ship','9007199254740992']]){
  test('invalid '+id+'='+JSON.stringify(value)+' cannot become a zero or minimum',()=>{
    const c=calculator();c.set(id,value);
    assert.equal(c.get(id).getAttribute('aria-invalid'),'true');
    assert.equal(c.get('o-best-name').textContent,'입력 확인');
    assert.ok(c.outs.every(el=>el.textContent==='입력 확인'));
    assert.ok(c.cards.every(el=>!el.classList.contains('best')));
  });
}
test('individually finite safe inputs with unsafe derived totals are rejected atomically',()=>{
  const c=calculator();c.set('i-qty',Number.MAX_SAFE_INTEGER);
  assert.equal(c.get('i-qty').getAttribute('aria-invalid'),'true');
  assert.match(c.get('o-best-detail').textContent,/조합/);
  assert.ok(c.outs.every(el=>el.textContent==='입력 확인'));
  c.click('btnExample');
  assert.equal(c.get('i-qty').getAttribute('aria-invalid'),'false');
  assert.equal(c.get('o-best-name').textContent,'CGC');
});
test('safe costs whose sum is unsafe are rejected even with all fees blank',()=>{
  const c=calculator();for(const co of ['psa','bgs','cgc','sgc'])c.set('g-'+co,'');
  c.set('i-ship',Number.MAX_SAFE_INTEGER);c.set('i-misc','1');
  assert.equal(c.get('o-best-name').textContent,'입력 확인');
});
test('direct mode omits agency cost, including unused malformed value',()=>{
  const c=calculator();c.set('i-mode','direct');c.set('i-agent','bad');
  assert.equal(c.get('total-psa').textContent,krw(32.99*1381*3+60000));
  assert.equal(c.get('i-agent').getAttribute('aria-invalid'),'false');
  c.set('i-mode','agency');assert.equal(c.get('i-agent').getAttribute('aria-invalid'),'true');
});
test('blank fees are not free quotes; two comparable equal quotes retain ties',()=>{
  const c=calculator();for(const co of ['bgs','cgc','sgc'])c.set('g-'+co,'');
  assert.equal(c.get('total-bgs').textContent,'미입력');
  assert.equal(c.get('o-best-name').textContent,'개별 비용 계산');
  c.set('g-bgs','32.99');assert.match(c.get('o-best-name').textContent,/PSA · BGS.*동률/);
});
test('reset, recovery and formatted integer costs remain usable',()=>{
  const c=calculator();c.click('btnReset');
  assert.equal(c.get('i-fx').getAttribute('aria-invalid'),'true');
  c.set('i-fx','1381');
  assert.equal(c.get('o-best-name').textContent,'요금 입력 대기');
  assert.ok(c.outs.every(el=>el.textContent==='미입력'));
  c.click('btnExample');c.set('i-ship','1000');
  assert.equal(c.get('i-ship').value,'1,000');
  assert.equal(c.get('total-psa').textContent,krw(32.99*1381*3+61000));
});
