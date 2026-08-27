const axios = require('axios');

async function checkUrl(url) {
  try {
    const apiResponse = await axios.post(
      'https://www.tikwm.com/api/',
      new URLSearchParams({ url, hd: '1' }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );
    console.log(`URL: ${url} ->`, apiResponse.data.code === 0 ? 'SUCCESS' : 'FAILED: ' + apiResponse.data.msg);
    return apiResponse.data.code === 0;
  } catch (err) {
    console.log(`URL: ${url} -> ERROR:`, err.message);
    return false;
  }
}

async function run() {
  const urls = [
    'https://www.tiktok.com/@tiktok/video/7106203554625293614',
    'https://www.tiktok.com/@mrbeast/video/7279313264629452075',
    'https://www.tiktok.com/@bellapoarch/video/6862153058223197445',
    'https://vm.tiktok.com/ZMYX36d5m/'
  ];
  for (const url of urls) {
    await checkUrl(url);
  }
}

run();
