const MEDIA_HOST_REGEX = /^(?:[a-zA-Z0-9-]+\.)*(?:tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|byteoversea\.com|ibyteimg\.com|ibytedtos\.com|muscdn\.com|musical\.ly)$/i;
const MOCK_MEDIA_URL = 'https://www.w3schools.com/html/mov_bbb.mp4';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isAllowedMediaUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (MEDIA_HOST_REGEX.test(parsed.hostname) || value === MOCK_MEDIA_URL);
  } catch (_error) {
    return false;
  }
}

function safeFilename(value, fallback) {
  const filename = String(value || fallback).replace(/[\r\n"\\]/g, '').replace(/[^a-zA-Z0-9._@ -]/g, '').trim();
  return filename || fallback;
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map((value) => parseInt(value, 16)));
}

function uint16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(...arrays) {
  const length = arrays.reduce((total, array) => total + array.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipLocalHeader(name, crc, size) {
  const nameBytes = new TextEncoder().encode(name);
  return concat(
    uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
    uint32(crc), uint32(size), uint32(size), uint16(nameBytes.length), uint16(0), nameBytes
  );
}

function zipCentralHeader(name, crc, size, offset) {
  const nameBytes = new TextEncoder().encode(name);
  return concat(
    uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
    uint32(crc), uint32(size), uint32(size), uint16(nameBytes.length), uint16(0), uint16(0),
    uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
  );
}

function zipEnd(entryCount, centralSize, centralOffset) {
  return concat(
    uint32(0x06054b50), uint16(0), uint16(0), uint16(entryCount), uint16(entryCount),
    uint32(centralSize), uint32(centralOffset), uint16(0)
  );
}

async function fetchRemote(url) {
  if (!isAllowedMediaUrl(url)) throw new Error('Unauthorized media host');
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Remote media returned ${response.status}`);
  return response;
}

function createZipStream(items) {
  return new ReadableStream({
    async start(controller) {
      const centralHeaders = [];
      let offset = 0;
      try {
        for (const item of items) {
          const response = await fetchRemote(item.u);
          const contentType = response.headers.get('content-type') || '';
          if (contentType && !contentType.toLowerCase().startsWith('image/')) {
            throw new Error('Remote resource is not an image');
          }
          const data = new Uint8Array(await response.arrayBuffer());
          const name = safeFilename(item.n, 'photo.jpg');
          const crc = crc32(data);
          const localHeader = zipLocalHeader(name, crc, data.length);
          controller.enqueue(localHeader);
          controller.enqueue(data);
          centralHeaders.push(zipCentralHeader(name, crc, data.length, offset));
          offset += localHeader.length + data.length;
        }
        const centralOffset = offset;
        centralHeaders.forEach((header) => controller.enqueue(header));
        offset += centralHeaders.reduce((total, header) => total + header.length, 0);
        controller.enqueue(zipEnd(items.length, offset - centralOffset, centralOffset));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

export default async (request, context) => {
  const url = new URL(request.url);
  const payloadText = url.searchParams.get('p');
  const signature = url.searchParams.get('s');

  if (!payloadText || !signature) {
    return new Response('Missing payload or signature', { status: 400 });
  }

  const secret = Deno.env.get('SERVER_SECRET');
  if (!secret) return new Response('Server secret not configured', { status: 500 });

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const isValid = await crypto.subtle.verify(
      'HMAC', key, fromHex(signature), enc.encode(payloadText)
    );
    if (!isValid) return new Response('Invalid or tampered signature', { status: 403 });

    const payload = JSON.parse(atob(payloadText.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.e || Date.now() > payload.e) return new Response('Download link has expired', { status: 410 });

    if (payload.z) {
      if (!Array.isArray(payload.items) || payload.items.length < 2 || payload.items.length > 35) {
        return new Response('Invalid ZIP payload', { status: 400 });
      }
      const headers = new Headers({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeFilename(payload.n, 'TikSave-photos.zip')}"`,
        'Access-Control-Allow-Origin': '*'
      });
      return new Response(createZipStream(payload.items), { status: 200, headers });
    }

    if (!payload.u) return new Response('Invalid payload structure', { status: 400 });
    const response = await fetchRemote(payload.u);
    const contentType = response.headers.get('content-type') || '';
    if (payload.m?.startsWith('image/') && contentType && !contentType.toLowerCase().startsWith('image/')) {
      return new Response('Remote resource is not an image', { status: 415 });
    }

    const headers = new Headers(response.headers);
    if (payload.m) headers.set('Content-Type', payload.m);
    headers.set('Content-Disposition', `attachment; filename="${safeFilename(payload.n, 'tiktok_media')}"`);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response('Failed to proxy media. Invalid token format.', { status: 500 });
  }
};

export const config = {
  path: '/api/proxy-download'
};
