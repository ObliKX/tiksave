const { resolveAndValidateUrl } = require('../server/utils/validateUrl');

async function test() {
  try {
    const url = 'https://www.tiktok.com/@khaby.lame/video/6981864443440975109';
    console.log('Resolving:', url);
    const resolved = await resolveAndValidateUrl(url);
    console.log('Resolved to:', resolved);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
