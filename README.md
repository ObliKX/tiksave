# TikSave - Personal TikTok Video Downloader

TikSave is a clean, modern, personal-use web application built with a premium dark interface (glassmorphism + ambient neon glows) to download TikTok videos in high-definition (HD). 

It is designed to run seamlessly on desktop, mobile (iOS and Android), and serverless platforms like **Netlify**.

---

## Features

- **Premium Design:** Glassmorphic card styling, Outfit & Inter typography, and interactive button hover states.
- **Mobile Compatibility:** Built-in video player preview and attachment headers that work on mobile web views and iOS Safari.
- **Serverless Ready:** Automatically detects if running in serverless environments (like Netlify) and uses a stateless, signed streaming proxy instead of local storage.
- **Highly Secure:** 
  - SSRF protection on redirect resolution.
  - Strict parameter sanitization and validation.
  - Cryptographic HMAC signatures for video URLs to prevent tampering and server proxy abuse.
  - CORS and rate-limiting configurations.

---

## Project Structure

```text
tiktok-downloader/
│
├── netlify/
│   └── functions/
│       └── api.js          # Netlify serverless function wrapper
│
├── server/
│   ├── server.js           # Server initializer & Express setup
│   ├── routes/
│   │   └── download.js     # Post downloader and file proxy routes
│   ├── services/
│   │   └── videoService.js # Configurable video download strategies
│   └── utils/
│       ├── validateUrl.js  # Redirect resolver and SSRF checks
│       └── cleanup.js      # Disk file cleanup scheduler (Standalone mode)
│
├── public/
│   ├── index.html          # Frontend page structure
│   ├── style.css           # Custom glassmorphic CSS design system
│   └── app.js              # Client event listeners & clipboard integrations
│
├── downloads/
│   └── .gitkeep            # Local cache directory for video binaries
│
├── .env.example            # Environment variables template
├── .gitignore              # Files ignored from source control
├── netlify.toml            # Netlify build and routing configuration
├── package.json            # Dependencies and start scripts
└── README.md               # User guide and documentation
```

---

## Architecture Overview

TikSave operates in two modes depending on the environment:

### 1. Standalone Node.js Mode (Local)
1. User pastes a TikTok link and submits.
2. The backend resolves redirect hops (e.g. `vm.tiktok.com`) while validating the target host to prevent Server-Side Request Forgery (SSRF).
3. The server downloads the MP4 file to the local `downloads/` directory.
4. A unique `fileId` is generated, and details are registered in an in-memory registry.
5. The frontend displays the preview player pointing to `/api/file/:id`.
6. Clicking **Download HD** downloads the file directly from the local disk cache.
7. A background worker periodically cleans files older than 15 minutes.

### 2. Serverless Mode (Netlify)
1. Netlify lacks a persistent stateful filesystem (making disk caching across multiple requests impossible).
2. TikSave detects `process.env.NETLIFY` and switches to **Stateless Mode**.
3. Instead of caching to disk, the server generates a cryptographically signed URL containing the direct video source URL, the sanitized title, and an HMAC signature.
4. The client preview points to `/api/file/secure?u=...&t=...&s=...`.
5. When the user plays or downloads the video, the server validates the signature and pipes the stream directly from the video CDN to the client on-the-fly.
6. This consumes **zero disk space**, eliminates storage costs, works on mobile web browsers, and prevents attackers from using your server as an arbitrary proxy (since only URLs signed by your server can be requested).

---

## Setup & Local Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v16.0.0 or higher recommended)
- NPM

### Step 1: Install Dependencies
Run the following command in the project root directory:
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` and adjust the variables:
- `PORT`: Local server port (defaults to `3000`).
- `NODE_ENV`: Set to `development` or `production`.
- `TIKTOK_PROVIDER`: Choose your download engine. Options are:
  - `tikwm`: (Recommended) Uses the TikWM API.
  - `tiktok-api-dl`: Uses the local package `@tobyg74/tiktok-api-dl`.
  - `mock`: Simulates downloads using an open source test video (ideal for offline tests).
- `TIKWM_API_KEY`: (Optional) Custom API Key for TikWM to bypass rate limits.
- `SERVER_SECRET`: (Optional) Secret key to sign URLs. A random key is generated automatically if not set.

### Step 3: Run Locally
Start the development server:
```bash
npm start
```
Open your browser and navigate to `http://localhost:3000`.

---

## Deploying to Netlify

TikSave is designed to deploy to Netlify out-of-the-box using **Netlify Functions**.

### Step 1: Push to GitHub/GitLab
Initialize git in your folder (if not done already) and push to your git host:
```bash
git init
git add .
git commit -m "Initial commit"
# Push to your repository
```

### Step 2: Deploy on Netlify
1. Log in to the [Netlify Dashboard](https://app.netlify.com/).
2. Click **Add new site** -> **Import an existing project**.
3. Link your repository.
4. Netlify will automatically detect `netlify.toml` and apply:
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
5. Click **Deploy Site**.

### Step 3: Configure Netlify Environment Variables
To ensure downloads work:
1. Go to **Site Configuration** -> **Environment variables**.
2. Add the following variables:
   - `TIKTOK_PROVIDER`: Set to `tikwm` (or `mock` to test).
   - `SERVER_SECRET`: A long random string (e.g. `your_server_secret_key_12345`). This ensures signatures match across scaled serverless containers.
   - `TIKWM_API_KEY`: (Optional) Add your API key if you have a premium subscription.
3. Trigger a redeploy of your site to apply changes.

---

## Disclaimer
This project is built for **personal-use only** (downloading videos you own or have explicit permission to download). Respect TikTok terms of service and copyrights.
