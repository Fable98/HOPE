// Client for the Hope backend. The AI API key lives on the server, never here.

const TIMEOUT_MS = 60_000;

export function messageForStatus(status) {
  if (status === 401) return 'The access code in Settings is not right.';
  if (status === 429) return 'Too many requests. Please wait a minute and try again.';
  if (status === 502) return 'The AI service did not answer. Please try again.';
  if (status === 400 || status === 413) return 'This page is too unusual for me to read.';
  return 'Something went wrong with the Hope helper service. Please try again.';
}

export function createApiClient(getSettings, fetchImpl = (...args) => fetch(...args)) {
  async function post(path, body) {
    const { serverUrl, accessCode } = await getSettings();
    let res;
    try {
      res = await fetchImpl(`${serverUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessCode ? { 'x-hope-token': accessCode } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      const err = new Error(`request to ${path} failed`, { cause });
      err.userMessage = 'I could not reach the Hope helper service. Check your internet, or the server address in Settings.';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`request to ${path} returned ${res.status}`);
      err.status = res.status;
      err.userMessage = messageForStatus(res.status);
      throw err;
    }
    return res.json();
  }

  return {
    plan: async (body) => (await post('/api/plan', body)).decision,
    simplify: async (texts) => (await post('/api/simplify', { texts })).texts,
  };
}
