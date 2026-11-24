// Reads backend settings from environment variables.
// Secrets (API keys, client token) only ever come from the environment.

const DEFAULT_MODELS = {
  anthropic: { planner: 'claude-sonnet-5-5', simplify: 'claude-haiku-5-5' },
  openai: { planner: 'gpt-4.1', simplify: 'gpt-4.1-mini' },
  mock: { planner: 'mock', simplify: 'mock' },
};

function pickProvider(env) {
  const explicit = (env.HOPE_LLM_PROVIDER || '').trim().toLowerCase();
  if (explicit) {
    if (!DEFAULT_MODELS[explicit]) {
      throw new Error(`HOPE_LLM_PROVIDER must be one of: ${Object.keys(DEFAULT_MODELS).join(', ')}`);
    }
    return explicit;
  }
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'mock';
}

function parseList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const provider = pickProvider(env);
  const port = Number.parseInt(env.HOPE_PORT || '8787', 10);
  const host = env.HOPE_HOST || '127.0.0.1';

  if (provider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('HOPE_LLM_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set');
  }
  if (provider === 'openai' && !env.OPENAI_API_KEY) {
    throw new Error('HOPE_LLM_PROVIDER is openai but OPENAI_API_KEY is not set');
  }

  return {
    port,
    host,
    publicUrl: (env.HOPE_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    plannerModel: env.HOPE_PLANNER_MODEL || DEFAULT_MODELS[provider].planner,
    simplifyModel: env.HOPE_SIMPLIFY_MODEL || DEFAULT_MODELS[provider].simplify,
    clientToken: env.HOPE_CLIENT_TOKEN || '',
    allowedOrigins: parseList(env.HOPE_ALLOWED_ORIGINS),
    rateLimitPerMinute: Number.parseInt(env.HOPE_RATE_LIMIT_PER_MINUTE || '120', 10),
    serveDemo: env.HOPE_SERVE_DEMO !== 'false',
  };
}
