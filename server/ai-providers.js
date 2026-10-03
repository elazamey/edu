import { PRICING_TIERS, evaluateVerificationGates } from './ai-policy.js';

const REQUEST_TIMEOUT_MS = 15000;

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = body?.error?.message || body?.error || `Upstream HTTP ${response.status}`;
      throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function parseGatesFromEnv(prefix, env = process.env) {
  const allFlag = String(env[`${prefix}_GATES_VERIFIED`] || '').toLowerCase() === 'true';
  return {
    card: allFlag || String(env[`${prefix}_GATE_CARD`] || '').toLowerCase() === 'true',
    region: allFlag || String(env[`${prefix}_GATE_REGION`] || '').toLowerCase() === 'true',
    limits: allFlag || String(env[`${prefix}_GATE_LIMITS`] || '').toLowerCase() === 'true',
    storage: allFlag || String(env[`${prefix}_GATE_STORAGE`] || '').toLowerCase() === 'true',
    quota: allFlag || String(env[`${prefix}_GATE_QUOTA`] || '').toLowerCase() === 'true',
  };
}

export function createProviderRegistry(env = process.env, initialGateOverrides = {}) {
  const gateOverrides = new Map(Object.entries(initialGateOverrides || {}));

  const definitions = [
    {
      id: 'openrouter',
      name: 'OpenRouter (Free Models Only)',
      envPrefix: 'OPENROUTER',
      pricingTier: PRICING_TIERS.FREE_QUOTA,
      costUsd: 0,
      requiresFreeModelSuffix: true,
      defaultModel: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      endpoint: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions',
      configured: Boolean(env.OPENROUTER_API_KEY),
      async invoke({ model, systemPrompt, userPrompt }) {
        const data = await fetchJsonWithTimeout(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from OpenRouter endpoint');
        return String(text).trim();
      },
    },
    {
      id: 'huggingface',
      name: 'Hugging Face Serverless Inference',
      envPrefix: 'HF',
      pricingTier: PRICING_TIERS.FREE_QUOTA,
      costUsd: 0,
      requiresFreeModelSuffix: false,
      defaultModel: env.HF_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
      endpoint: env.HF_BASE_URL || 'https://router.huggingface.co/hf-inference/v1/chat/completions',
      configured: Boolean(env.HF_API_KEY || env.HUGGINGFACE_API_KEY),
      async invoke({ model, systemPrompt, userPrompt }) {
        const apiKey = env.HF_API_KEY || env.HUGGINGFACE_API_KEY;
        const data = await fetchJsonWithTimeout(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Hugging Face endpoint');
        return String(text).trim();
      },
    },
    {
      id: 'gemini',
      name: 'Google Gemini Free Tier',
      envPrefix: 'GEMINI',
      pricingTier: PRICING_TIERS.FREE_QUOTA,
      costUsd: 0,
      requiresFreeModelSuffix: false,
      defaultModel: env.GEMINI_MODEL || 'gemini-2.0-flash',
      endpoint: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
      configured: Boolean(env.GEMINI_API_KEY),
      async invoke({ model, systemPrompt, userPrompt }) {
        const targetModel = model || this.defaultModel;
        const url = `${this.endpoint.replace(/\/$/, '')}/${encodeURIComponent(targetModel)}:generateContent`;
        const data = await fetchJsonWithTimeout(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          }),
        });
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response from Gemini endpoint');
        return String(text).trim();
      },
    },
    {
      id: 'nvidia',
      name: 'NVIDIA NIM Endpoint',
      envPrefix: 'NVIDIA',
      // NVIDIA NIM uses trial credits by default unless explicitly verified as FREE_QUOTA
      pricingTier: String(env.NVIDIA_PRICING_TIER || PRICING_TIERS.TRIAL).toUpperCase(),
      costUsd: 0,
      requiresFreeModelSuffix: false,
      defaultModel: env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
      endpoint: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
      configured: Boolean(env.NVIDIA_API_KEY),
      async invoke({ model, systemPrompt, userPrompt }) {
        const data = await fetchJsonWithTimeout(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from NVIDIA endpoint');
        return String(text).trim();
      },
    },
    {
      id: 'ollama',
      name: 'Ollama / Local Runtime',
      envPrefix: 'OLLAMA',
      pricingTier: PRICING_TIERS.LOCAL,
      costUsd: 0,
      requiresFreeModelSuffix: false,
      defaultModel: env.OLLAMA_MODEL || 'llama3.2',
      endpoint: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/api/chat',
      configured: Boolean(env.OLLAMA_ENABLED === 'true' || env.OLLAMA_BASE_URL),
      async invoke({ model, systemPrompt, userPrompt }) {
        const data = await fetchJsonWithTimeout(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model || this.defaultModel,
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        const text = data?.message?.content || data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Ollama local endpoint');
        return String(text).trim();
      },
    },
  ];

  function resolveProvider(def) {
    const baseGates = parseGatesFromEnv(def.envPrefix, env);
    const customGates = gateOverrides.get(def.id) || {};
    const mergedGates = { ...baseGates, ...customGates };
    const gateEval = evaluateVerificationGates(mergedGates);
    return {
      ...def,
      verificationGates: gateEval.gates,
      allGatesVerified: gateEval.allVerified,
      missingGates: gateEval.missingGates,
      // Provider remains disabled until configured AND all 5 verification gates pass
      enabled: Boolean(def.configured && gateEval.allVerified),
    };
  }

  return {
    list() {
      return definitions.map(resolveProvider);
    },
    get(id) {
      const cleanId = String(id || '').toLowerCase();
      const def = definitions.find(d => d.id === cleanId);
      return def ? resolveProvider(def) : null;
    },
    setGates(id, gatesPatch = {}) {
      const cleanId = String(id || '').toLowerCase();
      const def = definitions.find(d => d.id === cleanId);
      if (!def) return null;
      const current = gateOverrides.get(cleanId) || parseGatesFromEnv(def.envPrefix, env);
      const updated = {
        card: gatesPatch.card !== undefined ? Boolean(gatesPatch.card) : Boolean(current.card),
        region: gatesPatch.region !== undefined ? Boolean(gatesPatch.region) : Boolean(current.region),
        limits: gatesPatch.limits !== undefined ? Boolean(gatesPatch.limits) : Boolean(current.limits),
        storage: gatesPatch.storage !== undefined ? Boolean(gatesPatch.storage) : Boolean(current.storage),
        quota: gatesPatch.quota !== undefined ? Boolean(gatesPatch.quota) : Boolean(current.quota),
      };
      gateOverrides.set(cleanId, updated);
      return resolveProvider(def);
    },
  };
}
