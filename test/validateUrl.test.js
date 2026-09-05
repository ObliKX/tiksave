const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');

const axiosPath = require.resolve('axios');
const axiosModule = require(axiosPath);
const calls = [];
let responses = new Map();

function responseKey(config) {
  return `${config.method.toLowerCase()}:${config.url}`;
}

function fakeAxios(config) {
  calls.push(config);
  const planned = responses.get(responseKey(config));
  if (!planned) return Promise.reject(new Error(`Unexpected request: ${responseKey(config)}`));
  if (planned instanceof Error) return Promise.reject(planned);
  return Promise.resolve(planned);
}

require.cache[axiosPath].exports = fakeAxios;
delete require.cache[require.resolve('../server/utils/validateUrl')];
const {
  resolveAndValidateUrl,
  isValidTikTokDomain,
  isPrivateIp,
  canonicalUrlFromHtml,
  getValidatedRedirectUrl
} = require('../server/utils/validateUrl');

function setResponses(entries) {
  responses = new Map(entries.map(([method, url, response]) => [
    `${method}:${url}`,
    response
  ]));
  calls.length = 0;
}

function ok(data = '', headers = {}) {
  return { status: 200, headers, data };
}

function redirect(location, status = 302) {
  return { status, headers: { location }, data: '' };
}

beforeEach(() => {
  setResponses([]);
});

test('strictly validates TikTok domains and protocols', () => {
  assert.equal(isValidTikTokDomain('https://vm.tiktok.com/ZGdQ1wTjV/'), true);
  assert.equal(isValidTikTokDomain('https://vt.tiktok.com/example'), true);
  assert.equal(isValidTikTokDomain('https://tiktok.com/@user/video/1'), true);
  assert.equal(isValidTikTokDomain('http://www.tiktok.com/@user/video/1'), true);
  assert.equal(isValidTikTokDomain('https://tiktok.com.evil.example/video/1'), false);
  assert.equal(isValidTikTokDomain('https://user:pass@tiktok.com/video/1'), false);
  assert.equal(isValidTikTokDomain('file:///etc/passwd'), false);
});

test('resolves a short URL with GET fallback when HEAD has no usable redirect', async () => {
  const shortUrl = 'https://vm.tiktok.com/ZGdQ1wTjV/';
  const finalUrl = 'https://www.tiktok.com/@creator/video/1234567890';
  setResponses([
    ['head', shortUrl, ok('<ignored>')],
    ['get', shortUrl, redirect(finalUrl)],
    ['head', finalUrl, ok()]
  ]);

  assert.equal(await resolveAndValidateUrl(shortUrl), finalUrl);
  assert.deepEqual(calls.map((call) => call.method.toLowerCase()), ['head', 'get', 'head']);
  assert.ok(calls.every((call) => call.maxRedirects === 0));
});

test('follows multiple absolute, protocol-relative, and relative TikTok redirects', async () => {
  const shortUrl = 'https://vt.tiktok.com/example/';
  const firstHop = 'https://vm.tiktok.com/step/';
  const secondHop = 'https://www.tiktok.com/@creator/video/2';
  setResponses([
    ['head', shortUrl, redirect('//vm.tiktok.com/step/')],
    ['head', firstHop, redirect('../step-2')],
    ['head', 'https://vm.tiktok.com/step-2', redirect(secondHop)],
    ['head', secondHop, ok()]
  ]);

  assert.equal(await resolveAndValidateUrl(shortUrl), secondHop);
  assert.equal(calls.length, 4);
});

test('blocks a non-TikTok redirect before following it', async () => {
  const shortUrl = 'https://vm.tiktok.com/unsafe/';
  setResponses([
    ['head', shortUrl, redirect('https://169.254.169.254/latest/meta-data/')]
  ]);

  await assert.rejects(
    resolveAndValidateUrl(shortUrl),
    (error) => error.code === 'SSRF_BLOCKED'
  );
  assert.equal(calls.length, 1);
});

