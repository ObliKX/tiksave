const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();

const { resolveAndValidateUrl } = require('../utils/validateUrl');
const { getPhotoInfo, downloadPhotos, activePhotoDownloads, purgeExpiredPhotoRegistry } = require('../services/photoService');

/**
 * POST /api/photos/info
 * Get information about a photo post without downloading
 */
router.post('/info', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid TikTok URL.'
    });
  }

  try {
    const resolvedUrl = await resolveAndValidateUrl(url.trim());
    const photoInfo = await getPhotoInfo(resolvedUrl);

    return res.json(photoInfo);

  } catch (error) {
    console.error('[PhotoRoute] Error processing photo info request:', error.message);

    if (error.message.includes('CONFIG_ERROR')) {
      return res.status(500).json({
        success: false,
        error: 'Server Configuration Error: The photo provider is not properly configured.'
      });
    }

    if (error.message.includes('No photos found')) {
      return res.status(422).json({
        success: false,
        error: 'This post does not contain photos. Please verify that the link is correct.'
      });
    }

    return res.status(422).json({
      success: false,
      error: 'Unable to process this post. Please verify that the link is correct and the post is public.'
    });
  }
});

/**
 * POST /api/photos/download
 * Download selected photos from a photo post
 */
router.post('/download', async (req, res) => {
  const { url, selection } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid TikTok URL.'
    });
  }

  if (!selection) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a photo selection (array of indices or "all").'
    });
  }

  try {
    const resolvedUrl = await resolveAndValidateUrl(url.trim());

    // Validate selection format
    let selectedIndices = [];
    if (typeof selection === 'string' && selection === 'all') {
      selectedIndices = 'all';
    } else if (Array.isArray(selection)) {
      selectedIndices = selection.map(s => {
        const idx = parseInt(s, 10);
        if (isNaN(idx) || idx < 1) {
          throw new Error('Invalid photo index');
        }
        return idx;
      });

      if (selectedIndices.length === 0) {
        throw new Error('Please select at least one photo');
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Selection must be an array of photo numbers or "all"'
      });
    }

    const result = await downloadPhotos(resolvedUrl, selectedIndices);

    return res.json(result);

  } catch (error) {
    console.error('[PhotoRoute] Error processing photo download request:', error.message);

    if (error.message.includes('CONFIG_ERROR')) {
      return res.status(500).json({
        success: false,
        error: 'Server Configuration Error: The photo provider is not properly configured.'
      });
    }

    if (error.message.includes('Invalid photo')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid photo selection. Please select valid photo numbers.'
      });
    }

    return res.status(422).json({
      success: false,
      error: 'Unable to download the photos. Please try again.'
    });
  }
});

/**
 * GET /api/photo/:id
 * Serve downloaded photo or ZIP file
 */
router.get('/:id', (req, res) => {
  const photoId = req.params.id;

  if (!photoId || !/^[a-f0-9]{32}$/.test(photoId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid photo ID format'
    });
  }

  purgeExpiredPhotoRegistry();

  const photoData = activePhotoDownloads.get(photoId);

  if (!photoData) {
    return res.status(404).json({
      success: false,
      error: 'Photo not found or has expired'
    });
  }

  if (!fs.existsSync(photoData.filePath)) {
    activePhotoDownloads.delete(photoId);
    return res.status(404).json({
      success: false,
      error: 'Photo file not found'
    });
  }

  const filename = photoData.title;
  const isZip = photoData.isZip || photoData.filePath.endsWith('.zip');
  const contentType = isZip ? 'application/zip' : 'image/jpeg';
  const downloadName = isZip ? `${filename}.zip` : `${filename}.jpg`;

  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('Content-Type', contentType);

  const stream = fs.createReadStream(photoData.filePath);
  stream.pipe(res);

  stream.on('error', (err) => {
    console.error('[PhotoRoute] Stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Error reading photo file' });
    }
  });
});

module.exports = router;
