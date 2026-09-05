const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const crypto = require('crypto');
const { resolveAndValidateUrl } = require('../utils/validateUrl');
const { downloadVideo, fetchProviderResult } = require('../services/videoService');
const { getPhotoPost, createPhotoInfo, downloadSelectedPhotos } = require('../services/photoService');

const recentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 10000;

function authenticate(req, res) {
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.SHORTCUT_API_KEY;
  if (!expectedKey) {
    console.error('[Shortcut API] SHORTCUT_API_KEY is not configured on the server.');
    res.status(500).json({ success: false, error: 'Server misconfiguration.' });
    return false;
  }
  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    console.warn(`[Shortcut API] Authentication failed: ${!authHeader ? 'missing Authorization header' : 'invalid API key'}.`);
    res.status(401).json({ success: false, error: 'Unauthorized. Invalid API Key.' });
    return false;
  }
  return true;
}

function checkShortcutRateLimit(url, operation) {
  const key = `${operation}:${url}`;
  const lastRequestTime = recentRequests.get(key);
  if (lastRequestTime && Date.now() - lastRequestTime < RATE_LIMIT_WINDOW_MS) {
    console.warn(`[Shortcut API] Rate limit hit for ${operation}.`);
    return false;
  }
  recentRequests.set(key, Date.now());
  return true;
}

function readShortcutUrl(req, res) {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ success: false, type: 'unknown', error: 'Please provide a valid TikTok URL.' });
    return null;
  }
  return url.trim();
}

const RESOLUTION_ERROR_CODES = new Set(['INVALID_URL', 'RESOLUTION_FAILED', 'SSRF_BLOCKED', 'REDIRECT_INVALID', 'REDIRECT_LOOP', 'REDIRECT_LIMIT']);

function shortcutError(res, error) {
  console.error(`[Shortcut API] Error processing request [${error.code || 'UNCLASSIFIED'}]:`, error.message);
  if (error.cause && error.cause.message) {
    console.error(`[Shortcut API] Underlying cause [${error.code || 'UNCLASSIFIED'}]:`, error.cause.message);
  }
  if (RESOLUTION_ERROR_CODES.has(error.code)) {
    console.error('[Shortcut API] Failure stage: short-link redirect resolution.');
  }
  if (error.message.startsWith('CONFIG_ERROR')) {
    return res.status(500).json({ success: false, type: 'unknown', error: 'Server misconfiguration.' });
  }
  if (error.message.startsWith('INVALID_SELECTION')) {
    return res.status(400).json({ success: false, type: 'photo', error: 'Invalid photo selection.' });
  }
  if (error.message.startsWith('VIDEO_POST')) {
    return res.status(422).json({ success: false, type: 'video', error: 'This link is a video post.' });
  }
  return res.status(422).json({ success: false, type: 'unknown', error: 'TikSave could not retrieve this TikTok post.' });
}

