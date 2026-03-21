/* ═══════════════════════════════════════
   ChainRun Engine
   IntentClassifier · AntiPatternFixer · Templates · ChainPipeline
   ═══════════════════════════════════════ */

// ────────────────────────────────────
// Intent Classifier
// ────────────────────────────────────
const IntentClassifier = {
  patterns: {
    code: [
      /\b(write|create|build|implement|code|script|function|class|api|endpoint)\b/i,
      /\b(bug|fix|debug|refactor|optimize|lint)\b/i,
      /\b(python|javascript|typescript|java|swift|kotlin|rust|go|ruby|php|c\+\+|csharp|c#|sql|html|css|react|node|express|django|flask|rails)\b/i,
      /\b(import|def|class|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|function|const|let|var|return|async|await|try|catch)\b/i,
      /\b(algorithm|data structure|regex|recursion|loop|array|object|string|integer|boolean)\b/i
    ],
    research: [
      /\b(research|analyze|compare|evaluate|investigate|study|examine|assess)\b/i,
      /\b(pros and cons|advantages|disadvantages|trade-?offs?|benchmark|comparison)\b/i,
      /\b(market|industry|competitor|trend|landscape|sector|forecast)\b/i,
      /\b(evidence|data|statistics|findings|literature|source|citation)\b/i
    ],
    creative: [
      /\b(write|draft|compose)\b.*\b(story|poem|essay|article|blog|copy|tagline|script|lyrics|narrative|fiction)\b/i,
      /\b(creative|fiction|metaphor|rewrite|rephrase|reimagine)\b/i,
      /\b(tone|voice|style|engaging|compelling|vivid|poetic)\b/i,
      /\b(brainstorm|ideate|imagine|invent)\b.*\b(story|concept|idea|narrative)\b/i
    ],
    structured: [
      /\b(json|csv|table|schema|xml|yaml|markdown table)\b/i,
      /\b(list of|give me a table|organize into|categorize|classify)\b/i,
      /\b(extract|parse|convert|transform|format|structure)\b/i,
      /\b(spreadsheet|database|columns|rows|fields)\b/i
    ],
    summary: [
      /\b(summarize|summary|tldr|tl;dr|brief|overview|key points|highlights|recap|condense)\b/i,
      /\b(shorten|distill|boil down|main takeaways?|gist)\b/i,
      /\b(in (a few|one|two|three) sentences?|bullet points)\b/i
    ],
    stepByStep: [
      /\b(how to|step by step|tutorial|guide|instructions|walkthrough)\b/i,
      /\b(set up|install|configure|deploy|migrate|setup)\b/i,
      /\b(process|procedure|workflow|recipe|checklist)\b/i,
      /\b(first|then|next|finally|step \d)\b/i
    ],
    conversational: [
      /\b(what do you think|your opinion|help me decide|brainstorm|ideas|suggestions)\b/i,
      /\b(advice|recommend|suggest|thoughts on|perspective|weigh in)\b/i,
      /\b(should I|would you|could you help|can you help|tell me about)\b/i,
      /\b(explain|clarify|elaborate|what is|what are|why does|how does)\b/i
    ]
  },

  classify(prompt) {
    const scores = {};
    for (const [type, patterns] of Object.entries(this.patterns)) {
      scores[type] = 0;
      for (const pattern of patterns) {
        if (pattern.test(prompt)) {
          scores[type] += 2;
        }
      }
    }

    let maxScore = 0;
    let maxType = 'conversational';
    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxType = type;
      }
    }

    return maxType;
  }
};

