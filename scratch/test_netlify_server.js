process.env.PORT = '3001';
process.env.NETLIFY = 'true';
process.env.TIKTOK_PROVIDER = 'mock'; // Use mock to test flow deterministically

const express = require('express');
const axios = require('axios');
const app = require('../server/server');

const server = app.listen(3001, async () => {
  console.log('🚀 Test Server started in Netlify/Serverless mode on port 3001.');
  const BASE_URL = 'http://127.0.0.1:3001';

  try {
    // 1. Send mock video request
    console.log('\n--- Test 1: POST /api/download (Mock URL) ---');
    const res = await axios.post(`${BASE_URL}/api/download`, {
      url: 'https://www.tiktok.com/@tiktok/video/7106203554625293614'
    });
    console.log('Status:', res.status);
    console.log('Body:', res.data);

    if (res.data.success && res.data.downloadUrl) {
      console.log('✅ Test 1 Passed: Generated signed serverless download URL.');

      // 2. Fetch the file via the signed proxy URL
      console.log('\n--- Test 2: GET signed proxy URL ---');
      const proxyUrl = `${BASE_URL}${res.data.downloadUrl}`;
      console.log('Proxy URL:', proxyUrl);
      const downloadRes = await axios.get(proxyUrl);
      console.log('Status:', downloadRes.status);
      console.log('Headers:', {
        'content-type': downloadRes.headers['content-type'],
        'content-disposition': downloadRes.headers['content-disposition'],
        'content-length': downloadRes.headers['content-length']
      });
      console.log('✅ Test 2 Passed: File successfully streamed stateless-ly.');
    } else {
      console.error('❌ Test 1 Failed.');
    }

    // 3. Test signature tampering security
    console.log('\n--- Test 3: GET proxy URL with tampered signature ---');
    const tamperedUrl = `${BASE_URL}${res.data.downloadUrl.replace(/&s=[a-f0-9]+/, '&s=12345abcde')}`;
    try {
      await axios.get(tamperedUrl);
      console.error('❌ Test 3 Failed: Allowed tampered signature access!');
    } catch (err) {
      if (err.response) {
        console.log('Status:', err.response.status);
        console.log('Body:', err.response.data);
        console.log('✅ Test 3 Passed: Successfully blocked tampered link.');
      } else {
        console.error('Test 3 Error:', err.message);
      }
    }

    // 4. Test SSRF URL validation security
    console.log('\n--- Test 4: GET proxy URL with unauthorized target domain ---');
    const googleB64 = Buffer.from('https://google.com').toString('base64url');
    const tamperedDomainUrl = `${BASE_URL}${res.data.downloadUrl.replace(/u=[a-zA-Z0-9_-]+/, 'u=' + googleB64)}`;
    try {
      await axios.get(tamperedDomainUrl);
      console.error('❌ Test 4 Failed: Allowed SSRF request to google.com!');
    } catch (err) {
      if (err.response) {
        console.log('Status:', err.response.status);
        console.log('Body:', err.response.data);
        console.log('✅ Test 4 Passed: Successfully blocked SSRF.');
      } else {
        console.error('Test 4 Error:', err.message);
      }
    }

  } catch (err) {
    console.error('Test Error:', err.response ? err.response.data : err.message);
  } finally {
    server.close(() => {
      console.log('\n🏁 Test Server shut down.');
    });
  }
});
