// Thin clients for the model providers. Each returns the model's text reply.
// `complete({ model, system, prompt, maxTokens })` -> Promise<string>

const TIMEOUT_MS = 45_000;

export class LlmError extends Error {}

async function postJson(url, headers, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new LlmError(`model request failed: ${err.name}`);
  }
  if (!res.ok) {
    // Do not include the response body: it can echo parts of the prompt.
    throw new LlmError(`model request failed with status ${res.status}`);
  }
  return res.json();
}

export function createAnthropicClient({ apiKey, fetchImpl = fetch }) {
  return {
    async complete({ model, system, prompt, maxTokens = 4000 }) {
      const data = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        },
        fetchImpl,
      );
      const text = (data.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (!text) throw new LlmError('model returned no text');
      return text;
    },
  };
}

// Works with OpenAI and other services that copy its chat completions API.
export function createOpenAiClient({ apiKey, baseUrl, fetchImpl = fetch }) {
  return {
    async complete({ model, system, prompt }) {
      const data = await postJson(
        `${baseUrl}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        },
        fetchImpl,
      );
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new LlmError('model returned no text');
      return text;
    },
  };
}

export function createLlm(config, fetchImpl = fetch) {
  if (config.provider === 'anthropic') {
    return createAnthropicClient({ apiKey: config.anthropicApiKey, fetchImpl });
  }
  if (config.provider === 'openai') {
    return createOpenAiClient({ apiKey: config.openaiApiKey, baseUrl: config.openaiBaseUrl, fetchImpl });
  }
  return null; // mock provider: the planner and simplifier use local rules instead
}

// Models sometimes wrap JSON in prose or code fences. Take the outermost object.
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new LlmError('model reply had no JSON object');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new LlmError('model reply was not valid JSON');
  }
}