// Lightweight authenticated type detection used by the Apple Shortcut.
router.post('/info', async (req, res) => {
  if (!authenticate(req, res)) return;
  const url = readShortcutUrl(req, res);
  if (!url) return;
  if (!checkShortcutRateLimit(url, 'info')) {
    return res.status(429).json({ success: false, type: 'unknown', error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const resolvedUrl = await resolveAndValidateUrl(url);
    const media = await fetchProviderResult(resolvedUrl);
    if (media.type === 'photo') {
      return res.json({ success: true, type: 'photo', count: media.photoUrls.length });
    }
    return res.json({ success: true, type: 'video' });
  } catch (error) {
    recentRequests.delete(`info:${url}`);
    return shortcutError(res, error);
  }
});

router.post('/photos/info', async (req, res) => {
  if (!authenticate(req, res)) return;
  const url = readShortcutUrl(req, res);
  if (!url) return;
  if (!checkShortcutRateLimit(url, 'photo-info')) {
    return res.status(429).json({ success: false, type: 'unknown', error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const resolvedUrl = await resolveAndValidateUrl(url);
    const media = await getPhotoPost(resolvedUrl);
    return res.json(createPhotoInfo(media, resolvedUrl));
  } catch (error) {
    recentRequests.delete(`photo-info:${url}`);
    return shortcutError(res, error);
  }
});

router.post('/photos/download', async (req, res) => {
  if (!authenticate(req, res)) return;
  const url = readShortcutUrl(req, res);
  if (!url) return;
  if (!checkShortcutRateLimit(url, 'photo-download')) {
    return res.status(429).json({ success: false, type: 'unknown', error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const resolvedUrl = await resolveAndValidateUrl(url);
    const result = await downloadSelectedPhotos(resolvedUrl, req.body.selection);
    return res.redirect(302, result.downloadUrl);
  } catch (error) {
    recentRequests.delete(`photo-download:${url}`);
    return shortcutError(res, error);
  }
});

router.post('/download', async (req, res) => {

  if (!authenticate(req, res)) return;

  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, type: 'unknown', error: 'Please provide a valid TikTok video URL.' });
  }

  const urlHash = `download:${url.trim()}`;
  const lastRequestTime = recentRequests.get(urlHash);

  if (lastRequestTime && (Date.now() - lastRequestTime) < RATE_LIMIT_WINDOW_MS) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment before downloading the same video again.' });
  }

  recentRequests.set(urlHash, Date.now());

  try {

    const resolvedUrl = await resolveAndValidateUrl(url.trim());

    const media = await fetchProviderResult(resolvedUrl);
    if (media.type === 'photo') {
      return res.status(409).json({
        success: false,
        type: 'photo',
        error: 'This is a photo post. Use /api/shortcut/photos/info and /api/shortcut/photos/download.'
      });
    }
    const result = await downloadVideo(resolvedUrl, media);

    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Failed to process video.' });
    }

    console.log(`[Shortcut API] Success. Redirecting Shortcut to final payload: ${result.downloadUrl}`);
    return res.redirect(302, result.downloadUrl);

  } catch (error) {
    console.error(`[Shortcut API] Error processing video request [${error.code || 'UNCLASSIFIED'}]:`, error.message);

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

setInterval(() => {
  const now = Date.now();
  for (const [hash, timestamp] of recentRequests.entries()) {
    if (now - timestamp > RATE_LIMIT_WINDOW_MS) {
      recentRequests.delete(hash);
    }
  }
}, 60000).unref();

router.get('/install', (req, res) => {
  const { key } = req.query;

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing ?key= query parameter. Please provide your SHORTCUT_API_KEY.'
    });
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const apiUrl = `${protocol}://${host}/api/shortcut/download`;

  const clipboardUUID = randomUUID().toUpperCase();
  const urlActionUUID = randomUUID().toUpperCase();
  const saveUUID = randomUUID().toUpperCase();
  const notifUUID = randomUUID().toUpperCase();

  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const safeKey = esc(`Bearer ${key.trim()}`);
  const safeUrl = esc(apiUrl);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- Action 1: Get Clipboard -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getclipboard</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${clipboardUUID}</string>
      </dict>
    </dict>

    <!-- Action 2: Get Contents of URL (POST to TikSave API) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${urlActionUUID}</string>
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFURL</key>
        <string>${safeUrl}</string>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>Authorization</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
                <key>WFValue</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>${safeKey}</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFHTTPBodyType</key>
        <string>JSON</string>
        <key>WFHTTPRequestBody</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>string</key>
                    <string>url</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
                <key>WFValue</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>attachmentsByRange</key>
                    <dict>
                      <key>{0, 1}</key>
                      <dict>
                        <key>OutputUUID</key>
                        <string>${clipboardUUID}</string>
                        <key>Type</key>
                        <string>ActionOutput</string>
                      </dict>
                    </dict>
                    <key>string</key>
                    <string>&#xFFFC;</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenString</string>
                </dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
      </dict>
    </dict>

    <!-- Action 3: Save to Photo Album -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.savetoalbum</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${saveUUID}</string>
        <key>WFInput</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>attachmentsByRange</key>
            <dict>
              <key>{0, 1}</key>
              <dict>
                <key>OutputUUID</key>
                <string>${urlActionUUID}</string>
                <key>Type</key>
                <string>ActionOutput</string>
              </dict>
            </dict>
            <key>string</key>
            <string>&#xFFFC;</string>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenString</string>
        </dict>
      </dict>
    </dict>

    <!-- Action 4: Show Notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${notifUUID}</string>
        <key>WFNotificationActionBody</key>
        <string>TikSave &#x2713;</string>
        <key>WFNotificationActionTitle</key>
        <string>Saved to Photos!</string>
      </dict>
    </dict>

  </array>
  <key>WFWorkflowClientVersion</key>
  <string>2600.0.2</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionDescription</key>
  <string>iOS 16.4</string>
  <key>WFWorkflowName</key>
  <string>TikSave</string>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>-2078573057</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59511</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFStringContentItem</string>
  </array>
  <key>WFWorkflowTypes</key>
  <array/>
</dict>
</plist>`;

  console.log(`[Shortcut Install] Generating shortcut file for host: ${host}`);

  res.setHeader('Content-Type', 'application/x-apple-aspen-shortcut');
  res.setHeader('Content-Disposition', 'attachment; filename="TikSave.shortcut"');
  res.send(plist);
});

module.exports = router;
