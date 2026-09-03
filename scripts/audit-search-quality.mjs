#!/usr/bin/env node

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));

const base = String(args.get('base') || 'https://cardpick.kr').replace(/\/$/, '');
const sampleLimit = Math.max(0, Math.min(100, Number(args.get('limit') || 12)));
const timeoutMs = Math.max(1000, Number(args.get('timeout') || 15000));

function xmlUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
}

function tagAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function metaContent(html, name) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (tagAttribute(match[0], 'name').toLowerCase() === name.toLowerCase()) return tagAttribute(match[0], 'content');
  }
  return '';
}

function canonicalHref(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (tagAttribute(match[0], 'rel').toLowerCase().split(/\s+/).includes('canonical')) return tagAttribute(match[0], 'href');
  }
  return '';
}

function visibleText(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function firstElementText(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  return match ? visibleText(match[1]) : '';
}

function wonValue(text) {
  const match = String(text || '').match(/₩\s*([\d,]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function jsonLdPrices(html) {
  const prices = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack = [JSON.parse(match[1])];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== 'object') continue;
        if (item.priceCurrency === 'KRW' && item.price != null) prices.push(Number(item.price));
        if (item['@type'] === 'PropertyValue' && item.name === 'latest_krw' && item.unitText === 'KRW' && item.value != null) prices.push(Number(item.value));
        for (const child of Object.values(item)) if (child && typeof child === 'object') stack.push(child);
      }
    } catch {
      prices.push(Number.NaN);
    }
  }
  return prices;
}

async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'CardpickQualityAudit/1.0 (+https://cardpick.kr/about)' }, signal: controller.signal });
    return { url, status: response.status, location: response.headers.get('location') || '', xRobots: response.headers.get('x-robots-tag') || '', body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectPage(url, { expectedInSitemap = false, requireNoindex = false, requireNoAds = false } = {}) {
  const result = await request(url);
  const text = visibleText(result.body);
  const robots = metaContent(result.body, 'robots');
  const canonical = canonicalHref(result.body);
  const adsenseScript = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(result.body);
  const heroPrice = wonValue(firstElementText(result.body, 'hero-price'));
  const descriptionPrice = wonValue(metaContent(result.body, 'description'));
  const ldPrices = jsonLdPrices(result.body);
  const numericLdPrices = ldPrices.filter(Number.isFinite);
  const priceSet = new Set([heroPrice, descriptionPrice, ...numericLdPrices].filter((value) => value != null));
  const findings = [];
  if (result.status !== 200) findings.push(`HTTP ${result.status}`);
  if (requireNoindex && !/noindex/i.test(`${robots} ${result.xRobots}`)) findings.push('required noindex missing');
  if (requireNoAds && adsenseScript) findings.push('AdSense script on excluded page');
  if (expectedInSitemap && /noindex/i.test(`${robots} ${result.xRobots}`)) findings.push('sitemap URL is noindex');
  if (expectedInSitemap && canonical && new URL(canonical).pathname !== new URL(url).pathname) findings.push(`canonical mismatch: ${canonical}`);
  if (/불러오는 중|로딩 중|가격 데이터를 불러오는 중/i.test(text)) findings.push('visible loading placeholder');
  if (ldPrices.some(Number.isNaN)) findings.push('invalid JSON-LD');
  if (priceSet.size > 1) findings.push(`price mismatch: ${[...priceSet].join(', ')}`);
  return { url, status: result.status, location: result.location, robots: robots || result.xRobots, canonical, visibleCharacters: text.length, adsenseScript, heroPrice, descriptionPrice, jsonLdPrices: numericLdPrices, findings };
}

async function main() {
  const contentUrls = [`${base}/`, `${base}/guides`, `${base}/tools`, `${base}/about`];
  const excludedUrls = [`${base}/catalog`, `${base}/facts/site`, `${base}/facts/glossary`, `${base}/facts/tools/grading-cost-compare`];
  const [mainSitemap, cardSitemap] = await Promise.all([request(`${base}/sitemap.xml`), request(`${base}/sitemap-cards.xml`)]);
  const mainUrls = xmlUrls(mainSitemap.body);
  const cardUrls = xmlUrls(cardSitemap.body);
  const sampleUrls = cardUrls.slice(0, sampleLimit).map((url) => `${base}${new URL(url).pathname}`);
  const pages = [];
  for (const url of contentUrls) pages.push(await inspectPage(url));
  for (const url of excludedUrls) pages.push(await inspectPage(url, { requireNoindex: url.includes('/facts/'), requireNoAds: true }));
  for (const url of sampleUrls) pages.push(await inspectPage(url, { expectedInSitemap: true, requireNoAds: true }));
  const report = {
    auditedAt: new Date().toISOString(), base, mode: 'read-only',
    sitemap: { main: { status: mainSitemap.status, urlCount: mainUrls.length }, cards: { status: cardSitemap.status, urlCount: cardUrls.length, sampled: sampleUrls.length } },
    summary: {
      pagesChecked: pages.length,
      pagesWithFindings: pages.filter((page) => page.findings.length).length,
      sitemapSampleNoindex: pages.filter((page) => sampleUrls.includes(page.url) && /noindex/i.test(page.robots)).length,
      visibleLoadingPlaceholders: pages.filter((page) => page.findings.includes('visible loading placeholder')).length,
      priceMismatches: pages.filter((page) => page.findings.some((finding) => finding.startsWith('price mismatch'))).length,
      pagesWithAdsenseScript: pages.filter((page) => page.adsenseScript).length,
      adsenseScriptsOnExcludedPages: pages.filter((page) => page.findings.includes('AdSense script on excluded page')).length
    }, pages
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (pages.some((page) => page.status >= 500)) process.exitCode = 2;
  else if (report.summary.pagesWithFindings) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`audit failed: ${error.message}\n`);
  process.exitCode = 2;
});
