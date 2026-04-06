/* ═══════════════════════════════════════
   ChainRun API Service & Chain Executor
   ═══════════════════════════════════════ */

const PROXY_URL = 'https://chainrun-proxy.markusraeder.workers.dev';

// ────────────────────────────────────
// API Keys — persisted in localStorage (encrypted-at-rest via browser)
// ────────────────────────────────────
const ApiKeys = {
  openai: '',
  anthropic: '',
  perplexity: '',
  gemini: '',
  xai: '',
  mistral: '',
  openrouter: ''  // Single key for: NVIDIA, Xiaomi, MiniMax, Qwen (via OpenRouter)
};

// Providers that route through OpenRouter
const OPENROUTER_PROVIDERS = ['nvidia', 'xiaomi', 'minimax', 'qwen'];

// Load saved keys on startup
(function loadSavedKeys() {
  try {
    const saved = window._store.get('chainrun_api_keys');
    if (saved) {
      const parsed = JSON.parse(saved);
      for (const [k, v] of Object.entries(parsed)) {
        if (ApiKeys.hasOwnProperty(k) && typeof v === 'string') {
          ApiKeys[k] = v;
        }
      }
    }
  } catch (e) { /* ignore corrupted data */ }
})();

function _persistKeys() {
  try {
    window._store.set('chainrun_api_keys', JSON.stringify(ApiKeys));
  } catch (e) { /* storage full or unavailable */ }
}

function setApiKey(provider, key) {
  ApiKeys[provider] = key.trim();
  _persistKeys();
}

function getApiKey(provider) {
  return ApiKeys[provider] || '';
}

function hasApiKey(provider) {
  return !!ApiKeys[provider];
}

// ────────────────────────────────────
// Model auto-detection per provider
// ────────────────────────────────────
const DetectedModels = {}; // { provider: { models: [...], ts: Date.now() } }

