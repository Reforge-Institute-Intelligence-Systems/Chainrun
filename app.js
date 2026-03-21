/* ═══════════════════════════════════════
   ChainRun App — UI Logic & State
   ═══════════════════════════════════════ */

// ────────────────────────────────────
// Browser Fingerprint (lightweight, anti-abuse)
// ────────────────────────────────────
function getBrowserFingerprint() {
  try {
    const nav = navigator;
    const scr = screen;
    const raw = [
      nav.userAgent || '',
      nav.language || '',
      nav.hardwareConcurrency || 0,
      scr.width + 'x' + scr.height,
      scr.colorDepth || 0,
      new Date().getTimezoneOffset(),
      nav.maxTouchPoints || 0,
      nav.deviceMemory || 0,
    ].join('|');
    // Simple hash
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  } catch(e) { return 'unknown'; }
}

// ────────────────────────────────────
// Tab Navigation
// ────────────────────────────────────
let currentTab = 'wrap';

function switchTab(tabId) {
  currentTab = tabId;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  // Refresh tab-specific content
  if (tabId === 'profiles') renderProfiles();
  if (tabId === 'settings') renderSettings();
}

// ────────────────────────────────────
// Toast Notifications
// ────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ────────────────────────────────────
// Wrap Tab
// ────────────────────────────────────
function handleWrap() {
  const prompt = document.getElementById('wrap-input').value.trim();
  if (!prompt) return;

  const llm = document.getElementById('wrap-llm').value;
  const outputType = document.getElementById('wrap-type').value;

  const result = WrapEngine.wrap(prompt, llm, outputType);

  // Show intent badge
  const intentBadge = document.getElementById('wrap-intent');
  intentBadge.textContent = `Detected: ${INTENT_LABELS[result.intent]}`;
  intentBadge.classList.remove('hidden');

  // Show vague warning
  const vagueEl = document.getElementById('wrap-vague');
  if (result.isVague) {
    vagueEl.classList.remove('hidden');
  } else {
    vagueEl.classList.add('hidden');
  }

  // Show fixes
  const fixesContainer = document.getElementById('wrap-fixes');
  const fixesList = document.getElementById('wrap-fixes-list');
  if (result.fixes.length > 0) {
    fixesList.innerHTML = result.fixes.map(f =>
      `<div class="fix-item"><strong>${f.original}</strong> → ${f.replacement}</div>`
    ).join('');
    fixesContainer.classList.remove('hidden');
  } else {
    fixesContainer.classList.add('hidden');
  }

  // Show output
  const outputArea = document.getElementById('wrap-output');
  const outputSection = document.getElementById('wrap-output-section');
  outputArea.textContent = result.wrapped;
  outputSection.classList.remove('hidden');

  // After first wrap, show the chain reveal to tease Auto Chain
  maybeShowChainReveal();
}

function copyWrapped() {
  const text = document.getElementById('wrap-output').textContent;
  copyToClipboard(text);
}

function toggleFixes() {
  const btn = document.getElementById('fixes-toggle-btn');
  const list = document.getElementById('wrap-fixes-list');
  btn.classList.toggle('open');
  list.classList.toggle('open');
}

// ────────────────────────────────────
// Auto Tab (Chain Execution)
// ────────────────────────────────────
let chainRunning = false;
let autoMode = 'auto'; // 'fast' | 'auto' | 'quality'
let autoAttachment = null; // { type, base64, mimeType, name }

// Mode toggle
function initModeToggle() {
  const toggle = document.getElementById('auto-mode-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      autoMode = btn.dataset.mode;
    });
  });
}

// File upload handler
function initFileUpload() {
  const input = document.getElementById('auto-file-input');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large (max 10MB)');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const isImage = file.type.startsWith('image/');
      autoAttachment = {
        type: isImage ? 'image' : 'document',
        base64,
        mimeType: file.type,
        name: file.name
      };

      // Show preview
      const preview = document.getElementById('auto-file-preview');
      const nameEl = document.getElementById('auto-file-name');
      nameEl.textContent = file.name;
      preview.classList.remove('hidden');

      // Highlight attach button
      document.getElementById('auto-file-btn').classList.add('has-file');
    };
    reader.readAsDataURL(file);
  });
}

function removeAutoFile() {
  autoAttachment = null;
  document.getElementById('auto-file-input').value = '';
  document.getElementById('auto-file-preview').classList.add('hidden');
  document.getElementById('auto-file-btn').classList.remove('has-file');
}

