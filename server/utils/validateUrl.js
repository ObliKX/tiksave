const axios = require('axios');
const { URL } = require('url');

// Strict regex to check that host is tiktok.com or a subdomain of tiktok.com
const TIKTOK_DOMAIN_REGEX = /^(?:[a-zA-Z0-9-]+\.)?tiktok\.com$/i;

/**
 * Validates if a string is a valid URL and belongs to a TikTok domain.
 * @param {string} urlStr 
 * @returns {boolean}
 */
function isValidTikTokDomain(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return TIKTOK_DOMAIN_REGEX.test(parsed.hostname);
  } catch (e) {
    return false;
  }
}

/**
 * Resolves short TikTok URLs (like vm.tiktok.com/...) to their final video URLs,
 * while strictly validating that all redirect locations are TikTok domains (SSRF protection).
 * @param {string} url 
 * @returns {Promise<string>} The resolved URL
 */
async function resolveAndValidateUrl(url) {
  if (!isValidTikTokDomain(url)) {
    throw new Error('Invalid TikTok URL or domain.');
  }

  let currentUrl = url;
  const maxRedirects = 5;

  for (let i = 0; i < maxRedirects; i++) {
    try {
      const response = await axios({
        method: 'head',
        url: currentUrl,
        maxRedirects: 0, // Handled manually for safety
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        
        // Handle relative redirects
        if (redirectUrl.startsWith('/')) {
          const origin = new URL(currentUrl).origin;
          redirectUrl = `${origin}${redirectUrl}`;
        }

        // Validate target domain
        if (!isValidTikTokDomain(redirectUrl)) {
          throw new Error('SSRF Warning: Redirected to a non-TikTok domain.');
        }

        currentUrl = redirectUrl;
      } else {
        break;
      }
    } catch (error) {
      if (error.response && error.response.status >= 300 && error.response.status < 400 && error.response.headers.location) {
        let redirectUrl = error.response.headers.location;
        if (redirectUrl.startsWith('/')) {
          const origin = new URL(currentUrl).origin;
          redirectUrl = `${origin}${redirectUrl}`;
        }
        if (!isValidTikTokDomain(redirectUrl)) {
          throw new Error('SSRF Warning: Redirected to a non-TikTok domain.');
        }
        currentUrl = redirectUrl;
        continue;
      }
      break;
    }
  }

  // Double check the final resolved URL
  if (!isValidTikTokDomain(currentUrl)) {
    throw new Error('Resolved URL points to an invalid domain.');
  }

  return currentUrl;
}

module.exports = {
  isValidTikTokDomain,
  resolveAndValidateUrl
};
