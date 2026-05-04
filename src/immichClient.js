import { Readable } from 'node:stream';
import * as log from './logger.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 120_000;

export class ImmichApiError extends Error {
  constructor(message, { status = null, statusText = '', body = '' } = {}) {
    super(message);
    this.name = 'ImmichApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export class ImmichRequestTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImmichRequestTimeoutError';
  }
}

export class ImmichClient {
  constructor({
    baseUrl,
    apiKey,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    downloadIdleTimeoutMs = DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  }) {
    if (!fetchImpl) {
      throw new Error('This program requires Node.js 18 or newer with built-in fetch.');
    }

    this.baseUrl = normalizeImmichBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.requestTimeoutMs = normalizeTimeoutMs(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.downloadIdleTimeoutMs = normalizeTimeoutMs(
      downloadIdleTimeoutMs,
      DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
    );
  }

  async searchMetadata(body) {
    log.debug('api', 'searchMetadata', { page: body.page, size: body.size });
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
    log.info('api', 'Listing favorite images');
    const favorites = [];
    for await (const asset of this.iterateSearch({
      isFavorite: true,
      type: 'IMAGE',
    })) {
      favorites.push(asset);
    }

    log.info('api', 'Favorite images loaded', { count: favorites.length });
    return favorites;
  }

  async listAlbums() {
    log.info('api', 'Listing albums');
    const albums = await this.#requestJson('/albums', { method: 'GET' });
    const result = Array.isArray(albums) ? albums : [];
    log.info('api', 'Albums loaded', { count: result.length });
    return result;
  }

  async listAlbumImages(albumId) {
    if (!albumId) {
      throw new Error('Album download source requires IMMICH_ALBUM_ID.');
    }

    log.info('api', 'Listing album images', { albumId });
    const images = [];
    for await (const asset of this.iterateSearch({
      albumIds: [albumId],
      type: 'IMAGE',
    })) {
      images.push(asset);
    }

    log.info('api', 'Album images loaded', { albumId, count: images.length });
    return images;
  }

  async searchRawCandidates({ takenAfter, takenBefore }) {
    log.debug('api', 'Searching RAW candidates', { takenAfter, takenBefore });
    const body = {
      type: 'IMAGE',
      takenAfter,
      takenBefore,
    };

    const candidates = [];
    for await (const asset of this.iterateSearch(body, { pageSize: 100 })) {
      candidates.push(asset);
    }

    log.debug('api', 'RAW candidates found', { count: candidates.length });
    return candidates;
  }

  async downloadAsset(assetId) {
    log.info('api', 'Downloading asset', { assetId });
    const response = await this.#request(`/assets/${encodeURIComponent(assetId)}/original`, {
      method: 'GET',
    });

    if (!response.body) {
      throw new Error(`Immich returned an empty download body for asset ${assetId}`);
    }

    const totalBytes = parseContentLength(response.headers.get('content-length'));
    log.debug('api', 'Download stream started', { assetId, totalBytes });

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
    const url = new URL(relativePath, this.baseUrl);
    const { signal, clear } = createTimeoutSignal(
      this.requestTimeoutMs,
      `Immich request timed out after ${formatSeconds(this.requestTimeoutMs)} seconds: ${url.pathname}`,
    );
    let response;
    try {
      response = await this.fetch(url, {
        ...init,
        signal,
        headers: {
          'x-api-key': this.apiKey,
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      if (signal.aborted) {
        log.warn('api', 'Request timed out', { url: url.pathname, timeoutMs: this.requestTimeoutMs });
        throw signal.reason;
      }
      log.error('api', 'Request failed', { url: url.pathname, error: error.message });
      throw error;
    } finally {
      clear();
    }

    if (!response.ok) {
      const message = await readErrorResponse(response);
      log.error('api', 'API error response', { status: response.status, statusText: response.statusText, url: url.pathname });
      throw new ImmichApiError(
        `Immich API ${response.status} ${response.statusText}: ${message}`,
        {
          status: response.status,
          statusText: response.statusText,
          body: message,
        },
      );
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

function createTimeoutSignal(timeoutMs, message) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new ImmichRequestTimeoutError(message));
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function normalizeTimeoutMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatSeconds(timeoutMs) {
  return Math.round(timeoutMs / 1000);
}
