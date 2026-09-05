const axios = require('axios');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

// Match tiktok.com and any syntactically valid subdomain of it, but no lookalike domains.
const TIKTOK_DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*tiktok\.com$/i;
const SHORT_TIKTOK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const MAX_REDIRECTS = 8;
const RESOLUTION_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function createResolutionError(code, message, cause) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isPrivateIp(address) {
  const normalized = String(address).toLowerCase();
  if (net.isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [first, second] = octets;
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224;
  }

  if (net.isIP(normalized) === 6) {
    const withoutZone = normalized.split('%')[0];
    if (withoutZone === '::' || withoutZone === '::1') return true;
    if (withoutZone.startsWith('fc') || withoutZone.startsWith('fd') || withoutZone.startsWith('fe8') ||
        withoutZone.startsWith('fe9') || withoutZone.startsWith('fea') || withoutZone.startsWith('feb')) return true;
    const mappedIpv4 = withoutZone.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    return Boolean(mappedIpv4 && isPrivateIp(mappedIpv4[1]));
  }
  return true;
}

// Pin each request to a resolved public address. This prevents a permitted
// hostname from being used to reach loopback, link-local, or private networks.
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  // Node >= 20 enables autoSelectFamily by default and calls lookup with
  // all: true, expecting an array of { address, family } back. Returning a
  // single address there surfaces as ERR_INVALID_IP_ADDRESS at connect time.
  const wantsAll = Boolean(options && options.all);
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    const publicAddresses = addresses.filter((entry) => !isPrivateIp(entry.address));
    if (publicAddresses.length === 0) {
      return callback(new Error('Resolved host does not have a public IP address.'));
    }
    if (wantsAll) return callback(null, publicAddresses);
    return callback(null, publicAddresses[0].address, publicAddresses[0].family);
  });
}

const HTTP_AGENT = new http.Agent({ lookup: safeLookup });
const HTTPS_AGENT = new https.Agent({ lookup: safeLookup });

/**
 * Validates a URL before it is used for a server-side request.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isValidTikTokDomain(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return TIKTOK_DOMAIN_REGEX.test(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function isShortTikTokUrl(urlStr) {
  try {
    return SHORT_TIKTOK_HOSTS.has(new URL(urlStr).hostname.toLowerCase());
  } catch (_error) {
    return false;
  }
}

function getValidatedRedirectUrl(currentUrl, location) {
  if (typeof location !== 'string' || location.trim() === '') return null;

  let redirectUrl;
  try {
    // URL resolves absolute, protocol-relative, root-relative, and path-relative
    // Location values against the URL that produced the redirect.
    redirectUrl = new URL(location.trim(), currentUrl).toString();
  } catch (error) {
    throw createResolutionError('REDIRECT_INVALID', 'TikTok returned an invalid redirect location.', error);
  }

  if (!isValidTikTokDomain(redirectUrl)) {
    throw createResolutionError('SSRF_BLOCKED', 'TikTok redirected to a non-TikTok domain.');
  }
  return redirectUrl;
}

async function requestWithoutRedirects(method, url, options = {}) {
  return axios({
    method,
    url,
    maxRedirects: 0,
    timeout: RESOLUTION_TIMEOUT_MS,
    // Axios otherwise rejects redirects in some adapter/status combinations.
    validateStatus: (status) => status >= 200 && status < 400,
    headers: { 'User-Agent': USER_AGENT },
    httpAgent: HTTP_AGENT,
    httpsAgent: HTTPS_AGENT,
    proxy: false,
    ...options
  });
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/&#x3d;|&#61;/gi, '=');
}

function canonicalUrlFromHtml(html, currentUrl) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return null;

  const candidates = [
    /<link\b[^>]*\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["']/i,
    /<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i,
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:url["']/i
  ];

  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (!match) continue;
    const candidate = decodeHtmlEntities(match[1]);
    // A canonical tag is page metadata, not an HTTP redirect. Still apply the
    // same allowlist before considering it, and ignore unsafe metadata.
    try {
      const resolved = new URL(candidate, currentUrl).toString();
      if (isValidTikTokDomain(resolved)) return resolved;
    } catch (_error) {
      // Ignore malformed metadata and continue looking for another safe value.
    }
  }
  return null;
}

function htmlResponseBody(response) {
  const body = response && response.data;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return '';
}

async function inspectWithHead(currentUrl) {
  try {
    const response = await requestWithoutRedirects('head', currentUrl);
    if (isRedirectStatus(response.status)) {
      const redirectUrl = getValidatedRedirectUrl(currentUrl, response.headers.location);
      return { redirectUrl, shouldUseGet: !redirectUrl && isShortTikTokUrl(currentUrl) };
    }
    return { redirectUrl: null, shouldUseGet: isShortTikTokUrl(currentUrl) };
  } catch (error) {
    // A 3xx response can still be attached to an Axios error by another adapter.
    // Validation failures must never be downgraded to a fallback attempt.
    if (error.code === 'SSRF_BLOCKED' || error.code === 'REDIRECT_INVALID') throw error;
    if (error.response && isRedirectStatus(error.response.status)) {
      const redirectUrl = getValidatedRedirectUrl(currentUrl, error.response.headers.location);
      return { redirectUrl, shouldUseGet: !redirectUrl && isShortTikTokUrl(currentUrl) };
    }
    return { redirectUrl: null, shouldUseGet: isShortTikTokUrl(currentUrl), headError: error };
  }
}

async function inspectWithGet(currentUrl) {
  let response;
  try {
    response = await requestWithoutRedirects('get', currentUrl, {
      responseType: 'text',
      maxContentLength: MAX_HTML_BYTES,
      maxBodyLength: MAX_HTML_BYTES
    });
  } catch (error) {
    if (error.response && isRedirectStatus(error.response.status)) {
      return { redirectUrl: getValidatedRedirectUrl(currentUrl, error.response.headers.location) };
    }
    // TikTok sometimes answers automated requests with a non-redirect HTML
    // page (e.g. 403). Try the same bounded canonical extraction on that body
    // before giving up; nothing outside the TikTok allowlist is accepted.
    if (error.response) {
      const body = htmlResponseBody(error.response);
      const contentType = String(error.response.headers['content-type'] || '').toLowerCase();
      if (body && (contentType.includes('text/html') || /<html[\s>]/i.test(body))) {
        const canonical = canonicalUrlFromHtml(body, currentUrl);
        if (canonical) return { redirectUrl: canonical };
      }
    }
    throw createResolutionError('RESOLUTION_FAILED', 'TikTok short-link fallback request failed.', error);
  }

  if (isRedirectStatus(response.status)) {
    return { redirectUrl: getValidatedRedirectUrl(currentUrl, response.headers.location) };
  }

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html') || htmlResponseBody(response)) {
    return { redirectUrl: canonicalUrlFromHtml(htmlResponseBody(response), currentUrl) };
  }
  return { redirectUrl: null };
}

/**
 * Resolves TikTok short URLs with bounded, manually validated redirect hops.
 * HEAD is attempted first; vm/vt links also receive a no-redirect GET fallback
 * because TikTok commonly does not return a useful Location for HEAD requests.
 * @param {string} url
 * @returns {Promise<string>} The safely resolved TikTok URL
 */