async function handleRunChain() {
  if (chainRunning) return;

  const prompt = document.getElementById('auto-input').value.trim();
  if (!prompt) return;

  const outputType = document.getElementById('auto-type').value;
  const intent = outputType === 'auto' ? IntentClassifier.classify(prompt) : outputType;

  // Check if user has enough keys for their chain
  const requiredKeys = ChainPipeline.getRequiredKeys(intent);
  const missingKeys = requiredKeys.filter(k => !hasApiKey(k));
  const hasAnyKeys = API_PROVIDERS.some(p => hasApiKey(p.key));

  const missingBanner = document.getElementById('auto-missing-keys');

  // If no keys at all and demo proxy is configured, use DemoChain
  const useDemo = !hasAnyKeys && typeof DemoChain !== 'undefined' && DEMO_PROXY_URL !== 'PASTE_YOUR_WORKER_URL_HERE';

  if (!useDemo && missingKeys.length > 0) {
    const names = missingKeys.map(k => {
      const map = { openai: 'OpenAI', anthropic: 'Anthropic', perplexity: 'Perplexity', gemini: 'Gemini', xai: 'xAI/Grok' };
      return map[k] || k;
    });
    missingBanner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>Missing API keys for: <strong>${names.join(', ')}</strong>. Go to Settings to add them.</div>
    `;
    missingBanner.classList.remove('hidden');
    return;
  }
  missingBanner.classList.add('hidden');

  chainRunning = true;
  const runBtn = document.getElementById('auto-run-btn');
  runBtn.disabled = true;
  runBtn.innerHTML = '<span class="spinning">↻</span> Running…';

  const progressArea = document.getElementById('auto-progress');
  const finalArea = document.getElementById('auto-output-section');
  const totalArea = document.getElementById('auto-total');
  const routerBadge = document.getElementById('auto-router-badge');
  progressArea.classList.remove('hidden');
  finalArea.classList.add('hidden');
  totalArea.classList.add('hidden');
  if (routerBadge) routerBadge.classList.add('hidden');

  try {
    if (useDemo) {
      // Run via proxy — no user keys needed
      await DemoChain.run(prompt, (steps, detectedIntent, result) => {
        renderChainProgress(steps, detectedIntent);
        if (result) {
          renderChainFinal(result.finalOutput, result.totalDuration);
        }
      });
    } else {
      // Run with user's own keys — pass mode and attachment
      await ChainExecutor.run(prompt, outputType, (steps, detectedIntent, result, routerResult) => {
        // Show router badge
        if (routerResult && routerBadge) {
          renderRouterBadge(routerResult);
        }
        renderChainProgress(steps, detectedIntent);
        if (result) {
          renderChainFinal(result.finalOutput, result.totalDuration);
        }
      }, autoMode, autoAttachment);
    }
  } catch (e) {
    const msg = e.message || 'Unknown error';
    if (msg.includes('Missing API keys')) {
      missingBanner.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>${escapeHtml(msg)} <button class="inline-link" onclick="switchTab('settings')">Open Settings</button></div>
      `;
      missingBanner.classList.remove('hidden');
    } else if (msg.includes('Invalid API key') || msg.includes('401')) {
      showToast('Invalid API key — check Settings');
    } else {
      showToast('Chain error: ' + msg);
    }
  }

  chainRunning = false;
  runBtn.disabled = false;
  runBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Chain`;
}

// Render router decision badge
function renderRouterBadge(routerResult) {
  const badge = document.getElementById('auto-router-badge');
  const text = document.getElementById('auto-router-text');
  const capsEl = document.getElementById('auto-router-caps');
  if (!badge || !text) return;

  badge.classList.remove('hidden');
  text.textContent = routerResult.reasoning || '';

  // Show capability pills
  const pills = [];
  pills.push(routerResult.mode === 'fast' ? '⚡ Fast' : '✦ Quality');
  if (routerResult.webSearch) pills.push('🔍 Web search');
  if (routerResult.codeExec) pills.push('⟨⟩ Code exec');
  if (routerResult.deepReasoning) pills.push('🧠 Reasoning');
  if (capsEl) {
    capsEl.innerHTML = pills.map(p => `<span class="router-cap-pill">${p}</span>`).join('');
  }
}

function renderChainProgress(steps, intent) {
  const container = document.getElementById('auto-steps');
  const intentBadge = document.getElementById('auto-intent');
  intentBadge.textContent = `Chain: ${INTENT_LABELS[intent]}`;
  intentBadge.classList.remove('hidden');

  container.innerHTML = steps.map((step, i) => {
    const statusIcon = {
      pending: '⏳',
      running: '🔄',
      done: '✅',
      failed: '❌',
      skipped: '⏭'
    }[step.status];

    const durationStr = step.duration > 0 ? formatDuration(step.duration) : '';
    const capsPills = (step.capsUsed && step.capsUsed.length > 0)
      ? `<div class="step-caps">${step.capsUsed.map(c => `<span class="step-cap-pill">${c}</span>`).join('')}</div>`
      : '';

    return `
      <div class="step-card ${step.status}" onclick="toggleStepOutput(${i})">
        <div class="step-header">
          <div class="step-number">${i + 1}</div>
          <div class="step-info">
            <div class="step-llm">${step.llmName}</div>
            <div class="step-role">${step.role}${capsPills}</div>
          </div>
          ${durationStr ? `<div class="step-duration">${durationStr}</div>` : ''}
          <div class="step-status">${statusIcon}</div>
        </div>
        <div class="step-output" id="step-output-${i}">
          <pre>${escapeHtml(step.output || step.error || 'No output')}</pre>
        </div>
      </div>
    `;
  }).join('');
}

function toggleStepOutput(index) {
  const el = document.getElementById(`step-output-${index}`);
  if (el) el.classList.toggle('open');
}

function renderChainFinal(output, totalDuration) {
  const finalArea = document.getElementById('auto-output-section');
  const totalArea = document.getElementById('auto-total');

  document.getElementById('auto-output').textContent = output;
  document.getElementById('auto-total-time').textContent = formatDuration(totalDuration);

  if (finalArea) finalArea.classList.remove('hidden');
  if (totalArea) totalArea.classList.remove('hidden');
}

function copyChainOutput() {
  const text = document.getElementById('auto-output').textContent;
  copyToClipboard(text);
}

// ────────────────────────────────────
// Profiles Tab
// ────────────────────────────────────
function renderProfiles() {
  const container = document.getElementById('profiles-list');
  if (!container) return;
  const profiles = ProfileManager.getAll();
  const activeId = ProfileManager.getActive().id;

  container.innerHTML = profiles.map(p => `
    <div class="profile-item ${p.id === activeId ? 'active' : ''}" onclick="activateProfile('${p.id}')">
      <div class="profile-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="profile-body">
        <div class="profile-name">${escapeHtml(p.name)}</div>
        <div class="profile-desc">${escapeHtml(p.description || (p.prefix ? 'Custom prefix' : '') + (p.suffix ? (p.prefix ? ' + suffix' : 'Custom suffix') : '') || 'No modifications')}</div>
      </div>
      <div class="profile-actions">
        ${!p.builtIn ? `
          <button class="btn-icon" onclick="event.stopPropagation(); editProfile('${p.id}')" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon" onclick="event.stopPropagation(); deleteProfile('${p.id}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function activateProfile(id) {
  ProfileManager.setActive(id);
  renderProfiles();
  showToast(`Profile: ${ProfileManager.getActive().name}`);
}

function deleteProfile(id) {
  const p = ProfileManager.get(id);
  if (p && confirm(`Delete "${p.name}"?`)) {
    ProfileManager.remove(id);
    renderProfiles();
    showToast('Profile deleted');
  }
}

// ── Profile Modal ──
let editingProfileId = null;

function openProfileModal(id) {
  editingProfileId = id || null;
  const modal = document.getElementById('profile-modal');
  const title = document.getElementById('profile-modal-title');

  if (id) {
    const p = ProfileManager.get(id);
    title.textContent = 'Edit Profile';
    document.getElementById('profile-name-input').value = p.name;
    document.getElementById('profile-prefix-input').value = p.prefix;
    document.getElementById('profile-suffix-input').value = p.suffix;
    document.getElementById('profile-llm-input').value = p.llm || '';
  } else {
    title.textContent = 'New Profile';
    document.getElementById('profile-name-input').value = '';
    document.getElementById('profile-prefix-input').value = '';
    document.getElementById('profile-suffix-input').value = '';
    document.getElementById('profile-llm-input').value = '';
  }

  modal.classList.add('open');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('open');
  editingProfileId = null;
}

function saveProfile() {
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) { showToast('Name is required'); return; }

  const data = {
    name,
    prefix: document.getElementById('profile-prefix-input').value.trim(),
    suffix: document.getElementById('profile-suffix-input').value.trim(),
    llm: document.getElementById('profile-llm-input').value
  };

  if (editingProfileId) {
    ProfileManager.update(editingProfileId, data);
    showToast('Profile updated');
  } else {
    ProfileManager.add(data);
    showToast('Profile created');
  }

  closeProfileModal();
  renderProfiles();
}

function editProfile(id) {
  openProfileModal(id);
}

function addNewProfile() {
  openProfileModal(null);
}

// ────────────────────────────────────
// Settings Tab
// ────────────────────────────────────
const API_PROVIDERS = [
  { key: 'gemini', name: 'Google Gemini', placeholder: 'AIza...', url: 'https://aistudio.google.com/apikey', wizHint: 'Sign in with your Google account, tap "Create API key", copy it.' },
  { key: 'xai', name: 'xAI / Grok', placeholder: 'xai-...', url: 'https://console.x.ai/', wizHint: 'Sign in, go to API Keys, create one and copy it.' },
  { key: 'openai', name: 'OpenAI', placeholder: 'sk-...', url: 'https://platform.openai.com/api-keys', wizHint: 'Sign in, tap "Create new secret key", copy it before closing.' },
  { key: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...', url: 'https://console.anthropic.com/settings/keys', wizHint: 'Sign in, go to API Keys, create and copy your key.' },
  { key: 'perplexity', name: 'Perplexity', placeholder: 'pplx-...', url: 'https://www.perplexity.ai/settings/api', wizHint: 'Sign in, go to API settings, generate and copy your key.' }
];

function renderSettings() {
  // Decide: show wizard or normal key management
  const anyKeys = API_PROVIDERS.some(p => hasApiKey(p.key));
  const wizard = document.getElementById('setup-wizard');
  const normal = document.getElementById('settings-normal');

  if (!wizard || !normal) return; // Elements not in DOM yet

  if (anyKeys) {
    wizard.style.display = 'none';
    normal.style.display = '';
    renderKeyList();
    if (PAYGATE_STATE.isCT) {
      _renderSettingsCT();
    } else {
      _renderSettingsReferral();
    }
  } else {
    wizard.style.display = '';
    normal.style.display = 'none';
  }
}

function renderKeyList() {
  const container = document.getElementById('api-keys-list');
  container.innerHTML = API_PROVIDERS.map(p => {
    const hasKey = hasApiKey(p.key);
    return `
      <div class="api-key-item ${hasKey ? 'has-key' : ''}">
        <div class="api-key-header">
          <div class="api-key-name">
            <span class="key-dot ${hasKey ? 'configured' : 'missing'}"></span>
            ${p.name}
          </div>
          <a href="${p.url}" target="_blank" rel="noopener noreferrer" class="key-get-link">
            Get key
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
        <div class="key-input-wrap">
          <input
            type="password"
            id="key-${p.key}"
            placeholder="${p.placeholder}"
            value="${getApiKey(p.key)}"
            oninput="handleKeyInput('${p.key}', this.value)"
          />
          <button class="key-paste" onclick="pasteApiKey('${p.key}')" title="Paste from clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          </button>
          <button class="key-toggle" onclick="toggleKeyVisibility('${p.key}')" title="Show/Hide">
            <svg id="key-eye-${p.key}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function handleKeyInput(provider, value) {
  setApiKey(provider, value);
  // Update dot color
  const dot = document.querySelector(`#key-${provider}`).closest('.api-key-item').querySelector('.key-dot');
  dot.classList.toggle('configured', !!value.trim());
  dot.classList.toggle('missing', !value.trim());
}

function toggleKeyVisibility(provider) {
  const input = document.getElementById(`key-${provider}`);
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function pasteApiKey(provider) {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      const input = document.getElementById(`key-${provider}`);
      input.value = text.trim();
      handleKeyInput(provider, text.trim());
      showToast(`Pasted ${API_PROVIDERS.find(p => p.key === provider)?.name || provider} key`);
    } else {
      showToast('Clipboard is empty');
    }
  } catch (e) {
    showToast('Allow clipboard access or paste manually');
  }
}

// ────────────────────────────────────
// Setup Wizard
// ────────────────────────────────────
let wizState = {
  selectedProviders: [],
  currentIndex: 0
};

function wizStartSetup() {
  // Gather selected providers
  const checks = document.querySelectorAll('#wiz-choices input[type=checkbox]:checked');
  wizState.selectedProviders = Array.from(checks).map(c => c.value);

  if (wizState.selectedProviders.length === 0) {
    showToast('Pick at least one');
    return;
  }

  wizState.currentIndex = 0;
  document.getElementById('wiz-select').style.display = 'none';
  document.getElementById('wiz-setup').style.display = '';
  wizShowCurrentProvider();
}

function wizShowCurrentProvider() {
  const key = wizState.selectedProviders[wizState.currentIndex];
  const provider = API_PROVIDERS.find(p => p.key === key);
  const total = wizState.selectedProviders.length;
  const current = wizState.currentIndex + 1;

  // Progress bar
  const bar = document.getElementById('wiz-progress-bar');
  bar.style.width = `${(current / total) * 100}%`;

  // Counter
  document.getElementById('wiz-setup-count').textContent = `${current} of ${total}`;

  // Provider info
  document.getElementById('wiz-provider-name').textContent = provider.name;
  document.getElementById('wiz-provider-hint').textContent = provider.wizHint;

  // Open link
  const link = document.getElementById('wiz-open-link');
  link.href = provider.url;

  // Reset input & status
  const input = document.getElementById('wiz-key-input');
  input.value = getApiKey(key) || '';
  input.oninput = function() { wizCheckInput(key); };

  document.getElementById('wiz-key-status').innerHTML = '';
  document.getElementById('wiz-next-btn').disabled = !hasApiKey(key);

  if (hasApiKey(key)) {
    wizShowKeyOk();
  }
}

