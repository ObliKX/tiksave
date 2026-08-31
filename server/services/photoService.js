const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const {
  fetchProviderResult,
  activeDownloads,
  DOWNLOADS_DIR,
  USER_AGENT,
  sanitizeFilename,
  generateSignedUrl,
  generateSignedZipUrl,
  isAllowedMediaUrl
} = require('./videoService');

const MAX_PHOTOS = 35;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

function postIdFromUrl(url) {
  const match = String(url).match(/\/(?:photo|video)\/(\d+)/i) || String(url).match(/(?:item_id|shareId)=(\d+)/i);
  return match ? match[1] : 'post';
}

function extensionForMime(mimeType, url = '') {
  const mime = String(mimeType || '').split(';')[0].toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/avif') return '.avif';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return /^\.(jpe?g|png|webp|gif|avif)$/.test(ext) ? ext : '.jpg';
  } catch (_error) {
    return '.jpg';
  }
}

function guessedMimeType(url) {
  const extension = extensionForMime('', url);
  return extension === '.png' ? 'image/png' :
    extension === '.webp' ? 'image/webp' :
      extension === '.gif' ? 'image/gif' : 'image/jpeg';
}

function normalizedUsername(author = {}) {
  return `@${String(author.unique_id || 'user').replace(/^@/, '')}`;
}

function createPhotoInfo(media, sourceUrl) {
  const photos = media.photoUrls.slice(0, MAX_PHOTOS).map((directUrl, index) => {
    const extension = extensionForMime('', directUrl);
    return {
      index: index + 1,
      url: generateSignedUrl(directUrl, {
        filename: `photo-${index + 1}${extension}`,
        mimeType: guessedMimeType(directUrl)
      })
    };
  });

  return {
    success: true,
    type: 'photo',
    title: media.title || 'TikTok Photo Post',
    author: {
      username: normalizedUsername(media.author),
      displayName: media.author?.nickname || 'Unknown',
      avatar: media.author?.avatar || ''
    },
    photos,
    count: photos.length,
    stats: media.stats || {},
    sourceUrl
  };
}

async function getPhotoPost(resolvedUrl) {
  const media = await fetchProviderResult(resolvedUrl);
  if (media.type !== 'photo') {
    throw new Error('VIDEO_POST: This TikTok link is a video post.');
  }
  if (!Array.isArray(media.photoUrls) || media.photoUrls.length === 0) {
    throw new Error('NO_PHOTOS: No permitted photos were returned by the provider.');
  }
  if (media.photoUrls.length > MAX_PHOTOS) media.photoUrls = media.photoUrls.slice(0, MAX_PHOTOS);
  return media;
}

async function savePhotoFromUrl(url, fileId, index) {
  if (!isAllowedMediaUrl(url)) {
    throw new Error('Provider returned an unauthorized photo URL.');
  }

  const fallbackPath = path.join(DOWNLOADS_DIR, `${fileId}-${index}.jpg`);
  let response;
  let outputPath = fallbackPath;
  let writer;
  let bytes = 0;

  try {
    response = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      maxContentLength: MAX_PHOTO_BYTES,
      headers: { 'User-Agent': USER_AGENT }
    });

    const contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error('Provider returned a non-image file.');
    }

    const extension = extensionForMime(contentType, url);
    outputPath = path.join(DOWNLOADS_DIR, `${fileId}-${index}${extension}`);
    writer = fs.createWriteStream(outputPath);

    await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        writer.destroy();
        response.data.destroy();
        reject(error);
      };

      response.data.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_PHOTO_BYTES) fail(new Error('Photo exceeds the permitted size limit.'));
      });
      response.data.on('error', fail);
      writer.on('error', fail);
      writer.on('finish', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      response.data.pipe(writer);
    });

    return {
      path: outputPath,
      mimeType: contentType || guessedMimeType(url),
      extension
    };
  } catch (error) {
    if (response?.data) response.data.destroy();
    if (writer) writer.destroy();
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(fallbackPath) && fallbackPath !== outputPath) fs.unlinkSync(fallbackPath);
    throw error;
  }
}

function zipUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function zipUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipLocalHeader(name, checksum, size) {
  const nameBuffer = Buffer.from(name, 'utf8');
  return Buffer.concat([
    zipUInt32(0x04034b50), zipUInt16(20), zipUInt16(0x0800), zipUInt16(0), zipUInt16(0), zipUInt16(0),
    zipUInt32(checksum), zipUInt32(size), zipUInt32(size), zipUInt16(nameBuffer.length), zipUInt16(0), nameBuffer
  ]);
}

