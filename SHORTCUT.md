# 📱 TikSave iPhone Shortcut Guide

With this Apple Shortcut, you can download TikTok videos directly to your iPhone's **Photos** app using the Action Button (or via the Share Sheet) without ever opening the TikSave website.

---

## 🛠️ Prerequisites

1. Your TikSave app must be deployed online (e.g. on Netlify) and accessible via HTTPS.
2. You must configure the `SHORTCUT_API_KEY` environment variable on your deployed server. Set it to a long, secure, random string.

---

## 🚀 Creating the Shortcut Step-by-Step

Open the **Shortcuts** app on your iPhone and tap the **+** (plus) icon in the top right to create a new shortcut.

1. Tap the name at the top and rename it to **`TikSave`**.
2. Build the shortcut by adding the following actions exactly as shown:

### Action 1: Get Clipboard
- Search for **Get Clipboard** and add it.

### Action 2: If
- Search for **If** and add it.
- Configure it to: `If [Clipboard] [contains] tiktok.com`

### Action 3: Get Contents of URL (Inside the 'If' block)
- Search for **Get Contents of URL** and add it immediately below the `If` statement.
- Set the URL to: `https://YOUR-DOMAIN.com/api/shortcut/download` *(Replace YOUR-DOMAIN.com with your actual Netlify/live domain!)*
- Tap the **> (arrow)** next to the URL to expand the advanced options:
  - **Method**: Change from `GET` to `POST`
  - **Headers**: Add a new header:
    - Key: `Authorization`
    - Text: `Bearer YOUR_SHORTCUT_API_KEY` *(Replace with your actual secret key from Netlify)*
  - **Request Body**: Change to `JSON`
  - Add a new field to the JSON body:
    - Key: `url`
    - Text: Select the `Clipboard` variable.

### Action 4: Save to Photo Album
- Search for **Save to Photo Album** and add it below `Get Contents of URL`.
- It should automatically say `Save [Contents of URL] to [Recents]`.
- *(Optional: You can tap 'Recents' and choose a specific album like "TikSave")*

### Action 5: Show Notification
- Search for **Show Notification** and add it below the Save action.
- Set the text to: `TikSave ✓`

---

## ⚡ Assign to Action Button (iPhone 15 Pro / 16)

Once you've saved the shortcut, you can map it to your Action Button:

1. Open the iPhone **Settings** app.
2. Tap **Action Button**.
3. Swipe until you reach the **Shortcut** option.
4. Tap **Choose a Shortcut...** and select **`TikSave`**.

Now, whenever you copy a TikTok link on your iPhone, just hold the Action Button! The video will silently download directly to your Photos in the background.

---

## 🧪 Testing the API from your Computer

To verify your server is configured correctly, run this command in your terminal (replacing the domain, key, and url):

```bash
curl -X POST "https://YOUR-DOMAIN.com/api/shortcut/download" \
  -H "Authorization: Bearer YOUR_SHORTCUT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/12345678"}' \
  -L --output test-video.mp4
```

> **Note on `-L`**: The API uses a secure token redirect (`302 Found`) for serverless deployments to bypass the 6MB limit. Apple Shortcuts follows redirects automatically. When testing with `curl`, you must include `-L` so curl follows the redirect to download the final MP4 file.
