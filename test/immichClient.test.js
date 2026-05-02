import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import {
  ImmichApiError,
  ImmichClient,
  ImmichRequestTimeoutError,
  normalizeImmichBaseUrl,
  normalizeSearchResponse,
} from '../src/immichClient.js';

test('normalizes Immich base URLs to /api/', () => {
  assert.equal(String(normalizeImmichBaseUrl('http://example.test')), 'http://example.test/api/');
  assert.equal(String(normalizeImmichBaseUrl('http://example.test/api')), 'http://example.test/api/');
  assert.equal(String(normalizeImmichBaseUrl('http://example.test/base/')), 'http://example.test/base/api/');
});

test('normalizes search response with nested assets and nextPage', () => {
  const normalized = normalizeSearchResponse({
    assets: {
      items: [{ id: 'a' }],
      nextPage: 2,
    },
  });

  assert.deepEqual(normalized, {
    items: [{ id: 'a' }],
    nextPage: 2,
    hasNextPage: true,
  });
});

test('iterates paged metadata search responses', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    const body = requests.length === 1
      ? { assets: { items: [{ id: 'one' }], nextPage: 2 } }
      : { assets: { items: [{ id: 'two' }] } };

    return Response.json(body);
  };

  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    fetchImpl,
  });

  const assets = [];
  for await (const asset of client.iterateSearch({ type: 'IMAGE' }, { pageSize: 1 })) {
    assets.push(asset);
  }

  assert.deepEqual(assets.map((asset) => asset.id), ['one', 'two']);
  assert.equal(requests[0].url, 'http://immich.test/api/search/metadata');
  assert.equal(requests[0].body.page, 1);
  assert.equal(requests[1].body.page, 2);
  assert.equal(requests[0].body.withExif, true);
});

test('listAlbums loads Immich albums', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'http://immich.test/api/albums');
    assert.equal(init.method, 'GET');
    return Response.json([{ id: 'album-id', albumName: 'Trip', assetCount: 10 }]);
  };

  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    fetchImpl,
  });

  assert.deepEqual(await client.listAlbums(), [
    { id: 'album-id', albumName: 'Trip', assetCount: 10 },
  ]);
});

test('listAlbumImages searches image assets by album id', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ assets: { items: [{ id: 'album-image' }] } });
  };

  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    fetchImpl,
  });

  assert.deepEqual(await client.listAlbumImages('album-id'), [{ id: 'album-image' }]);
  assert.equal(requests[0].url, 'http://immich.test/api/search/metadata');
  assert.deepEqual(requests[0].body.albumIds, ['album-id']);
  assert.equal(requests[0].body.type, 'IMAGE');
});

test('listAlbumImages requires an album id', async () => {
  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    fetchImpl: async () => Response.json({}),
  });

  await assert.rejects(() => client.listAlbumImages(null), /IMMICH_ALBUM_ID/);
});

test('downloadAsset returns a node readable stream', async () => {
  const fetchImpl = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('raw-bytes'));
        controller.close();
      },
    }),
    {
      headers: {
        'content-length': '9',
      },
    },
  );
  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    fetchImpl,
  });

  const chunks = [];
  const download = await client.downloadAsset('asset-id');
  for await (const chunk of download.stream) {
    chunks.push(chunk);
  }

  assert.equal(download.totalBytes, 9);
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'raw-bytes');
});

test('client errors include Immich API status for retry decisions', async () => {
  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    fetchImpl: async () => new Response('try later', {
      status: 503,
      statusText: 'Service Unavailable',
    }),
  });

  await assert.rejects(
    () => client.listAlbums(),
    (error) => {
      assert.equal(error instanceof ImmichApiError, true);
      assert.equal(error.status, 503);
      assert.match(error.message, /try later/);
      return true;
    },
  );
});

test('client aborts requests that do not receive a response in time', async () => {
  const client = new ImmichClient({
    baseUrl: 'http://immich.test',
    apiKey: 'key',
    requestTimeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }),
  });

  await assert.rejects(
    () => client.listAlbums(),
    (error) => {
      assert.equal(error instanceof ImmichRequestTimeoutError, true);
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});
