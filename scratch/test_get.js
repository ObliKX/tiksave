const axios = require('axios');

async function testGet() {
  const url = 'https://www.tiktok.com/@tiktok/video/7106203554625293614';
  try {
    const res = await axios.get(`https://www.tikwm.com/api/`, {
      params: {
        url: url,
        hd: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('GET Response:', res.data);
  } catch (err) {
    console.error('GET Error:', err.message);
  }
}

testGet();
