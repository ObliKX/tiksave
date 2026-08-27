const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { resolveAndValidateUrl } = require('../utils/validateUrl');
const { downloadVideo, activeDownloads } = require('../services/videoService');

// In-memory duplicate protection cache (URL Hash -> Timestamp)
const recentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds

/**
 * POST /api/shortcut/download
 * Dedicated endpoint for Apple Shortcuts iPhone integration
 */
router.post('/download', async (req, res) => {
  // 1. Authentication
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.SHORTCUT_API_KEY;

  if (!expectedKey) {
    console.error('[Shortcut API] SHORTCUT_API_KEY is not configured on the server.');
    return res.status(500).json({ success: false, error: 'Server misconfiguration.' });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Invalid API Key.' });
  }

  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'Please provide a valid TikTok video URL.' });
  }

  // 2. Duplicate Protection / Rate Limiting
  const urlHash = crypto.createHash('md5').update(url.trim()).digest('hex');
  const lastRequestTime = recentRequests.get(urlHash);

  if (lastRequestTime && (Date.now() - lastRequestTime) < RATE_LIMIT_WINDOW_MS) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment before downloading the same video again.' });
  }
  
  recentRequests.set(urlHash, Date.now());

  try {
    // 3. Resolve and validate the URL
    const resolvedUrl = await resolveAndValidateUrl(url.trim());

    // 4. Download video
    const result = await downloadVideo(resolvedUrl);

    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Failed to process video.' });
    }

    // 5. Respond
    // For serverless (Netlify), result.downloadUrl is the signed Edge Function proxy URL.
    // For local mode, result.downloadUrl is the local /api/file/:id route.
    // Apple Shortcuts transparently follows 302 redirects, so we can redirect to the final delivery endpoint!
    
    console.log(`[Shortcut API] Success. Redirecting Shortcut to final payload: ${result.downloadUrl}`);
    return res.redirect(302, result.downloadUrl);

  } catch (error) {
    console.error('[Shortcut API] Error processing video request:', error.message);
    
    // Clean up duplicate cache on error so they can try again immediately
    recentRequests.delete(urlHash);

    if (error.message.includes('CONFIG_ERROR')) {
      return res.status(500).json({
        success: false,
        error: 'Server Configuration Error: The video downloader provider is not properly configured.'
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid TikTok URL or unable to process the video.'
    });
  }
});

// Periodic cleanup of recentRequests map
setInterval(() => {
  const now = Date.now();
  for (const [hash, timestamp] of recentRequests.entries()) {
    if (now - timestamp > RATE_LIMIT_WINDOW_MS) {
      recentRequests.delete(hash);
    }
  }
}, 60000).unref();

module.exports = router;