// ────────────────────────────────────
// Anti-Pattern Fixer
// ────────────────────────────────────
const AntiPatternFixer = {
  replacements: [
    { pattern: /don'?t be vague/gi, fix: 'be specific — use exact numbers, named examples, and concrete details' },
    { pattern: /don'?t be verbose/gi, fix: 'be concise — limit each point to 1–2 sentences' },
    { pattern: /don'?t be boring/gi, fix: 'use vivid language, concrete examples, and varied sentence structure' },
    { pattern: /don'?t be generic/gi, fix: 'tailor every point to the specific context given' },
    { pattern: /don'?t be biased/gi, fix: 'present multiple perspectives and flag your assumptions' },
    { pattern: /don'?t hallucinate/gi, fix: "only state claims you can ground in the provided context; say 'I'm not sure' when uncertain" },
    { pattern: /don'?t make (stuff|things) up/gi, fix: 'only state claims you can ground in evidence; explicitly flag uncertainty' },
    { pattern: /don'?t be lazy/gi, fix: 'be thorough — address every aspect of the request with full detail' }
  ],

  vaguePatterns: [
    /^make this better$/i,
    /^improve this$/i,
    /^fix this$/i,
    /^help me with this$/i,
    /^make it good$/i,
    /^do better$/i
  ],

  fix(prompt) {
    const fixes = [];
    let fixed = prompt;

    for (const { pattern, fix } of this.replacements) {
      if (pattern.test(fixed)) {
        const original = fixed.match(pattern)[0];
        fixed = fixed.replace(pattern, fix);
        fixes.push({ original, replacement: fix });
      }
    }

    const isVague = this.vaguePatterns.some(p => p.test(prompt.trim()));

    return { text: fixed, fixes, isVague };
  }
};

// ────────────────────────────────────
// Templates — 5 LLMs × 7 output types
// ────────────────────────────────────
const Templates = {
  chatgpt: {
    code: `### Role
You are an expert software engineer. Write clean, production-ready code.

### Rules
- Think step by step before writing code
- Include clear comments explaining complex logic
- Follow language-specific best practices and conventions
- Handle edge cases and errors gracefully
- Use meaningful variable and function names

### Task
{prompt}

### Format
Respond with well-structured code blocks. Include brief explanations before each code section. If multiple files are needed, clearly label each one.`,

    research: `### Role
You are a thorough research analyst.

### Rules
- Think step by step through each aspect of the topic
- Present evidence-based findings with specific data points
- Compare multiple perspectives fairly
- Identify key trends, patterns, and implications
- Flag any limitations in available information

### Task
{prompt}

### Format
Use ### headers for main sections. Include specific examples, statistics, and named sources where possible. End with a clear synthesis of key findings.`,

    creative: `### Role
You are a skilled creative writer with a distinctive voice.

### Rules
- Think step by step about tone, audience, and purpose before writing
- Use vivid, sensory language and concrete details
- Vary sentence structure and rhythm for engaging flow
- Show rather than tell — use examples, metaphors, and anecdotes
- Maintain a consistent voice throughout

### Task
{prompt}

### Format
Write in flowing prose with natural paragraph breaks. Use formatting sparingly — let the writing itself carry the piece.`,

    structured: `### Role
You are a data organization expert.

### Rules
- Think step by step about the best structure for this data
- Use consistent formatting throughout
- Include all relevant fields and categories
- Sort/group logically
- Ensure data is complete and accurate

### Task
{prompt}

### Format
Output in the most appropriate structured format (table, JSON, CSV, etc.). Use clear headers/labels. Include a brief note on the structure chosen if it wasn't specified.`,

    summary: `### Role
You are an expert at distilling complex information into clear summaries.

### Rules
- Think step by step to identify the most important points
- Preserve key facts, figures, and conclusions
- Maintain accuracy — never add information not in the source
- Prioritize what the reader needs to know
- Be concise — every word should earn its place

### Task
{prompt}

### Format
Lead with the single most important takeaway. Follow with key points in order of importance. Use bullet points for clarity.`,

    stepByStep: `### Role
You are a clear, patient technical instructor.

### Rules
- Think step by step and number each step sequentially
- Start each step with an action verb
- Include expected outcomes so the user can verify each step
- Warn about common pitfalls before they happen
- Assume the reader is following along in real-time

### Task
{prompt}

### Format
Use numbered steps with ### headers for major phases. Include code blocks or examples where helpful. Add ⚠️ warnings for common mistakes.`,

    conversational: `### Role
You are a knowledgeable, thoughtful assistant.

### Rules
- Think step by step through the question
- Give direct, actionable answers
- Provide context and reasoning for your suggestions
- Acknowledge trade-offs and alternatives
- Be specific rather than generic

### Task
{prompt}

### Format
Respond naturally in clear paragraphs. Use ### headers if covering multiple topics. Include specific examples to illustrate points.`
  },

  claude: {
    code: `<role>You are an expert software engineer focused on writing clean, maintainable, production-ready code.</role>

<rules>
- Analyze the requirements fully before writing any code
- Follow the principle of least surprise — code should be readable and predictable
- Handle errors, edge cases, and invalid inputs gracefully
- Use idiomatic patterns for the target language/framework
- Include concise comments only where logic is non-obvious
</rules>

<task>
{prompt}
</task>

<format>
Provide well-structured code with clear separation of concerns. Label each file/section distinctly. Include a brief explanation of key design decisions.
</format>

<thinking>
Break down the problem, identify the right approach, then implement.
</thinking>

Here is my implementation:`,

    research: `<role>You are a rigorous research analyst who values evidence and balanced analysis.</role>

<rules>
- Ground every claim in specific evidence, data, or expert sources
- Present multiple perspectives before drawing conclusions
- Distinguish between established facts and informed opinions
- Quantify where possible — use numbers, percentages, timeframes
- Acknowledge gaps in knowledge and areas of uncertainty
</rules>

<task>
{prompt}
</task>

<format>
Structure with clear sections: Background, Analysis, Key Findings, Implications. Use specific examples and data points throughout.
</format>

<thinking>
Map out all angles of the topic, gather key evidence, then synthesize.
</thinking>

Here is my analysis:`,

    creative: `<role>You are a talented creative writer who crafts compelling, original content.</role>

<rules>
- Develop a clear voice and tone appropriate to the piece
- Use sensory details, metaphors, and varied rhythm
- Build narrative momentum — each paragraph should pull the reader forward
- Show don't tell — use scenes, examples, and specifics
- Edit ruthlessly — every sentence must earn its place
</rules>

<task>
{prompt}
</task>

<format>
Write in polished prose with natural structure. Let form follow content.
</format>

<thinking>
Consider the audience, purpose, and emotional arc before writing.
</thinking>

Here is my piece:`,

    structured: `<role>You are a data structuring expert who organizes information for maximum clarity and usability.</role>

<rules>
- Choose the format that best serves the data (table, JSON, YAML, CSV)
- Use consistent naming conventions and formatting
- Include all relevant fields — completeness matters
- Sort and group data logically
- Validate structure and formatting before outputting
</rules>

<task>
{prompt}
</task>

<format>
Output clean, well-formatted structured data. Include a brief note on format choice if relevant.
</format>

<thinking>
Analyze what structure best represents this data.
</thinking>

Here is the structured output:`,

    summary: `<role>You are an expert at extracting and distilling the essence of complex information.</role>

<rules>
- Identify and prioritize the most critical information
- Preserve exact figures, names, and key details
- Never introduce information not present in the source
- Maintain the original meaning and nuance
- Be ruthlessly concise — every word must add value
</rules>

<task>
{prompt}
</task>

<format>
Open with the single most important insight. Follow with key supporting points ordered by importance.
</format>

<thinking>
Identify what truly matters, then distill.
</thinking>

Here is the summary:`,

    stepByStep: `<role>You are a meticulous technical instructor who writes guides people can follow without confusion.</role>

<rules>
- Number every step and start with a clear action verb
- Include verification — how the user knows each step worked
- Warn about common mistakes before they occur
- Assume the reader is doing this for the first time
- Include prerequisites upfront
</rules>

<task>
{prompt}
</task>

<format>
Structure as: Prerequisites → Steps (numbered) → Verification → Troubleshooting. Include code/commands in blocks.
</format>

<thinking>
Walk through the entire process mentally, noting every substep and potential pitfall.
</thinking>

Here is the guide:`,

    conversational: `<role>You are a thoughtful, knowledgeable assistant who gives direct, well-reasoned answers.</role>

<rules>
- Answer the actual question directly before providing context
- Give specific, actionable suggestions — not generic advice
- Acknowledge trade-offs honestly
- Support key points with concrete examples
- If uncertain about something, say so clearly
</rules>

<task>
{prompt}
</task>

<format>
Respond in clear, natural language. Use structure only when it aids clarity.
</format>

<thinking>
Understand what's actually being asked, then provide the most helpful response.
</thinking>

Here is my response:`
  },

  perplexity: {
    code: `Question: {prompt}

You are an expert software engineer. Provide production-ready code with clear explanations.

Requirements:
- Write clean, well-documented code following best practices
- Handle edge cases and errors
- Include usage examples
- Cite any libraries, frameworks, or documentation referenced
- If referencing specific APIs or methods, include source documentation links`,

    research: `Question: {prompt}

You are a research analyst. Provide a thorough, evidence-based analysis.

Requirements:
- Cite specific sources for every major claim
- Include relevant statistics, data points, and expert opinions
- Compare multiple perspectives and approaches
- Identify key trends, risks, and opportunities
- Clearly distinguish between facts and analysis
- Include source URLs where available`,

    creative: `Question: {prompt}

You are a creative writer. Craft engaging, original content.

Requirements:
- Use vivid language and concrete sensory details
- Maintain a consistent voice and tone throughout
- If drawing on existing works or styles for inspiration, cite them
- Ensure originality while acknowledging influences
- Vary rhythm and structure for engaging flow`,

    structured: `Question: {prompt}

You are a data organization expert. Structure the requested information clearly.

Requirements:
- Use the most appropriate format (table, JSON, list, etc.)
- Ensure completeness and accuracy
- Cite sources for any data points included
- Use consistent formatting throughout
- Include relevant context for each data point`,

    summary: `Question: {prompt}

You are a summarization expert. Distill the key information concisely.

Requirements:
- Lead with the most important finding or conclusion
- Preserve critical facts, figures, and sources
- Cite original sources throughout
- Maintain accuracy — do not add unsupported claims
- Organize by importance, not by order of appearance`,

    stepByStep: `Question: {prompt}

You are a technical guide writer. Provide clear, step-by-step instructions.

Requirements:
- Number each step with a clear action
- Include verification checkpoints
- Cite official documentation for tools and commands
- Warn about common pitfalls with evidence
- Include prerequisite requirements upfront
- Link to relevant resources and documentation`,

    conversational: `Question: {prompt}

You are a helpful, well-informed assistant. Provide a direct, evidence-backed response.

Requirements:
- Answer directly, then provide supporting context
- Cite sources for key claims and recommendations
- Present multiple options when applicable with evidence for each
- Be specific and actionable
- Acknowledge uncertainty where appropriate`
  },

  gemini: {
    code: `**Role:** Expert software engineer

**Task:** {prompt}

**Instructions:**
- Write clean, production-ready code
- Follow language best practices and conventions
- Handle errors and edge cases properly
- Include clear comments for complex logic
- Provide usage examples

**Output:** Well-structured code with brief explanations.`,

    research: `**Role:** Research analyst

**Task:** {prompt}

**Instructions:**
- Provide evidence-based analysis with specific data
- Compare multiple perspectives fairly
- Include relevant statistics and trends
- Identify key implications and risks
- Flag limitations and uncertainties

**Output:** Structured analysis with clear sections and data-backed conclusions.`,

    creative: `**Role:** Creative writer

**Task:** {prompt}

**Instructions:**
- Use vivid, engaging language
- Maintain consistent voice and tone
- Show rather than tell with concrete details
- Vary sentence structure for rhythm
- Craft a compelling narrative arc

**Output:** Polished creative content.`,

    structured: `**Role:** Data organization expert

**Task:** {prompt}

**Instructions:**
- Choose the optimal structure format
- Ensure completeness and consistency
- Use clear headers and labels
- Sort/group data logically
- Validate formatting

**Output:** Clean, well-formatted structured data.`,

    summary: `**Role:** Summarization expert

**Task:** {prompt}

**Instructions:**
- Lead with the most critical insight
- Preserve key facts and figures
- Be concise — every word counts
- Don't add information not in the source
- Order by importance

**Output:** Concise summary with key takeaways.`,

    stepByStep: `**Role:** Technical instructor

**Task:** {prompt}

**Instructions:**
- Number each step clearly
- Start with prerequisites
- Include verification for each step
- Warn about common pitfalls
- Provide code/commands where applicable

**Output:** Step-by-step guide with clear actions and checkpoints.`,

    conversational: `**Role:** Knowledgeable assistant

**Task:** {prompt}

**Instructions:**
- Answer directly first
- Provide reasoning and context
- Include specific examples
- Acknowledge trade-offs
- Be actionable rather than generic

**Output:** Clear, helpful response.`
  },

  grok: {
    code: `**Role:** Expert software engineer

**Task:** {prompt}

**Guidelines:**
- Write clean, well-structured code
- Follow best practices for the language
- Handle errors and edge cases
- Include helpful comments
- Provide a brief explanation of the approach

**Format:** Code blocks with explanations.`,

    research: `**Role:** Research analyst

**Task:** {prompt}

**Guidelines:**
- Back up claims with evidence and data
- Consider multiple angles and perspectives
- Highlight key trends and insights
- Be specific with examples and numbers
- Note areas of uncertainty

**Format:** Structured analysis with clear takeaways.`,

    creative: `**Role:** Creative writer

**Task:** {prompt}

**Guidelines:**
- Write with vivid, engaging language
- Use concrete details and imagery
- Keep a consistent voice
- Build momentum through the piece
- Edit for impact — every sentence matters

**Format:** Polished prose.`,

    structured: `**Role:** Data structuring expert

**Task:** {prompt}

**Guidelines:**
- Pick the best format for the data
- Be complete and consistent
- Use clear labels and headers
- Group logically
- Ensure accuracy

**Format:** Clean structured output.`,

    summary: `**Role:** Summarization expert

**Task:** {prompt}

**Guidelines:**
- Start with the key takeaway
- Keep only essential information
- Preserve accuracy
- Be concise
- Order by importance

**Format:** Brief, focused summary.`,

    stepByStep: `**Role:** Technical guide writer

**Task:** {prompt}

**Guidelines:**
- Number every step
- Begin with prerequisites
- Include checkpoints to verify success
- Flag common mistakes
- Provide code or commands when helpful

**Format:** Numbered step-by-step guide.`,

    conversational: `**Role:** Helpful assistant

**Task:** {prompt}

**Guidelines:**
- Give a direct answer first
- Back it up with reasoning
- Include practical examples
- Mention alternatives and trade-offs
- Be specific, not generic

**Format:** Natural, clear response.`
  }
};

// LLM name mapping
const LLM_NAMES = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  grok: 'Grok'
};

const LLM_KEY_MAP = {
  chatgpt: 'openai',
  claude: 'anthropic',
  perplexity: 'perplexity',
  gemini: 'gemini',
  grok: 'xai'
};

// ────────────────────────────────────
// Model Tiers — fast vs quality per provider
// ────────────────────────────────────
const MODEL_TIERS = {
  openai: {
    fast:    { id: 'gpt-5.4-mini',  name: 'GPT-5.4 mini',  cost: '$0.75/$4.50', vision: true,  maxTokenParam: 'max_completion_tokens' },
    quality: { id: 'gpt-5.4',       name: 'GPT-5.4',       cost: '$2.50/$15',   vision: true,  maxTokenParam: 'max_completion_tokens' }
  },
  anthropic: {
    fast:    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5',  cost: '$1/$5',    vision: true },
    quality: { id: 'claude-sonnet-4-6-20260310', name: 'Claude Sonnet 4.6', cost: '$3/$15',   vision: true }
  },
  perplexity: {
    fast:    { id: 'sonar',              name: 'Sonar',              cost: '$1/$1',   vision: false, reasoning: 'sonar-reasoning' },
    quality: { id: 'sonar-deep-research', name: 'Sonar Deep Research', cost: '$2/$8',   vision: false, reasoning: 'sonar-reasoning-pro' }
  },
  gemini: {
    fast:    { id: 'gemini-2.5-flash',        name: 'Gemini 2.5 Flash', cost: '$0.30/$2.50', vision: true },
    quality: { id: 'gemini-3.1-pro-preview',   name: 'Gemini 3.1 Pro',   cost: '$2/$12',      vision: true }
  },
  xai: {
    fast:    { id: 'grok-4.1-fast', name: 'Grok 4.1 Fast', cost: '$0.20/$0.50', vision: true },
    quality: { id: 'grok-4',        name: 'Grok 4',        cost: '$3/$15',       vision: true }
  }
};

// Get model info for a provider + mode
function getModelInfo(providerKey, mode) {
  return MODEL_TIERS[providerKey]?.[mode || 'quality'] || MODEL_TIERS[providerKey]?.quality;
}

// Check if a provider supports vision
function providerSupportsVision(providerKey, mode) {
  const info = getModelInfo(providerKey, mode);
  return info?.vision ?? false;
}

// Get human-readable model name for display
function getModelDisplayName(providerKey, mode) {
  const info = getModelInfo(providerKey, mode);
  return info ? `${info.name} (${info.cost})` : providerKey;
}

const INTENT_LABELS = {
  code: 'Code',
  research: 'Research',
  creative: 'Creative',
  structured: 'Structured',
  summary: 'Summary',
  stepByStep: 'Step-by-step',
  conversational: 'Conversational'
};

// ────────────────────────────────────
// Chain Pipeline
// ────────────────────────────────────
const ChainPipeline = {
  chains: {
    research: [
      { llm: 'perplexity', role: 'Gather' },
      { llm: 'claude', role: 'Analyze' },
      { llm: 'chatgpt', role: 'Refine' }
    ],
    code: [
      { llm: 'claude', role: 'Generate' },
      { llm: 'chatgpt', role: 'Refine' }
    ],
    creative: [
      { llm: 'chatgpt', role: 'Generate' },
      { llm: 'claude', role: 'Refine' }
    ],
    structured: [
      { llm: 'claude', role: 'Generate' },
      { llm: 'chatgpt', role: 'Verify' }
    ],
    stepByStep: [
      { llm: 'perplexity', role: 'Gather' },
      { llm: 'chatgpt', role: 'Generate' },
      { llm: 'claude', role: 'Verify' }
    ],
    summary: [
      { llm: 'claude', role: 'Analyze' },
      { llm: 'chatgpt', role: 'Refine' }
    ],
    conversational: [
      { llm: 'chatgpt', role: 'Generate' },
      { llm: 'claude', role: 'Verify' }
    ]
  },

  rolePrompts: {
    Gather: (llmName, prevOutput) =>
      `You are gathering comprehensive information. A previous step has provided the following output:\n\n---\n${prevOutput}\n---\n\nReview, expand, and ensure completeness. Add any missing details, data points, or perspectives.`,
    Analyze: (llmName, prevOutput) =>
      `Here is the output from the previous step. Your job is to analyze it critically — identify patterns, assess quality, flag gaps, and add depth:\n\n---\n${prevOutput}\n---\n\nProvide a thorough analysis that strengthens the original.`,
    Generate: (llmName, prevOutput) =>
      `Here is the output from the previous step. Your job is to generate an improved version based on this material:\n\n---\n${prevOutput}\n---\n\nUse the provided content as your foundation and produce a polished, comprehensive result.`,
    Refine: (llmName, prevOutput) =>
      `Here is the output from the previous step. Your job is to refine and polish this output — improve clarity, fix any errors, enhance structure, and ensure it is production-ready:\n\n---\n${prevOutput}\n---\n\nDeliver the final, refined version.`,
    Verify: (llmName, prevOutput) =>
      `Here is the output from the previous step. Your job is to verify its accuracy, completeness, and quality. Check for errors, inconsistencies, and missing elements:\n\n---\n${prevOutput}\n---\n\nProvide the verified and corrected final version.`
  },

  build(intent) {
    return this.chains[intent] || this.chains.conversational;
  },

  getStepPrompt(step, stepIndex, intent, userPrompt, previousOutput) {
    if (stepIndex === 0) {
      // First step: use the LLM's template
      const template = Templates[step.llm]?.[intent] || Templates[step.llm]?.conversational;
      return template.replace('{prompt}', userPrompt);
    } else {
      // Subsequent steps: use role-based prompt with previous output
      return this.rolePrompts[step.role](LLM_NAMES[step.llm], previousOutput);
    }
  },

  getRequiredKeys(intent) {
    const chain = this.build(intent);
    const llms = [...new Set(chain.map(s => s.llm))];
    return llms.map(llm => LLM_KEY_MAP[llm]);
  }
};

// ────────────────────────────────────
// Smart Router — Gemini Flash micro-call to optimize chain
// ────────────────────────────────────
const SmartRouter = {
  async analyze(prompt, hasFile, userMode) {
    // If user explicitly chose fast or quality, respect that
    // Router only activates when mode is 'auto'
    if (userMode !== 'auto') {
      return {
        mode: userMode,
        intent: IntentClassifier.classify(prompt),
        reasoning: `User selected ${userMode} mode`,
        webSearch: false,
        codeExec: false,
        deepReasoning: userMode === 'quality',
        skipRouter: true
      };
    }

    // Need Gemini key for the router
    const geminiKey = getApiKey('gemini');
    if (!geminiKey) {
      // Fallback to local classification
      return {
        mode: 'quality',
        intent: IntentClassifier.classify(prompt),
        reasoning: 'No Gemini key — defaulting to quality mode with local classification',
        webSearch: false,
        codeExec: false,
        deepReasoning: true,
        skipRouter: true
      };
    }

    try {
      const routerPrompt = `You are a routing engine for an AI chain system. Analyze the user's prompt and decide the optimal approach.

User prompt: "${prompt.slice(0, 1500)}"
${hasFile ? 'User attached a file (image/document).' : ''}

Decide:
1. MODE: "fast" (simple task, quick answer needed) or "quality" (complex, needs depth)
2. INTENT: one of: code, research, creative, structured, summary, stepByStep, conversational
3. ENABLE_WEB_SEARCH: true if the prompt needs current info, facts, or real-world data
4. ENABLE_CODE_EXEC: true if the prompt involves calculations, data processing, or code verification
5. ENABLE_REASONING: true if the prompt requires deep analysis, multi-step logic, or complex reasoning
6. REASONING: one short sentence explaining your decision

Respond ONLY with valid JSON, no markdown:
{"mode":"fast|quality","intent":"...","webSearch":true|false,"codeExec":true|false,"deepReasoning":true|false,"reasoning":"..."}`;

      // Use Flash (cheapest/fastest) for routing
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: routerPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
        }),
        signal: AbortSignal.timeout(5000) // 5s max
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const text = data.candidates[0].content.parts[0].text;
      // Parse JSON from response (handle possible markdown wrapping)
      const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(jsonStr);

      // Validate
      const validModes = ['fast', 'quality'];
      const validIntents = Object.keys(INTENT_LABELS);
      return {
        mode: validModes.includes(result.mode) ? result.mode : 'quality',
        intent: validIntents.includes(result.intent) ? result.intent : IntentClassifier.classify(prompt),
        reasoning: result.reasoning || 'AI router decision',
        webSearch: result.webSearch === true,
        codeExec: result.codeExec === true,
        deepReasoning: result.deepReasoning === true,
        skipRouter: false
      };
    } catch (e) {
      // Router failed — graceful fallback
      return {
        mode: 'quality',
        intent: IntentClassifier.classify(prompt),
        reasoning: 'Router unavailable — using quality mode',
        webSearch: false,
        codeExec: false,
        deepReasoning: true,
        skipRouter: true
      };
    }
  }
};

// ────────────────────────────────────
// Wrap Engine (combines everything)
// ────────────────────────────────────
const WrapEngine = {
  wrap(prompt, llm, forceType) {
    // 1. Classify intent
    const intent = forceType === 'auto' ? IntentClassifier.classify(prompt) : forceType;

    // 2. Fix anti-patterns
    const { text: fixedPrompt, fixes, isVague } = AntiPatternFixer.fix(prompt);

    // 3. Get active profile adjustments
    const activeProfile = ProfileManager.getActive();
    let finalPrompt = fixedPrompt;
    if (activeProfile.prefix) {
      finalPrompt = activeProfile.prefix + '\n\n' + finalPrompt;
    }
    if (activeProfile.suffix) {
      finalPrompt = finalPrompt + '\n\n' + activeProfile.suffix;
    }

    // 4. Apply template
    const template = Templates[llm]?.[intent] || Templates[llm]?.conversational;
    const wrapped = template.replace('{prompt}', finalPrompt);

    return {
      wrapped,
      intent,
      fixes,
      isVague
    };
  }
};
