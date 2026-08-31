const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();

const { resolveAndValidateUrl } = require('../utils/validateUrl');
const {
  downloadVideo,
  fetchProviderResult,
  activeDownloads,
  SERVER_SECRET,
  isAllowedMediaUrl
} = require('../services/videoService');
const { createPhotoInfo } = require('../services/photoService');

router.post('/download', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid TikTok video URL.'
    });
  }

  try {

    const resolvedUrl = await resolveAndValidateUrl(url.trim());

    const media = await fetchProviderResult(resolvedUrl);

    if (media.type === 'photo') {
      return res.json(createPhotoInfo(media, resolvedUrl));
    }

    const result = await downloadVideo(resolvedUrl, media);
    return res.json(result);

  } catch (error) {
    console.error('[DownloadRoute] Error processing video request:', error.message);

    if (error.message.includes('CONFIG_ERROR')) {
      return res.status(500).json({
        success: false,
        error: 'Server Configuration Error: The video downloader provider is not properly configured.'
      });
    }

    return res.status(422).json({
      success: false,
      error: 'Unable to process this video. Please verify that the link is correct and the video is public.'
    });
  }
});

// Local equivalent of the Netlify Edge Function. Netlify handles this path
// with netlify/edge-functions/proxy.js; this route keeps local development safe.
router.get('/proxy-download', async (req, res) => {
  const { p, s } = req.query;
  if (!p || !s || typeof p !== 'string' || typeof s !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing signed download parameters.' });
  }

  try {
    const expectedSignature = crypto.createHmac('sha256', SERVER_SECRET).update(p).digest('hex');
    if (s.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expectedSignature))) {
      return res.status(403).json({ success: false, error: 'Invalid or tampered download link.' });
    }

    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!payload.e || Date.now() > payload.e || payload.z || !isAllowedMediaUrl(payload.u)) {
      return res.status(403).json({ success: false, error: 'Download link is invalid or expired.' });
    }

    // Redirecting preserves streaming and avoids buffering media in the Node process.
    return res.redirect(302, payload.u);
  } catch (error) {
    console.error('[Proxy] Error validating signed media link:', error.message);
    return res.status(400).json({ success: false, error: 'Unable to stream this download.' });
  }
});

router.get('/file/secure', async (req, res) => {
  const { u: urlB64, t: titleB64, s: signature } = req.query;

  if (!urlB64 || !titleB64 || !signature) {
    return res.status(400).json({
      success: false,
      error: 'Missing required secure download parameters.'
    });
  }

  try {

    const directUrl = Buffer.from(urlB64, 'base64url').toString('utf8');
    const title = Buffer.from(titleB64, 'base64url').toString('utf8');

    const payload = `${directUrl}|${title}`;
    const expectedSignature = crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest('hex');

    if (typeof signature !== 'string' || signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or tampered signature on download request.'
      });
    }

    const parsedUrl = new URL(directUrl);
    const TIKTOK_CDN_REGEX = /^(?:[a-zA-Z0-9-]+\.)*(?:tiktokcdn\.com|tiktokcdn-us\.com|byteoversea\.com|ibyteimg\.com|tiktokcdn-eu\.com|musical\.ly)$/i;

    if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || !TIKTOK_CDN_REGEX.test(parsedUrl.hostname)) {
      if (directUrl !== 'https://www.w3schools.com/html/mov_bbb.mp4') {
        return res.status(400).json({
          success: false,
          error: 'SSRF Block: Requested URL does not belong to authorized TikTok media CDNs.'
        });
      }
    }

    console.log(`[Proxy] Redirecting stateless media download to avoid serverless response limits: ${directUrl}`);

    return res.redirect(302, directUrl);

  } catch (err) {
    console.error('[Proxy] Error resolving secure stream:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Unable to stream file. Please check link signature.'
      });
    }
  }
});

router.get('/file/:id', (req, res) => {
  const fileId = req.params.id;

  if (!fileId || !/^[a-f0-9]{32}$/i.test(fileId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid download ID format.'
    });
  }

  const record = activeDownloads.get(fileId);
  if (!record) {
    return res.status(404).json({
      success: false,
      error: 'Download link has expired or does not exist.'
    });
  }

  const { filePath, title } = record;

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Temporary file has been removed.'
    });
  }

  const downloadName = record.filename || `${title || 'tiktok_video'}.mp4`;
  if (record.mimeType) res.type(record.mimeType);

  res.download(filePath, downloadName, (err) => {
    if (err) {
      console.error('[DownloadRoute] Error sending file:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Failed to stream file to browser.'
        });
      }
    }
  });
});

module.exports = router;
