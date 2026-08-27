const axios = require('axios');

const BASE_URL = 'http://127.0.0.1:3000';

async function runTests() {
  console.log('🚀 Starting API Verification Tests for TikSave...\n');

  // Test 1: Invalid URL formats
  try {
    console.log('Test 1: Sending invalid TikTok URL format...');
    const res = await axios.post(`${BASE_URL}/api/download`, { url: 'not-a-valid-url' });
    console.error('❌ Test 1 Failed: Expected error status but got success response:', res.data);
  } catch (error) {
    if (error.response) {
      console.log('✅ Test 1 Passed: Correctly returned error status:', error.response.status);
      console.log('   Response body:', error.response.data);
    } else {
      console.error('❌ Test 1 Error:', error.message);
    }
  }

  console.log('\n----------------------------------------\n');

  // Test 2: Non-TikTok domain (SSRF protection test)
  try {
    console.log('Test 2: Sending non-TikTok domain URL (SSRF prevention)...');
    const res = await axios.post(`${BASE_URL}/api/download`, { url: 'https://example.com/some-fake-video' });
    console.error('❌ Test 2 Failed: Expected error status but got success response:', res.data);
  } catch (error) {
    if (error.response) {
      console.log('✅ Test 2 Passed: Correctly blocked non-TikTok domain. Status:', error.response.status);
      console.log('   Response body:', error.response.data);
    } else {
      console.error('❌ Test 2 Error:', error.message);
    }
  }

  console.log('\n----------------------------------------\n');

  // Test 3: Processing video with configured provider (Currently tikwm)
  try {
    console.log('Test 3: Processing real video with tikwm provider...');
    const testUrl = 'https://www.tiktok.com/@khaby.lame/video/6981864443440975109';
    const res = await axios.post(`${BASE_URL}/api/download`, { url: testUrl });
    
    console.log('✅ Test 3 Response Status:', res.status);
    console.log('   Response Body:', res.data);

    if (res.data.success && res.data.downloadUrl) {
      console.log('✅ Test 3 Passed: Successfully processed video and generated downloadUrl.');
      
      // Test 4: Accessing download link
      console.log('\nTest 4: Attempting to retrieve temporary downloaded file...');
      const fileRes = await axios.get(`${BASE_URL}${res.data.downloadUrl}`, { responseType: 'stream' });
      console.log('✅ Test 4 Response Status:', fileRes.status);
      console.log('   Content-Type:', fileRes.headers['content-type']);
      console.log('   Content-Disposition:', fileRes.headers['content-disposition']);
      console.log('✅ Test 4 Passed: Video is successfully served.');
    } else {
      console.error('❌ Test 3 Failed: Success parameter was false.');
    }
  } catch (error) {
    console.error('❌ Test 3/4 Error:', error.response ? error.response.data : error.message);
  }

  console.log('\n----------------------------------------\n');

  // Test 5: Invalid download file ID format (Security test)
  try {
    console.log('Test 5: Testing directory traversal/parameter security (invalid file ID)...');
    const res = await axios.get(`${BASE_URL}/api/file/../../package.json`);
    console.error('❌ Test 5 Failed: Allowed arbitrary file access!');
  } catch (error) {
    if (error.response) {
      console.log('✅ Test 5 Passed: Successfully blocked directory traversal. Status:', error.response.status);
      console.log('   Response Body:', error.response.data);
    } else {
      console.error('❌ Test 5 Error:', error.message);
    }
  }

  console.log('\n----------------------------------------\n');
  console.log('🏁 Verification Tests Completed.');
}

runTests();