function wizCheckInput(providerKey) {
  const val = document.getElementById('wiz-key-input').value.trim();
  setApiKey(providerKey, val);
  document.getElementById('wiz-next-btn').disabled = !val;

  if (val) {
    wizShowKeyOk();
  } else {
    document.getElementById('wiz-key-status').innerHTML = '';
  }
}

function wizShowKeyOk() {
  document.getElementById('wiz-key-status').innerHTML = `
    <div class="wiz-key-ok">
      <svg viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
      Key saved
    </div>
  `;
}

async function wizPasteKey() {
  const key = wizState.selectedProviders[wizState.currentIndex];
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      document.getElementById('wiz-key-input').value = text.trim();
      wizCheckInput(key);
      document.getElementById('wiz-next-btn').disabled = false;
    } else {
      showToast('Clipboard is empty');
    }
  } catch (e) {
    showToast('Allow clipboard access or paste manually');
  }
}

function wizSkipProvider() {
  wizAdvance();
}

function wizNextProvider() {
  // Save the current key
  const key = wizState.selectedProviders[wizState.currentIndex];
  const val = document.getElementById('wiz-key-input').value.trim();
  setApiKey(key, val);
  wizAdvance();
}

function wizAdvance() {
  wizState.currentIndex++;
  if (wizState.currentIndex < wizState.selectedProviders.length) {
    wizShowCurrentProvider();
  } else {
    wizShowDone();
  }
}

function wizShowDone() {
  document.getElementById('wiz-setup').style.display = 'none';
  document.getElementById('wiz-done').style.display = '';

  const configured = API_PROVIDERS.filter(p => hasApiKey(p.key));
  const names = configured.map(p => p.name);
  const summary = configured.length > 0
    ? `${names.join(', ')} ${configured.length === 1 ? 'is' : 'are'} ready to go.`
    : 'No keys configured yet. You can add them anytime in Settings.';
  document.getElementById('wiz-done-summary').textContent = summary;
}

function wizFinish() {
  // Switch to the Wrap tab
  switchTab('wrap');
}

function wizAddMore() {
  // Show normal key management
  document.getElementById('setup-wizard').style.display = 'none';
  document.getElementById('settings-normal').style.display = '';
  renderKeyList();
}

function wizSkipAll() {
  // Skip wizard entirely — show normal settings view
  document.getElementById('setup-wizard').style.display = 'none';
  document.getElementById('settings-normal').style.display = '';
  renderKeyList();
}

function wizRestart() {
  // Reset wizard and show it
  document.getElementById('setup-wizard').style.display = '';
  document.getElementById('settings-normal').style.display = 'none';
  document.getElementById('wiz-select').style.display = '';
  document.getElementById('wiz-setup').style.display = 'none';
  document.getElementById('wiz-done').style.display = 'none';
}

// ────────────────────────────────────
// Welcome Overlay (premium first-launch moment)
// ────────────────────────────────────
function initWelcome() {
  const overlay = document.getElementById('welcome-overlay');
  if (!overlay) return;

  // If user has already seen the welcome, remove immediately
  if (window._store.get('chainrun_welcomed')) {
    overlay.remove();
    return;
  }

  // Show for 1.8s then fade out
  setTimeout(() => {
    overlay.classList.add('fade-out');
    window._store.set('chainrun_welcomed', '1');
    setTimeout(() => overlay.remove(), 600);
  }, 1800);
}

// ────────────────────────────────────
// Chain Reveal (after first wrap)
// ────────────────────────────────────
let chainRevealShown = false;

function maybeShowChainReveal() {
  // Show once per session after first successful wrap
  if (chainRevealShown) return;
  if (window._store.get('chainrun_chain_revealed')) return;
  chainRevealShown = true;

  const reveal = document.getElementById('chain-reveal');
  if (!reveal) { return; }

  // Build the pipeline visualization with real model names
  const pipeline = document.getElementById('chain-reveal-pipeline');
  if (pipeline) {
    const nodes = [
      { name: 'Perplexity', role: 'Research' },
      { name: 'Gemini', role: 'Structure' },
      { name: 'Grok 3', role: 'Analyze' },
      { name: 'GPT-5.4', role: 'Refine' }
    ];
    pipeline.innerHTML = nodes.map((n, i) => {
      let html = `<div class="cr-node"><span class="cr-node-name">${n.name}</span><span class="cr-node-role">${n.role}</span></div>`;
      if (i < nodes.length - 1) html += '<span class="cr-arrow">→</span>';
      return html;
    }).join('');
  }

  // Show the sheet after a slight delay
  reveal.style.display = '';
  setTimeout(() => reveal.classList.add('show'), 50);
}

function dismissChainReveal() {
  const reveal = document.getElementById('chain-reveal');
  if (reveal) {
    reveal.classList.remove('show');
    setTimeout(() => { reveal.style.display = 'none'; }, 400);
  }
  window._store.set('chainrun_chain_revealed', '1');
}

function startChainSetup() {
  dismissChainReveal();
  // Switch to the Auto tab
  switchTab('auto');
}

// ────────────────────────────────────
// Utilities
// ────────────────────────────────────
// ────────────────────────────────────
// Dynamic Prompt Suggestions
// Prompts where multi-model chaining genuinely outperforms a single LLM:
// research + fact-check, multi-perspective, synthesis, current data + analysis
// ────────────────────────────────────
const PROMPT_POOL = [
  // Research + fact-checking (Sonar finds data, others verify & refine)
  'What are the actual side effects of creatine based on recent clinical trials?',
  'Compare the real cost of owning an EV vs gas car over 5 years in 2026',
  'What are the current best-paying remote jobs that don\'t require a degree?',
  'Is the Mediterranean diet actually better than keto? What does the latest research say?',
  'What are the most effective study methods according to cognitive science?',
  'What are the real risks and benefits of intermittent fasting based on 2025-2026 studies?',

  // Multi-perspective analysis (each model adds a different angle)
  'Should I rent or buy a home in a major US city right now?',
  'Is a computer science degree still worth it in 2026 with AI taking over coding?',
  'What are the strongest arguments for and against universal basic income?',
  'Is remote work actually more productive, or do companies have a point about offices?',
  'Should I invest in index funds, real estate, or start a business with $50k?',
  'What are the actual pros and cons of homeschooling vs public school?',

  // Synthesis & deep explanation (needs research + structure + clarity)
  'Explain how mRNA vaccines work and why they were developed so fast — without oversimplifying',
  'What exactly happens to your body during a 72-hour fast? Step by step, with sources',
  'How does the US credit score system actually work, and how is it different from Europe?',
  'What are the biggest misconceptions about AI that even tech people get wrong?',
  'Break down how Spotify\'s recommendation algorithm actually works',
  'How do noise-cancelling headphones actually cancel sound? The real physics',

  // Current data + strategic advice (needs live search + critical analysis)
  'What are the best side hustles that actually work in 2026 — not the recycled listicle ones?',
  'What programming language should I learn first in 2026 and why?',
  'What are the most underrated travel destinations right now based on cost and safety?',
  'What are the current best strategies for negotiating a higher salary?',
  'Which AI tools are actually worth paying for right now vs free alternatives?',
  'What are the most effective ways to learn a new language as an adult based on research?',

  // Complex decision-making (benefits from research + multiple critiques)
  'Help me decide: MacBook Pro vs a high-end Windows laptop for software development',
  'What should I know before starting a dropshipping business — the honest version',
  'Is it better to pay off student loans fast or invest the money instead?',
  'What are the real differences between therapy approaches like CBT, DBT, and psychoanalysis?',
];

let _lastPromptIndices = [];

function _pickRandomPrompts(count) {
  const available = PROMPT_POOL.map((_, i) => i).filter(i => !_lastPromptIndices.includes(i));
  // If not enough non-repeating, just use all
  const pool = available.length >= count ? available : PROMPT_POOL.map((_, i) => i);
  const picked = [];
  const used = new Set();
  while (picked.length < count && picked.length < pool.length) {
    const idx = pool[Math.floor(Math.random() * pool.length)];
    if (!used.has(idx)) {
      used.add(idx);
      picked.push(idx);
    }
  }
  _lastPromptIndices = picked;
  return picked.map(i => PROMPT_POOL[i]);
}

function renderExamplePrompts() {
  const container = document.getElementById('example-chips');
  if (!container) return;
  const prompts = _pickRandomPrompts(3);
  container.innerHTML = prompts.map(p =>
    `<button class="lp-example-chip" onclick="fillExample(this)">${escapeHtml(p)}</button>`
  ).join('');
  // Animate in
  container.querySelectorAll('.lp-example-chip').forEach((chip, i) => {
    chip.style.opacity = '0';
    chip.style.transform = 'translateY(6px)';
    setTimeout(() => {
      chip.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      chip.style.opacity = '1';
      chip.style.transform = 'translateY(0)';
    }, i * 80);
  });
}

function refreshExamplePrompts() {
  const btn = document.getElementById('example-refresh');
  if (btn) {
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => { btn.style.transform = ''; }, 400);
  }
  renderExamplePrompts();
}

function fillExample(btn) {
  const textarea = document.getElementById('demo-prompt');
  if (!textarea) return;
  textarea.value = btn.textContent;
  textarea.focus();
  // Hide the example prompts after selection
  const container = document.getElementById('example-prompts');
  if (container) container.classList.add('used');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied to clipboard'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Copied to clipboard');
  } catch {
    showToast('Failed to copy');
  }
  document.body.removeChild(ta);
}

