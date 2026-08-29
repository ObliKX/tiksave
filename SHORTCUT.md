# 📱 TikSave iPhone Shortcut Guide

With this Apple Shortcut, you can download **TikTok videos AND photos** directly to your iPhone's **Photos** app using the Action Button (or via the Share Sheet) without ever opening the TikSave website.

The Shortcut automatically detects whether you've copied a video or photo post and handles each appropriately:
- **Videos**: Downloads directly to Photos
- **Photo Carousel**: Asks which photos you want, then downloads them

---

## 🛠️ Prerequisites

1. Your TikSave app must be deployed online (e.g. on Netlify) and accessible via HTTPS.
2. You must configure the `SHORTCUT_API_KEY` environment variable on your deployed server. Set it to a long, secure, random string.

---

## 🚀 Creating the Updated Shortcut Step-by-Step

Open the **Shortcuts** app on your iPhone and tap the **+** (plus) icon in the top right to create a new shortcut.

1. Tap the name at the top and rename it to **`TikSave`**.
2. Build the shortcut by adding the following actions exactly as shown:

### Action 1: Get Clipboard
- Search for **Get Clipboard** and add it.

### Action 2: If
- Search for **If** and add it.
- Configure it to: `If [Clipboard] [contains] tiktok.com`

### Action 3: Ask for [Post Type Detection]
- Search for **Get Contents of URL** and add it below the `If` statement.
- Set the URL to: `https://YOUR-DOMAIN.com/api/shortcut/info` *(Replace YOUR-DOMAIN.com with your actual Netlify/live domain!)*
- Tap the **> (arrow)** next to the URL to expand the advanced options:
  - **Method**: Change from `GET` to `POST`
  - **Headers**: Add a new header:
    - Key: `Authorization`
    - Text: `Bearer YOUR_SHORTCUT_API_KEY` *(Replace with your actual secret key from Netlify)*
  - **Request Body**: Change to `JSON`
  - Add a new field to the JSON body:
    - Key: `url`
    - Text: Select the `Clipboard` variable.
- This request will return `{"type":"video"}` or `{"type":"photo","count":4}` etc.

### Action 4: Get [JSON] Value from [Contents of URL]
- Search for **Get Dictionary Value** (or **Get JSON Value**) and add it.
- Configure it to extract the `type` field from the previous response.
- Let's call this result: `PostType`

### Action 5: If [PostType] = "video"
- Search for **If** and add another conditional.
- Set it to: `If [PostType] [equals] video`

### Action 6: Get Contents of URL (Video Download - inside the `If video` block)
- Search for **Get Contents of URL** and add it inside the video `If` block.
- Set the URL to: `https://YOUR-DOMAIN.com/api/shortcut/download`
- Tap the **> (arrow)** to expand advanced options:
  - **Method**: `POST`
  - **Headers**:
    - Key: `Authorization`
    - Text: `Bearer YOUR_SHORTCUT_API_KEY`
  - **Request Body**: `JSON`
  - Add a field:
    - Key: `url`
    - Text: Select the `Clipboard` variable.
- This returns the video file to download.

### Action 7: Save to Photo Album (Video - inside the `If video` block)
- Search for **Save to Photo Album** and add it.
- It should say `Save [Contents of URL] to [Recents]`.
- *(Optional: choose the "TikSave" album instead)*

### Action 8: Otherwise (Photo handling - add `Else` block)
- Add an **Else** block to the `If [PostType] = "video"` statement.

### Action 9: Get [JSON] Value - Photo Count
- Inside the Else block, search for **Get Dictionary Value** and add it.
- Extract the `count` field from the earlier response.
- This tells us how many photos are available.

### Action 10: Ask for Photo Selection
- Search for **Ask for [Number]** or **Ask for Text with List**.
- Create a **menu** with the following options:
  - For each photo number (1, 2, 3, ... up to the count from Action 9):
    - Add option `Photo 1`, `Photo 2`, etc.
  - Add a final option `All Photos`
- This will let the user choose which photos to download.

