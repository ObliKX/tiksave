const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const archiver = require('archiver');
const { tiktokdl } = require('@tobyg74/tiktok-api-dl');
const { generateSignedUrl } = require('./videoService');

const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// In-memory registry of active photo downloads
const activePhotoDownloads = new Map();

/**
 * Sanitize titles for file downloads
 */
function sanitizeFilename(name) {
  return name
    .replace(/[\x00-\x1F\x7F\/\\:\*\?\"<>\|]/g, '')
    .trim()
    .substring(0, 100) || 'tiktok_photo';
}

/**
 * Detect if a TikTok post is a video or photo carousel
 * @param {string} videoUrl Resolved long TikTok URL
 * @returns {Promise<{type: string, count?: number, info?: object}>}
 */
async function detectPostType(videoUrl) {
  const provider = (process.env.TIKTOK_PROVIDER || '').trim().toLowerCase();

  if (!provider || provider === 'mock') {
    return { type: 'video', count: 1 };
  }

  if (provider === 'tiktok-api-dl') {
    try {
      const result = await tiktokdl(videoUrl);
      if (result.status !== 'success' || !result.result) {
        throw new Error(result.message || 'Scraper failed');
      }

      const info = result.result;

      // Check if it's a carousel/collection (photo carousel)
      if (info.type === 'carousel' || info.imagePost === true || (Array.isArray(info.image) && info.image.length > 0)) {
        // It's a photo carousel/collection
        const photos = info.image || [];
        return {
          type: 'photo',
          count: photos.length,
          photos: photos,
          info: info
        };
      }

      // Check if it has video
      if (info.video && (Array.isArray(info.video) || typeof info.video === 'string' || (info.video.no_watermark))) {
        return { type: 'video', count: 1, info: info };
      }

      // If no video but has images, it's a photo
      if (info.image && Array.isArray(info.image) && info.image.length > 0) {
        return {
          type: 'photo',
          count: info.image.length,
          photos: info.image,
          info: info
        };
      }

      // Default to video if unclear
      return { type: 'video', count: 1, info: info };

    } catch (err) {
      console.error('[PhotoService] tiktok-api-dl detection failed:', err.message);
      throw new Error(`Failed to detect post type: ${err.message}`);
    }
  }

  // For tikwm provider, we need a different approach
  // TikWM likely doesn't support photo carousel detection easily, so default to video
  return { type: 'video', count: 1 };
}

/**
 * Get information about a photo post without downloading
 * @param {string} photoUrl Resolved long TikTok URL
 * @returns {Promise<object>} Photo post metadata
 */
async function getPhotoInfo(photoUrl) {
  const provider = (process.env.TIKTOK_PROVIDER || '').trim().toLowerCase();

  if (!provider) {
    throw new Error('CONFIG_ERROR: TIKTOK_PROVIDER environment variable is not configured.');
  }

  const validProviders = ['tikwm', 'tiktok-api-dl', 'mock'];
  if (!validProviders.includes(provider)) {
    throw new Error(`CONFIG_ERROR: Configured TIKTOK_PROVIDER "${provider}" is invalid. Choose from: tikwm, tiktok-api-dl, mock.`);
  }

  let title = 'TikTok Photo Post';
  let author = { nickname: 'Unknown', unique_id: 'user', avatar: '' };
  let stats = { plays: 0, likes: 0, comments: 0, shares: 0 };
  let photos = [];

  if (provider === 'tiktok-api-dl') {
    try {
      const result = await tiktokdl(photoUrl);
      if (result.status !== 'success' || !result.result) {
        throw new Error(result.message || 'Scraper failed');
      }

      const info = result.result;
      title = info.description || 'TikTok Photo Post';

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

      // Extract photos
      if (Array.isArray(info.image)) {
        photos = info.image.map((url, index) => ({
          index: index + 1,
          url: url
        }));
      }

      if (photos.length === 0) {
        throw new Error('No photos found in this post');
      }

      return {
        success: true,
        type: 'photo',
        title: title,
        author: author,
        stats: stats,
        photos: photos,
        count: photos.length
      };

    } catch (err) {
      console.error('[PhotoService] tiktok-api-dl failed:', err.message);
      throw new Error(`Failed to fetch photo info: ${err.message}`);
    }

  } else if (provider === 'mock') {
    // Mock photo carousel
    return {
      success: true,
      type: 'photo',
      title: 'Mock Photo Carousel',
      author: { nickname: 'Mock User', unique_id: 'mockuser', avatar: 'https://ui-avatars.com/api/?name=Mock+User' },
      stats: { plays: 5000, likes: 250, comments: 50, shares: 100 },
      photos: [
        { index: 1, url: 'https://picsum.photos/400/400?random=1' },
        { index: 2, url: 'https://picsum.photos/400/400?random=2' },
        { index: 3, url: 'https://picsum.photos/400/400?random=3' }
      ],
      count: 3
    };
  }

  throw new Error('Unsupported provider for photo posts');
}

/**
 * Helper to download an image and save it locally
 */
async function downloadImageFromUrl(url, filename) {
  const outputPath = path.join(DOWNLOADS_DIR, filename);
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
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(err);
    });
  });
}

/**
 * Download selected photos from a photo post
 * @param {string} photoUrl Resolved long TikTok URL
 * @param {array|string} selection Array of photo indices (1-based) or "all"
 * @returns {Promise<object>} Download info with file details
 */