function showUpdateBanner() {
  // Don't show on landing page
  if (document.getElementById('landing-screen')?.classList.contains('active')) return;
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>A new version is available</span>
    <button onclick="window.location.reload()">Update</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('visible'), 100);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

// ────────────────────────────────────
// V2 Waitlist
// ────────────────────────────────────
// Helper: get selected radio tier from a notify pref group
function _getNotifyTier(radioName) {
  const sel = document.querySelector('input[name="' + radioName + '"]:checked');
  return sel ? sel.value : 'v2_only';
}

// Helper: shared notify submit logic
function _submitNotify(email, tier, source, btn) {
  fetch('https://chainrun-verify.markusraeder.workers.dev/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, tier, source }),
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      const list = JSON.parse(window._store.get('v2_waitlist') || '[]');
      if (!list.includes(email)) { list.push(email); window._store.set('v2_waitlist', JSON.stringify(list)); }
    }
  })
  .catch(() => {
    const list = JSON.parse(window._store.get('v2_waitlist') || '[]');
    if (!list.includes(email)) { list.push(email); window._store.set('v2_waitlist', JSON.stringify(list)); }
  });

  if (btn) {
    btn.textContent = 'You\'re on the list';
    btn.style.color = '#20b2aa';
    btn.style.borderColor = '#20b2aa';
    btn.disabled = true;
  }
}

function handleV2Notify() {
  const input = document.getElementById('v2-email');
  const email = (input?.value || '').trim();
  if (!email || !email.includes('@') || !email.includes('.')) {
    showToast('Enter a valid email');
    input?.focus();
    return;
  }
  const tier = _getNotifyTier('lp-notify-tier');
  const btn = document.querySelector('#lp-notify-pref')?.closest('.lp-v2-teaser')?.querySelector('.lp-v2-notify-btn');
  input.value = '';
  _submitNotify(email, tier, 'landing', btn);
}

function handleV2NotifyThankyou() {
  const input = document.getElementById('thankyou-v2-email');
  const email = (input?.value || '').trim();
  if (!email || !email.includes('@') || !email.includes('.')) {
    showToast('Enter a valid email');
    input?.focus();
    return;
  }
  const tier = _getNotifyTier('ty-notify-tier');
  const btn = input.nextElementSibling;
  input.value = '';
  _submitNotify(email, tier, 'post_purchase', btn);
}

// ────────────────────────────────────
// Landing Page: Live Demo
// ────────────────────────────────────
let landingDemoRunning = false;

// Step metadata for insights
// ── Model insights — shared between preview and live SSE modes ──
const MODEL_INSIGHTS = {
  'Sonar Deep Research': {
    strength: 'Multi-step deep web research — finds current data, multiple sources, citations',
    limitation: 'May surface too much raw data without a clear structure'
  },
  'Gemini 3.1 Pro': {
    strength: '1M context flagship — deep reasoning, advanced logic, code generation',
    limitation: 'Thorough but can be verbose when simpler answers suffice'
  },
  'Grok 4': {
    strength: '256K context, always-on reasoning — finds gaps, contradictions, missing angles',
    limitation: 'Can be overly contrarian, occasionally adding unnecessary caveats'
  },
  'GPT-5.4': {
    strength: 'Flagship creative output — polished prose, nuanced tone, authoritative writing',
    limitation: 'May smooth over nuance that the previous steps intentionally included'
  }
};
function _getModelInsight(modelName) {
  return MODEL_INSIGHTS[modelName] || { strength: 'Specialized AI processing', limitation: 'General-purpose constraints' };
}

const DEMO_STEP_META = [
  {
    model: 'Sonar Deep Research',
    role: 'Deep Research',
    strength: MODEL_INSIGHTS['Sonar Deep Research'].strength,
    limitation: MODEL_INSIGHTS['Sonar Deep Research'].limitation
  },
  {
    model: 'Gemini 3.1 Pro',
    role: 'Synthesize',
    strength: MODEL_INSIGHTS['Gemini 3.1 Pro'].strength,
    limitation: MODEL_INSIGHTS['Gemini 3.1 Pro'].limitation
  },
  {
    model: 'Grok 4',
    role: 'Challenge',
    strength: MODEL_INSIGHTS['Grok 4'].strength,
    limitation: MODEL_INSIGHTS['Grok 4'].limitation
  },
  {
    model: 'GPT-5.4',
    role: 'Refine',
    strength: MODEL_INSIGHTS['GPT-5.4'].strength,
    limitation: MODEL_INSIGHTS['GPT-5.4'].limitation
  }
];

// ────────────────────────────────────
// Streaming Demo — SSE-based live chain
// ────────────────────────────────────

async function runLandingDemo(isRetry) {
  if (landingDemoRunning) return;

  const textarea = isRetry
    ? document.getElementById('demo-retry-prompt')
    : document.getElementById('demo-prompt');
  const prompt = (textarea?.value || '').trim();
  if (!prompt) { textarea?.focus(); return; }

  landingDemoRunning = true;

  const btn = isRetry ? document.getElementById('demo-retry-btn') : document.getElementById('demo-run-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinning">↻</span> Running chain…'; }

  const resultsSection = document.getElementById('demo-results');
  resultsSection.classList.remove('hidden');
  setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);

  const container = document.getElementById('demo-chain-steps');
  const qualityEl = document.getElementById('demo-quality');
  const ctaEl = document.getElementById('demo-cta');
  const finalOutputEl = document.getElementById('demo-final-output');
  qualityEl.classList.add('hidden');
  ctaEl.classList.add('hidden');
  if (finalOutputEl) finalOutputEl.classList.add('hidden');

  // Show orchestrator thinking immediately
  container.innerHTML = _buildOrchestratorThinking();

  try {
    const reqBody = { prompt: prompt.slice(0, 2000), fingerprint: getBrowserFingerprint() };
    if (isRetry) {
      const storedToken = window._store.get('chainrun_retry_token');
      if (storedToken) reqBody.retryToken = storedToken;
    }

    const res = await fetch(DEMO_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    // Check for non-streaming error responses
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await res.json();
      throw new Error(data.error || 'Demo chain failed');
    }

    // ── Process SSE stream ──
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let plan = null;
    const chainSteps = []; // { model, role, output, ms }
    const stepTexts = {};  // index → accumulated text
    let finalData = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        switch (evt.type) {

          case 'orchestrator_thinking':
            // Already showing the thinking animation
            break;

          case 'orchestrator': {
            plan = evt.plan;
            // Transition: show the plan, then build step cards
            container.innerHTML = _buildOrchestratorPlan(plan) + _buildStreamSteps(plan.steps, chainSteps, stepTexts, -1);
            _animateOrchestratorReveal(container);
            await sleep(300);
            container.querySelector('.demo-orch-plan')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            break;
          }

          case 'step_start': {
            stepTexts[evt.index] = '';
            if (plan) {
              container.innerHTML = _buildOrchestratorPlan(plan) + _buildStreamSteps(plan.steps, chainSteps, stepTexts, evt.index);
              _animateAllVisible(container);
            }
            const card = container.querySelector(`[data-step="${evt.index}"]`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            break;
          }

          case 'step_chunk': {
            stepTexts[evt.index] = (stepTexts[evt.index] || '') + evt.text;
            // Update the live text area for this step
            const liveEl = document.getElementById(`demo-stream-${evt.index}`);
            if (liveEl) {
              liveEl.textContent = stepTexts[evt.index];
              liveEl.scrollTop = liveEl.scrollHeight;
            }
            break;
          }

          case 'step_done': {
            chainSteps[evt.index] = { model: evt.model, role: evt.role, output: evt.output, ms: evt.ms };
            if (plan) {
              container.innerHTML = _buildOrchestratorPlan(plan) + _buildStreamSteps(plan.steps, chainSteps, stepTexts, -1);
              _animateAllVisible(container);
            }
            break;
          }

          case 'chain_done': {
            finalData = evt;
            if (evt.retryToken) window._store.set('chainrun_retry_token', evt.retryToken);
            break;
          }

          case 'chain_error':
            throw new Error(evt.error || 'Chain failed');
        }
      }
    }

    // ── Chain complete — show results ──
    if (!finalData) throw new Error('Stream ended without result');

    const chain = finalData.chain || chainSteps;
    const finalOutput = finalData.result || '';
    const totalMs = finalData.totalMs || 0;
    const analysis = analyzeQuality(prompt, chain[0]?.output || '', finalOutput, chain);

    // Show final output
    await sleep(400);
    _renderFinalOutput(finalOutputEl, finalOutput, totalMs, chain, prompt);
    if (finalOutputEl) {
      finalOutputEl.classList.remove('hidden');
      finalOutputEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Quality check
    await sleep(500);
    renderQualityCheck(qualityEl, prompt, chain[0]?.output || '', finalOutput, totalMs, chain, isRetry);
    qualityEl.classList.remove('hidden');
    qualityEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // CTA
    await sleep(600);
    ctaEl.classList.remove('hidden');

    // Persist
    const runNumber = finalData.runNumber || (isRetry ? 2 : 1);
    window._store.set('chainrun_demo_used', String(runNumber));
    _persistDemoResult(prompt, chain, finalOutput, totalMs, false, analysis.improved);

    // Swap input area
    document.getElementById('demo-input-area').classList.add('hidden');
    const retryArea = document.getElementById('demo-retry-area');
    const usedArea = document.getElementById('demo-used-area');

    if (!analysis.improved && runNumber === 1 && !isRetry) {
      if (retryArea) {
        retryArea.classList.remove('hidden');
        const retryTextarea = document.getElementById('demo-retry-prompt');
        if (retryTextarea && analysis.betterPrompt) retryTextarea.value = analysis.betterPrompt.replace(/^"|"$/g, '');
      }
      if (usedArea) usedArea.classList.add('hidden');
    } else {
      if (retryArea) retryArea.classList.add('hidden');
      if (usedArea) usedArea.classList.remove('hidden');
      window._store.remove('chainrun_retry_token');
    }

  } catch (err) {
    console.error('[ChainRun Demo] Chain error:', err.message, err);
    const isLimit = err.message && (err.message.toLowerCase().includes('limit') || err.message.toLowerCase().includes('retry token'));
    if (isLimit) {
      container.innerHTML = `<div class="demo-error-card"><p>Demo limit reached. Each visitor gets one free chain (two if the first result wasn't great).</p><button class="lp-cta-primary" style="margin-top:16px" onclick="handlePurchase()">Get ChainRun — $19</button></div>`;
    } else {
      await runPreviewDemo(container, prompt, qualityEl, ctaEl);
    }
  }

  landingDemoRunning = false;
  const runBtn = document.getElementById('demo-run-btn');
  const retryBtn = document.getElementById('demo-retry-btn');
  if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run free chain`; }
  if (retryBtn) { retryBtn.disabled = false; retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run again — free`; }
}