// Models we care about per provider (display name → model ID for chain use)
const MODEL_CATALOG = {
  openai: [
    { id: 'gpt-5.4', name: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
    { id: 'gpt-5.3', name: 'GPT-5.3' },
    { id: 'gpt-5.2', name: 'GPT-5.2' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'o3', name: 'o3' },
    { id: 'o3-mini', name: 'o3-mini' },
    { id: 'o1', name: 'o1' },
    { id: 'dall-e-3', name: 'DALL·E 3', type: 'image' },
    { id: 'tts-1', name: 'TTS-1', type: 'audio' },
    { id: 'whisper-1', name: 'Whisper', type: 'audio' },
  ],
  gemini: [
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemma-3', name: 'Gemma 3' },
  ],
  xai: [
    { id: 'grok-4', name: 'Grok 4' },
    { id: 'grok-3', name: 'Grok 3' },
    { id: 'grok-3-mini', name: 'Grok 3 Mini' },
    { id: 'grok-2', name: 'Grok 2' },
  ],
  anthropic: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
  ],
  perplexity: [
    { id: 'sonar-deep-research', name: 'Sonar Deep Research' },
    { id: 'sonar-pro', name: 'Sonar Pro' },
    { id: 'sonar', name: 'Sonar' },
    { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
    { id: 'sonar-reasoning', name: 'Sonar Reasoning' },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Mistral Large' },
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'codestral-latest', name: 'Codestral' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium' },
  ],
  openrouter: [] // OpenRouter returns its own catalog
};

// Probe endpoints per provider
const PROBE_ENDPOINTS = {
  openai:     { url: 'https://api.openai.com/v1/models', auth: 'Bearer' },
  gemini:     { url: 'https://generativelanguage.googleapis.com/v1beta/models', auth: 'query' },
  xai:        { url: 'https://api.x.ai/v1/models', auth: 'Bearer' },
  anthropic:  { url: 'https://api.anthropic.com/v1/models', auth: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01' } },
  perplexity: { url: 'https://api.perplexity.ai/models', auth: 'Bearer' },
  mistral:    { url: 'https://api.mistral.ai/v1/models', auth: 'Bearer' },
  openrouter: { url: 'https://openrouter.ai/api/v1/models', auth: 'Bearer' },
};

async function probeModels(provider) {
  var key = getApiKey(provider);
  if (!key) return null;

  var endpoint = PROBE_ENDPOINTS[provider];
  if (!endpoint) return null;

  try {
    var rawModels = [];
    var proxyWorked = false;

    // Primary: use worker proxy (avoids CORS issues on mobile)
    try {
      var proxyRes = await fetch(PROXY_URL + '/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider, apiKey: key }),
        signal: AbortSignal.timeout(12000)
      });
      var proxyData = await proxyRes.json();
      if (proxyData.error) {
        return { error: proxyData.error, status: proxyData.status };
      }
      if (proxyData.ok) {
        rawModels = proxyData.rawModels || [];
        proxyWorked = true;
        // Perplexity: no /models endpoint, but key was validated
        if (proxyData.valid && provider === 'perplexity') {
          var pResult = { ok: true, models: MODEL_CATALOG.perplexity || [], extra: [], total: (MODEL_CATALOG.perplexity || []).length, ts: Date.now() };
          DetectedModels[provider] = pResult;
          _persistDetectedModels();
          return pResult;
        }
      }
    } catch (proxyErr) {
      // Proxy failed, try direct
    }

    // Fallback: direct call (may fail on mobile due to CORS)
    if (!proxyWorked) {
      var headers = {};
      var url = endpoint.url;

      if (endpoint.auth === 'Bearer') {
        headers['Authorization'] = 'Bearer ' + key;
      } else if (endpoint.auth === 'x-api-key') {
        headers['x-api-key'] = key;
      } else if (endpoint.auth === 'query') {
        url += '?key=' + encodeURIComponent(key);
      }
      if (endpoint.extraHeaders) {
        Object.assign(headers, endpoint.extraHeaders);
      }

      var res = await fetch(url, {
        headers: headers,
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { error: res.status === 401 || res.status === 403 ? 'invalid_key' : 'api_error', status: res.status };
      }

      var data = await res.json();

      if (provider === 'gemini') {
        rawModels = (data.models || []).map(function(m) {
          return m.name ? m.name.replace('models/', '') : '';
        }).filter(Boolean);
      } else if (provider === 'anthropic') {
        rawModels = (data.data || []).map(function(m) { return m.id || ''; }).filter(Boolean);
      } else {
        rawModels = (data.data || []).map(function(m) { return m.id || ''; }).filter(Boolean);
      }
    }

    // Match against our catalog
    var catalog = MODEL_CATALOG[provider] || [];
    var matched = [];
    var extra = [];

    if (catalog.length > 0) {
      catalog.forEach(function(entry) {
        var found = rawModels.some(function(raw) {
          return raw === entry.id || raw.indexOf(entry.id) === 0;
        });
        if (found) matched.push(entry);
      });
    } else {
      rawModels.slice(0, 200).forEach(function(id) {
        extra.push({ id: id, name: id.split('/').pop() });
      });
    }

    var result = {
      ok: true,
      models: matched,
      extra: extra,
      total: rawModels.length,
      ts: Date.now()
    };

    DetectedModels[provider] = result;
    _persistDetectedModels();
    return result;
  } catch (e) {
    return { error: 'network', message: e.message };
  }
}

function _persistDetectedModels() {
  try {
    window._store.set('chainrun_detected_models', JSON.stringify(DetectedModels));
  } catch (e) {}
}

function _loadDetectedModels() {
  try {
    var raw = window._store.get('chainrun_detected_models');
    if (raw) {
      var parsed = JSON.parse(raw);
      for (var k in parsed) {
        if (parsed.hasOwnProperty(k)) DetectedModels[k] = parsed[k];
      }
    }
  } catch (e) {}
}
_loadDetectedModels();

// ────────────────────────────────────
// Provider Capabilities Map
// Each provider lists what it can do beyond basic chat
// ────────────────────────────────────
const PROVIDER_CAPABILITIES = {
  openai: {
    vision: true,
    webSearch: true,          // web_search tool
    codeInterpreter: false,   // requires Assistants API (not chat completions)
    structuredOutput: true,   // response_format: json_schema
    reasoning: true,          // reasoning_effort: none|low|medium|high|xhigh
    maxContext: '1M tokens'
  },
  anthropic: {
    vision: true,
    webSearch: true,          // web_search tool via server_tool
    codeExecution: false,     // requires beta header, not reliable from browser
    structuredOutput: false,  // no native JSON mode
    reasoning: false,
    maxContext: '200K tokens'
  },
  gemini: {
    vision: true,
    webSearch: true,          // Google Search grounding
    codeExecution: true,      // code_execution tool
    structuredOutput: true,   // response_mime_type: application/json
    reasoning: false,
    urlContext: true,          // URL context tool
    maxContext: '1M tokens'
  },
  xai: {
    vision: true,
    webSearch: true,           // live search
    codeExecution: false,
    structuredOutput: false,
    reasoning: false,
    maxContext: '256K tokens'
  },
  perplexity: {
    vision: false,
    webSearch: true,           // native — it's a search engine
    codeExecution: false,
    structuredOutput: true,    // response_format via beta
    reasoning: true,           // sonar-reasoning / sonar-reasoning-pro models
    searchContextSize: true,   // low/medium/high
    maxContext: '128K tokens'
  },
  mistral: {
    vision: true,
    webSearch: false,
    codeExecution: false,
    structuredOutput: true,
    reasoning: true,           // reasoning parameter
    maxContext: '256K tokens'
  },
  nvidia: {
    vision: false,
    webSearch: false,
    codeExecution: false,
    structuredOutput: false,
    reasoning: false,
    maxContext: '262K tokens (1M native)'
  },
  xiaomi: {
    vision: false,
    webSearch: false,
    codeExecution: false,
    structuredOutput: false,
    reasoning: false,
    maxContext: '1M tokens'
  },
  minimax: {
    vision: false,
    webSearch: false,
    codeExecution: false,
    structuredOutput: true,
    reasoning: true,
    maxContext: '204.8K tokens'
  },
  qwen: {
    vision: true,
    webSearch: false,
    codeExecution: false,
    structuredOutput: true,
    reasoning: true,
    maxContext: '262K tokens'
  }
};

// ────────────────────────────────────
// API Service — 5 LLM providers with full capabilities
// ────────────────────────────────────
const APIService = {
  timeout: 90000, // 90s max per step

  // caps: { webSearch, reasoning, codeExecution, structuredOutput, searchContextSize }
  // mode: 'fast' | 'quality'
  // attachment: { type: 'image', base64, mimeType } | null
  async call(llm, prompt, mode, attachment, caps) {
    const provider = LLM_KEY_MAP[llm];
    const key = getApiKey(provider);
    if (!key) {
      throw new Error(`No API key configured for ${LLM_NAMES[llm]}. Add it in Settings.`);
    }

    const m = mode || 'quality';
    const modelInfo = getModelInfo(provider, m);
    const file = attachment || null;
    const activeCaps = caps || {};

    switch (provider) {
      case 'openai': return this.callOpenAI(key, prompt, modelInfo, file, activeCaps);
      case 'anthropic': return this.callAnthropic(key, prompt, modelInfo, file, activeCaps);
      case 'perplexity': return this.callPerplexity(key, prompt, modelInfo, file, activeCaps);
      case 'gemini': return this.callGemini(key, prompt, modelInfo, file, activeCaps);
      case 'xai': return this.callXAI(key, prompt, modelInfo, file, activeCaps);
      case 'mistral': return this.callMistral(key, prompt, modelInfo, file, activeCaps);
      case 'nvidia':
      case 'xiaomi':
      case 'minimax':
      case 'qwen': {
        const orKey = getApiKey('openrouter');
        if (!orKey) throw new Error(`No OpenRouter API key. Add it in Settings to use ${LLM_NAMES[llm]}.`);
        return this.callOpenRouter(orKey, prompt, modelInfo, file, activeCaps);
      }
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  },

  // Get which model was actually used (for display)
  getModelUsed(llm, mode) {
    const provider = LLM_KEY_MAP[llm];
    const info = getModelInfo(provider, mode || 'quality');
    return info ? info.name : LLM_NAMES[llm];
  },

  // ── OpenAI ──
  // Supports: vision, web_search tool, reasoning_effort, structured output
  async callOpenAI(key, prompt, modelInfo, file, caps) {
    // Build content: text-only or vision (image_url)
    let content;
    if (file && file.type === 'image' && modelInfo.vision) {
      content = [
        { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}`, detail: 'auto' } },
        { type: 'text', text: prompt }
      ];
    } else {
      content = prompt;
    }

    const body = {
      model: modelInfo.id,
      messages: [{ role: 'user', content }],
    };

    // GPT-5.4 family uses max_completion_tokens
    if (modelInfo.maxTokenParam === 'max_completion_tokens') {
      body.max_completion_tokens = 4096;
      // Reasoning models: temperature must be 1 or omitted
      if (caps.reasoning) {
        body.reasoning = { effort: caps.reasoningLevel || 'high' };
        // Don't set temperature for reasoning mode
      } else {
        body.temperature = 0.4;
      }
    } else {
      body.max_tokens = 4096;
      body.temperature = 0.4;
    }

    // Web search tool (only when NOT in reasoning mode — they can conflict)
    if (caps.webSearch && !caps.reasoning) {
      body.tools = body.tools || [];
      body.tools.push({ type: 'web_search_preview' });
    }

    // Structured output (JSON mode)
    if (caps.structuredOutput && !caps.reasoning) {
      body.response_format = { type: 'json_object' };
    }

    // Stream to prevent timeout on deep-reasoning models
    body.stream = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `OpenAI HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
    }
    return fullText;
  },

  // ── Anthropic ──
  // Supports: vision, web_search tool (server tool)
  async callAnthropic(key, prompt, modelInfo, file, caps) {
    // Build content: text-only or vision (image in content blocks)
    let content;
    if (file && file.type === 'image' && modelInfo.vision) {
      content = [
        { type: 'image', source: { type: 'base64', media_type: file.mimeType, data: file.base64 } },
        { type: 'text', text: prompt }
      ];
    } else {
      content = prompt;
    }

    const body = {
      model: modelInfo.id,
      max_tokens: 4096,
      messages: [{ role: 'user', content }]
    };

    // Web search tool (Anthropic server-side tool)
    if (caps.webSearch) {
      body.tools = body.tools || [];
      body.tools.push({
        type: 'server_tool',
        name: 'web_search',
        max_uses: 3
      });
    }

    const res = await this._fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Anthropic API error');
    // Extract text from content blocks (may include tool results)
    if (Array.isArray(data.content)) {
      const textBlocks = data.content.filter(b => b.type === 'text');
      return textBlocks.map(b => b.text).join('\n\n') || data.content[0]?.text || '';
    }
    return data.content[0].text;
  },

  // ── Perplexity ──
  // Supports: native web search (always on), search_context_size, reasoning models
  async callPerplexity(key, prompt, modelInfo, file, caps) {
    // Perplexity: text only, no vision support
    if (file) {
      prompt = prompt + '\n\n[Note: A file was attached but Perplexity does not support file input. Processing text only.]';
    }

    const body = {
      model: modelInfo.id,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 4096
    };

    // Search context size (controls how much web context to pull)
    if (caps.searchContextSize) {
      body.search_context_size = caps.searchContextSize; // 'low' | 'medium' | 'high'
    }

    // If reasoning is requested and we're in quality mode, use reasoning model
    if (caps.reasoning && modelInfo.reasoning) {
      body.model = modelInfo.reasoning; // switch to sonar-reasoning or sonar-reasoning-pro
    }

    const res = await this._fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error?.message || 'Perplexity API error');
    return data.choices[0].message.content;
  },

  // ── Gemini ──
  // Supports: vision, Google Search grounding, code execution, structured output, URL context
  async callGemini(key, prompt, modelInfo, file, caps) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelInfo.id}:generateContent?key=${key}`;

    // Build parts: text + optional inline_data for images
    const parts = [{ text: prompt }];
    if (file && file.type === 'image' && modelInfo.vision) {
      parts.unshift({ inline_data: { mime_type: file.mimeType, data: file.base64 } });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096
      }
    };

    // Tools array for Gemini capabilities
    const tools = [];

    // Google Search grounding
    if (caps.webSearch) {
      tools.push({ google_search: {} });
    }

    // Code execution
    if (caps.codeExecution) {
      tools.push({ code_execution: {} });
    }

    if (tools.length > 0) {
      body.tools = tools;
    }

    // Structured output (JSON mode)
    if (caps.structuredOutput) {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const res = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Gemini API error');

    // Extract text from all parts (may include code execution results)
    const candidate = data.candidates[0];
    if (candidate.content && candidate.content.parts) {
      const textParts = candidate.content.parts
        .filter(p => p.text)
        .map(p => p.text);
      // Also include executable code results
      const execResults = candidate.content.parts
        .filter(p => p.executableCode || p.codeExecutionResult)
        .map(p => {
          if (p.executableCode) return `\`\`\`${p.executableCode.language || 'python'}\n${p.executableCode.code}\n\`\`\``;
          if (p.codeExecutionResult) return `Output:\n${p.codeExecutionResult.output}`;
          return '';
        });
      return [...textParts, ...execResults].join('\n\n') || '';
    }
    return candidate.content.parts[0].text;
  },

  // ── xAI / Grok ──
  // Supports: vision, live search
  async callXAI(key, prompt, modelInfo, file, caps) {
    let content;
    if (file && file.type === 'image' && modelInfo.vision) {
      content = [
        { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}` } },
        { type: 'text', text: prompt }
      ];
    } else {
      content = prompt;
    }

    const body = {
      model: modelInfo.id,
      messages: [{ role: 'user', content }],
      temperature: 0.4,
      max_tokens: 4096,
      stream: true // Stream to prevent timeout on deep-reasoning models
    };

    if (caps.webSearch) {
      body.search = { mode: 'auto' };
    }

    // Use raw fetch with streaming (bypasses _fetch timeout for long Grok 4 responses)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000); // 3 min for Grok 4
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `xAI HTTP ${res.status}`);
    }

    // Read SSE stream and collect full text
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
    }
    return fullText;
  },

  // ── Mistral ──
  // OpenAI-compatible: https://api.mistral.ai/v1/chat/completions
  async callMistral(key, prompt, modelInfo, file, caps) {
    let content;
    if (file && file.type === 'image' && modelInfo.vision) {
      content = [
        { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}` } },
        { type: 'text', text: prompt }
      ];
    } else {
      content = prompt;
    }

    const body = {
      model: modelInfo.id,
      messages: [{ role: 'user', content }],
      temperature: 0.4,
      max_tokens: 4096
    };

    const res = await this._fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error?.message || 'Mistral API error');
    return data.choices[0].message.content;
  },

  // ── OpenRouter (NVIDIA, Xiaomi, MiniMax, Qwen) ──
  // Single gateway: https://openrouter.ai/api/v1/chat/completions
  async callOpenRouter(key, prompt, modelInfo, file, caps) {
    let content;
    if (file && file.type === 'image' && modelInfo.vision) {
      content = [
        { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}` } },
        { type: 'text', text: prompt }
      ];
    } else {
      content = prompt;
    }

    const body = {
      model: modelInfo.id,
      messages: [{ role: 'user', content }],
      temperature: 0.4,
      max_tokens: 4096
    };

    const res = await this._fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://chainrun.tech',
        'X-Title': 'ChainRun'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error?.message || 'OpenRouter API error');
    return data.choices[0].message.content;
  },

  async _fetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    options.signal = controller.signal;

    try {
      const res = await fetch(url, options);
      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        throw new Error(`Rate limited. ${retryAfter ? `Retry after ${retryAfter}s.` : 'Please wait and try again.'}`);
      }
      if (res.status === 401) {
        throw new Error('Invalid API key. Check your key in Settings.');
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `HTTP ${res.status}: ${res.statusText}`);
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        throw new Error('Request timed out (120s). The response may be too large or the API is slow.');
      }
      throw e;
    }
  }
};

// ────────────────────────────────────
// Demo Chain — runs via proxy (no user keys needed)
// ────────────────────────────────────
const DEMO_PROXY_URL = 'https://chainrun-proxy.markusraeder.workers.dev';

const DemoChain = {
  available() {
    // Demo available if user hasn't run one yet (or has no keys)
    return !window._store.get('chainrun_demo_used');
  },

  async run(prompt, onStepUpdate) {
    const intent = IntentClassifier.classify(prompt);

    // Show the 4-step pipeline in UI
    const demoSteps = [
      { index: 0, llm: 'perplexity', llmName: 'Perplexity Sonar', role: 'Research', status: 'pending', output: '', duration: 0, error: null, capsUsed: ['web search'] },
      { index: 1, llm: 'gemini', llmName: 'Gemini Flash', role: 'Structure', status: 'pending', output: '', duration: 0, error: null, capsUsed: ['grounding'] },
      { index: 2, llm: 'grok', llmName: 'Grok 3 Fast', role: 'Analyze', status: 'pending', output: '', duration: 0, error: null, capsUsed: [] },
      { index: 3, llm: 'chatgpt', llmName: 'GPT-5.4 mini', role: 'Refine', status: 'pending', output: '', duration: 0, error: null, capsUsed: [] },
    ];

    if (onStepUpdate) onStepUpdate([...demoSteps], intent, null);

    // Mark all as running (proxy runs the full chain server-side)
    demoSteps[0].status = 'running';
    if (onStepUpdate) onStepUpdate([...demoSteps], intent, null);

    const totalStart = Date.now();

    try {
      const res = await fetch(DEMO_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.slice(0, 2000) }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Demo chain failed');
      }

      // Map proxy response to step updates
      for (let i = 0; i < data.chain.length && i < demoSteps.length; i++) {
        demoSteps[i].status = 'done';
        demoSteps[i].output = data.chain[i].output;
        demoSteps[i].duration = data.chain[i].ms;
        // Show next step as running
        if (i + 1 < demoSteps.length) demoSteps[i + 1].status = 'running';
        if (onStepUpdate) onStepUpdate([...demoSteps], intent, null);
      }

      const totalDuration = data.totalMs || (Date.now() - totalStart);
      const finalOutput = data.result;

      // Mark demo as used
      window._store.set('chainrun_demo_used', '1');

      if (onStepUpdate) onStepUpdate([...demoSteps], intent, { finalOutput, totalDuration });

      return { steps: demoSteps, intent, finalOutput, totalDuration };

    } catch (err) {
      demoSteps[0].status = 'failed';
      demoSteps[0].error = err.message;
      demoSteps.slice(1).forEach(s => s.status = 'skipped');
      if (onStepUpdate) onStepUpdate([...demoSteps], intent, null);
      throw err;
    }
  }
};

// ────────────────────────────────────
// Credit System (pay-per-prompt)
// ────────────────────────────────────
const CREDIT_PACKS = [
  { id: '5pack', credits: 5, price: '$5', priceNum: 5, label: '5 runs', url: 'https://buy.stripe.com/4gM14m2FI1L166QgH42oE04', per: '$1.00/run' },
  { id: '12pack', credits: 12, price: '$10', priceNum: 10, label: '12 runs', url: 'https://buy.stripe.com/14A3cu4NQ3T9an6duS2oE05', per: '$0.83/run', best: true },
];

function getCreditUID() {
  var uid = window._store.get('chainrun_credit_uid');
  if (!uid) {
    uid = 'cr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
    window._store.set('chainrun_credit_uid', uid);
  }
  return uid;
}

async function fetchCreditBalance() {
  var uid = getCreditUID();
  try {
    var res = await fetch(DEMO_PROXY_URL + '/credits/balance?uid=' + encodeURIComponent(uid));
    var data = await res.json();
    return data.balance || 0;
  } catch (e) {
    return parseInt(window._store.get('chainrun_credit_balance') || '0', 10);
  }
}

async function verifyCreditPurchase(nonce) {
  var uid = getCreditUID();
  try {
    var res = await fetch(DEMO_PROXY_URL + '/credits/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, nonce: nonce }),
    });
    var data = await res.json();
    if (data.ok) {
      window._store.set('chainrun_credit_balance', String(data.balance));
      return data;
    }
    return { error: data.error };
  } catch (e) {
    return { error: e.message };
  }
}

async function buyCredits(packId) {
  var uid = getCreditUID();
  try {
    // Step 1: Create purchase intent on server
    var res = await fetch(DEMO_PROXY_URL + '/credits/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, pack_id: packId }),
    });
    var data = await res.json();
    if (!data.ok) {
      if (typeof showToast === 'function') showToast(data.error || 'Purchase failed');
      return;
    }
    // Store nonce for verification on return
    window._store.set('chainrun_pending_nonce', data.nonce);
    // Step 2: Open Stripe payment link
    window.open(data.payment_url, '_blank');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Connection error');
  }
}

// ────────────────────────────────────
// Chain Executor — full capabilities pipeline
// ────────────────────────────────────
const ChainExecutor = {
  // mode: 'fast' | 'quality' | 'auto'
  // attachment: { type, base64, mimeType } | null
  async run(prompt, forceType, onStepUpdate, mode, attachment) {
    // 1. Smart Router (if mode is 'auto', uses Gemini Flash to decide)
    const userMode = mode || 'auto';
    const hasFile = !!attachment;
    const routerResult = await SmartRouter.analyze(prompt, hasFile, userMode);
    const effectiveMode = routerResult.mode;
    const intent = forceType === 'auto'
      ? routerResult.intent
      : (forceType || routerResult.intent);

    // Notify UI about router decision
    if (onStepUpdate) onStepUpdate([], intent, null, routerResult);

    // 2. Fix anti-patterns
    const { text: fixedPrompt } = AntiPatternFixer.fix(prompt);

    // 3. Apply active profile
    const activeProfile = ProfileManager.getActive();
    let finalPrompt = fixedPrompt;
    if (activeProfile.prefix) finalPrompt = activeProfile.prefix + '\n\n' + finalPrompt;
    if (activeProfile.suffix) finalPrompt = finalPrompt + '\n\n' + activeProfile.suffix;

    // 4. Build chain
    const chain = ChainPipeline.build(intent);

    // 5. Check required keys
    const requiredKeys = ChainPipeline.getRequiredKeys(intent);
    const missingKeys = requiredKeys.filter(k => !hasApiKey(k));
    if (missingKeys.length > 0) {
      const names = missingKeys.map(k => {
        const map = { openai: 'OpenAI', anthropic: 'Anthropic', perplexity: 'Perplexity', gemini: 'Gemini', xai: 'xAI/Grok', mistral: 'Mistral', openrouter: 'OpenRouter (NVIDIA/Xiaomi/MiniMax/Qwen)' };
        return map[k] || k;
      });
      throw new Error(`Missing API keys: ${names.join(', ')}. Configure them in Settings.`);
    }

    // 6. Initialize step states (with actual model names + capabilities)
    const steps = chain.map((step, i) => {
      const provider = LLM_KEY_MAP[step.llm];
      // All steps use the effective mode (quality or fast) — Grok 4 now streams so it won't timeout
      const stepMode = effectiveMode;
      const modelInfo = getModelInfo(provider, stepMode);
      // Decide capabilities for this step based on role + intent + router
      const stepCaps = CapabilityRouter.decide(provider, step.role, intent, effectiveMode, routerResult);
      return {
        index: i,
        llm: step.llm,
        llmName: modelInfo.name,
        modelCost: modelInfo.cost,
        role: step.role,
        status: 'pending',
        output: '',
        duration: 0,
        error: null,
        caps: stepCaps,
        capsUsed: CapabilityRouter.getLabels(stepCaps)
      };
    });

    // Notify UI of initial state
    if (onStepUpdate) onStepUpdate(steps, intent, null, routerResult);

    let previousOutput = '';
    const totalStart = Date.now();

    // 7. Execute steps sequentially
    for (let i = 0; i < steps.length; i++) {
      steps[i].status = 'running';
      if (onStepUpdate) onStepUpdate([...steps], intent, null, routerResult);

      const stepStart = Date.now();

      try {
        const stepPrompt = ChainPipeline.getStepPrompt(
          chain[i], i, intent, finalPrompt, previousOutput
        );

        // Only pass file to the first step (subsequent steps work on text)
        const stepFile = (i === 0) ? attachment : null;
        const output = await APIService.call(chain[i].llm, stepPrompt, effectiveMode, stepFile, steps[i].caps);
        steps[i].output = output;
        steps[i].status = 'done';
        steps[i].duration = Date.now() - stepStart;
        previousOutput = output;
      } catch (e) {
        // Fallback strategy: try a different provider, then same provider in fast mode
        const FALLBACK_MAP = { chatgpt: 'claude', claude: 'chatgpt', gemini: 'chatgpt', grok: 'gemini', perplexity: 'chatgpt' };
        const fallbackLLM = FALLBACK_MAP[chain[i].llm];
        const fallbackProvider = fallbackLLM ? LLM_KEY_MAP[fallbackLLM] : null;
        const hasFallbackKey = fallbackProvider && hasApiKey(fallbackProvider);

        let recovered = false;
        // Attempt 1: try fallback provider
        if (hasFallbackKey && !recovered) {
          try {
            const fbPrompt = ChainPipeline.getStepPrompt(chain[i], i, intent, finalPrompt, previousOutput);
            const fbCaps = CapabilityRouter.decide(fallbackProvider, chain[i].role, intent, effectiveMode, routerResult);
            const output = await APIService.call(fallbackLLM, fbPrompt, effectiveMode, null, fbCaps);
            steps[i].output = output;
            steps[i].status = 'done';
            steps[i].duration = Date.now() - stepStart;
            steps[i].llmName = LLM_NAMES[fallbackLLM] + ' (fallback)';
            previousOutput = output;
            recovered = true;
          } catch (fbErr) { /* fallback also failed */ }
        }
        // Attempt 2: try same provider in fast mode
        if (!recovered) {
          try {
            const retryPrompt = ChainPipeline.getStepPrompt(chain[i], i, intent, finalPrompt, previousOutput);
            const output = await APIService.call(chain[i].llm, retryPrompt, 'fast', null, {});
            steps[i].output = output;
            steps[i].status = 'done';
            steps[i].duration = Date.now() - stepStart;
            steps[i].llmName += ' (fast retry)';
            previousOutput = output;
            recovered = true;
          } catch (retryErr) { /* fast retry also failed */ }
        }
        // If still not recovered, skip this step but don't kill the chain
        if (!recovered) {
          steps[i].status = 'failed';
          steps[i].error = e.message;
          steps[i].duration = Date.now() - stepStart;
          // Continue with last good output if we have one
          if (previousOutput && i < steps.length - 1) {
            if (onStepUpdate) onStepUpdate([...steps], intent, null, routerResult);
            continue;
          }
          for (let j = i + 1; j < steps.length; j++) steps[j].status = 'skipped';
          if (onStepUpdate) onStepUpdate([...steps], intent, null, routerResult);
          break;
        }
      }

      if (onStepUpdate) onStepUpdate([...steps], intent, null, routerResult);
    }

    const totalDuration = Date.now() - totalStart;
    const finalOutput = previousOutput;

    if (onStepUpdate) onStepUpdate([...steps], intent, { finalOutput, totalDuration }, routerResult);

    return {
      steps,
      intent,
      finalOutput,
      totalDuration,
      mode: effectiveMode,
      routerResult
    };
  }
};

// ────────────────────────────────────
// Capability Router — decides which capabilities to enable per step
// Based on provider, role in chain, intent, and mode
// ────────────────────────────────────
const CapabilityRouter = {
  decide(provider, role, intent, mode, routerResult) {
    const provCaps = PROVIDER_CAPABILITIES[provider];
    if (!provCaps) return {};
    const rr = routerResult || {};
    const caps = {};

    // ── WEB SEARCH ──
    // Enable when: router says so, OR role is Gather/research, OR intent needs facts
    // NEVER for Critic — it audits existing text, doesn't need to search
    if (provCaps.webSearch && role !== 'Critic') {
      if (rr.webSearch || role === 'Gather' || intent === 'research' || intent === 'stepByStep') {
        caps.webSearch = true;
      }
    }

    // ── CODE EXECUTION (Gemini) ──
    if (provCaps.codeExecution) {
      if (rr.codeExec || intent === 'code' || intent === 'structured') {
        caps.codeExecution = true;
      }
    }

    // ── STRUCTURED OUTPUT ──
    if (provCaps.structuredOutput && intent === 'structured') {
      caps.structuredOutput = true;
    }

    // ── REASONING ──
    // OpenAI: enable reasoning effort based on mode
    if (provCaps.reasoning && provider === 'openai') {
      if (rr.deepReasoning || mode === 'quality') {
        caps.reasoning = true;
        caps.reasoningLevel = 'high';
      } else {
        caps.reasoning = true;
        caps.reasoningLevel = 'low';
      }
    }
    // Perplexity: enable reasoning models for quality tasks
    if (provCaps.reasoning && provider === 'perplexity') {
      if (rr.deepReasoning || (mode === 'quality' && (intent === 'research' || intent === 'code' || intent === 'summary'))) {
        caps.reasoning = true;
      }
    }

    // ── PERPLEXITY SEARCH CONTEXT ──
    if (provCaps.searchContextSize && provider === 'perplexity') {
      caps.searchContextSize = mode === 'quality' ? 'high' : 'low';
    }

    // ── VISION ──
    // Auto-enable if the provider supports it (actual file check is in the API call)
    if (provCaps.vision) {
      caps.vision = true;
    }

    return caps;
  },

  // Human-readable labels for UI display
  getLabels(caps) {
    const labels = [];
    if (caps.webSearch) labels.push('web search');
    if (caps.codeExecution) labels.push('code exec');
    if (caps.structuredOutput) labels.push('JSON mode');
    if (caps.reasoning) labels.push(caps.reasoningLevel ? `reasoning: ${caps.reasoningLevel}` : 'reasoning');
    if (caps.searchContextSize) labels.push(`search: ${caps.searchContextSize}`);
    return labels;
  }
};