test('blocks a non-TikTok redirect returned by the GET fallback', async () => {
  const shortUrl = 'https://vm.tiktok.com/unsafe-get/';
  setResponses([
    ['head', shortUrl, ok()],
    ['get', shortUrl, redirect('https://example.com/not-tiktok')]
  ]);

  await assert.rejects(
    resolveAndValidateUrl(shortUrl),
    (error) => error.code === 'SSRF_BLOCKED'
  );
  assert.equal(calls.length, 2);
});

test('accepts only safe TikTok canonical metadata from bounded HTML', async () => {
  const shortUrl = 'https://vm.tiktok.com/html/';
  const finalUrl = 'https://www.tiktok.com/@creator/photo/987654321';
  const html = `<html><head><link rel="canonical" href="${finalUrl}"></head></html>`;
  setResponses([
    ['head', shortUrl, ok()],
    ['get', shortUrl, ok(html, { 'content-type': 'text/html; charset=utf-8' })],
    ['head', finalUrl, ok()]
  ]);

  assert.equal(await resolveAndValidateUrl(shortUrl), finalUrl);
  assert.equal(canonicalUrlFromHtml('<meta property="og:url" content="https://evil.example/x">', shortUrl), null);
  assert.equal(getValidatedRedirectUrl(shortUrl, '../next'), 'https://vm.tiktok.com/next');
});

test('rejects a short link when HEAD and GET both fail to resolve', async () => {
  const shortUrl = 'https://vm.tiktok.com/dead/';
  setResponses([
    ['head', shortUrl, ok()],
    ['get', shortUrl, new Error('connect ECONNREFUSED')]
  ]);

  await assert.rejects(
    resolveAndValidateUrl(shortUrl),
    (error) => error.code === 'RESOLUTION_FAILED'
  );
  assert.equal(calls.length, 2);
});

test('returns a normal TikTok URL unchanged without issuing a GET', async () => {
  const videoUrl = 'https://www.tiktok.com/@creator/video/6981864443440975109';
  setResponses([['head', videoUrl, ok()]]);

  assert.equal(await resolveAndValidateUrl(videoUrl), videoUrl);
  assert.deepEqual(calls.map((call) => call.method.toLowerCase()), ['head']);
});

test('extracts a TikTok canonical URL from an HTML error page returned by the GET fallback', async () => {
  const shortUrl = 'https://vt.tiktok.com/challenge/';
  const finalUrl = 'https://www.tiktok.com/@creator/photo/111222333';
  const html = `<html><head><meta property="og:url" content="${finalUrl}"></head><body>blocked</body></html>`;
  setResponses([
    ['head', shortUrl, ok()],
    ['get', shortUrl, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' }, data: html }]
  ]);

  assert.equal(await resolveAndValidateUrl(shortUrl), finalUrl);
});

test('rejects a redirect loop between TikTok URLs', async () => {
  const shortUrl = 'https://vm.tiktok.com/loop/';
  setResponses([
    ['head', shortUrl, redirect('https://vt.tiktok.com/loop2/')],
    ['head', 'https://vt.tiktok.com/loop2/', redirect(shortUrl)]
  ]);

  await assert.rejects(
    resolveAndValidateUrl(shortUrl),
    (error) => error.code === 'REDIRECT_LOOP'
  );
});

test('rejects an invalid or non-TikTok input URL outright', async () => {
  await assert.rejects(
    resolveAndValidateUrl('https://example.com/video/1'),
    (error) => error.code === 'INVALID_URL'
  );
  await assert.rejects(
    resolveAndValidateUrl('not a url'),
    (error) => error.code === 'INVALID_URL'
  );
  assert.equal(calls.length, 0);
});

test('classifies private and IPv4-mapped IPv6 addresses for SSRF defence', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.5'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIp('::ffff:169.254.169.254'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateIp('not-an-ip'), true);
});
