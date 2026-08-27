const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { tiktokdl } = require('@tobyg74/tiktok-api-dl');

const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// In-memory registry of active downloads to map fileId -> file details
const activeDownloads = new Map();

// Secure signature key for stateless downloads (Netlify)
const SERVER_SECRET = process.env.SERVER_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Generates a signed, short-lived download token for the Edge Function proxy.
 */
function generateSignedUrl(directUrl) {
  // Token expires in 120 seconds (2 minutes)
  const payloadObj = {
    u: directUrl,
    e: Date.now() + 120 * 1000
  };
  
  // Base64URL encode the JSON payload
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  
  // Sign the payload
  const signature = crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest('hex');
  
  return `/api/proxy-download?p=${payload}&s=${signature}`;
}

/**
 * Helper to download a video stream from a URL and save it locally.
 */
async function saveVideoFromUrl(url, fileId) {
  const outputPath = path.join(DOWNLOADS_DIR, `${fileId}.mp4`);
  const writer = fs.createWriteStream(outputPath);

  const response = await axios({
    method: 'get',
    url: url,
    responseType: 'stream',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', (err) => {
      // Clean up partial file on error
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(err);
    });
  });
}

/**
 * Sanitize titles for file downloads
 */
function sanitizeFilename(name) {
  return name
    .replace(/[\x00-\x1F\x7F\/\\:\*\?\"<>\|]/g, '')
    .trim()
    .substring(0, 100) || 'tiktok_video';
}

/**
 * Purges expired entries from the activeDownloads memory registry
 */
function purgeExpiredRegistry() {
  const now = Date.now();
  const threshold = 15 * 60 * 1000; // 15 minutes
  for (const [key, value] of activeDownloads.entries()) {
    if (now - value.createdAt > threshold) {
      activeDownloads.delete(key);
    }
  }
}

/**
 * Downloads TikTok video using the configured provider.
 * @param {string} videoUrl Resolved long TikTok URL
 * @returns {Promise<object>} Metadata and download link details
 */
async function downloadVideo(videoUrl) {
  const provider = (process.env.TIKTOK_PROVIDER || '').trim().toLowerCase();

  // 1. Strict Configuration Validation
  if (!provider) {
    throw new Error('CONFIG_ERROR: TIKTOK_PROVIDER environment variable is not configured.');
  }

  const validProviders = ['tikwm', 'tiktok-api-dl', 'mock'];
  if (!validProviders.includes(provider)) {
    throw new Error(`CONFIG_ERROR: Configured TIKTOK_PROVIDER "${provider}" is invalid. Choose from: tikwm, tiktok-api-dl, mock.`);
  }

  // Purge old mappings from memory
  purgeExpiredRegistry();

  const fileId = crypto.randomBytes(16).toString('hex');
  let title = 'TikTok Video';
  let directVideoUrl = '';
  let quality = 'HD';
  let author = { nickname: 'Unknown', unique_id: 'user', avatar: '' };
  let stats = { plays: 0, likes: 0, comments: 0, shares: 0 };

  // 2. Execute Provider Logic
  if (provider === 'tikwm') {
    const tikwmUrl = 'https://www.tikwm.com/api/';
    const apiKey = process.env.TIKWM_API_KEY;

    try {
      const apiResponse = await axios.post(
        tikwmUrl,
        new URLSearchParams({
          url: videoUrl,
          hd: '1'
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      const resData = apiResponse.data;
      if (!resData || resData.code !== 0 || !resData.data) {
        throw new Error(resData.msg || 'Invalid response from TikWM API');
      }

      const info = resData.data;
      title = info.title || `TikTok Video by @${info.author?.unique_id || 'user'}`;
      directVideoUrl = info.hdplay || info.play;
      
      if (info.author) {
        author = {
          nickname: info.author.nickname || 'Unknown',
          unique_id: info.author.unique_id || 'user',
          avatar: info.author.avatar || ''
        };
      }
      
      stats = {
        plays: info.play_count || 0,
        likes: info.digg_count || 0,
        comments: info.comment_count || 0,
        shares: info.share_count || 0
      };

      if (!directVideoUrl) {
        throw new Error('No download links returned by TikWM');
      }
      quality = info.hdplay ? 'HD' : 'SD';

    } catch (err) {
      console.error('[VideoService] TikWM processing failed:', err.message);
      throw new Error(`Failed to fetch video using TikWM: ${err.message}`);
    }

  } else if (provider === 'tiktok-api-dl') {
    try {
      const result = await tiktokdl(videoUrl);
      if (result.status !== 'success' || !result.result) {
        throw new Error(result.message || 'Scraper failed to extract video info');
      }

      const info = result.result;
      title = info.description || 'TikTok Scraped Video';
      
      if (info.author) {
        author = {
          nickname: info.author.nickname || 'Unknown',
          unique_id: info.author.username || info.author.unique_id || 'user',
          avatar: info.author.avatar || ''
        };
      }
      
      if (info.statistics) {
        stats = {
          plays: info.statistics.playCount || 0,
          likes: info.statistics.diggCount || 0,
          comments: info.statistics.commentCount || 0,
          shares: info.statistics.shareCount || 0
        };
      }
      
      if (info.video && Array.isArray(info.video) && info.video.length > 0) {
        directVideoUrl = info.video[0];
      } else if (typeof info.video === 'string') {
        directVideoUrl = info.video;
      } else if (info.video && info.video.no_watermark) {
        directVideoUrl = info.video.no_watermark;
      }

      if (!directVideoUrl) {
        throw new Error('No video links found in scraping result.');
      }
      quality = 'HD';
    } catch (err) {
      console.error('[VideoService] tiktok-api-dl scraper failed:', err.message);
      throw new Error(`Failed to scrape video using local library: ${err.message}`);
    }

  } else if (provider === 'mock') {
    directVideoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
    title = 'Mock Test Video (Big Buck Bunny)';
    quality = 'HD (Mock)';
    author = { nickname: 'Blender Foundation', unique_id: 'blender', avatar: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Blender_logo_no_text.svg/512px-Blender_logo_no_text.svg.png' };
    stats = { plays: 1000000, likes: 50000, comments: 200, shares: 1000 };
  }

  // If running in Netlify (serverless environment), return a stateless URL via Edge Function
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.log(`[VideoService] Netlify detected. Generating stateless secure Edge Function download link.`);
    return {
      success: true,
      title: title,
      quality: quality,
      author: author,
      stats: stats,
      downloadUrl: generateSignedUrl(directVideoUrl)
    };
  }

  // 3. Download the MP4 to the local downloads folder (Local/Server Mode)
  console.log(`[VideoService] Downloading MP4 stream from: ${directVideoUrl}`);
  const savedPath = await saveVideoFromUrl(directVideoUrl, fileId);

  // 4. Save metadata to active download list for serving via file route
  const sanitizedTitle = sanitizeFilename(title);
  activeDownloads.set(fileId, {
    filePath: savedPath,
    title: sanitizedTitle,
    createdAt: Date.now()
  });

  return {
    success: true,
    title: title,
    quality: quality,
    author: author,
    stats: stats,
    downloadUrl: `/api/file/${fileId}`
  };
}

module.exports = {
  downloadVideo,
  activeDownloads,
  sanitizeFilename,
  purgeExpiredRegistry,
  SERVER_SECRET,
  generateSignedUrl
};
