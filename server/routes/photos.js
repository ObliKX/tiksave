const express = require('express');
const { resolveAndValidateUrl } = require('../utils/validateUrl');
const {
  getPhotoPost,
  createPhotoInfo,
  downloadSelectedPhotos
} = require('../services/photoService');

const router = express.Router();

function readUrl(req, res) {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ success: false, type: 'unknown', error: 'Please provide a valid TikTok URL.' });
    return null;
  }
  return url.trim();
}

function handleError(res, error) {
  console.error('[PhotoRoute] Error processing photo request:', error.message);
  if (error.message.startsWith('CONFIG_ERROR')) {
    return res.status(500).json({ success: false, type: 'unknown', error: 'Photo downloads are not configured on this server.' });
  }
  if (error.message.startsWith('VIDEO_POST')) {
    return res.status(422).json({ success: false, type: 'video', error: 'This link is a video post, not a photo post.' });
  }
  if (error.message.startsWith('INVALID_SELECTION')) {
    return res.status(400).json({ success: false, type: 'photo', error: 'Choose one or more available photos.' });
  }
  if (error.message.startsWith('NO_PHOTOS')) {
    return res.status(422).json({ success: false, type: 'unknown', error: 'No photos were found in this TikTok post.' });
  }
  return res.status(422).json({
    success: false,
    type: 'unknown',
    error: 'Couldn’t retrieve the photos. Please try again in a moment.'
  });
}

router.post('/info', async (req, res) => {
  const url = readUrl(req, res);
  if (!url) return;

  try {
    const resolvedUrl = await resolveAndValidateUrl(url);
    const media = await getPhotoPost(resolvedUrl);
    return res.json(createPhotoInfo(media, resolvedUrl));
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/download', async (req, res) => {
  const url = readUrl(req, res);
  if (!url) return;

  const { selection } = req.body || {};
  try {
    const resolvedUrl = await resolveAndValidateUrl(url);
    const result = await downloadSelectedPhotos(resolvedUrl, selection);
    // Both local files and Netlify media/ZIPs are served through the same
    // short-lived URL abstraction. fetch()/Shortcuts follow this redirect.
    return res.redirect(302, result.downloadUrl);
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