// ── Orchestrator UI builders ──

function _buildOrchestratorThinking() {
  return `<div class="demo-orch demo-orch-thinking">
    <div class="demo-orch-icon"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="22" height="22"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="22" x2="15" y2="22"/></svg></div>
    <div class="demo-orch-body">
      <div class="demo-orch-title">Orchestrator</div>
      <div class="demo-orch-status">Analyzing your prompt<span class="demo-orch-dots"><span>.</span><span>.</span><span>.</span></span></div>
    </div>
  </div>`;
}

function _buildOrchestratorPlan(plan) {
  const stepsHtml = plan.steps.map((s, i) => {
    return `<div class="demo-orch-step">
      <span class="demo-orch-step-num">${i + 1}</span>
      <span class="demo-orch-step-model">${escapeHtml(s.model)}</span>
      <span class="demo-orch-step-role">${escapeHtml(s.role)}</span>
    </div>`;
  }).join('<span class="demo-orch-arrow">→</span>');

  return `<div class="demo-orch demo-orch-plan">
    <div class="demo-orch-icon done"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="22" height="22"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="22" x2="15" y2="22"/></svg></div>
    <div class="demo-orch-body">
      <div class="demo-orch-title">Orchestrator</div>
      <div class="demo-orch-reasoning">${escapeHtml(plan.reasoning)}</div>
      <div class="demo-orch-pipeline">${stepsHtml}</div>
    </div>
  </div>
  <div class="demo-connector"><div class="demo-connector-line visible"></div></div>`;
}

