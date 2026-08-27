const { Downloader } = require('@tobyg74/tiktok-api-dl');

async function test() {
  const url = 'https://www.tiktok.com/@mrbeast/video/7279313264629452075';
  console.log('Sending to tiktok-api-dl Downloader:', url);
  try {
    const res = await Downloader(url, {
      version: 'v1'
    });
    console.log('Result status:', res.status);
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
