// Additive, literal identity constraints. The existing aliases, grading-intent
// guard and trusted-price policy remain owned by search-query.mjs.
import { planSearchQuery as planBaseQuery } from './search-query.mjs';
export { escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from './search-query.mjs';

const NUMBER = /^[a-z0-9]{1,12}(?:\/[a-z0-9]{1,12})?$/i;
const NUMBER_WITH_DIGIT = /^(?:\d+[a-z]?|[a-z]{1,5}\d+[a-z]?)(?:\/(?:\d+[a-z]?|[a-z]{1,5}\d+[a-z]?))?$/i;
const SET = /^[a-z0-9][a-z0-9-]{0,23}$/i;
// This recognizes a literal namespace-shaped input, not a code/name mapping.
// The value is compared with cards.set_id; it is never translated to set_code.
const NATURAL_SET_ID = /^(?:sv\d+(?:pt\d+)?|swsh\d+(?:pt\d+)?)$/i;
const LABELS = { number:'카드 번호', set_code:'세트 코드', set_id:'세트 ID' };

function fullInput(value) { return String(value ?? '').normalize('NFC').trim(); }

export function planSearchQuery(value) {
  const base = planBaseQuery(value);
  const identity = { number:null, set_code:null, set_id:null };
  const result = { ...base, identity, identityConditions:[], hasIdentityFilters:false,
    identityError:null, freeQuery:base.original, canSearch:!base.hasGradingIntent && base.queryTokens.length > 0 };
  // Examine the entire bounded original before any five-token query cap.
  if (base.hasGradingIntent) return result;
  const parts = base.original.split(/\s+/).filter(Boolean);
  const keep = [];
  let error = null;
  const full = fullInput(value);
  const fullParts = full.split(/\s+/);
  const fullHasPair = fullParts.some(part => NATURAL_SET_ID.test(part))
    && fullParts.some(part => NUMBER_WITH_DIGIT.test(part) && !NATURAL_SET_ID.test(part));
  if (full.length > 80 && (/(?:^|\s)(?:#|(?:set|code|id|number):)/i.test(full) || fullHasPair)) {
    error = '번호·세트 조건을 포함한 검색어는 80자 이내로 입력해 주세요.';
  }
  function assign(field, item) {
    if (!(field === 'number' ? NUMBER : SET).test(item)) {
      error = `${LABELS[field]} 형식을 확인해 주세요. 공백과 와일드카드는 사용할 수 없습니다.`;
    } else if (identity[field] && identity[field].toLowerCase() !== item.toLowerCase()) {
      error = `${LABELS[field]} 조건은 하나만 입력해 주세요.`;
    } else {
      identity[field] = identity[field] || item;
    }
  }
  for (const part of parts) {
    const explicit = part.match(/^(set|code|id|number):(.*)$/i);
    if (explicit) {
      const field = /^(?:set|code)$/i.test(explicit[1]) ? 'set_code' : /^id$/i.test(explicit[1]) ? 'set_id' : 'number';
      assign(field, explicit[2]);
    } else if (part.startsWith('#')) {
      assign('number', part.slice(1));
    } else {
      keep.push(part);
    }
  }
  // Only an unmistakable ID + number pair is inferred. Bare 151 and card
  // types/rarities such as EX, AR and VMAX retain the old free-text search.
  if (!identity.set_id && !identity.set_code) {
    const ids = keep.map((part,index) => NATURAL_SET_ID.test(part) ? index : -1).filter(index => index >= 0);
    const hasNumber = identity.number || keep.some(part => !NATURAL_SET_ID.test(part) && NUMBER_WITH_DIGIT.test(part));
    if (ids.length > 1 && hasNumber) error = '세트 ID 조건은 하나만 입력해 주세요.';
    else if (ids.length === 1 && hasNumber) {
      assign('set_id', keep.splice(ids[0],1)[0]);
    }
  }
  if ((identity.set_id || identity.set_code) && !identity.number) {
    const numbers = keep.map((part,index) => NUMBER_WITH_DIGIT.test(part) ? index : -1).filter(index => index >= 0);
    if (numbers.length === 1) assign('number', keep.splice(numbers[0],1)[0]);
    else if (numbers.length > 1) error = '카드 번호 조건은 하나만 입력해 주세요. 번호 앞에 #을 붙여 구분할 수 있습니다.';
  }
  const fractions = keep.map((part,index) => part.includes('/') && NUMBER_WITH_DIGIT.test(part) ? index : -1).filter(index => index >= 0);
  if (fractions.length > 1 || (identity.number && fractions.some(index => keep[index].toLowerCase() !== identity.number.toLowerCase()))) {
    error = '카드 번호 조건은 하나만 입력해 주세요. 분모가 다른 번호를 합쳐 검색하지 않습니다.';
  } else if (fractions.length === 1) {
    assign('number', keep.splice(fractions[0],1)[0]);
  }
  result.hasIdentityFilters = Object.values(identity).some(Boolean);
  // Never silently turn a truncated structured identifier into another card.
  if (full.length > 80 && (result.hasIdentityFilters || error)) {
    error = '번호·세트 조건을 포함한 검색어는 80자 이내로 입력해 주세요.';
  }
  if (!result.hasIdentityFilters && !error) return result;
  const remaining = planBaseQuery(keep.join(' '));
  result.freeQuery = keep.join(' ');
  result.queryNormalized = remaining.queryNormalized;
  result.queryTokens = remaining.queryTokens;
  result.removedIntentTokens = remaining.removedIntentTokens;
  result.intentOnly = remaining.intentOnly;
  result.identityConditions = Object.entries(identity).filter(([,item]) => item !== null)
    .map(([field,item]) => ({ field, label:LABELS[field], value:item }));
  result.identityError = error;
  result.canSearch = !error && (result.hasIdentityFilters || result.queryTokens.length > 0);
  return result;
}

export function identityFilterEntries(plan) {
  if (!plan || plan.hasGradingIntent || plan.identityError) return [];
  return ['set_code','set_id','number'].filter(field => plan.identity?.[field] != null)
    .map(field => [field, plan.identity[field]]);
}

export function serializeIdentityQuery({ query='', number='', set_code='', set_id='' } = {}) {
  const text = fullInput(query);
  const fields = { set_code:fullInput(set_code), set_id:fullInput(set_id), number:fullInput(number) };
  const queryText = [text, fields.set_code && `set:${fields.set_code}`, fields.set_id && `id:${fields.set_id}`,
    fields.number && `#${fields.number}`].filter(Boolean).join(' ');
  const plan = planSearchQuery(queryText);
  if (queryText.length > 80) return { query:queryText, error:'번호·세트 조건을 포함한 검색어는 80자 이내로 입력해 주세요.' };
  // Validate the form values as whole strings before tokenizing the final q.
  for (const [field,item] of Object.entries(fields)) {
    if (item && !(field === 'number' ? NUMBER : SET).test(item)) {
      return { query:queryText, error:`${LABELS[field]} 형식을 확인해 주세요. 공백과 와일드카드는 사용할 수 없습니다.` };
    }
  }
  return { query:queryText, error:plan.identityError };
}
