import test from 'node:test';
import assert from 'node:assert/strict';
import { planSearchQuery, identityFilterEntries, serializeIdentityQuery } from '../search-identity.mjs';
import { planSearchQuery as basePlan } from '../search-query.mjs';

// Test-only identifiers below exercise string contracts, not catalog claims.
for (const input of ['코코리', '코코리205', '뮤츠 ex', '151', 'EX', 'AR', 'VMAX', '모르는한글세트', 'SSP 205',
  'a%_\\*', '***', '', '시세', '리자몽 가격', 'a b c d e f g', 'a'.repeat(100)]) {
  test(`ordinary search ${input} retains the existing planner`, () => {
    const actual=planSearchQuery(input), expected=basePlan(input);
    for(const [key,value] of Object.entries(expected)) assert.deepEqual(actual[key],value,key);
    assert.deepEqual(identityFilterEntries(actual),[]);
    assert.equal(actual.hasIdentityFilters,false);
  });
}

for (const [input, filters, tokens] of [
  ['코코리 #205', [['number','205']], ['phanpy']],
  ['set:SSP #205', [['set_code','SSP'],['number','205']], []],
  ['id:sv3pt5 #199', [['set_id','sv3pt5'],['number','199']], []],
  ['sv3pt5 199', [['set_id','sv3pt5'],['number','199']], []],
  ['SV3PT5 199/091 가격', [['set_id','SV3PT5'],['number','199/091']], []],
  ['set:SSP 205', [['set_code','SSP'],['number','205']], []],
  ['199/091', [['number','199/091']], []],
  ['#001', [['number','001']], []],
  ['#TG01/TG30', [['number','TG01/TG30']], []],
  ['#SVP001', [['number','SVP001']], []],
  ['#58a', [['number','58a']], []],
  ['CODE:fXa #001/100', [['set_code','fXa'],['number','001/100']], []],
  ['a b c d e f #001', [['number','001']], ['a','b','c','d','e']],
  ['코코리 set:SSP id:sv8 #205', [['set_code','SSP'],['set_id','sv8'],['number','205']], ['phanpy']],
  ['#001 #001', [['number','001']], []],
]) {
  test(`literal identity ${input}`, () => {
    const plan=planSearchQuery(input);
    assert.equal(plan.identityError,null);
    assert.equal(plan.canSearch,true);
    assert.equal(plan.hasIdentityFilters,true);
    assert.deepEqual(identityFilterEntries(plan),filters);
    assert.deepEqual(plan.queryTokens,tokens);
    assert.equal(plan.original,input.normalize('NFC').trim().slice(0,80));
  });
}

for(const input of ['set:', '#', '#001 #002', 'id:sv1 id:sv2', '#199/', '#1/2/3', '#-1',
  'set:a%','set:a_','set:a*','id:a\\b','set:a,b','set:(a)','number:1).or.(number.eq.2',
  'set:SSP 199 200', 'set:'+'A'.repeat(25), '#'+ '1'.repeat(13),
  'a'.repeat(79)+' #001', '#001 '+ 'a'.repeat(90), 'a'.repeat(80)+' sv3pt5 199',
  '199/165 199/091', 'sv3pt5 swsh12 199', 'sv3pt5 swsh12 #199', '#199 199/091']) {
  test(`invalid identity ${input} never broadens into a free lookup`, () => {
    const plan=planSearchQuery(input);
    assert.ok(plan.identityError);
    assert.equal(plan.canSearch,false);
    assert.deepEqual(identityFilterEntries(plan),[]);
  });
}

for(const input of ['sv3pt5 199 PSA 10', 'set:SSP #205 BRG', 'id:bad% CGC 10', '#001 등급']) {
  test(`grading wins over identity ${input}`, () => {
    const plan=planSearchQuery(input);
    assert.equal(plan.hasGradingIntent,true);
    assert.equal(plan.canSearch,false);
    assert.equal(plan.identityError,null);
    assert.deepEqual(identityFilterEntries(plan),[]);
    assert.deepEqual(plan.queryTokens,[]);
  });
}

test('no number component is normalized or silently dropped',()=>{
  for(const number of ['1','001','001/100','001/200','TG01','TG1','SVP001','58a']) {
    assert.equal(planSearchQuery('#'+number).identity.number,number);
  }
  assert.equal(planSearchQuery('sv3pt5 199').identity.set_code,null);
  assert.deepEqual(planSearchQuery('스칼렛 바이올렛 #001').queryTokens,['스칼렛','바이올렛']);
});

test('form serialization keeps q as the only new search value',()=>{
  assert.deepEqual(serializeIdentityQuery({query:' 코코리 ',set_code:'SSP',set_id:'sv8',number:'001/100'}),
    {query:'코코리 set:SSP id:sv8 #001/100',error:null});
  assert.deepEqual(serializeIdentityQuery({query:'PSA 10',number:'205'}),{query:'PSA 10 #205',error:null});
  for(const item of [{number:'1 2'},{set_code:'SSP #2'},{set_id:'a%'}]) assert.ok(serializeIdentityQuery(item).error);
  assert.ok(serializeIdentityQuery({query:'a'.repeat(80),number:'001'}).error);
});
