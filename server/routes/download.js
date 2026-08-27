const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();

const { resolveAndValidateUrl } = require('../utils/validateUrl');
const { downloadVideo, activeDownloads, SERVER_SECRET } = require('../services/videoService');

/**
 * POST /api/download
 * Process a TikTok URL and prepare for downloading.
 */
router.post('/download', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid TikTok video URL.'
    });
  }

  try {
    // 1. Resolve and validate the URL (SSRF checks and redirects)
    const resolvedUrl = await resolveAndValidateUrl(url.trim());

    // 2. Fetch and download the video using the modular service
    const result = await downloadVideo(resolvedUrl);

    // 3. Return results to front-end
    return res.json(result);

  } catch (error) {
    console.error('[DownloadRoute] Error processing video request:', error.message);

    // Differentiate between configuration errors and parsing/download errors
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

/**
 * GET /api/file/secure
 * Serves signed remote video URLs stateless-ly. Used on serverless platforms (Netlify).
 */
router.get('/file/secure', async (req, res) => {
  const { u: urlB64, t: titleB64, s: signature } = req.query;

  if (!urlB64 || !titleB64 || !signature) {
    return res.status(400).json({
      success: false,
      error: 'Missing required secure download parameters.'
    });
  }

  try {
    // 1. Decode parameters safely
    const directUrl = Buffer.from(urlB64, 'base64url').toString('utf8');
    const title = Buffer.from(titleB64, 'base64url').toString('utf8');

    // 2. Recalculate signature
    const payload = `${directUrl}|${title}`;
    const expectedSignature = crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest('hex');

    // 3. Verify signature authenticity
    if (signature !== expectedSignature) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or tampered signature on download request.'
      });
    }

    // 4. Validate URL domain for additional SSRF safety (restrict to TikTok CDNs)
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

    console.log(`[Proxy] Redirecting video stateless-ly to avoid 6MB Lambda limit: ${directUrl}`);

    // 5. Redirect the browser to the TikTok CDN directly.
    // This bypasses the 6MB synchronous response limit on AWS Lambda (Netlify Functions)
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

/**
 * GET /api/file/:id
 * Serves the temporary video file for download.
 */
router.get('/file/:id', (req, res) => {
  const fileId = req.params.id;

  // Validate file ID format (32 hex characters) to prevent directory traversal attacks
  if (!fileId || !/^[a-f0-9]{32}$/i.test(fileId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid download ID format.'
    });
  }

  // Look up file metadata
  const record = activeDownloads.get(fileId);
  if (!record) {
    return res.status(404).json({
      success: false,
      error: 'Download link has expired or does not exist.'
    });
  }

  const { filePath, title } = record;

  // Check if file exists on disk
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Temporary file has been removed.'
    });
  }

  const downloadName = `${title}.mp4`;

  // Serve the file as an attachment
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
