const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { tiktokdl } = require('@tobyg74/tiktok-api-dl');

const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MEDIA_HOST_REGEX = /^(?:[a-zA-Z0-9-]+\.)*(?:tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|byteoversea\.com|ibyteimg\.com|ibytedtos\.com|muscdn\.com|musical\.ly)$/i;
const MOCK_MEDIA_URL = 'https://www.w3schools.com/html/mov_bbb.mp4';
const STALL_TIMEOUT_MS = 20000;

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const activeDownloads = new Map();
const SERVER_SECRET = process.env.SERVER_SECRET || crypto.randomBytes(32).toString('hex');

function isAllowedMediaUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (MEDIA_HOST_REGEX.test(parsed.hostname) || value === MOCK_MEDIA_URL);
  } catch (_error) {
    return false;
  }
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest('hex');
}

function generateSignedUrl(directUrl, options = {}) {
  const payload = encodePayload({
    u: directUrl,
    e: Date.now() + 120 * 1000,
    ...(options.filename ? { n: options.filename } : {}),
    ...(options.mimeType ? { m: options.mimeType } : {})
  });

  return `/api/proxy-download?p=${payload}&s=${signPayload(payload)}`;
}

function generateSignedZipUrl(items, filename) {
  const payload = encodePayload({
    z: true,
    items,
    n: filename,
    e: Date.now() + 120 * 1000
  });

  return `/api/proxy-download?p=${payload}&s=${signPayload(payload)}`;
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[\x00-\x1F\x7F\/\\:\*\?\"<>\|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100) || 'tiktok_download';
}

function normalizeUrlList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return item.url || item.url_list?.[0] || item.urlList?.[0] || item.display_image?.url_list?.[0] || '';
      }
      return '';
    })
    .filter((url) => typeof url === 'string' && isAllowedMediaUrl(url));
}

function normalizeAuthor(author = {}) {
  const username = author.unique_id || author.username || author.uniqueId || 'user';
  return {
    nickname: author.nickname || author.displayName || 'Unknown',
    unique_id: username.replace(/^@/, ''),
    avatar: author.avatar || author.avatarMedium?.[0] || author.avatarThumb?.[0] || ''
  };
}

function normalizeStats(stats = {}) {
  return {
    plays: stats.play_count ?? stats.playCount ?? 0,
    likes: stats.digg_count ?? stats.diggCount ?? stats.likeCount ?? 0,
    comments: stats.comment_count ?? stats.commentCount ?? 0,
    shares: stats.share_count ?? stats.shareCount ?? 0
  };
}

function validateProvider() {
  const provider = (process.env.TIKTOK_PROVIDER || '').trim().toLowerCase();
  if (!provider) {
    throw new Error('CONFIG_ERROR: TIKTOK_PROVIDER environment variable is not configured.');
  }

  const validProviders = ['tikwm', 'tiktok-api-dl', 'mock'];
  if (!validProviders.includes(provider)) {
    throw new Error(`CONFIG_ERROR: Configured TIKTOK_PROVIDER "${provider}" is invalid. Choose from: tikwm, tiktok-api-dl, mock.`);
  }
  return provider;
}

/**
 * Fetches and normalizes one TikTok post from the configured provider.
 * This is intentionally shared by videoService and photoService so detection
 * and download never maintain separate scraping implementations.
 */
async function fetchProviderResult(videoUrl) {
  const provider = validateProvider();

  if (provider === 'tikwm') {
    try {
      const response = await axios.post(
        'https://www.tikwm.com/api/',
        new URLSearchParams({ url: videoUrl, hd: '1' }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
          },
          timeout: 20000
        }
      );

      const body = response.data;
      if (!body || body.code !== 0 || !body.data) {
        throw new Error(body?.msg || 'Invalid response from TikWM API');
      }

      const info = body.data;
      const photoUrls = normalizeUrlList(info.images || info.image_post_info?.images);
      const author = normalizeAuthor(info.author);
      return {
        type: photoUrls.length > 0 ? 'photo' : 'video',
        title: info.title || `TikTok Video by @${author.unique_id}`,
        author,
        stats: normalizeStats(info),
        quality: info.hdplay ? 'HD' : 'SD',
        directVideoUrl: info.hdplay || info.play || '',
        photoUrls
      };
    } catch (error) {
      console.error('[VideoService] TikWM processing failed:', error.message);
      throw new Error(`Failed to fetch TikTok media using TikWM: ${error.message}`);
    }
  }

  if (provider === 'tiktok-api-dl') {
    try {
      if (typeof tiktokdl !== 'function') {
        throw new Error('The installed TikTok provider does not expose a downloader.');
      }

      const result = await tiktokdl(videoUrl);
      if (result.status !== 'success' || !result.result) {
        throw new Error(result.message || 'Scraper failed to extract post info');
      }

      const info = result.result;
      const photoUrls = normalizeUrlList(info.images || info.imagePost?.images);
      const author = normalizeAuthor(info.author);
      const video = info.video;
      const videoUrls = typeof video === 'string'
        ? [video]
        : normalizeUrlList(video?.playAddr || video?.downloadAddr || video?.no_watermark);

      return {
        type: photoUrls.length > 0 || info.type === 'image' ? 'photo' : 'video',
        title: info.desc || info.description || 'TikTok Video',
        author,
        stats: normalizeStats(info.statistics || info.stats),
        quality: 'HD',
        directVideoUrl: videoUrls[0] || '',
        photoUrls
      };
    } catch (error) {
      console.error('[VideoService] tiktok-api-dl scraper failed:', error.message);
      throw new Error(`Failed to scrape TikTok media using local provider: ${error.message}`);
    }
  }

  // Mock remains video-only and is never used to fabricate photo results.
  return {
    type: 'video',
    title: 'Mock Test Video (Big Buck Bunny)',
    quality: 'HD (Mock)',
    author: {
      nickname: 'Blender Foundation',
      unique_id: 'blender',
      avatar: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Blender_logo_no_text.svg/512px-Blender_logo_no_text.svg.png'
    },
    stats: { plays: 1000000, likes: 50000, comments: 200, shares: 1000 },
    directVideoUrl: MOCK_MEDIA_URL,
    photoUrls: []
  };
}