async function resolveAndValidateUrl(url) {
  if (!isValidTikTokDomain(url)) {
    throw createResolutionError('INVALID_URL', 'Invalid TikTok URL or domain.');
  }

  let currentUrl = new URL(url).toString();
  const visited = new Set([currentUrl]);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headResult = await inspectWithHead(currentUrl);
    let nextUrl = headResult.redirectUrl;

    if (!nextUrl && headResult.shouldUseGet) {
      if (headResult.headError) {
        console.warn(`[UrlResolver] HEAD probe failed for ${new URL(currentUrl).hostname} (${headResult.headError.message}); trying GET fallback.`);
      }
      try {
        const getResult = await inspectWithGet(currentUrl);
        nextUrl = getResult.redirectUrl;
      } catch (error) {
        console.error(`[UrlResolver] GET fallback failed for ${new URL(currentUrl).hostname}:`, error.message);
        throw error;
      }
    }

    if (!nextUrl) {
      if (visited.size > 1) {
        console.log(`[UrlResolver] Resolution finished at ${currentUrl} after ${visited.size - 1} redirect hop(s).`);
      } else if (isShortTikTokUrl(currentUrl)) {
        console.warn(`[UrlResolver] Short link ${currentUrl} exposed no redirect and no canonical metadata; returning it unchanged for the provider.`);
      }
      return currentUrl;
    }
    if (visited.has(nextUrl)) {
      throw createResolutionError('REDIRECT_LOOP', 'TikTok returned a redirect loop.');
    }
    if (hop === MAX_REDIRECTS) {
      throw createResolutionError('REDIRECT_LIMIT', 'TikTok redirect chain exceeded the safety limit.');
    }

    // getValidatedRedirectUrl() has already checked this target. Keep the
    // second check adjacent to the assignment so every hop remains guarded.
    if (!isValidTikTokDomain(nextUrl)) {
      throw createResolutionError('SSRF_BLOCKED', 'Resolved URL points to a non-TikTok domain.');
    }
    visited.add(nextUrl);
    console.log(`[UrlResolver] Redirect hop ${hop + 1}: ${currentUrl} -> ${nextUrl}`);
    currentUrl = nextUrl;
  }

  throw createResolutionError('REDIRECT_LIMIT', 'TikTok redirect chain exceeded the safety limit.');
}

module.exports = {
  isValidTikTokDomain,
  resolveAndValidateUrl,
  // Exported for focused tests without exposing any new API route.
  isPrivateIp,
  canonicalUrlFromHtml,
  getValidatedRedirectUrl,
  MAX_REDIRECTS
};