function _buildStreamSteps(planSteps, doneSteps, liveTexts, activeIndex) {
  let html = '';
  for (let i = 0; i < planSteps.length; i++) {
    const s = planSteps[i];
    const done = doneSteps[i];
    const isActive = i === activeIndex;
    const isPending = !done && !isActive;

    let statusIcon, extraClass;
    if (done) {
      statusIcon = '<svg class="demo-icon-done" viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="10" fill="rgba(76,175,80,0.15)"/><polyline points="6 10 9 13 14 7" fill="none" stroke="#4caf50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      extraClass = 'visible';
    } else if (isActive) {
      statusIcon = '<span class="demo-icon-running"><span class="demo-pulse-dot"></span></span>';
      extraClass = 'visible active-step';
    } else {
      statusIcon = '<svg class="demo-icon-pending" viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="8" fill="none" stroke="#333" stroke-width="1.5"/></svg>';
      extraClass = 'visible';
    }

    const timeStr = done?.ms ? formatDuration(done.ms) : '';

    html += `<div class="demo-step-card ${extraClass}" data-step="${i}">`;
    html += `<div class="demo-step-header">`;
    html += `<div class="demo-step-number">${i + 1}</div>`;
    html += `<div class="demo-step-meta"><div class="demo-step-model">${escapeHtml(s.model)}</div><div class="demo-step-role">${escapeHtml(s.role)}</div></div>`;
    if (timeStr) html += `<div class="demo-step-time">${timeStr}</div>`;
    html += `<div class="demo-step-status">${statusIcon}</div>`;
    html += `</div>`;

    if (isActive) {
      // Live streaming text area
      html += `<div class="demo-step-activity">`;
      html += `<div class="demo-step-progress"><div class="demo-step-progress-bar"></div></div>`;
      html += `<div class="demo-stream-text" id="demo-stream-${i}">${escapeHtml(liveTexts[i] || '')}</div>`;
      html += `</div>`;
    }

    if (done && done.output) {
      const escaped = escapeHtml(done.output).replace(/"/g, '&quot;');
      html += `<button class="demo-step-expand" onclick="toggleDemoOutput(${i}, this)" data-full="${escaped}">`;
      html += `<span class="demo-expand-label">See ${escapeHtml(s.model)} output</span>`;
      html += `<svg class="demo-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>`;
      html += `</button>`;
      html += `<div class="demo-step-output collapsed" id="demo-output-${i}">${escapeHtml(done.output)}</div>`;
      // Model strengths & limitations
      const insight = _getModelInsight(s.model);
      html += `<div class="demo-step-insights">`;
      html += `<div class="demo-step-insight"><div class="demo-step-insight-label strength">Strength</div><div class="demo-step-insight-text">${escapeHtml(insight.strength)}</div></div>`;
      html += `<div class="demo-step-insight"><div class="demo-step-insight-label limitation">Limitation</div><div class="demo-step-insight-text">${escapeHtml(insight.limitation)}</div></div>`;
      html += `</div>`;
    }

    html += `</div>`;

    if (i < planSteps.length - 1) {
      const connVisible = done ? 'visible' : (isActive ? '' : '');
      html += `<div class="demo-connector"><div class="demo-connector-line ${connVisible}"></div></div>`;
    }
  }
  return html;
}

function _animateOrchestratorReveal(container) {
  const orch = container.querySelector('.demo-orch-plan');
  if (orch) {
    orch.style.opacity = '0';
    orch.style.transform = 'translateY(12px)';
    requestAnimationFrame(() => {
      orch.style.transition = 'opacity 0.4s, transform 0.4s';
      orch.style.opacity = '1';
      orch.style.transform = 'translateY(0)';
    });
  }
}

function _animateAllVisible(container) {
  container.querySelectorAll('.demo-step-card').forEach(c => c.classList.add('visible'));
  container.querySelectorAll('.demo-connector-line').forEach(c => c.classList.add('visible'));
}

function _renderFinalOutput(el, output, totalMs, chain, originalPrompt) {
  if (!el) return;
  const modelNames = chain.map(s => s.model).join(' → ');
  const formatted = escapeHtml(output)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const promptHtml = originalPrompt
    ? `<div class="demo-original-prompt">
        <div class="demo-original-prompt-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Your prompt
        </div>
        <div class="demo-original-prompt-text">${escapeHtml(originalPrompt)}</div>
      </div>` : '';

  el.innerHTML = `
    ${promptHtml}
    <div class="demo-final-card">
      <div class="demo-final-header">
        <div class="demo-final-badge">Final output</div>
        <div class="demo-final-meta">${modelNames} · ${formatDuration(totalMs)}</div>
      </div>
      <div class="demo-final-body"><p>${formatted}</p></div>
    </div>
  `;
}

async function runPreviewDemo(container, prompt, qualityEl, ctaEl) {
  const shortPrompt = prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt;

  const simSteps = [
    {
      model: 'Sonar Deep Research',
      role: 'Deep Research',
      ms: 38000,
      output: `Deep web research on: "${shortPrompt}"\n\nFound 18 relevant sources including recent articles, expert analyses, and data from 2025–2026. Key findings cover multiple perspectives with specific numbers and citations. Multi-step research identified primary sources, cross-referenced claims, and surfaced conflicting viewpoints.`
    },
    {
      model: 'Gemini 3.1 Pro',
      role: 'Synthesize',
      ms: 9200,
      output: `Synthesized the deep research into a structured framework:\n\n1. Context & background with verified data\n2. Core analysis with supporting evidence\n3. Expert consensus & dissenting views\n4. Actionable insights ranked by impact\n\nApplied deep reasoning to identify patterns across sources and resolve contradictions.`
    },
    {
      model: 'Grok 4',
      role: 'Challenge',
      ms: 33000,
      output: `Critical analysis complete using always-on reasoning. Found 3 gaps:\n\n• Missing cost-benefit tradeoff analysis — added quantified comparison\n• One source contradicts the consensus — added nuance and context\n• Overlooked second-order effects — expanded implications section\n\nStrengthened weak arguments, added contrarian perspective the other models missed.`
    },
    {
      model: 'GPT-5.4',
      role: 'Refine',
      ms: 17800,
      output: `Final output polished. Removed redundancy, tightened the language, and ensured every claim is grounded in the research. The result directly answers: "${shortPrompt}" with clarity and authority.`
    }
  ];

  // Animate each step progressively
  for (let i = 0; i < simSteps.length; i++) {
    container.innerHTML = buildDemoStepsHTML('running', simSteps.slice(0, i), i);
    makeStepsVisible(container, i);
    _startLivePhrases(i);
    await sleep(1200 + Math.random() * 800);

    _stopLivePhrases();
    container.innerHTML = buildDemoStepsHTML('done', simSteps.slice(0, i + 1), i);
    makeStepsVisible(container, i + 1);

    await sleep(200);
    const newCard = container.querySelectorAll('.demo-step-card')[i];
    if (newCard) {
      newCard.classList.add('visible');
      newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (i < 3) {
      const connectors = container.querySelectorAll('.demo-connector-line');
      if (connectors[i]) {
        await sleep(200);
        connectors[i].classList.add('visible');
      }
    }
    await sleep(300);
  }

  // Show a note that this was a preview
  await sleep(400);
  qualityEl.innerHTML = `
    <div class="demo-quality-card">
      <div class="demo-quality-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span class="demo-quality-title">Preview mode</span>
      </div>
      <p class="demo-quality-text">This was a simulated preview. The live chain calls Sonar Deep Research, Gemini 3.1 Pro, Grok 4, and GPT-5.4 in real time — each building on the last. It takes about 90 seconds but produces an answer no single model could create alone.</p>
    </div>
  `;
  qualityEl.classList.remove('hidden');
  qualityEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  await sleep(600);
  ctaEl.classList.remove('hidden');

  // Mark demo as used + persist preview result
  window._store.set('chainrun_demo_used', '1');
  _persistDemoResult(prompt, simSteps, simSteps[simSteps.length - 1].output, simSteps.reduce((a, s) => a + s.ms, 0), true);
  document.getElementById('demo-input-area').classList.add('hidden');
  document.getElementById('demo-used-area').classList.remove('hidden');
}

// Status phrases shown while each model is working
const DEMO_RUNNING_PHRASES = [
  ['Searching the web…', 'Reading sources…', 'Pulling recent data…', 'Cross-referencing findings…'],
  ['Grouping themes…', 'Building structure…', 'Ordering by relevance…', 'Highlighting key points…'],
  ['Looking for gaps…', 'Testing assumptions…', 'Adding counterpoints…', 'Strengthening weak spots…'],
  ['Tightening language…', 'Removing redundancy…', 'Final polish…', 'Writing conclusion…'],
];

function buildDemoStepsHTML(phase, completedSteps, activeIndex) {
  let html = '';
  for (let i = 0; i < 4; i++) {
    const meta = DEMO_STEP_META[i];
    const step = completedSteps[i];
    const isDone = !!step;
    const isRunning = (phase === 'running' && i === activeIndex);
    const isPending = !isDone && !isRunning;

    // SVG status icons instead of emoji
    let statusIcon = '';
    let extraClass = '';
    if (isDone) {
      statusIcon = '<svg class="demo-icon-done" viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="10" fill="rgba(76,175,80,0.15)"/><polyline points="6 10 9 13 14 7" fill="none" stroke="#4caf50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      extraClass = 'visible';
    } else if (isRunning) {
      statusIcon = '<span class="demo-icon-running"><span class="demo-pulse-dot"></span></span>';
      extraClass = 'visible active-step';
    } else {
      statusIcon = '<svg class="demo-icon-pending" viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="8" fill="none" stroke="#333" stroke-width="1.5"/></svg>';
      extraClass = (i === 0 && phase === 'pending') ? 'visible' : '';
    }

    const timeStr = step?.ms ? formatDuration(step.ms) : '';

    html += `<div class="demo-step-card ${extraClass}">`;
    html += `<div class="demo-step-header">`;
    html += `<div class="demo-step-number">${i + 1}</div>`;
    html += `<div class="demo-step-meta"><div class="demo-step-model">${meta.model}</div><div class="demo-step-role">${meta.role}</div></div>`;
    if (timeStr) html += `<div class="demo-step-time">${timeStr}</div>`;
    html += `<div class="demo-step-status">${statusIcon}</div>`;
    html += `</div>`;

    if (isRunning) {
      // Live activity area: progress bar + cycling status text
      html += `<div class="demo-step-activity">`;
      html += `<div class="demo-step-progress"><div class="demo-step-progress-bar"></div></div>`;
      html += `<div class="demo-step-live" id="demo-live-${i}"></div>`;
      html += `</div>`;
    }

    if (isDone && step.output) {
      // Collapsed by default — one tap to see the full output
      const escaped = escapeHtml(step.output).replace(/"/g, '&quot;');
      html += `<button class="demo-step-expand" onclick="toggleDemoOutput(${i}, this)" data-full="${escaped}">`;
      html += `<span class="demo-expand-label">See ${meta.model} output</span>`;
      html += `<svg class="demo-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>`;
      html += `</button>`;
      html += `<div class="demo-step-output collapsed" id="demo-output-${i}">${escapeHtml(step.output)}</div>`;
      // Insights
      html += `<div class="demo-step-insights">`;
      html += `<div class="demo-step-insight"><div class="demo-step-insight-label strength">Strength</div><div class="demo-step-insight-text">${meta.strength}</div></div>`;
      html += `<div class="demo-step-insight"><div class="demo-step-insight-label limitation">Limitation</div><div class="demo-step-insight-text">${meta.limitation}</div></div>`;
      html += `</div>`;
    }

    html += `</div>`;

    // Connector between steps
    if (i < 3) {
      const connVisible = isDone ? 'visible' : '';
      html += `<div class="demo-connector"><div class="demo-connector-line ${connVisible}"></div></div>`;
    }
  }
  return html;
}

// Cycle through status phrases while a step is running
let _livePhraseTimer = null;
function _startLivePhrases(stepIndex) {
  clearInterval(_livePhraseTimer);
  const phrases = DEMO_RUNNING_PHRASES[stepIndex] || ['Working…'];
  let idx = 0;
  const el = document.getElementById('demo-live-' + stepIndex);
  if (!el) return;
  el.textContent = phrases[0];
  _livePhraseTimer = setInterval(function() {
    idx = (idx + 1) % phrases.length;
    el.style.opacity = '0';
    setTimeout(function() {
      el.textContent = phrases[idx];
      el.style.opacity = '1';
    }, 150);
  }, 1800);
}
function _stopLivePhrases() {
  clearInterval(_livePhraseTimer);
  _livePhraseTimer = null;
}

function makeStepsVisible(container, upToIndex) {
  const cards = container.querySelectorAll('.demo-step-card');
  cards.forEach((card, i) => {
    if (i <= upToIndex) card.classList.add('visible');
  });
}

function toggleDemoOutput(index, btn) {
  const el = document.getElementById(`demo-output-${index}`);
  if (!el) return;
  const isCollapsed = el.classList.contains('collapsed');
  if (isCollapsed) {
    // Expand
    el.classList.remove('collapsed');
    btn.classList.add('expanded');
    // Smooth scroll to show the output
    setTimeout(function() { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
  } else {
    // Collapse
    el.classList.add('collapsed');
    btn.classList.remove('expanded');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ────────────────────────────────────
// Persist & Restore Demo Result
// ────────────────────────────────────
function _persistDemoResult(prompt, chain, finalResult, totalMs, isPreview, improved) {
  try {
    var data = {
      prompt: prompt,
      chain: chain.map(function(s) {
        return { model: s.model, role: s.role, output: s.output, ms: s.ms };
      }),
      result: finalResult || '',
      totalMs: totalMs || 0,
      preview: !!isPreview,
      improved: !!improved,
      ts: Date.now(),
    };
    window._store.set('chainrun_demo_result', JSON.stringify(data));
  } catch(e) { /* storage full or other issue — non-critical */ }
}

function _restoreDemoResult() {
  var raw = window._store.get('chainrun_demo_result');
  if (!raw) return;

  try {
    var data = JSON.parse(raw);
    if (!data.chain || !data.chain.length) return;

    var resultsSection = document.getElementById('demo-results');
    var container = document.getElementById('demo-chain-steps');
    var qualityEl = document.getElementById('demo-quality');
    var ctaEl = document.getElementById('demo-cta');
    var finalOutputEl = document.getElementById('demo-final-output');
    if (!resultsSection || !container) return;

    // Show the results section
    resultsSection.classList.remove('hidden');

    // Render all steps as completed (static, no animation)
    container.innerHTML = buildDemoStepsHTML('done', data.chain, -1);
    // Make all cards visible immediately
    container.querySelectorAll('.demo-step-card').forEach(function(card) {
      card.classList.add('visible');
    });
    container.querySelectorAll('.demo-connector-line').forEach(function(line) {
      line.classList.add('visible');
    });

    // Show the final output prominently
    if (finalOutputEl && data.result) {
      _renderFinalOutput(finalOutputEl, data.result, data.totalMs, data.chain, data.prompt);
      finalOutputEl.classList.remove('hidden');
    }

    // Render quality check
    if (qualityEl) {
      if (data.preview) {
        qualityEl.innerHTML =
          '<div class="demo-quality-card">' +
            '<div class="demo-quality-header">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' +
              '<span class="demo-quality-title">Preview mode</span>' +
            '</div>' +
            '<p class="demo-quality-text">This was a simulated preview. The live chain calls Sonar Deep Research, Gemini 3.1 Pro, Grok 4, and GPT-5.4 in real time \u2014 each building on the last. Takes about 90 seconds.</p>' +
          '</div>';
      } else {
        var firstOutput = data.chain[0]?.output || '';
        var finalOutput = data.result || data.chain[data.chain.length - 1]?.output || '';
        renderQualityCheck(qualityEl, data.prompt, firstOutput, finalOutput, data.totalMs, data.chain);
      }
      qualityEl.classList.remove('hidden');
    }

    // Show CTA
    if (ctaEl) ctaEl.classList.remove('hidden');

  } catch(e) { /* corrupted data — ignore */ }
}

function resetDemo() {
  // Allow running the demo again (still rate-limited server-side)
  window._store.remove('chainrun_demo_used');
  window._store.remove('chainrun_demo_result');
  window._store.remove('chainrun_retry_token');
  const inputArea = document.getElementById('demo-input-area');
  const usedArea = document.getElementById('demo-used-area');
  const retryArea = document.getElementById('demo-retry-area');
  const finalOutputEl = document.getElementById('demo-final-output');
  const resultsSection = document.getElementById('demo-results');
  if (inputArea) inputArea.classList.remove('hidden');
  if (usedArea) usedArea.classList.add('hidden');
  if (retryArea) retryArea.classList.add('hidden');
  if (finalOutputEl) finalOutputEl.classList.add('hidden');
  if (resultsSection) resultsSection.classList.add('hidden');
  // Clear and focus textarea
  const textarea = document.getElementById('demo-prompt');
  if (textarea) { textarea.value = ''; textarea.focus(); }
  // Restore example prompts with fresh suggestions
  const examples = document.getElementById('example-prompts');
  if (examples) examples.classList.remove('used');
  renderExamplePrompts();
  // Scroll back to top
  const landing = document.getElementById('landing-scroll');
  if (landing) landing.scrollTo({ top: 0, behavior: 'smooth' });
}

// ────────────────────────────────────
// Landing Page: CryptoTraders Access
// ────────────────────────────────────
function handleCTAccess() {
  // Navigate to chainrun.tech?ct=1 to trigger the CT verification flow
  const url = new URL(window.location.href);
  url.searchParams.set('ct', '1');
  window.location.href = url.toString();
}

// ────────────────────────────────────
// Landing Page: Quality Check
// ────────────────────────────────────
function renderQualityCheck(container, originalPrompt, firstOutput, finalOutput, totalMs, chain, isRetry) {
  const analysis = analyzeQuality(originalPrompt, firstOutput, finalOutput, chain);

  const isImproved = analysis.improved;
  const iconClass = isImproved ? 'improved' : 'honest';
  const iconSvg = isImproved
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const title = isImproved ? 'Chain improved the output' : 'Honest assessment';
  const subtitle = isImproved ? 'The 4-model chain produced a meaningfully better result' : 'The chain didn\'t add much this time — here\'s why';

  let html = '';
  html += `<div class="demo-quality-header">`;
  html += `<div class="demo-quality-icon ${iconClass}">${iconSvg}</div>`;
  html += `<div><div class="demo-quality-title">${title}</div><div class="demo-quality-subtitle">${subtitle}</div></div>`;
  html += `</div>`;

  // Verdict
  html += `<div class="demo-quality-verdict"><p>${analysis.verdict}</p></div>`;

  // Scores
  html += `<div class="demo-quality-scores">`;
  html += `<div class="demo-quality-score"><div class="demo-quality-score-value">${analysis.depthScore}/10</div><div class="demo-quality-score-label">Depth</div></div>`;
  html += `<div class="demo-quality-score"><div class="demo-quality-score-value">${analysis.clarityScore}/10</div><div class="demo-quality-score-label">Clarity</div></div>`;
  html += `<div class="demo-quality-score"><div class="demo-quality-score-value">${analysis.originalityScore}/10</div><div class="demo-quality-score-label">Originality</div></div>`;
  html += `<div class="demo-quality-score"><div class="demo-quality-score-value">${formatDuration(totalMs)}</div><div class="demo-quality-score-label">Total time</div></div>`;
  html += `</div>`;

  // If not improved, show prompting lesson
  if (!isImproved) {
    html += `<div class="demo-lesson">`;
    html += `<div class="demo-lesson-title">`;
    html += `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
    html += `Prompting lesson`;
    html += `</div>`;
    html += `<div class="demo-lesson-body">${analysis.lesson}</div>`;
    html += `<div class="demo-lesson-tip"><strong>Try instead:</strong> ${analysis.betterPrompt}</div>`;
    html += `</div>`;
  }

  container.innerHTML = html;
}

function analyzeQuality(originalPrompt, firstOutput, finalOutput, chain) {
  // Heuristic quality analysis
  const promptLen = originalPrompt.length;
  const firstLen = firstOutput.length;
  const finalLen = finalOutput.length;

  // Length improvement ratio
  const lengthRatio = finalLen / Math.max(firstLen, 1);

  // Count structural markers in final output
  const finalStructure = (finalOutput.match(/\n#{1,3}\s|\n[-*]\s|\n\d+\.\s|\n\n/g) || []).length;
  const firstStructure = (firstOutput.match(/\n#{1,3}\s|\n[-*]\s|\n\d+\.\s|\n\n/g) || []).length;

  // Count unique words (vocabulary breadth)
  const getUniqueWords = (text) => new Set(text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []).size;
  const firstVocab = getUniqueWords(firstOutput);
  const finalVocab = getUniqueWords(finalOutput);
  const vocabRatio = finalVocab / Math.max(firstVocab, 1);

  // Prompt quality heuristics
  const isVaguePrompt = promptLen < 30 || /^(hi|hello|hey|test|help|what|how|why|tell me)/i.test(originalPrompt.trim());
  const hasContext = /because|for|about|regarding|specifically|in the context of/i.test(originalPrompt);
  const hasConstraints = /must|should|format|include|exclude|limit|max|min|exactly|at least/i.test(originalPrompt);

  // Determine if improved
  const structImproved = finalStructure > firstStructure + 2;
  const vocabImproved = vocabRatio > 1.15;
  const lengthImproved = lengthRatio > 1.3 && lengthRatio < 5; // More content but not just padding
  const improved = (structImproved || vocabImproved || lengthImproved) && finalLen > 200;

  // Score calculation
  let depthScore = Math.min(10, Math.round(3 + (finalLen / 500) + (finalVocab / 50)));
  let clarityScore = Math.min(10, Math.round(4 + finalStructure * 0.5 + (finalLen > 300 ? 2 : 0)));
  let originalityScore = Math.min(10, Math.round(3 + vocabRatio * 2 + (chain.length >= 4 ? 2 : 0)));

  depthScore = Math.max(3, Math.min(10, depthScore));
  clarityScore = Math.max(3, Math.min(10, clarityScore));
  originalityScore = Math.max(3, Math.min(10, originalityScore));

  let verdict, lesson, betterPrompt;

  if (improved) {
    verdict = `The chain added ${finalVocab - firstVocab > 0 ? `${finalVocab - firstVocab} unique concepts` : 'additional depth'}, `
            + `${structImproved ? 'improved structure, ' : ''}`
            + `and refined the output across ${chain.length} model passes. `
            + `Each model contributed a different perspective that a single model would miss.`;
  } else {
    if (isVaguePrompt) {
      verdict = 'Your prompt was too short or vague for the chain to add meaningful depth. '
              + 'When a prompt lacks specificity, all four models essentially paraphrase the same generic answer.';
      lesson = 'AI chains work best with specific, detailed prompts. A vague question gets a vague answer — '
             + 'four times over. The chain amplifies quality, but it can\'t create context that wasn\'t there.';
      betterPrompt = generateBetterPrompt(originalPrompt, 'vague');
    } else if (!hasContext) {
      verdict = 'The prompt had a clear question but lacked context about why you need the answer. '
              + 'Without context, models can\'t tailor their output to your actual use case.';
      lesson = 'Adding context (“I\'m a [role] working on [project]”) helps each model in the chain '
             + 'focus on what matters to you specifically, rather than giving a generic overview.';
      betterPrompt = generateBetterPrompt(originalPrompt, 'no-context');
    } else {
      verdict = 'The chain ran successfully, but the improvement over a single model was marginal. '
              + 'Some prompts are already specific enough that a single strong model handles them well.';
      lesson = 'Not every question benefits from a 4-model chain. Simple, well-defined questions with clear answers '
             + 'don\'t leave much room for iterative improvement. Chains shine on complex, multi-faceted topics.';
      betterPrompt = generateBetterPrompt(originalPrompt, 'already-good');
    }
  }

  return { improved, depthScore, clarityScore, originalityScore, verdict, lesson, betterPrompt };
}

function generateBetterPrompt(original, reason) {
  const trimmed = original.trim();
  switch (reason) {
    case 'vague':
      if (/^(what is|what are)/i.test(trimmed)) {
        return `"${trimmed} — explain for a [beginner/expert], include real-world examples, and compare the top 3 approaches"`;
      }
      return `"${trimmed.slice(0, 60)}${trimmed.length > 60 ? '…' : ''} — I need this for [specific use case]. Include pros/cons, examples, and actionable recommendations."`;
    case 'no-context':
      return `"I'm working on [your project]. ${trimmed.slice(0, 60)}${trimmed.length > 60 ? '…' : ''} — focus on [specific angle] and include practical examples."`;
    case 'already-good':
      return `Try a more open-ended, multi-faceted question like: "Compare the top 5 approaches to [topic], with pros/cons and which works best for [scenario]"`;
    default:
      return `Add more detail: who is this for, what format do you need, and what should be included or excluded.`;
  }
}

// ────────────────────────────────────
// Landing Page: Scroll Reveal & Sticky CTA
// ────────────────────────────────────
function initLandingInteractions() {
  const landing = document.getElementById('landing-scroll');
  if (!landing) return;

  // Scroll reveal via scroll event (more reliable than IntersectionObserver in scroll containers)
  const reveals = landing.querySelectorAll('.lp-reveal');
  const stickyCta = document.getElementById('sticky-cta');
  const hero = document.querySelector('.lp-hero');

  function checkScrollReveal() {
    const viewBottom = landing.scrollTop + landing.clientHeight;
    const threshold = landing.clientHeight * 0.85;

    reveals.forEach(el => {
      if (el.classList.contains('visible')) return;
      const elTop = el.offsetTop;
      if (landing.scrollTop + threshold > elTop) {
        el.classList.add('visible');
      }
    });

    // Sticky CTA: show after scrolling past hero
    if (stickyCta && hero) {
      const heroBottom = hero.offsetTop + hero.offsetHeight;
      if (landing.scrollTop > heroBottom - 100) {
        stickyCta.classList.add('visible');
      } else {
        stickyCta.classList.remove('visible');
      }
    }
  }

  landing.addEventListener('scroll', checkScrollReveal, { passive: true });
  // Initial check
  setTimeout(checkScrollReveal, 100);

  // Check if demo already used — restore result if available
  if (window._store.get('chainrun_demo_used')) {
    const inputArea = document.getElementById('demo-input-area');
    const usedArea = document.getElementById('demo-used-area');
    if (inputArea) inputArea.classList.add('hidden');
    if (usedArea) usedArea.classList.remove('hidden');
    _restoreDemoResult();
  }

  // Dynamic prompt suggestions
  renderExamplePrompts();
}

// ────────────────────────────────────
// Init
// ────────────────────────────────────
function initApp() {
  // Register service worker with update detection
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // Check for updates on load
      reg.update().catch(() => {});
      // When a new SW is waiting, prompt the user
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version ready — show update toast
            showUpdateBanner();
          }
        });
      });
    }).catch(() => {});
    // If a waiting SW is already there on page load
    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) showUpdateBanner();
    });
  }

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Wrap button
  document.getElementById('wrap-btn').addEventListener('click', handleWrap);
  document.getElementById('wrap-copy-btn').addEventListener('click', copyWrapped);

  // Auto button
  document.getElementById('auto-run-btn').addEventListener('click', handleRunChain);
  document.getElementById('auto-copy-btn').addEventListener('click', copyChainOutput);

  // Mode toggle + file upload
  initModeToggle();
  initFileUpload();

  // Fixes toggle
  document.getElementById('fixes-toggle-btn').addEventListener('click', toggleFixes);

  // Profile modal
  document.getElementById('profile-add-btn').addEventListener('click', addNewProfile);
  document.getElementById('profile-save-btn').addEventListener('click', saveProfile);
  document.getElementById('profile-cancel-btn').addEventListener('click', closeProfileModal);

  // Modal backdrop close
  document.getElementById('profile-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeProfileModal();
  });

  // Initial render
  renderProfiles();
  renderSettings();

  // Welcome overlay (first-launch premium moment)
  initWelcome();

  // CT in-app banner (gentle referral ask)
  _initCTBanner();

  // Landing page interactions (scroll reveal, sticky CTA, demo state)
  initLandingInteractions();

  // Set active tab
  switchTab('wrap');
}

// ────────────────────────────────────
// Settings: CryptoTraders Section
// ────────────────────────────────────
function _renderSettingsCT() {
  var section = document.getElementById('settings-referral');
  var content = document.getElementById('settings-ref-content');
  if (!section || !content) return;

  var code = PAYGATE_STATE.ctCode || window._store.get('chainrun_ct_code');
  if (!code) return;

  var referrals = PAYGATE_STATE.ctReferrals;
  var settled = PAYGATE_STATE.ctSettled;
  var link = 'https://chainrun.tech?ref=' + code;

  section.style.display = '';
  content.innerHTML =
    '<div class="ref-settings-card ct-settings-card">' +
      '<div class="ct-settings-badge">CryptoTraders Community</div>' +
      (settled
        ? '<p class="ref-settings-desc ct-settled">You\'re locked in. 2 friends joined through you — your access is permanent. Thanks for sharing.</p>'
        : '<p class="ref-settings-desc">You\'re in for free. Share your link with friends — if 2 grab it, yours is locked in forever. No pressure.</p>'
      ) +
      '<div class="ref-settings-code-row">' +
        '<code class="ref-settings-code">' + code + '</code>' +
        '<button class="ref-settings-share" onclick="_shareCtFromSettings()">' +
          (navigator.share ? 'Share' : 'Copy link') +
        '</button>' +
      '</div>' +
      '<div class="ref-settings-stats">' +
        '<div class="ref-stat">' +
          '<span class="ref-stat-num">' + referrals + ' / 2</span>' +
          '<span class="ref-stat-label">referrals</span>' +
        '</div>' +
        '<div class="ref-stat">' +
          '<span class="ref-stat-num">' + (settled ? '\u2713' : '\u2014') + '</span>' +
          '<span class="ref-stat-label">' + (settled ? 'settled' : 'in progress') + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function _shareCtFromSettings() {
  var code = PAYGATE_STATE.ctCode || window._store.get('chainrun_ct_code');
  if (!code) return;
  var link = 'https://chainrun.tech?ref=' + code;
  if (navigator.share) {
    navigator.share({ title: 'ChainRun', text: 'Get $5 off ChainRun — 4 AI models, one prompt, better answers.', url: link });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() {
      showToast('Link copied');
    });
  }
}

// ────────────────────────────────────
// Settings: Referral Section
// ────────────────────────────────────
function _renderSettingsReferral() {
  var section = document.getElementById('settings-referral');
  var content = document.getElementById('settings-ref-content');
  if (!section || !content) return;

  var code = window._store.get('chainrun_my_ref_code');
  if (!code) {
    // Try to create one if user is paid
    var receipt = window._store.get('chainrun_receipt');
    if (receipt) {
      _createMyReferralCode();
    }
    return; // Will render when code comes back
  }

  section.style.display = '';
  var conversions = parseInt(window._store.get('chainrun_ref_conversions') || '0', 10);
  var v2Discount = Math.min(50 + conversions * 5, 100);
  var link = 'https://chainrun.tech?ref=' + code;

  content.innerHTML =
    '<div class="ref-settings-card">' +
      '<p class="ref-settings-desc">Share your link. Friends get $5 off, you get +5% V2 discount per referral.</p>' +
      '<div class="ref-settings-code-row">' +
        '<code class="ref-settings-code">' + code + '</code>' +
        '<button class="ref-settings-share" onclick="_shareRefFromSettings()">' +
          (navigator.share ? 'Share' : 'Copy link') +
        '</button>' +
      '</div>' +
      '<div class="ref-settings-stats">' +
        '<div class="ref-stat">' +
          '<span class="ref-stat-num">' + conversions + '</span>' +
          '<span class="ref-stat-label">referral' + (conversions !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div class="ref-stat">' +
          '<span class="ref-stat-num">' + v2Discount + '%</span>' +
          '<span class="ref-stat-label">V2 discount</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function _shareRefFromSettings() {
  var code = window._store.get('chainrun_my_ref_code');
  if (!code) return;
  var link = 'https://chainrun.tech?ref=' + code;
  if (navigator.share) {
    navigator.share({ title: 'ChainRun', text: 'Get $5 off ChainRun \u2014 4 AI models, one prompt, better answers.', url: link });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() {
      showToast('Link copied');
    });
  }
}

// ────────────────────────────────────
// CryptoTraders In-App Banner
// ────────────────────────────────────
function _initCTBanner() {
  if (!PAYGATE_STATE.isCT) return;
  if (PAYGATE_STATE.ctSettled) return; // already done, no need
  if (window._store.get('chainrun_ct_banner_dismissed') === '1') return;

  var code = PAYGATE_STATE.ctCode || window._store.get('chainrun_ct_code');
  var referrals = PAYGATE_STATE.ctReferrals;
  if (!code) return;

  var banner = document.createElement('div');
  banner.id = 'ct-banner';
  banner.className = 'ct-banner';
  banner.innerHTML =
    '<div class="ct-banner-inner">' +
      '<div class="ct-banner-text">' +
        '<span class="ct-banner-label">CryptoTraders</span>' +
        '<span class="ct-banner-msg">Share with 2 friends to lock in your free access</span>' +
        '<span class="ct-banner-progress">' + referrals + ' / 2</span>' +
      '</div>' +
      '<div class="ct-banner-actions">' +
        '<button class="ct-banner-share" onclick="_shareFromCTBanner()">Share</button>' +
        '<button class="ct-banner-close" onclick="_dismissCTBanner()">&times;</button>' +
      '</div>' +
    '</div>';

  // Insert at top of app-main, after header
  var appMain = document.getElementById('app-main');
  if (appMain) {
    var header = appMain.querySelector('.app-header');
    if (header && header.nextSibling) {
      appMain.insertBefore(banner, header.nextSibling);
    } else {
      appMain.appendChild(banner);
    }
  }
}

function _shareFromCTBanner() {
  var code = PAYGATE_STATE.ctCode || window._store.get('chainrun_ct_code');
  if (!code) return;
  var link = 'https://chainrun.tech?ref=' + code;
  if (navigator.share) {
    navigator.share({ title: 'ChainRun', text: 'Get $5 off ChainRun \u2014 4 AI models, one prompt, better answers.', url: link });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() {
      showToast('Link copied');
    });
  }
}

function _dismissCTBanner() {
  window._store.set('chainrun_ct_banner_dismissed', '1');
  var banner = document.getElementById('ct-banner');
  if (banner) {
    banner.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-8px)';
    setTimeout(function() { banner.remove(); }, 250);
  }
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
