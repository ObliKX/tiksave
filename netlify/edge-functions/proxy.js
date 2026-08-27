export default async (request, context) => {
  const url = new URL(request.url);
  const p = url.searchParams.get('p');
  const s = url.searchParams.get('s');
  
  if (!p || !s) {
    return new Response('Missing payload or signature', { status: 400 });
  }

  const secret = Deno.env.get('SERVER_SECRET');
  if (!secret) {
    return new Response('Server secret not configured', { status: 500 });
  }

  try {
    // 1. Verify Signature using Web Crypto API
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    // Parse hex signature
    const sigBytes = new Uint8Array(s.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      enc.encode(p)
    );

    if (!isValid) {
      return new Response('Invalid or tampered signature', { status: 403 });
    }

    // 2. Decode Payload
    const decodedStr = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(decodedStr);

    if (!payload.u || !payload.e) {
      return new Response('Invalid payload structure', { status: 400 });
    }

    // 3. Verify Expiration
    if (Date.now() > payload.e) {
      return new Response('Download link has expired', { status: 410 });
    }

    // 4. Fetch the video from TikTok CDN
    const response = await fetch(payload.u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return new Response('Error fetching remote video', { status: response.status });
    }

    // 5. Proxy the response headers but override Content-Disposition to force a download
    const headers = new Headers(response.headers);
    headers.set('Content-Disposition', 'attachment; filename="tiktok_video.mp4"');
    headers.set('Access-Control-Allow-Origin', '*');

    // Edge Functions have no 6MB limit and can stream the body directly!
    return new Response(response.body, {
      status: response.status,
      headers
    });
  } catch (err) {
    console.error('Edge function error:', err);
    return new Response('Failed to proxy video. Invalid token format.', { status: 500 });
  }
};

export const config = {
  path: "/api/proxy-download"
};
