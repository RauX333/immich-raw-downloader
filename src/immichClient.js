import { Readable } from 'node:stream';

export class ImmichClient {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
    if (!fetchImpl) {
      throw new Error('This program requires Node.js 18 or newer with built-in fetch.');
    }

    this.baseUrl = normalizeImmichBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async searchMetadata(body) {
    return this.#requestJson('/search/metadata', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async *iterateSearch(body, { pageSize = 250 } = {}) {
    let page = 1;

    while (true) {
      const response = await this.searchMetadata({
        ...body,
        page,
        size: pageSize,
        withExif: true,
      });

      const pageData = normalizeSearchResponse(response);
      for (const asset of pageData.items) {
        yield asset;
      }

      if (!pageData.hasNextPage) {
        break;
      }
      page = pageData.nextPage || page + 1;
    }
  }

  async listFavoriteImages() {
    const favorites = [];
    for await (const asset of this.iterateSearch({
      isFavorite: true,
      type: 'IMAGE',
    })) {
      favorites.push(asset);
    }

    return favorites;
  }

  async listAlbums() {
    const albums = await this.#requestJson('/albums', { method: 'GET' });
    return Array.isArray(albums) ? albums : [];
  }

  async listAlbumImages(albumId) {
    if (!albumId) {
      throw new Error('Album download source requires IMMICH_ALBUM_ID.');
    }

    const images = [];
    for await (const asset of this.iterateSearch({
      albumIds: [albumId],
      type: 'IMAGE',
    })) {
      images.push(asset);
    }

    return images;
  }

  async searchRawCandidates({ takenAfter, takenBefore }) {
    const body = {
      type: 'IMAGE',
      takenAfter,
      takenBefore,
    };

    const candidates = [];
    for await (const asset of this.iterateSearch(body, { pageSize: 100 })) {
      candidates.push(asset);
    }

    return candidates;
  }

  async downloadAsset(assetId) {
    const response = await this.#request(`/assets/${encodeURIComponent(assetId)}/original`, {
      method: 'GET',
    });

    if (!response.body) {
      throw new Error(`Immich returned an empty download body for asset ${assetId}`);
    }

    const totalBytes = parseContentLength(response.headers.get('content-length'));

    return {
      stream: Readable.fromWeb(response.body),
      totalBytes,
    };
  }

  async #requestJson(pathname, init = {}) {
    const response = await this.#request(pathname, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });

    return response.json();
  }

  async #request(pathname, init = {}) {
    const relativePath = pathname.replace(/^\/+/, '');
    const response = await this.fetch(new URL(relativePath, this.baseUrl), {
      ...init,
      headers: {
        'x-api-key': this.apiKey,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const message = await readErrorResponse(response);
      throw new Error(`Immich API ${response.status} ${response.statusText}: ${message}`);
    }

    return response;
  }
}

export function normalizeImmichBaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = '';
  url.search = '';

  const pathname = url.pathname.replace(/\/+$/g, '');
  url.pathname = pathname.endsWith('/api') ? `${pathname}/` : `${pathname}/api/`;

  return url;
}

export function normalizeSearchResponse(response) {
  const assets = response.assets || response;
  const items = assets.items || [];
  const nextPage = assets.nextPage;

  return {
    items,
    nextPage,
    hasNextPage: nextPage !== undefined && nextPage !== null,
  };
}

async function readErrorResponse(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500) || 'empty response';
  } catch {
    return 'unable to read response body';
  }
}

function parseContentLength(value) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