// Axios `timeout` only covers the period until response headers arrive. A body
// stream that stops sending data would otherwise hang the request forever, so
// abort it when no data arrives for STALL_TIMEOUT_MS and log which stage
// failed. Slow-but-flowing downloads are unaffected.
function guardAgainstStalledStream(stream, sourceLabel) {
  let lastActivity = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
      clearInterval(timer);
      console.error(`[VideoService] Media stream from ${sourceLabel} stalled (no data for ${STALL_TIMEOUT_MS / 1000}s); aborting.`);
      stream.destroy(new Error(`Media stream from ${sourceLabel} stalled and was aborted.`));
    }
  }, 5000);
  timer.unref?.();
  const stop = () => clearInterval(timer);
  stream.on('data', () => { lastActivity = Date.now(); });
  stream.once('end', stop);
  stream.once('error', stop);
  stream.once('close', stop);
  return timer;
}

async function saveVideoFromUrl(url, fileId) {
  if (!isAllowedMediaUrl(url)) {
    throw new Error('Provider returned an unauthorized media URL.');
  }

  const sourceHost = new URL(url).hostname;
  const outputPath = path.join(DOWNLOADS_DIR, `${fileId}.mp4`);
  const writer = fs.createWriteStream(outputPath);
  let response;

  try {
    response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT }
    });
    guardAgainstStalledStream(response.data, sourceHost);
    response.data.pipe(writer);
  } catch (error) {
    writer.destroy();
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', (error) => {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(error);
    });
    response.data.on('error', (error) => {
      writer.destroy();
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(error);
    });
  });
}

function purgeExpiredRegistry() {
  const threshold = 15 * 60 * 1000;
  const now = Date.now();
  for (const [key, value] of activeDownloads.entries()) {
    if (now - value.createdAt > threshold) activeDownloads.delete(key);
  }
}

async function downloadVideo(videoUrl, providerResult) {
  purgeExpiredRegistry();
  const media = providerResult || await fetchProviderResult(videoUrl);

  if (media.type !== 'video' || !media.directVideoUrl) {
    throw new Error('PHOTO_POST: This TikTok link is a photo post.');
  }

  const fileId = crypto.randomBytes(16).toString('hex');

  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return {
      success: true,
      type: 'video',
      title: media.title,
      quality: media.quality,
      author: media.author,
      stats: media.stats,
      downloadUrl: generateSignedUrl(media.directVideoUrl, {
        filename: `${sanitizeFilename(media.title)}.mp4`,
        mimeType: 'video/mp4'
      })
    };
  }

  const savedPath = await saveVideoFromUrl(media.directVideoUrl, fileId);
  const filename = `${sanitizeFilename(media.title)}.mp4`;
  activeDownloads.set(fileId, {
    filePath: savedPath,
    filename,
    mimeType: 'video/mp4',
    title: sanitizeFilename(media.title),
    createdAt: Date.now()
  });

  return {
    success: true,
    type: 'video',
    title: media.title,
    quality: media.quality,
    author: media.author,
    stats: media.stats,
    downloadUrl: `/api/file/${fileId}`
  };
}

module.exports = {
  downloadVideo,
  fetchProviderResult,
  activeDownloads,
  sanitizeFilename,
  purgeExpiredRegistry,
  SERVER_SECRET,
  generateSignedUrl,
  generateSignedZipUrl,
  isAllowedMediaUrl,
  guardAgainstStalledStream,
  DOWNLOADS_DIR,
  USER_AGENT
};
