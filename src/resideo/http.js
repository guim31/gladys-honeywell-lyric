// -----------------------------------------------------------------------------
// The one function that talks to the network, on the fetch of Node 22+. The
// client takes it as a parameter: the tests replace it with an in-memory
// Resideo API (test/helpers/fakeResideo.js).
// -----------------------------------------------------------------------------

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 20_000 } = {},
) {
  const response = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...headers },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return { status: response.status, body: text };
}
