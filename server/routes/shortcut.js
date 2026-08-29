const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { resolveAndValidateUrl } = require('../utils/validateUrl');
const { downloadVideo, activeDownloads } = require('../services/videoService');

const recentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; 

router.post('/download', async (req, res) => {

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

  const urlHash = crypto.createHash('md5').update(url.trim()).digest('hex');
  const lastRequestTime = recentRequests.get(urlHash);

  if (lastRequestTime && (Date.now() - lastRequestTime) < RATE_LIMIT_WINDOW_MS) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment before downloading the same video again.' });
  }

  recentRequests.set(urlHash, Date.now());

  try {

    const resolvedUrl = await resolveAndValidateUrl(url.trim());

    const result = await downloadVideo(resolvedUrl);

    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Failed to process video.' });
    }

    console.log(`[Shortcut API] Success. Redirecting Shortcut to final payload: ${result.downloadUrl}`);
    return res.redirect(302, result.downloadUrl);

  } catch (error) {
    console.error('[Shortcut API] Error processing video request:', error.message);

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
