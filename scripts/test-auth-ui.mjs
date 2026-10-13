// Isolated execution of the real auth UI. No network, real account or DB writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../auth.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const turn = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await turn(); }

// A small DOM fixture implements only APIs used by the actual UI. It parses
// static templates so tests follow real selectors rather than returning mocks
// by selector name. Browser layout/AT is separately checked in central QA.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document;
    this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.style = {}; this.value = ''; this.disabled = false; this._html = ''; this._text = '';
  }
  set id(value) { this.setAttribute('id', value); }
  get id() { return this.getAttribute('id') || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  get isConnected() { return this === this.document.root || !!this.parentNode?.isConnected; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    let remaining = selector.trim();
    for (const match of [...remaining.matchAll(/:not\(([^)]+)\)/g)]) {
      if (this.matches(match[1])) return false;
      remaining = remaining.replace(match[0], '');
    }
    const tag = remaining.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const [, id] of remaining.matchAll(/#([\w-]+)/g)) if (this.id !== id) return false;
    for (const [, name] of remaining.matchAll(/\.([\w-]+)/g)) if (!(this.getAttribute('class') || '').split(/\s+/).includes(name)) return false;
    for (const [, name, value] of remaining.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (this.getAttribute(name) === null || (value !== undefined && this.getAttribute(name) !== value)) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => node.children.forEach(child => {
      if (selector.split(',').some(part => child.matches(part))) found.push(child);
      visit(child);
    });
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  set innerHTML(value) {
    this._html = value; this.children.forEach(child => { child.parentNode = null; }); this.children = [];
    const stack = [this];
    for (const token of value.match(/<[^>]*>|[^<]+/g) || []) {
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1)._text += token; continue; }
      const name = token.match(/^<([\w-]+)/)?.[1]; if (!name) continue;
      const child = new Element(name, this.document);
      for (const [, key, double, single, bare] of token.matchAll(/\s([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) child.setAttribute(key, double ?? single ?? bare ?? '');
      stack.at(-1).appendChild(child);
      if (!/\/>$/.test(token) && !['input', 'img', 'br', 'hr', 'meta', 'link'].includes(name)) stack.push(child);
    }
  }
  get innerHTML() { return this._html; }
  set textContent(value) { this._text = String(value); this.children = []; this._html = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  fire(name, extra = {}) { for (const callback of this.listeners.get(name) || []) callback({ target:this, ...extra }); }
  focus() { this.document.activeElement = this; this.document.dispatch('focusin', { target:this }); }
  getBoundingClientRect() { return { bottom:50, right:350 }; }
}

function harness(user = null, { missingSDK = false } = {}) {
  const listeners = new Map();
  const document = {
    readyState:'complete', activeElement:null,
    createElement(tag) { return new Element(tag, this); },
    getElementById(id) { return this.root.querySelector('#' + id); },
    querySelectorAll(selector) { return this.root.querySelectorAll(selector); },
    querySelector(selector) { return this.root.querySelector(selector); },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatch(name, extra = {}) {
      const event = { target:this.activeElement || this.body, prevented:false, stopped:false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      for (const callback of [...(listeners.get(name) || [])]) callback(event);
      return event;
    },
  };
  document.root = document.createElement('document');
  document.head = document.root.appendChild(document.createElement('head'));
  document.body = document.root.appendChild(document.createElement('body'));
  const button = document.body.appendChild(document.createElement('button'));
  button.setAttribute('class', 'cp-login-google'); button.setAttribute('aria-label', 'Google로 로그인');
  const link = document.body.appendChild(document.createElement('a'));
  link.setAttribute('class', 'login-google'); link.setAttribute('href', '/login/google');
  const outside = document.body.appendChild(document.createElement('a')); outside.setAttribute('href', '/');
  const oauth = [], apiCalls = [], alerts = [], storage = new Map([['cp-nick-skip', '1']]);
  const auth = {
    getSession:async () => ({ data:{ session:user ? { user } : null } }),
    getUser:async () => ({ data:{ user } }),
    onAuthStateChange(callback) { this.callback = callback; },
    signInWithOAuth:async options => { oauth.push(options); return {}; },
    signOut:async () => {},
  };
  const client = { auth, from(table) {
    assert.equal(table, 'profiles');
    const query = { fields:'', select(fields) { this.fields = fields; return this; }, eq() { return this; },
      async maybeSingle() {
        apiCalls.push({ table, fields:this.fields });
        return { data:this.fields === 'id' ? null : this.fields === '*' ? { nickname:'기존닉네임' }
          : { avatar_url:user?.user_metadata?.avatar_url, display_name:user?.user_metadata?.name || user?.user_metadata?.full_name } };
      },
      insert() { assert.fail('UI fixture must not add a profile write'); },
      update() { assert.fail('UI fixture must not change profile data'); },
      upsert() { assert.fail('UI fixture must not save a nickname'); },
    };
    return query;
  } };
  const sdk = { createClient:() => client };
  const window = { innerWidth:375, supabase:missingSDK ? undefined : sdk };
  const timers = new Map(); let nextTimer = 0;
  const context = { window, document, URL, location:{ origin:'https://cardpick.kr', pathname:'/guides' },
    sessionStorage:{ getItem:key => storage.get(key), setItem:(key, value) => storage.set(key, value) },
    setTimeout:(callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout:id => timers.delete(id), confirm:() => false, alert:message => alerts.push(message),
    console:{ warn() {}, error() {} },
  };
  vm.runInNewContext(source, context, { timeout:1000, filename:'auth.js' });
  function click(element) { element.onclick?.({ target:element, preventDefault() {}, stopPropagation() {} }); }
  return { document, window, button, link, outside, oauth, apiCalls, storage, timers, alerts, click, auth };
}

test('authentication, OAuth, session, profile and watch/alert persistence functions are byte-preserved', () => {
  const approved = {
    loadSDK:'f9edf67614b7b4ec6f1f0081213007cdf311a5244dcba302557988a3e23eb2f6',
    getClient:'3e4aec613bccb38ae837352f6da01e03feb809212288c6acb54f671b04a39706',
    signIn:'bbfc43bba2521156cef2710eebef7fd417c7a8e0ebec96dfbbe297f32e2363fa',
    signOut:'0de9c8327dac75d493c823ccbf36483e9be9c70ab65a978931c303bf87bbf25f',
    syncProfileFromMetadata:'03d4da674928a29fe55952473673ddbbb3b2eff81bdeee89e0617207febe7c45',
    getMyProfile:'0a6e75aa6b9ab51759eb119f42a650124136000a7c3ba4058725a43516900e99',
    isNicknameAvailable:'530852081c286d8733ba54afd348a44334d94ae75fec85693f64fa20be468b6f',
    saveNickname:'4db44c4378542aa2a5cae0dcb2ecec670a69cc741fd10ef41a72fa45d400ce4e',
    maybePromptNickname:'8addb3860ec03c8c58b5c311957a75717a6dd71594de4ae731cb7e7f6ed59d70',
    init:'0f5b76e27a8f29375b0065d1348cce5a81f62b2b96ddaaed6255a0e84e39dc34',
    getWatchlist:'01927ef2de57e2dc57f982cef06d4b9cae2fffca398dfeb859377e865aa1b690',
    isWatched:'861a8c24e14441d3705a15c03a54188b50f14df01e946acf03b22918983d3f69',
    addWatch:'69bce46cef4ca7b85d70d363d82ca7df25811a773d8b6cd4f94300a99bce5eac',
    removeWatch:'38e0d4758cfd6b0ac3cc21d9ab981f2665c0e8f2d669cfcb5c6198c561344d7f',
    getAlert:'34672dde69a81d6ba3f033fdd6baaecc8693c1ffdafbe164fdc2c677a263f224',
    subscribeAlert:'deba5dacaac3b8d61d2cf9d6451975f0e00b3925440002e89f6a4a18bc834103',
    unsubscribeAlert:'d0f7ba1d5ab1fa0e50da07011f9b0e9774d3bc2d550111eaeaaff6a90a4e91f5',
  };
  for (const [name, expected] of Object.entries(approved)) {
    let block = source.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'))?.[0];
    assert.ok(block, name);
    if (name === 'init') block = block.replace('    installAuthUIStyles();\n', '');
    assert.equal(createHash('sha256').update(block).digest('hex'), expected, name + ' must retain its approved API contract');
  }
});

test('owned button styles are available before a delayed SDK, without adding header/global selectors', () => {
  const page = harness(null, { missingSDK:true });
  const style = page.document.getElementById('cp-auth-ui-style');
  assert.match(style.textContent, /@media\(max-width:980px\)/);
  assert.match(style.textContent, /min-height:44px;min-width:44px/);
  assert.match(style.textContent, /:focus-visible/);
  assert.doesNotMatch(style.textContent, /(?:^|})\s*(?:header|nav|body|\.cp-nav|\.brand)[{ :]/);
  assert.equal(page.document.head.querySelectorAll('script').length, 1, 'existing single SDK request remains');
});

test('signed-in user names and emails are DOM text, never executable template content', async () => {
  const name = '<img src=x onerror=alert(1)> "테스터"';
  const email = '<svg onload=alert(1)>@example.test';
  const page = harness({ id:'test-user', email, user_metadata:{ name, avatar_url:'javascript:alert(1)' } });
  await settle();
  assert.equal(page.button.querySelector('[data-cp-name]').textContent, name);
  assert.ok(!page.button.innerHTML.includes(name));
  assert.equal(page.button.querySelectorAll('img').length, 0);
  assert.equal(page.button.getAttribute('aria-label'), name + ' 사용자 메뉴');
  page.click(page.button);
  const menu = page.document.querySelector('[data-cp-menu]');
  assert.equal(menu.querySelector('[data-cp-name]').textContent, name);
  assert.equal(menu.querySelector('[data-cp-email]').textContent, email);
  assert.ok(!menu.innerHTML.includes(name)); assert.ok(!menu.innerHTML.includes(email));
  assert.equal(menu.querySelectorAll('img').length, 0);
  assert.equal(page.oauth.length, 0); assert.equal(page.alerts.length, 0);
});

for (const avatar of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//example.test/a.png', 'http://example.test/a.png', 'https://user:pass@example.test/a.png', 'not a url']) {
  test('unsafe or non-HTTPS avatar falls back to initials: ' + avatar.split(':')[0], async () => {
    const page = harness({ id:'test-user', email:'test@example.test', user_metadata:{ name:'사용자', avatar_url:avatar } });
    await settle();
    assert.equal(page.button.querySelectorAll('img').length, 0);
    assert.equal(page.button.querySelector('[data-cp-avatar]').textContent, '사');
  });
}

test('HTTPS avatars are created through the DOM and signed-out rendering resets menu state', async () => {
  const page = harness({ id:'test-user', email:'test@example.test', user_metadata:{ name:'테스터', avatar_url:'https://example.test/avatar.png' } });
  await settle();
  assert.equal(page.button.querySelector('img').src, 'https://example.test/avatar.png');
  assert.equal(page.button.querySelector('img').alt, '');
  assert.ok(!page.button.innerHTML.includes('https://example.test/avatar.png'));
  assert.equal(page.link.getAttribute('role'), 'button');
  page.click(page.button); page.auth.callback('SIGNED_OUT', null);
  assert.equal(page.document.querySelector('[data-cp-menu]'), null);
  for (const button of [page.button, page.link]) {
    assert.equal(button.getAttribute('aria-label'), 'Google로 로그인');
    assert.equal(button.getAttribute('aria-haspopup'), null); assert.equal(button.getAttribute('aria-expanded'), null);
  }
  page.click(page.link); await settle();
  assert.equal(page.oauth.length, 1);
  assert.equal(page.oauth[0].provider, 'google');
  assert.equal(page.oauth[0].options.redirectTo, 'https://cardpick.kr/guides');
});

test('user menu announces expansion, supports navigation keys and Escape focus return without a focus trap', async () => {
  const page = harness({ id:'test-user', email:'test@example.test', user_metadata:{ name:'테스터' } });
  await settle(); page.button.focus(); page.click(page.button);
  const menu = page.document.querySelector('[data-cp-menu]'), items = menu.querySelectorAll('[role="menuitem"]');
  assert.equal(page.button.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.id, page.button.getAttribute('aria-controls'));
  assert.equal(menu.getAttribute('role'), 'menu'); assert.equal(items.length, 4);
  assert.equal(page.document.activeElement, items[0]);
  page.document.dispatch('keydown', { key:'ArrowDown' }); assert.equal(page.document.activeElement, items[1]);
  page.document.dispatch('keydown', { key:'End' }); assert.equal(page.document.activeElement, items[3]);
  page.document.dispatch('keydown', { key:'ArrowDown' }); assert.equal(page.document.activeElement, items[0]);
  page.document.dispatch('keydown', { key:'Escape' });
  assert.equal(page.document.querySelector('[data-cp-menu]'), null);
  assert.equal(page.button.getAttribute('aria-expanded'), 'false'); assert.equal(page.document.activeElement, page.button);
  page.click(page.button); page.outside.focus();
  assert.equal(page.document.querySelector('[data-cp-menu]'), null); assert.equal(page.document.activeElement, page.outside);
});

test('nickname dialog has a name, description, live validation and Tab/Escape/focus lifecycle', async () => {
  const page = harness(); await settle(); page.button.focus();
  page.window.cardpickAuth.openNicknameModal();
  const modal = page.document.getElementById('cp-nick-modal');
  const input = modal.querySelector('#cp-nick-input'), save = modal.querySelector('#cp-nick-save'), skip = modal.querySelector('#cp-nick-skip');
  assert.equal(modal.getAttribute('role'), 'dialog'); assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.ok(page.document.getElementById(modal.getAttribute('aria-labelledby')));
  assert.ok(page.document.getElementById(modal.getAttribute('aria-describedby')));
  assert.equal(input.getAttribute('aria-label'), '닉네임');
  assert.equal(modal.querySelector('#cp-nick-msg').getAttribute('role'), 'status');
  assert.equal(page.document.activeElement, input);
  page.document.dispatch('keydown', { key:'Tab', shiftKey:true }); assert.equal(page.document.activeElement, skip);
  page.document.dispatch('keydown', { key:'Tab' }); assert.equal(page.document.activeElement, input);
  save.disabled = true; skip.focus(); page.document.dispatch('keydown', { key:'Tab' }); assert.equal(page.document.activeElement, input);
  page.outside.focus(); assert.equal(page.document.activeElement, input);
  const composing = page.document.dispatch('keydown', { key:'Escape', isComposing:true });
  assert.equal(composing.prevented, false); assert.ok(modal.isConnected);
  page.document.dispatch('keydown', { key:'Escape' });
  assert.equal(page.document.getElementById('cp-nick-modal'), null); assert.equal(page.document.activeElement, page.button);
  assert.equal(page.storage.get('cp-nick-skip'), '1');
  page.outside.focus(); assert.equal(page.document.activeElement, page.outside, 'removed dialog must not retain focus listeners');
  assert.equal(page.oauth.length, 0); assert.equal(page.apiCalls.length, 0);
});

test('nickname close cancels scheduled validation and retains the existing explicit skip behavior', async () => {
  const page = harness(); await settle(); page.button.focus(); page.window.cardpickAuth.openNicknameModal();
  const modal = page.document.getElementById('cp-nick-modal'), input = modal.querySelector('#cp-nick-input');
  input.value = '테스터'; input.fire('input'); assert.equal(page.timers.size, 1);
  page.click(modal.querySelector('#cp-nick-skip'));
  assert.equal(page.timers.size, 0); assert.equal(page.document.activeElement, page.button);
  assert.equal(page.storage.get('cp-nick-skip'), '1'); assert.equal(page.apiCalls.length, 0);
});