function zipCentralHeader(name, checksum, size, offset) {
  const nameBuffer = Buffer.from(name, 'utf8');
  return Buffer.concat([
    zipUInt32(0x02014b50), zipUInt16(20), zipUInt16(20), zipUInt16(0x0800), zipUInt16(0), zipUInt16(0), zipUInt16(0),
    zipUInt32(checksum), zipUInt32(size), zipUInt32(size), zipUInt16(nameBuffer.length), zipUInt16(0), zipUInt16(0),
    zipUInt16(0), zipUInt16(0), zipUInt32(0), zipUInt32(offset), nameBuffer
  ]);
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

// A small dependency-free ZIP writer. It stores each image without recompressing
// it, which is appropriate for already-compressed JPEG/PNG files and avoids
// requiring a native or serverless-unfriendly archive package.
async function createZip(files, zipPath) {
  const output = fs.createWriteStream(zipPath);
  await new Promise((resolve, reject) => {
    output.once('open', resolve);
    output.once('error', reject);
  });

  const centralHeaders = [];
  let offset = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const data = await fs.promises.readFile(file.path);
      const name = `photo-${index + 1}${file.extension}`;
      const header = zipLocalHeader(name, crc32(data), data.length);
      await writeChunk(output, header);
      await writeChunk(output, data);
      centralHeaders.push(zipCentralHeader(name, crc32(data), data.length, offset));
      offset += header.length + data.length;
    }
    const centralOffset = offset;
    for (const header of centralHeaders) {
      await writeChunk(output, header);
      offset += header.length;
    }
    await writeChunk(output, Buffer.concat([
      zipUInt32(0x06054b50), zipUInt16(0), zipUInt16(0), zipUInt16(files.length), zipUInt16(files.length),
      zipUInt32(offset - centralOffset), zipUInt32(centralOffset), zipUInt16(0)
    ]));
    await new Promise((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
      output.end();
    });
  } catch (error) {
    output.destroy();
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    throw error;
  }
}

function validateSelection(selection, count) {
  if (selection === 'all') return Array.from({ length: count }, (_, index) => index + 1);
  if (!Array.isArray(selection) || selection.length === 0 || selection.length > count) {
    throw new Error('INVALID_SELECTION: Choose one or more available photo indexes.');
  }

  const indexes = selection.map((value) => {
    if (!Number.isInteger(value) || value < 1 || value > count) {
      throw new Error('INVALID_SELECTION: Photo indexes must be within the available range.');
    }
    return value;
  });
  if (new Set(indexes).size !== indexes.length) {
    throw new Error('INVALID_SELECTION: Photo indexes must be unique.');
  }
  return indexes.sort((a, b) => a - b);
}

async function downloadSelectedPhotos(resolvedUrl, selection) {
  const media = await getPhotoPost(resolvedUrl);
  const indexes = validateSelection(selection, media.photoUrls.length);
  const postId = postIdFromUrl(resolvedUrl);
  const username = normalizedUsername(media.author);
  const items = indexes.map((index) => ({
    index,
    url: media.photoUrls[index - 1],
    extension: extensionForMime('', media.photoUrls[index - 1]),
    mimeType: guessedMimeType(media.photoUrls[index - 1])
  }));

  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    if (items.length === 1) {
      return {
        success: true,
        type: 'photo',
        count: 1,
        filename: `photo-${items[0].index}${items[0].extension}`,
        mimeType: items[0].mimeType,
        downloadUrl: generateSignedUrl(items[0].url, {
          filename: `photo-${items[0].index}${items[0].extension}`,
          mimeType: items[0].mimeType
        })
      };
    }

    const filename = `TikSave-${sanitizeFilename(username)}-${sanitizeFilename(postId)}.zip`;
    return {
      success: true,
      type: 'photo',
      count: items.length,
      filename,
      mimeType: 'application/zip',
      downloadUrl: generateSignedZipUrl(items.map((item) => ({
        u: item.url,
        n: `photo-${item.index}${item.extension}`,
        m: item.mimeType
      })), filename)
    };
  }

  const fileId = crypto.randomBytes(16).toString('hex');
  const downloaded = [];
  try {
    for (const item of items) {
      downloaded.push({
        ...item,
        ...(await savePhotoFromUrl(item.url, fileId, item.index))
      });
    }

    if (downloaded.length === 1) {
      const file = downloaded[0];
      const filename = `photo-${file.index}${file.extension}`;
      activeDownloads.set(fileId, {
        filePath: file.path,
        filename,
        mimeType: file.mimeType,
        createdAt: Date.now()
      });
      return {
        success: true,
        type: 'photo',
        count: 1,
        filename,
        mimeType: file.mimeType,
        downloadUrl: `/api/file/${fileId}`
      };
    }

    const zipFilename = `TikSave-${sanitizeFilename(username)}-${sanitizeFilename(postId)}.zip`;
    const zipPath = path.join(DOWNLOADS_DIR, `${fileId}.zip`);
    await createZip(downloaded, zipPath);
    downloaded.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
    activeDownloads.set(fileId, {
      filePath: zipPath,
      filename: zipFilename,
      mimeType: 'application/zip',
      createdAt: Date.now()
    });
    return {
      success: true,
      type: 'photo',
      count: downloaded.length,
      filename: zipFilename,
      mimeType: 'application/zip',
      downloadUrl: `/api/file/${fileId}`
    };
  } catch (error) {
    downloaded.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
    throw error;
  }
}

module.exports = {
  MAX_PHOTOS,
  createPhotoInfo,
  getPhotoPost,
  downloadSelectedPhotos,
  validateSelection,
  postIdFromUrl
};
