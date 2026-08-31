# 📱 TikSave Shortcut: videos and photo posts

This Shortcut is for TikTok content you own or have permission to download. It keeps the existing video workflow and adds photo/carousel posts.

## Requirements

- A deployed TikSave URL using HTTPS.
- `SHORTCUT_API_KEY` configured on the server.
- The existing bearer header, exactly:

```text
Authorization: Bearer YOUR_SHORTCUT_API_KEY
```

Do not put this key in the website frontend or share it publicly.

## Recommended Shortcut flow

Assign the completed Shortcut to the iPhone Action Button:

```text
Get Clipboard
  ↓
Show Notification: TikSave: Finding post... 🔎
  ↓
Get Contents of URL (POST /api/shortcut/info)
  ↓
If type is video
  ↓
  Show Notification: TikSave: Fetching video... ⏳
  ↓
  Get Contents of URL (POST /api/shortcut/download)
  ↓
  Show Notification: TikSave: Saving to Photos... 💾
  ↓
  Save File / Save to Photo Album (TikSave)
Otherwise, if type is photo
  ↓
  Get photo count
  ↓
  Choose from Menu or Choose from List
  ↓
  POST selection to /api/shortcut/photos/download
  ↓
  Receive one image or a ZIP
  ↓
  If ZIP: Unzip → Repeat with Each → Save to Photo Album (TikSave)
  ↓
  Show Notification: TikSave: Done! ✅
```

## Build or update it in Shortcuts

1. Add **Get Clipboard**.
2. Add **Show Notification** with `TikSave: Finding post... 🔎`.
3. Add **Get Contents of URL**:
   - URL: `https://YOUR-DOMAIN.com/api/shortcut/info`
   - Method: `POST`
   - Request Body: `JSON`
   - JSON field `url`: the Clipboard magic variable
   - Header `Authorization`: `Bearer YOUR_SHORTCUT_API_KEY`
4. Add an **If** action checking the returned Dictionary's `type` equals `video`.
5. In the video branch:
   - Show `TikSave: Fetching video... ⏳`.
   - POST the Clipboard URL to `https://YOUR-DOMAIN.com/api/shortcut/download` with the same Authorization header.
   - Show `TikSave: Saving to Photos... 💾`.
   - Use **Save to Photo Album**, selecting or creating the album `TikSave`.
6. In the photo branch, first call **Get Contents of URL**:
   - URL: `https://YOUR-DOMAIN.com/api/shortcut/photos/info`
   - Method: `POST`, JSON body `{ "url": Clipboard }`
   - Add the same Authorization header.
7. Use **Get Dictionary Value** for `count`.
8. For a dynamic native choice, use **Choose from List** with a list made by **Repeat** from `1` through `count`. Add `All Photos` as an additional item. Enable **Select Multiple** if that option is available in your iOS version.
   - If your iOS version does not offer dynamic multi-select reliably, use **Choose from Menu** for each index plus an `All Photos` item, or use one **Choose from List** and download one image at a time. This is a native fallback, not a simulated UI.
   - Convert `Photo 1`, `Photo 2`, etc. into a Number list. For `All Photos`, send the text `all`.
9. POST the selection to `https://YOUR-DOMAIN.com/api/shortcut/photos/download`:
   - JSON body: `url` = Clipboard and `selection` = the selected Number list or text `all`.
   - Keep the Authorization header.
10. The endpoint returns a redirect to a short-lived signed download:
    - One selected photo: an image (`image/jpeg`, `image/png`, or another actual image type).
    - Multiple photos or `all`: `application/zip`.
11. If the result is a ZIP, use **Unzip Archive**, **Get Items from Folder**, and **Repeat with Each**. Save each image to the `TikSave` Photos album. For one image, save the received file directly.
12. Show `TikSave: Done! ✅`.

The API does not claim percentage progress. Use the notifications above as stage indicators only.

## Existing video Shortcut compatibility

The old `/api/shortcut/download` endpoint remains available and still returns the video download redirect. Do not rename it. The new `/api/shortcut/info` call is only for branching; video downloads continue through the existing endpoint.

## API examples

Type detection:

```json
POST /api/shortcut/info
Authorization: Bearer YOUR_SHORTCUT_API_KEY
Content-Type: application/json

{"url":"https://www.tiktok.com/@username/photo/123456789"}
```

```json
{"success":true,"type":"photo","count":4}
```

Photo info:

```json
POST /api/shortcut/photos/info
Authorization: Bearer YOUR_SHORTCUT_API_KEY
Content-Type: application/json

{"url":"https://www.tiktok.com/@username/photo/123456789"}
```

Selected download:

```json
POST /api/shortcut/photos/download
Authorization: Bearer YOUR_SHORTCUT_API_KEY
Content-Type: application/json

{"url":"https://www.tiktok.com/@username/photo/123456789","selection":[1,3]}
```

Use `{ "selection": "all" }` to request every available photo.

## Security and Netlify behavior

- Shortcut endpoints require the existing API key and are rate limited.
- URLs are validated as TikTok URLs before provider retrieval.
- The server only signs media URLs returned by the configured provider and only allows known TikTok CDN hosts.
- Signed links expire after two minutes. Netlify's Edge Function streams an individual image or builds a temporary ZIP stream, avoiding the serverless function response-size limit.
- No provider credential, internal file path, or arbitrary external URL is exposed.

## Notifications

Use these exact friendly stages where practical:

- `TikSave: Finding post... 🔎`
- `TikSave: Fetching video... ⏳`
- `TikSave: Downloading N photos... ⏳`
- `TikSave: Saving to Photos... 💾`
- `TikSave: Done! ✅`