async function downloadPhotos(photoUrl, selection) {
  const provider = (process.env.TIKTOK_PROVIDER || '').trim().toLowerCase();

  if (!provider) {
    throw new Error('CONFIG_ERROR: TIKTOK_PROVIDER environment variable is not configured.');
  }

  // Validate selection
  let selectedIndices = [];
  if (typeof selection === 'string' && selection === 'all') {
    selectedIndices = 'all';
  } else if (Array.isArray(selection)) {
    selectedIndices = selection.filter(s => {
      const idx = parseInt(s, 10);
      return !isNaN(idx) && idx > 0;
    });
    if (selectedIndices.length === 0) {
      throw new Error('Invalid photo selection');
    }
  } else {
    throw new Error('Selection must be an array or "all"');
  }

  let photoInfo;
  let title = 'TikTok Photo Post';
  let author = {};

  if (provider === 'tiktok-api-dl') {
    try {
      const result = await tiktokdl(photoUrl);
      if (result.status !== 'success' || !result.result) {
        throw new Error(result.message || 'Scraper failed');
      }

      const info = result.result;
      title = info.description || 'TikTok Photo Post';
      if (info.author) {
        author = {
          nickname: info.author.nickname || 'Unknown',
          unique_id: info.author.username || info.author.unique_id || 'user',
          avatar: info.author.avatar || ''
        };
      }

      if (!Array.isArray(info.image) || info.image.length === 0) {
        throw new Error('No photos found');
      }

      photoInfo = info;

    } catch (err) {
      console.error('[PhotoService] Photo download failed:', err.message);
      throw new Error(`Failed to download photos: ${err.message}`);
    }
  } else if (provider === 'mock') {
    // Mock implementation
    photoInfo = {
      image: [
        'https://picsum.photos/400/400?random=1',
        'https://picsum.photos/400/400?random=2',
        'https://picsum.photos/400/400?random=3'
      ]
    };
  } else {
    throw new Error('Photo download not supported for this provider');
  }

  // Determine which photos to download
  let indicesToDownload = [];
  if (selectedIndices === 'all') {
    indicesToDownload = Array.from({ length: photoInfo.image.length }, (_, i) => i + 1);
  } else {
    indicesToDownload = selectedIndices.filter(idx => idx >= 1 && idx <= photoInfo.image.length);
  }

  if (indicesToDownload.length === 0) {
    throw new Error('No valid photos selected');
  }

  // Single photo - return direct link
  if (indicesToDownload.length === 1) {
    const photoIdx = indicesToDownload[0] - 1;
    const photoUrl = photoInfo.image[photoIdx];

    if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      // Return signed proxy URL for Netlify
      return {
        success: true,
        type: 'photo',
        count: 1,
        title: title,
        author: author,
        downloadUrl: generateSignedUrl(photoUrl),
        mimeType: 'image/jpeg'
      };
    }

    // Local mode - download the image
    const fileId = crypto.randomBytes(16).toString('hex');
    const ext = photoUrl.includes('.png') ? '.png' : '.jpg';
    const filename = `${fileId}${ext}`;
    const savedPath = await downloadImageFromUrl(photoUrl, filename);

    activePhotoDownloads.set(fileId, {
      filePath: savedPath,
      title: sanitizeFilename(title),
      createdAt: Date.now()
    });

    return {
      success: true,
      type: 'photo',
      count: 1,
      title: title,
      author: author,
      downloadUrl: `/api/photo/${fileId}`,
      mimeType: 'image/jpeg'
    };
  }

  // Multiple photos - create ZIP if not on Netlify, otherwise return info for Shortcut handling
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // For Netlify, return the list of signed URLs and let client/shortcut handle ZIP creation
    const signedUrls = indicesToDownload.map((idx) => ({
      index: idx,
      url: generateSignedUrl(photoInfo.image[idx - 1])
    }));

    return {
      success: true,
      type: 'photo',
      count: indicesToDownload.length,
      title: title,
      author: author,
      photos: signedUrls,
      mimeType: 'application/zip'
    };
  }

  // Local mode - create ZIP with selected photos
  const fileId = crypto.randomBytes(16).toString('hex');
  const zipPath = path.join(DOWNLOADS_DIR, `${fileId}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  await new Promise((resolve, reject) => {
    archive.on('error', reject);
    output.on('close', resolve);
    output.on('error', reject);

    archive.pipe(output);

    // Download and add each selected photo to ZIP
    (async () => {
      try {
        for (let i = 0; i < indicesToDownload.length; i++) {
          const photoIdx = indicesToDownload[i] - 1;
          const photoUrl = photoInfo.image[photoIdx];
          const tempFilename = `photo-${indicesToDownload[i]}.jpg`;
          const tempPath = path.join(DOWNLOADS_DIR, tempFilename);

          await downloadImageFromUrl(photoUrl, tempFilename);
          archive.file(tempPath, { name: `TikSave-photo-${indicesToDownload[i]}.jpg` });
        }

        archive.finalize();
      } catch (err) {
        archive.destroy();
        reject(err);
      }
    })();
  });

  activePhotoDownloads.set(fileId, {
    filePath: zipPath,
    title: sanitizeFilename(title),
    createdAt: Date.now(),
    isZip: true
  });

  return {
    success: true,
    type: 'photo',
    count: indicesToDownload.length,
    title: title,
    author: author,
    downloadUrl: `/api/photo/${fileId}`,
    mimeType: 'application/zip'
  };
}

/**
 * Purges expired photo download entries
 */
function purgeExpiredPhotoRegistry() {
  const now = Date.now();
  const threshold = 15 * 60 * 1000; // 15 minutes
  for (const [key, value] of activePhotoDownloads.entries()) {
    if (now - value.createdAt > threshold) {
      activePhotoDownloads.delete(key);
    }
  }
}

module.exports = {
  detectPostType,
  getPhotoInfo,
  downloadPhotos,
  activePhotoDownloads,
  sanitizeFilename,
  purgeExpiredPhotoRegistry
};