**Alternative Approach (if Shortcuts doesn't support dynamic lists):**
- Use **Ask for Text** with a message like: "Enter photo numbers separated by commas (e.g., 1,3,4) or type ALL"
- Store this as `UserSelection`

### Action 11: Build Selection Array
- If using the menu approach, convert the selected photo number to an array.
- If using text input, you'll need to parse it (split by comma, trim, convert to numbers).
- For simplicity with menu approach:
  - If `Photo 1` selected → `[1]`
  - If `Photo 2` selected → `[2]`
  - If `All Photos` selected → `"all"`

### Action 12: Get Contents of URL (Photo Download)
- Search for **Get Contents of URL** and add it.
- Set the URL to: `https://YOUR-DOMAIN.com/api/photos/download`
- Tap the **> (arrow)** to expand:
  - **Method**: `POST`
  - **Headers**:
    - Key: `Authorization`
    - Text: `Bearer YOUR_SHORTCUT_API_KEY`
  - **Request Body**: `JSON`
  - Add two fields:
    - Key: `url` → Value: `Clipboard`
    - Key: `selection` → Value: `[1]` (or your selection array, or `"all"`)
- This returns either a single image or a ZIP file.

### Action 13: Save to Photo Album (Photos - inside Else block)
- Search for **Save to Photo Album** and add it below the photo download.
- It should say `Save [Contents of URL] to [Recents]`.
- *(Optional: choose the "TikSave" album)*

### Action 14: Show Notification (End of Else block)
- Search for **Show Notification** and add it at the end of the Else block.
- Set the text to: `TikSave ✓ Photos saved!`

### Action 15: End If
- The Else block closes automatically.

### Action 16: Show Notification (After all If/Else - if link is invalid)
- Add a **Show Notification** action after the entire If/Else block.
- This handles cases where the URL doesn't contain "tiktok.com".
- Set text to: `Please copy a valid TikTok link.`

---

## ⚡ Assign to Action Button (iPhone 15 Pro / 16)

Once you've saved the shortcut, you can map it to your Action Button:

1. Open the iPhone **Settings** app.
2. Tap **Action Button**.
3. Swipe until you reach the **Shortcut** option.
4. Tap **Choose a Shortcut...** and select **`TikSave`**.

Now, whenever you copy a TikTok link on your iPhone, just hold the Action Button! The Shortcut will:
- Detect if it's a video or photo post
- Download the video or ask you which photos to save
- Save everything to your Photos app in the background

---

## 🎬 Video Flow

```
Copy TikTok video link
        ↓
Hold Action Button
        ↓
TikSave Shortcut detects: type = "video"
        ↓
Downloads video
        ↓
Saves to Photos ✓
```

---

## 🖼️ Photo Flow

```
Copy TikTok photo link
        ↓
Hold Action Button
        ↓
TikSave Shortcut detects: type = "photo", count = 4
        ↓
"Which photos do you want?"
    Menu:
    - Photo 1
    - Photo 2
    - Photo 3
    - Photo 4
    - All Photos
        ↓
User selects (e.g., "Photo 1 and Photo 3")
        ↓
Downloads selected photos
        ↓
Saves to Photos ✓
```

---

## 🧪 Testing the API from your Computer

### Test Video Detection:

```bash
curl -X POST "https://YOUR-DOMAIN.com/api/shortcut/info" \
  -H "Authorization: Bearer YOUR_SHORTCUT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/12345678"}'
```

**Expected response for a video:**
```json
{
  "success": true,
  "type": "video"
}
```

**Expected response for a photo post:**
```json
{
  "success": true,
  "type": "photo",
  "count": 4
}
```

### Test Video Download (existing):

```bash
curl -X POST "https://YOUR-DOMAIN.com/api/shortcut/download" \
  -H "Authorization: Bearer YOUR_SHORTCUT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/12345678"}' \
  -L --output test-video.mp4
```

### Test Photo Download:

```bash
curl -X POST "https://YOUR-DOMAIN.com/api/photos/download" \
  -H "Authorization: Bearer YOUR_SHORTCUT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@user/photo/12345678","selection":[1,3]}' \
  -L --output photos.zip
```

> **Note on `-L`**: The API uses secure token redirects (`302 Found`) for serverless deployments. Include `-L` so curl follows the redirect to download the final file.

---

## 🔒 Security Notes

- Your `SHORTCUT_API_KEY` is sensitive. Keep it secure and don't share it.
- The Shortcut sends the key in the `Authorization: Bearer` header.
- All API endpoints validate the key before processing requests.
- Photos are downloaded from TikTok's CDN using validated, signed URLs.
- Temporary files are cleaned up automatically on the server.

---

## 📖 Web Interface

You can also use the TikSave website to download videos and photos:

1. Visit your TikSave domain (e.g., https://YOUR-DOMAIN.com)
2. Paste a TikTok video link → Download video
3. Paste a TikTok photo post link → Select photos → Download as ZIP (or single image)

The web interface offers the same functionality as the Shortcut!
