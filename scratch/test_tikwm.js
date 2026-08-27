const axios = require('axios');

async function test() {
  const url = 'https://www.tiktok.com/@khaby.lame/video/6981864443440975109';
  console.log('Sending to TikWM:', url);
  try {
    const apiResponse = await axios.post(
      'https://www.tikwm.com/api/',
      new URLSearchParams({
        url: url,
        hd: '1'
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    console.log('TikWM Response:', apiResponse.data);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
