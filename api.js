/* ═══════════════════════════════════════
   ChainRun API Service & Chain Executor
   ═══════════════════════════════════════ */

// ────────────────────────────────────
// API Keys — persisted in localStorage (encrypted-at-rest via browser)
// ────────────────────────────────────
const ApiKeys = {
  openai: '',
  anthropic: '',
  perplexity: '',
  gemini: '',
  xai: ''
};

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
  }
};

// ────────────────────────────────────
// API Service — 5 LLM providers with full capabilities
// ────────────────────────────────────
const APIService = {
  timeout: 120000,

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
      temperature: 0.4
    };

    // GPT-5.4 family uses max_completion_tokens
    if (modelInfo.maxTokenParam === 'max_completion_tokens') {
      body.max_completion_tokens = 4096;
    } else {
      body.max_tokens = 4096;
    }

    // Web search tool
    if (caps.webSearch) {
      body.tools = body.tools || [];
      body.tools.push({ type: 'web_search_preview' });
    }

    // Reasoning effort (GPT-5.4 quality mode)
    if (caps.reasoning && modelInfo.id.includes('gpt-5')) {
      // fast = low effort, quality = high effort
      body.reasoning = { effort: caps.reasoningLevel || 'high' };
    }

    // Structured output (JSON mode)
    if (caps.structuredOutput) {
      body.response_format = { type: 'json_object' };
    }

    const res = await this._fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'OpenAI API error');
    return data.choices[0].message.content;
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
    // Build content: text-only or vision (image_url like OpenAI)
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

    // Live search
    if (caps.webSearch) {
      body.search = { mode: 'auto' };
    }

    const res = await this._fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error?.message || 'xAI API error');
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
        const map = { openai: 'OpenAI', anthropic: 'Anthropic', perplexity: 'Perplexity', gemini: 'Gemini', xai: 'xAI/Grok' };
        return map[k] || k;
      });
      throw new Error(`Missing API keys: ${names.join(', ')}. Configure them in Settings.`);
    }

    // 6. Initialize step states (with actual model names + capabilities)
    const steps = chain.map((step, i) => {
      const provider = LLM_KEY_MAP[step.llm];
      const modelInfo = getModelInfo(provider, effectiveMode);
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
        steps[i].status = 'failed';
        steps[i].error = e.message;
        steps[i].duration = Date.now() - stepStart;

        // Mark remaining as skipped
        for (let j = i + 1; j < steps.length; j++) {
          steps[j].status = 'skipped';
        }

        if (onStepUpdate) onStepUpdate([...steps], intent, null, routerResult);
        break;
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

    const caps = {};

    // Web search: enable for Gather/Research roles, or when intent is research
    // Perplexity always has web search (native). For others, enable when gathering info.
    if (provCaps.webSearch) {
      if (role === 'Gather' || intent === 'research' || intent === 'stepByStep') {
        caps.webSearch = true;
      }
    }

    // Code execution (Gemini): enable for code intent or structured data tasks
    if (provCaps.codeExecution) {
      if (intent === 'code' || intent === 'structured') {
        caps.codeExecution = true;
      }
    }

    // Structured output: enable for structured intent
    if (provCaps.structuredOutput && intent === 'structured') {
      caps.structuredOutput = true;
    }

    // Reasoning (OpenAI): enable in quality mode for complex intents
    if (provCaps.reasoning && provider === 'openai') {
      if (mode === 'quality' && (intent === 'research' || intent === 'code' || intent === 'stepByStep')) {
        caps.reasoning = true;
        caps.reasoningLevel = 'high';
      } else if (mode === 'fast') {
        caps.reasoning = true;
        caps.reasoningLevel = 'low';
      }
    }

    // Perplexity search context: quality = high, fast = low
    if (provCaps.searchContextSize && provider === 'perplexity') {
      caps.searchContextSize = mode === 'quality' ? 'high' : 'low';
    }

    // Perplexity reasoning models: enable for complex quality tasks
    if (provCaps.reasoning && provider === 'perplexity') {
      if (mode === 'quality' && (intent === 'research' || intent === 'code' || intent === 'summary')) {
        caps.reasoning = true;
      }
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
