export default async (request, context) => {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl) {
    return new Response('Missing target URL', { status: 400 });
  }

  try {
    // Fetch the video from TikTok CDN
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return new Response('Error fetching video', { status: response.status });
    }

    // Proxy the response headers but override Content-Disposition to force a download
    const headers = new Headers(response.headers);
    headers.set('Content-Disposition', 'attachment; filename="tiktok_video.mp4"');
    headers.set('Access-Control-Allow-Origin', '*');

    // Edge Functions have no 6MB limit and can stream the body directly!
    return new Response(response.body, {
      status: response.status,
      headers
    });
  } catch (err) {
    return new Response('Failed to proxy video', { status: 500 });
  }
};

export const config = {
  path: "/api/proxy-download"
};
