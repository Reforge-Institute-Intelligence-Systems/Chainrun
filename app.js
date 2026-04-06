/* ═══════════════════════════════════════
   ChainRun App — UI Logic & State
   ═══════════════════════════════════════ */
var CR_APP_VERSION = 93;

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
let currentTab = 'auto';

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
  if (tabId === 'leaderboard') renderLeaderboard();
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
// Auto Tab (Chain Execution)
// ────────────────────────────────────
let chainRunning = false;
let autoMode = 'auto'; // 'fast' | 'auto' | 'quality'
let autoAttachments = []; // [{ type, base64, mimeType, name }]

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

// File upload handler (multiple files)
function initFileUpload() {
  var input = document.getElementById('auto-file-input');
  if (!input) return;
  input.addEventListener('change', function(e) {
    var files = Array.from(e.target.files);
    if (!files.length) return;

    // Max 10 files, 10MB each
    var totalSize = 0;
    for (var i = 0; i < files.length; i++) {
      if (files[i].size > 10 * 1024 * 1024) {
        showToast(files[i].name + ' too large (max 10MB)');
        continue;
      }
      totalSize += files[i].size;
    }
    if (autoAttachments.length + files.length > 10) {
      showToast('Max 10 files');
      return;
    }

    files.forEach(function(file) {
      if (file.size > 10 * 1024 * 1024) return;
      var reader = new FileReader();
      reader.onload = function() {
        var base64 = reader.result.split(',')[1];
        var isImage = file.type.startsWith('image/');
        autoAttachments.push({
          type: isImage ? 'image' : 'document',
          base64: base64,
          mimeType: file.type,
          name: file.name
        });
        _renderFilePreview();
      };
      reader.readAsDataURL(file);
    });
    // Reset input so same file can be added again
    input.value = '';
  });
}

function _renderFilePreview() {
  var preview = document.getElementById('auto-file-preview');
  if (!preview) return;
  if (autoAttachments.length === 0) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
    document.getElementById('auto-file-btn').classList.remove('has-file');
    return;
  }
  preview.classList.remove('hidden');
  document.getElementById('auto-file-btn').classList.add('has-file');
  var html = '';
  autoAttachments.forEach(function(att, i) {
    var icon = att.type === 'image'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    html += '<div class="file-chip" data-idx="' + i + '">'
      + icon
      + '<span class="file-chip-name">' + escapeHtml(att.name) + '</span>'
      + '<button class="file-chip-remove" onclick="removeAutoFileAt(' + i + ')" title="Remove">&times;</button>'
      + '</div>';
  });
  preview.innerHTML = html;
}

function removeAutoFileAt(idx) {
  autoAttachments.splice(idx, 1);
  _renderFilePreview();
}

function removeAutoFile() {
  autoAttachments = [];
  document.getElementById('auto-file-input').value = '';
  _renderFilePreview();
}

async function handleRunChain() {
  if (chainRunning) return;

  const prompt = document.getElementById('auto-input').value.trim();
  if (!prompt) return;

  const missingBanner = document.getElementById('auto-missing-keys');

  // Check credits — fetch fresh balance from server
  var creditBalance = parseInt(window._store.get('chainrun_credit_balance') || '0', 10);
  try {
    var freshBal = await fetchCreditBalance();
    if (typeof freshBal === 'number') {
      creditBalance = freshBal;
      window._store.set('chainrun_credit_balance', String(freshBal));
    }
  } catch(e) {} // if fetch fails, use cached

  // Gate users always have server-side credits
  var hasGateReceipt = false;
  try {
    var receipt = JSON.parse(window._store.get('chainrun_receipt') || '{}');
    hasGateReceipt = !!(receipt.sid && receipt.sid.startsWith('gate_CR-'));
  } catch(e) {}

  if (creditBalance < 1 && !hasGateReceipt) {
    missingBanner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>No credits remaining. <button class="inline-link" onclick="showCreditStore()">Get credits</button></div>
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
  progressArea.classList.remove('hidden');
  progressArea.innerHTML = '';
  finalArea.classList.add('hidden');
  totalArea.classList.add('hidden');

  // Auto-scroll to the progress area so user sees the chain
  setTimeout(function() {
    progressArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);

  try {
    var bhCheck = document.getElementById('battle-hardened-check');
    var prevResult = _previousChainResult;
    _previousChainResult = null;
    await runCreditChain(prompt, progressArea, finalArea, totalArea, getChaosScenario(), bhCheck && bhCheck.checked, prevResult);
  } catch (e) {
    const msg = e.message || 'Unknown error';
    if (msg.includes('No credits')) {
      missingBanner.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>${escapeHtml(msg)} <button class="inline-link" onclick="showCreditStore()">Get credits</button></div>
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

var _lastRawOutput = ''; // Store raw markdown for copy/download

function renderChainFinal(output, totalDuration) {
  _lastRawOutput = output || '';
  const finalArea = document.getElementById('auto-output-section');
  const totalArea = document.getElementById('auto-total');

  // Show the original prompt above the result
  var promptInput = document.getElementById('auto-input');
  var promptLabel = document.getElementById('auto-output-prompt');
  var promptRow = document.getElementById('auto-output-prompt-row');
  if (promptLabel && promptInput && promptInput.value) {
    promptLabel.textContent = promptInput.value;
    if (promptRow) promptRow.classList.remove('hidden');
  }

  // Format the output with basic markdown rendering
  var formatted = escapeHtml(output)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n(#{1,3})\s+(.+)/g, function(m, hashes, text) {
      var level = hashes.length + 1;
      return '</p><h' + level + ' class="output-heading">' + text + '</h' + level + '><p>';
    })
    .replace(/\n- /g, '</p><li>')
    .replace(/\n\d+\.\s/g, '</p><li>')
    .replace(/\n/g, '<br>');
  formatted = '<p>' + formatted + '</p>';
  formatted = formatted.replace(/<p><\/p>/g, '').replace(/<p><br>/g, '<p>');

  document.getElementById('auto-output').innerHTML = formatted;
  document.getElementById('auto-total-time').textContent = formatDuration(totalDuration);

  if (finalArea) finalArea.classList.remove('hidden');
  if (totalArea) totalArea.classList.remove('hidden');

  // Auto-scroll to the result — scroll the total time bar into view first, then the output
  if (totalArea) {
    setTimeout(function() {
      totalArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }
  // Then scroll down more to show the actual output
  if (finalArea) {
    setTimeout(function() {
      finalArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 800);
  }
}

function copyChainOutput() {
  copyToClipboard(_lastRawOutput || document.getElementById('auto-output').textContent);
}

function downloadChainOutput() {
  var text = _lastRawOutput || document.getElementById('auto-output').textContent;
  if (!text) return;
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'chainrun-result-' + new Date().toISOString().slice(0, 10) + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded');
}

var _previousChainResult = null; // Stores last result for continuation runs

function runAgain() {
  // Store the previous result for continuation
  _previousChainResult = _lastRawOutput || null;
  // Scroll to prompt input and focus it
  var promptInput = document.getElementById('auto-input');
  if (promptInput) {
    promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    promptInput.focus();
    // Show continuation hint
    promptInput.placeholder = _previousChainResult
      ? 'Continue the chain — your previous result will be fed as context...'
      : 'Enter a prompt to run through a multi-LLM chain\u2026';
  }
  // Hide result sections so it's fresh for the next run
  var outputSection = document.getElementById('auto-output-section');
  var totalSection = document.getElementById('auto-total');
  var promptRow = document.getElementById('auto-output-prompt-row');
  if (outputSection) outputSection.classList.add('hidden');
  if (totalSection) totalSection.classList.add('hidden');
  if (promptRow) promptRow.classList.add('hidden');
  showToast(_previousChainResult ? 'Previous result loaded as context' : 'Ready for new run');
}

// ────────────────────────────────────
// Chaos Mode (Black Swan Stress Test)
// ────────────────────────────────────
var _chaosActive = false;
var CHAOS_SCENARIOS = {
  'LIQUIDITY_CRUNCH': 'A top-3 global exchange suspends all BTC withdrawals due to regulatory review. Institutional spot absorption capacity is under stress.',
  'ORACLE_FRACTURE': 'CME futures and Spot prices diverge by >15% due to a high-frequency trading glitch. Data conflict destabilizes pricing models.',
  'FED_PIVOT_REVERSAL': 'Emergency 50bps rate hike announced to combat a sudden spike in 2026 inflation. All risk-on assets under macro pressure.',
};

function toggleChaosMode() {
  _chaosActive = !_chaosActive;
  var toggle = document.getElementById('chaos-toggle');
  var select = document.getElementById('chaos-select');
  var label = document.getElementById('chaos-label');
  var runBtn = document.getElementById('auto-run-btn');
  var bhRow = document.getElementById('battle-hardened-row');
  if (_chaosActive) {
    toggle.classList.add('active');
    select.classList.remove('hidden');
    bhRow.classList.remove('hidden');
    label.textContent = 'CHAOS MODE ON';
    updateRunBtnLabel();
  } else {
    toggle.classList.remove('active');
    select.classList.add('hidden');
    bhRow.classList.add('hidden');
    document.getElementById('chaos-custom-input').classList.add('hidden');
    document.getElementById('battle-hardened-check').checked = false;
    label.textContent = 'CHAOS MODE';
    updateRunBtnLabel();
  }
}

function updateBattleHardened() {
  updateRunBtnLabel();
}

function updateRunBtnLabel() {
  var runBtn = document.getElementById('auto-run-btn');
  var bh = document.getElementById('battle-hardened-check');
  var isBH = bh && bh.checked;
  if (_chaosActive && isBH) {
    runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Battle-Hardened Briefing <span class="chaos-cost-tag">2 credits</span>';
  } else if (_chaosActive) {
    runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Chain + Stress Test';
  } else {
    runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Chain';
  }
}

function getChaosScenario() {
  if (!_chaosActive) return null;
  var sel = document.getElementById('chaos-select').value;
  if (!sel) return null;
  if (sel === 'custom') return document.getElementById('chaos-custom-input').value.trim() || null;
  return CHAOS_SCENARIOS[sel] || null;
}

// Show/hide custom input on select change
document.addEventListener('DOMContentLoaded', function() {
  var sel = document.getElementById('chaos-select');
  if (sel) sel.addEventListener('change', function() {
    var custom = document.getElementById('chaos-custom-input');
    if (this.value === 'custom') { custom.classList.remove('hidden'); custom.focus(); }
    else custom.classList.add('hidden');
  });
});

// ────────────────────────────────────
// Archive (user run history)
// ────────────────────────────────────
var _archiveOpen = false;

function toggleArchive() {
  var panel = document.getElementById('archive-panel');
  _archiveOpen = !_archiveOpen;
  if (_archiveOpen) {
    panel.classList.remove('hidden');
    loadArchive();
  } else {
    panel.classList.add('hidden');
  }
}

async function loadArchive() {
  var uid = getCreditUID();
  var list = document.getElementById('archive-list');
  if (!uid) {
    list.innerHTML = '<div class="archive-empty">Log in to see your archive.</div>';
    return;
  }
  list.innerHTML = '<div class="archive-loading">Loading...</div>';
  try {
    var res = await fetch(DEMO_PROXY_URL + '/archive?uid=' + encodeURIComponent(uid));
    var data = await res.json();
    if (!data.archive || data.archive.length === 0) {
      list.innerHTML = '<div class="archive-empty">No runs yet. Results will appear here after your first chain.</div>';
      updateArchiveCount(0);
      return;
    }
    updateArchiveCount(data.archive.length);
    var html = '';
    data.archive.forEach(function(entry) {
      var date = new Date(entry.ts);
      var dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      var models = (entry.chain || []).map(function(s) { return s.model; }).join(' \u2192 ');
      var duration = entry.totalMs ? (entry.totalMs / 1000).toFixed(1) + 's' : '';
      var promptPreview = (entry.prompt || '').slice(0, 100) + (entry.prompt && entry.prompt.length > 100 ? '...' : '');
      var resultPreview = (entry.result || '').slice(0, 150) + (entry.result && entry.result.length > 150 ? '...' : '');
      var gaspBadge = entry.gasp && entry.gasp.compliant ? '<span class="archive-gasp-ok">GASP \u2713</span>' : entry.gasp ? '<span class="archive-gasp-warn">GASP \u2717</span>' : '';

      html += '<div class="archive-entry" data-id="' + entry.id + '">';
      html += '<div class="archive-entry-header">';
      html += '<span class="archive-date">' + dateStr + '</span>';
      html += '<span class="archive-duration">' + duration + '</span>';
      html += gaspBadge;
      html += '</div>';
      html += '<div class="archive-prompt">' + escapeHtml(promptPreview) + '</div>';
      html += '<div class="archive-models">' + escapeHtml(models) + '</div>';
      html += '<div class="archive-result-preview">' + escapeHtml(resultPreview) + '</div>';
      html += '<div class="archive-entry-actions">';
      html += '<button class="archive-action-btn" onclick="archiveLoadResult(this)" data-result="' + btoa(unescape(encodeURIComponent(entry.result || ''))) + '" data-prompt="' + btoa(unescape(encodeURIComponent(entry.prompt || ''))) + '">Load</button>';
      html += '<button class="archive-action-btn archive-delete-btn" onclick="archiveDelete(\'' + entry.id + '\')">';
      html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
      html += '</div>';
    });
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = '<div class="archive-empty">Failed to load archive.</div>';
  }
}

function updateArchiveCount(count) {
  var label = document.getElementById('archive-count-label');
  if (label) label.textContent = count > 0 ? 'Archive (' + count + ')' : 'Archive';
}

function archiveLoadResult(btn) {
  try {
    var result = decodeURIComponent(escape(atob(btn.dataset.result)));
    var prompt = decodeURIComponent(escape(atob(btn.dataset.prompt)));
    // Put the prompt back in the input
    var input = document.getElementById('auto-input');
    if (input && prompt) input.value = prompt;
    // Render the result
    renderChainFinal(result, 0);
    // Close archive
    toggleArchive();
    showToast('Loaded from archive');
  } catch(e) {
    showToast('Failed to load entry');
  }
}

async function archiveDelete(id) {
  var uid = getCreditUID();
  if (!uid) return;
  try {
    await fetch(DEMO_PROXY_URL + '/archive?uid=' + encodeURIComponent(uid) + '&id=' + encodeURIComponent(id), { method: 'DELETE' });
    // Remove from DOM
    var el = document.querySelector('.archive-entry[data-id="' + id + '"]');
    if (el) el.remove();
    // Update count
    var remaining = document.querySelectorAll('.archive-entry').length;
    updateArchiveCount(remaining);
    if (remaining === 0) {
      document.getElementById('archive-list').innerHTML = '<div class="archive-empty">No runs yet.</div>';
    }
  } catch(e) {}
}

// Load archive count on boot
(function() {
  setTimeout(function() {
    var uid = typeof getCreditUID === 'function' ? getCreditUID() : null;
    if (!uid) return;
    fetch(DEMO_PROXY_URL + '/archive?uid=' + encodeURIComponent(uid))
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.count) updateArchiveCount(d.count); })
      .catch(function() {});
  }, 2000);
})();

// ────────────────────────────────────
// Credit Chain (pay-per-prompt)
// ────────────────────────────────────
async function runCreditChain(prompt, progressArea, finalArea, totalArea, chaosScenario, battleHardened, previousResult) {
  const uid = getCreditUID();
  const payload = { prompt: prompt.slice(0, 2000), uid };
  if (chaosScenario) payload.chaos_scenario = chaosScenario;
  if (battleHardened) payload.battle_hardened = true;
  if (previousResult) payload.previous_result = previousResult.slice(0, 4000);
  // Pass gate code for one-time credit grant
  try {
    var receipt = JSON.parse(window._store.get('chainrun_receipt') || '{}');
    if (receipt.sid && receipt.sid.startsWith('gate_CR-')) {
      payload.gate_code = receipt.sid.replace('gate_', '');
    }
  } catch(e) {}

  const res = await fetch(DEMO_PROXY_URL + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Non-streaming error
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    const data = await res.json();
    if (data.balance === 0) {
      showCreditStore();
      throw new Error('No credits remaining');
    }
    throw new Error(data.error || 'Credit chain failed');
  }

  // Reuse shared SSE processor
  return _processChainSSE(res, progressArea, finalArea, totalArea);
}

async function _processChainSSE(res, progressArea, finalArea, totalArea) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let plan = null;
  const chainSteps = [];
  const stepTexts = {};
  let finalData = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6).trim()); } catch { continue; }

      switch (evt.type) {
        case 'credits':
          // Update local balance
          window._store.set('chainrun_credit_balance', String(evt.balance));
          _updateCreditBadge(evt.balance);
          break;
        case 'low_credits': {
          var fuelEl = document.createElement('div');
          fuelEl.className = 'chain-low-fuel';
          fuelEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="14" height="14"><path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="#fbbf24"/></svg> ' + escapeHtml(evt.message);
          progressArea.insertBefore(fuelEl, progressArea.firstChild);
          break;
        }
        case 'orchestrator_thinking':
          progressArea.innerHTML = '<div class="chain-step running"><div class="step-spinner"></div><span>Orchestrator thinking...</span></div>';
          break;
        case 'orchestrator':
          plan = evt.plan;
          progressArea.innerHTML = '<div class="chain-orch-plan"><span class="chain-orch-label">ORCHESTRATOR</span><span class="chain-orch-reasoning">' + escapeHtml(plan.reasoning) + '</span></div>';
          plan.steps.forEach(function(s, i) {
            var phaseClass = s.phase ? ' step-phase-' + s.phase : '';
            var phaseTag = s.phase ? '<span class="step-phase' + phaseClass + '">' + s.phase + '</span>' : '';
            progressArea.innerHTML += '<div class="chain-step pending" data-step="' + i + '"><span class="step-model">' + escapeHtml(s.model) + '</span><span class="step-role">' + escapeHtml(s.role) + '</span>' + phaseTag + '</div>';
          });
          break;
        case 'step_start': {
          const phaseLabel = evt.phase ? ' <span class="step-phase step-phase-' + evt.phase + '">' + evt.phase + '</span>' : '';
          stepTexts[evt.index] = '';
          // For retry steps, append a new card
          if (evt.phase === 'logic_retry') {
            var retryCard = document.createElement('div');
            retryCard.className = 'chain-step running retry-step';
            retryCard.dataset.step = 'retry-' + evt.index;
            retryCard.innerHTML = '<span class="step-model">' + escapeHtml(evt.model) + '</span><span class="step-role">' + escapeHtml(evt.role) + '</span>' + phaseLabel + '<div class="step-stream" id="credit-stream-retry-' + evt.index + '"></div>';
            progressArea.appendChild(retryCard);
            retryCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } else {
            var stepCard = progressArea.querySelector('[data-step="' + evt.index + '"]');
            if (stepCard) {
              stepCard.className = 'chain-step running';
              stepCard.innerHTML += phaseLabel + '<div class="step-stream" id="credit-stream-' + evt.index + '"></div>';
              stepCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }
          break;
        }
        case 'step_chunk': {
          stepTexts[evt.index] = (stepTexts[evt.index] || '') + evt.text;
          var streamEl = document.getElementById('credit-stream-retry-' + evt.index) || document.getElementById('credit-stream-' + evt.index);
          if (streamEl) {
            streamEl.textContent = stepTexts[evt.index];
            streamEl.scrollTop = streamEl.scrollHeight;
            // Auto-scroll the step into view while streaming
            var parentCard = streamEl.closest('.chain-step');
            if (parentCard) parentCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          break;
        }
        case 'step_done': {
          const phaseTag = evt.phase ? ' <span class="step-phase step-phase-' + evt.phase + '">' + evt.phase + '</span>' : '';
          chainSteps[evt.index] = { model: evt.model, role: evt.role, output: evt.output, ms: evt.ms, phase: evt.phase };
          // Build a truncated preview of the output
          var preview = (evt.output || '').replace(/---MANIFEST---[\s\S]*---END_MANIFEST---/g, '').replace(/---CONFIDENCE:[\s\S]*?---/g, '').trim();
          var previewTruncated = preview.length > 200 ? preview.slice(0, 200) + '...' : preview;
          var previewHTML = '<div class="step-preview" onclick="this.classList.toggle(\'expanded\')">' + escapeHtml(previewTruncated) + '</div>';
          var fullHTML = '<div class="step-full-output hidden">' + escapeHtml(preview) + '</div>';

          if (evt.phase === 'logic_retry') {
            var retryDoneCard = progressArea.querySelector('[data-step="retry-' + evt.index + '"]');
            if (retryDoneCard) {
              retryDoneCard.className = 'chain-step done retry-step';
              var retryStream = retryDoneCard.querySelector('.step-stream');
              if (retryStream) retryStream.remove();
              retryDoneCard.innerHTML = '<div class="step-header"><span class="step-model">' + escapeHtml(evt.model) + '</span><span class="step-role">' + escapeHtml(evt.role) + '</span>' + phaseTag + '<span class="step-time">' + (evt.ms / 1000).toFixed(1) + 's</span></div>' + previewHTML + fullHTML;
            }
          } else {
            var doneCard = progressArea.querySelector('[data-step="' + evt.index + '"]');
            if (doneCard) {
              doneCard.className = 'chain-step done';
              var streamDiv = doneCard.querySelector('.step-stream');
              if (streamDiv) streamDiv.remove();
              doneCard.innerHTML = '<div class="step-header"><span class="step-model">' + escapeHtml(evt.model) + '</span><span class="step-role">' + escapeHtml(evt.role) + '</span>' + phaseTag + '<span class="step-time">' + (evt.ms / 1000).toFixed(1) + 's</span></div>' + previewHTML + fullHTML;
            }
          }
          break;
        }
        case 'critic_verdict': {
          var criticCard = progressArea.querySelector('[data-step="' + evt.index + '"]');
          if (criticCard) {
            var badge = document.createElement('span');
            badge.className = 'critic-verdict critic-verdict-' + evt.verdict;
            badge.textContent = evt.verdict === 'pass' ? 'PASS' : 'FAIL';
            criticCard.appendChild(badge);
          }
          break;
        }
        case 'loop_retry': {
          var retryBanner = document.createElement('div');
          retryBanner.className = 'chain-retry-banner';
          retryBanner.innerHTML = '<span class="retry-icon">↻</span> ' + escapeHtml(evt.reason);
          progressArea.appendChild(retryBanner);
          retryBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          break;
        }
        case 'phase_status': {
          var phaseStatusEl = document.createElement('div');
          phaseStatusEl.className = 'chain-phase-status chain-phase-' + (evt.phase || 'logic');
          phaseStatusEl.innerHTML = '<span class="phase-status-label">[' + escapeHtml(evt.label) + ']</span> <span class="phase-status-detail">' + escapeHtml(evt.detail) + '</span>';
          progressArea.appendChild(phaseStatusEl);
          phaseStatusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          break;
        }
        case 'cap_hit': {
          // Cost cap reached — show Honest Choice UI
          var capEl = document.createElement('div');
          capEl.className = 'chain-cap-hit';
          capEl.innerHTML = '<div class="cap-hit-header"><svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="18" height="18"><path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="#fbbf24"/></svg><span>Cost Cap Reached</span></div>'
            + '<p class="cap-hit-text">' + escapeHtml(evt.reason) + '</p>'
            + '<p class="cap-hit-note">The chain will finalize with the current output. You can run again with a higher cap to allow retries.</p>';
          progressArea.appendChild(capEl);
          capEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          break;
        }
        case 'chaos_robustness': {
          var robEl = document.createElement('div');
          robEl.className = 'chaos-robustness-card';
          var verdict = evt.robustness_score > 0.8 ? 'ROBUST' : evt.robustness_score > 0.5 ? 'SENSITIVE' : 'FRAGILE';
          var verdictClass = evt.robustness_score > 0.8 ? 'robust' : evt.robustness_score > 0.5 ? 'sensitive' : 'fragile';
          robEl.innerHTML = '<div class="chaos-rob-header"><span class="chaos-rob-icon">\uD83D\uDD25</span><span class="chaos-rob-title">CHAOS MODE RESULT</span></div>'
            + '<div class="chaos-rob-scenario"><span class="chaos-rob-scenario-label">SCENARIO:</span> ' + escapeHtml(evt.scenario || '') + '</div>'
            + '<div class="chaos-rob-scores">'
            + '<div class="chaos-rob-score"><span class="chaos-rob-metric-label">Pre-chaos</span><span class="chaos-rob-metric-val">' + (evt.pre_score || 0).toFixed(2) + '</span></div>'
            + '<div class="chaos-rob-score"><span class="chaos-rob-metric-label">Post-chaos</span><span class="chaos-rob-metric-val">' + (evt.post_score || 0).toFixed(2) + '</span></div>'
            + '<div class="chaos-rob-score"><span class="chaos-rob-metric-label">Robustness</span><span class="chaos-rob-metric-val ' + verdictClass + '">' + (evt.robustness_score || 0).toFixed(2) + '</span></div>'
            + '</div>'
            + '<div class="chaos-rob-verdict ' + verdictClass + '">' + verdict + '</div>'
            + (evt.revised_floor ? '<div class="chaos-rob-floor">Revised floor: ' + escapeHtml(evt.revised_floor) + '</div>' : '');
          progressArea.appendChild(robEl);
          robEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          break;
        }
        case 'chain_done':
          finalData = evt;
          if (evt.balance !== undefined) {
            window._store.set('chainrun_credit_balance', String(evt.balance));
            _updateCreditBadge(evt.balance);
          }
          // Save result locally for recovery
          try {
            window._store.set('chainrun_last_result', JSON.stringify({
              result: evt.result,
              totalMs: evt.totalMs,
              ts: Date.now(),
            }));
          } catch(e) {}
          break;
        case 'step_heartbeat': {
          // Update elapsed time on the running step card
          var hbCard = progressArea.querySelector('[data-step="' + evt.index + '"]');
          if (hbCard && hbCard.classList.contains('running')) {
            var timerEl = hbCard.querySelector('.step-elapsed');
            if (!timerEl) {
              timerEl = document.createElement('span');
              timerEl.className = 'step-elapsed';
              hbCard.appendChild(timerEl);
            }
            timerEl.textContent = evt.elapsed + 's';
          }
          break;
        }
        case 'step_fallback': {
          var fbBanner = document.createElement('div');
          fbBanner.className = 'chain-fallback-banner';
          fbBanner.innerHTML = '<span class="fallback-icon">\u21BB</span> ' + escapeHtml(evt.reason) + ' \u2014 switching to ' + escapeHtml(evt.fallback);
          progressArea.appendChild(fbBanner);
          fbBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Update the step card model name
          var fbCard = progressArea.querySelector('[data-step="' + evt.index + '"]');
          if (fbCard) {
            var modelEl = fbCard.querySelector('.step-model');
            if (modelEl) modelEl.innerHTML = escapeHtml(evt.fallback) + ' <span class="step-fallback-tag">fallback</span>';
            // Remove elapsed timer for fresh start
            var oldTimer = fbCard.querySelector('.step-elapsed');
            if (oldTimer) oldTimer.remove();
          }
          break;
        }
        case 'chain_error':
          if (evt.refunded) {
            window._store.set('chainrun_credit_balance', String(evt.balance));
            _updateCreditBadge(evt.balance);
            showToast('Error \u2014 credit refunded');
          }
          throw new Error(evt.error || 'Chain failed');
      }
    }
  }

  if (!finalData) throw new Error('Stream ended without result');

  renderChainFinal(finalData.result, finalData.totalMs);

  // Render cost breakdown if available
  if (finalData.cost_breakdown) {
    _renderCostBreakdown(progressArea, finalData.cost_breakdown);
  }
}

function _updateCreditBadge(balance) {
  var badge = document.getElementById('credit-balance-badge');
  if (badge) {
    badge.textContent = balance + ' credit' + (balance !== 1 ? 's' : '');
    badge.style.display = balance > 0 ? '' : 'none';
    // Toggle the dot separator
    var dot = badge.nextElementSibling;
    if (dot && dot.tagName === 'SPAN' && dot.textContent === '\u00b7') {
      dot.style.display = balance > 0 ? '' : 'none';
    }
  }
}

function showCreditStore() {
  var existing = document.getElementById('credit-store-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'credit-store-modal';
  modal.className = 'credit-store-overlay';

  var balance = parseInt(window._store.get('chainrun_credit_balance') || '0', 10);

  modal.innerHTML = '<div class="credit-store">'
    + '<div class="credit-store-header">'
    + '<h3>Run Credits</h3>'
    + '<button class="credit-close" onclick="closeCreditStore()">&times;</button>'
    + '</div>'
    + '<p class="credit-store-desc">Don\'t want to manage API keys or pay for multiple AI subscriptions? One credit = one full multi-model chain run using our keys.</p>'
    + (balance > 0 ? '<div class="credit-current">Current balance: <strong>' + balance + '</strong></div>' : '')
    + '<div class="credit-packs">'
    + CREDIT_PACKS.map(function(p) {
        return '<button class="credit-pack' + (p.best ? ' credit-pack-best' : '') + '" onclick="closeCreditStore(); buyCredits(\'' + p.id + '\');">'
          + '<div class="credit-pack-top">'
          + '<span class="credit-pack-credits">' + p.label + '</span>'
          + (p.best ? '<span class="credit-pack-tag">Best value</span>' : '')
          + '</div>'
          + '<div class="credit-pack-price">' + p.price + '</div>'
          + '<div class="credit-pack-per">' + p.per + '</div>'
          + '</button>';
      }).join('')
    + '</div>'
    + '<div class="credit-transparency">'
    + '<div class="credit-transp-title">Where your money goes</div>'
    + '<div class="credit-transp-breakdown">'
    + '<div class="credit-transp-row"><span>My subscriptions</span><span>$750/mo</span></div>'
    + '<div class="credit-transp-row credit-transp-sub"><span>Gemini Ultra</span><span>$250</span></div>'
    + '<div class="credit-transp-row credit-transp-sub"><span>ChatGPT Max</span><span>$200</span></div>'
    + '<div class="credit-transp-row credit-transp-sub"><span>Perplexity Max</span><span>$200</span></div>'
    + '<div class="credit-transp-row credit-transp-sub"><span>Claude Max</span><span>$100</span></div>'
    + '<div class="credit-transp-row credit-transp-sub"><span>Grok API</span><span>pay-as-you-go</span></div>'
    + '<div class="credit-transp-row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:6px"><span>API cost per run</span><span>$0.04</span></div>'
    + '</div>'
    + '<p class="credit-transp-explain">The price starts at $1/run and drops as more people use credits this month. Once my $750/mo in subscriptions is covered, it drops to $0.04 — the raw API cost. Zero profit. Every run makes it cheaper for everyone. Resets monthly.</p>'
    + '<div class="credit-transp-tracker" id="credit-transp-tracker"></div>'
    + '</div>'
    + '</div>';

  document.body.appendChild(modal);
  requestAnimationFrame(function() { modal.classList.add('active'); });

  // Load live community progress
  _loadTransparencyTracker();
}

function _loadTransparencyTracker() {
  var el = document.getElementById('credit-transp-tracker');
  if (!el) return;
  fetch(DEMO_PROXY_URL + '/credits/transparency').then(function(r) { return r.json(); }).then(function(d) {
    if (!d.current_price && d.current_price !== 0) return;
    var price = d.current_price;
    var runs = d.runs_this_month || 0;
    var pct = d.offset_pct || 0;
    var nextPrice = d.next_price;
    var nextIn = d.next_drop_in || 0;
    var month = d.month || '';

    // Build tier visualization
    var tierHtml = (d.tiers || []).map(function(t, i) {
      var active = i === d.tier;
      var label = t.to ? (t.from + 1) + '\u2013' + t.to : (t.from + 1) + '+';
      return '<div class="transp-tier' + (active ? ' transp-tier-active' : (i < d.tier ? ' transp-tier-done' : '')) + '">'
        + '<span class="transp-tier-runs">' + label + '</span>'
        + '<span class="transp-tier-price">$' + t.price.toFixed(2) + '</span>'
        + '</div>';
    }).join('');

    var nextHtml = nextIn > 0
      ? '<div class="transp-next">' + nextIn + ' more runs until price drops to $' + nextPrice.toFixed(2) + '</div>'
      : (price <= 0.04 ? '<div class="transp-next transp-next-done">Subscriptions offset \u2014 running at cost</div>' : '');

    el.innerHTML =
      '<div class="transp-current-price">Current price: <strong>$' + price.toFixed(2) + '/run</strong></div>'
      + '<div class="transp-tiers">' + tierHtml + '</div>'
      + '<div class="transp-progress-label">'
      + '<span>' + month + ' \u00b7 ' + runs + ' runs</span>'
      + '<span>' + pct + '% offset</span>'
      + '</div>'
      + '<div class="transp-progress-bar"><div class="transp-progress-fill" style="width:' + pct + '%"></div></div>'
      + nextHtml
      + '<div class="transp-reset">Resets on the 1st of each month</div>';
  }).catch(function() {});
}

function closeCreditStore() {
  var modal = document.getElementById('credit-store-modal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(function() { modal.remove(); }, 200);
  }
}

// Load credit balance on startup
function _initCreditBalance() {
  // Show cached balance immediately
  var cached = parseInt(window._store.get('chainrun_credit_balance') || '0', 10);
  if (cached > 0) _updateCreditBadge(cached);

  // Fetch fresh balance in background
  var uid = window._store.get('chainrun_credit_uid');
  if (uid) {
    fetchCreditBalance().then(function(bal) {
      _updateCreditBadge(bal);
    }).catch(function() {});
  }
}

// Community progress calculator (V3 Collective Model)
function _calcCommunityProgress(runs) {
  var recovered = 0;
  var GOAL = 750;
  if (runs <= 200) {
    recovered = runs * 0.96;
  } else if (runs <= 500) {
    recovered = (200 * 0.96) + ((runs - 200) * 0.56);
  } else if (runs <= 800) {
    recovered = (200 * 0.96) + (300 * 0.56) + ((runs - 500) * 0.21);
  } else {
    recovered = GOAL;
  }
  var percentage = Math.min((recovered / GOAL) * 100, 100);
  var runsLeft = Math.max(801 - runs, 0);
  var currentPrice = runs >= 801 ? 0.04 : (runs > 500 ? 0.25 : (runs > 200 ? 0.60 : 1.00));
  return { percentage: percentage, recovered: recovered, runsLeft: runsLeft, currentPrice: currentPrice, goal: GOAL };
}

// Live price drop tracker (in Auto tab)
function _initPriceDropTracker() {
  var el = document.getElementById('price-drop-tracker');
  if (!el) return;

  fetch(DEMO_PROXY_URL + '/credits/transparency').then(function(r) { return r.json(); }).then(function(d) {
    if (!d.tiers) return;

    var runs = d.runs_this_month || 0;
    var prog = _calcCommunityProgress(runs);
    var tiers = d.tiers;
    var tier = d.tier;
    var atCost = prog.currentPrice <= 0.05;

    // Community progress bar toward $750 goal
    var html = '<div class="pdt-community">';
    html += '<div class="pdt-community-header">';
    html += '<span class="pdt-community-label">Community progress</span>';
    html += '<span class="pdt-community-amount">$' + prog.recovered.toFixed(0) + ' / $' + prog.goal + '</span>';
    html += '</div>';
    html += '<div class="pdt-bar"><div class="pdt-fill' + (atCost ? ' pdt-fill-done' : '') + '" style="width:' + prog.percentage.toFixed(1) + '%"></div></div>';
    html += '</div>';

    if (atCost) {
      html += '<div class="pdt-bar-wrap">';
      html += '<div class="pdt-label"><span class="pdt-price">$' + prog.currentPrice.toFixed(2) + '/run</span><span class="pdt-status pdt-at-cost">Goal reached \u2014 raw API cost only</span></div>';
      html += '<div class="pdt-detail">' + runs + ' runs this month \u00b7 Resets on the 1st</div>';
      html += '</div>';
    } else {
      html += '<div class="pdt-bar-wrap">';
      html += '<div class="pdt-label"><span class="pdt-price">$' + prog.currentPrice.toFixed(2) + '/run</span><span class="pdt-next">' + prog.runsLeft + ' runs to $0.04</span></div>';
      html += '<div class="pdt-tiers">' + tiers.map(function(t, i) {
          var label = '$' + t.price.toFixed(2);
          var cls = i === tier ? 'pdt-tier-active' : (i < tier ? 'pdt-tier-done' : 'pdt-tier-future');
          return '<span class="pdt-tier ' + cls + '">' + label + '</span>';
        }).join('<span class="pdt-tier-arrow">\u203a</span>') + '</div>';
      html += '</div>';
    }

    el.innerHTML = html;
  }).catch(function() {
    // Silent fail
  });
}

// Detect credit purchase return (visibility-based)
function _detectCreditPurchase() {
  // When user returns from Stripe tab, verify pending nonce
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    var nonce = window._store.get('chainrun_pending_nonce');
    if (!nonce) return;

    // Small delay — let the page settle
    setTimeout(function() {
      showToast('Verifying purchase...');
      verifyCreditPurchase(nonce).then(function(result) {
        if (result.ok) {
          window._store.remove('chainrun_pending_nonce');
          showToast(result.credits_added ? result.credits_added + ' credits added' : 'Credits ready');
          _updateCreditBadge(result.balance);
          switchTab('auto');
        } else if (result.already_processed) {
          window._store.remove('chainrun_pending_nonce');
          _updateCreditBadge(result.balance);
        } else if (result.error && result.error.indexOf('Too fast') !== -1) {
          // Payment still processing — will try again on next visibility change
          showToast('Still processing \u2014 come back in a moment');
        } else {
          // Failed — clear nonce
          window._store.remove('chainrun_pending_nonce');
          showToast(result.error || 'Verification failed');
        }
      });
    }, 800);
  });
}

// ────────────────────────────────────
// Profiles Tab
// ────────────────────────────────────
// ────────────────────────────────────
// Leaderboard Tab
// ────────────────────────────────────
function renderLeaderboard() {
  // Fetch community feed
  fetch(DEMO_PROXY_URL + '/community/feed').then(function(r) { return r.json(); }).then(function(data) {
    var feedEl = document.getElementById('lb-feed');
    if (!feedEl || !data.events || data.events.length === 0) return;
    var html = '';
    data.events.slice(0, 20).forEach(function(evt) {
      var icon = evt.type === 'credits_purchased' ? '\ud83d\udcb3' : '\u26a1';
      var action = evt.type === 'credits_purchased'
        ? 'bought ' + (evt.detail || 'credits')
        : 'ran a chain';
      var ago = _timeAgo(evt.ts);
      html += '<div class="lb-event"><span class="lb-event-icon">' + icon + '</span>'
        + '<span class="lb-event-user">' + escapeHtml(evt.user || 'Anon') + '</span> '
        + '<span class="lb-event-action">' + escapeHtml(action) + '</span>'
        + (evt.score_delta ? ' <span class="lb-event-score">+$' + evt.score_delta.toFixed(2) + ' recovered</span>' : '')
        + '<span class="lb-event-time">' + ago + '</span></div>';
    });
    feedEl.innerHTML = html;
  }).catch(function() {});

  // Fetch leaderboard
  fetch(DEMO_PROXY_URL + '/community/leaderboard').then(function(r) { return r.json(); }).then(function(data) {
    var rankEl = document.getElementById('lb-rankings');
    if (!rankEl || !data.leaderboard || data.leaderboard.length === 0) return;
    var html = '';
    data.leaderboard.forEach(function(entry, i) {
      var medal = i === 0 ? '\ud83e\udd47' : (i === 1 ? '\ud83e\udd48' : (i === 2 ? '\ud83e\udd49' : (i + 1)));
      html += '<div class="lb-rank-row">'
        + '<span class="lb-rank-num">' + medal + '</span>'
        + '<span class="lb-rank-user">' + escapeHtml(entry.user) + '</span>'
        + '<span class="lb-rank-stats">' + entry.runs + ' runs \u00b7 $' + entry.credits.toFixed(0) + '</span>'
        + '</div>';
    });
    rankEl.innerHTML = html;
  }).catch(function() {});

  // Cost recovery
  fetch(DEMO_PROXY_URL + '/credits/transparency').then(function(r) { return r.json(); }).then(function(d) {
    var recEl = document.getElementById('lb-recovery');
    if (!recEl) return;
    var runs = d.runs_this_month || 0;
    var prog = _calcCommunityProgress(runs);
    recEl.innerHTML = '<div class="lb-recovery-bar">'
      + '<div class="lb-recovery-header"><span>$' + prog.recovered.toFixed(0) + ' / $750</span><span>' + prog.percentage.toFixed(0) + '%</span></div>'
      + '<div class="pdt-bar"><div class="pdt-fill' + (prog.percentage >= 100 ? ' pdt-fill-done' : '') + '" style="width:' + prog.percentage.toFixed(1) + '%"></div></div>'
      + '<div class="lb-recovery-note">' + (prog.runsLeft > 0 ? prog.runsLeft + ' runs until $0.04/run' : 'Goal reached \u2014 raw API cost only') + '</div>'
      + '</div>';
  }).catch(function() {});
}

function _timeAgo(ts) {
  var diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

// ────────────────────────────────────
// Profile: Connected APIs + Models
// ────────────────────────────────────
function renderConnectedAPIs() {
  var el = document.getElementById('prof-connected-apis');
  if (!el) return;
  var providers = [
    { key: 'openai', name: 'OpenAI', models: 'GPT-5.4, GPT-5.4 Mini' },
    { key: 'anthropic', name: 'Anthropic', models: 'Claude Sonnet 4.6, Haiku 4.5' },
    { key: 'perplexity', name: 'Perplexity', models: 'Sonar Deep Research' },
    { key: 'gemini', name: 'Google Gemini', models: 'Gemini 3.1 Pro, 2.5 Flash' },
    { key: 'xai', name: 'xAI', models: 'Grok 4, Grok 3 Mini' },
    { key: 'mistral', name: 'Mistral', models: 'Mistral Large, Small' },
  ];
  var html = '';
  providers.forEach(function(p) {
    var connected = hasApiKey(p.key);
    var dot = connected ? '<span class="prof-dot prof-dot-on"></span>' : '<span class="prof-dot prof-dot-off"></span>';
    html += '<div class="prof-api-row">' + dot + '<span class="prof-api-name">' + p.name + '</span>';
    if (connected) {
      html += '<span class="prof-api-status">Connected</span>';
    } else {
      html += '<span class="prof-api-status prof-api-off">Not connected</span>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

function renderModelsTable() {
  var el = document.getElementById('prof-models-table');
  if (!el) return;
  var models = [
    { name: 'GPT-5.4', provider: 'openai', ownKey: true, credits: true, latest: true },
    { name: 'Gemini 3.1 Pro', provider: 'gemini', ownKey: true, credits: true, latest: true },
    { name: 'Grok 4', provider: 'xai', ownKey: true, credits: true, latest: true },
    { name: 'Sonar Deep Research', provider: 'perplexity', ownKey: true, credits: true, latest: true },
    { name: 'Claude Sonnet 4.6', provider: 'anthropic', ownKey: true, credits: true, latest: true },
    { name: 'GPT-5.4 Mini', provider: 'openai', ownKey: true, credits: true, latest: false },
    { name: 'Grok 3 Mini', provider: 'xai', ownKey: true, credits: true, latest: false },
    { name: 'Nemotron 3 Super', provider: 'openrouter', ownKey: false, credits: true, latest: true },
    { name: 'MiMo-V2-Pro', provider: 'openrouter', ownKey: false, credits: true, latest: true },
    { name: 'MiniMax M2.7', provider: 'openrouter', ownKey: false, credits: true, latest: true },
  ];
  var html = '<div class="prof-models-grid">';
  html += '<div class="prof-models-header"><span>Model</span><span>Your keys</span><span>Credits</span></div>';
  models.forEach(function(m) {
    var hasKey = hasApiKey(m.provider);
    var keyCell = m.ownKey ? (hasKey ? '<span class="prof-check">\u2713</span>' : '<span class="prof-x">\u2014</span>') : '<span class="prof-x">N/A</span>';
    var creditCell = m.credits ? '<span class="prof-check">\u2713</span>' : '<span class="prof-x">\u2014</span>';
    var badge = m.latest ? '<span class="prof-latest">Latest</span>' : '';
    html += '<div class="prof-models-row"><span>' + m.name + badge + '</span>' + keyCell + creditCell + '</div>';
  });
  html += '</div>';
  html += '<p class="prof-models-note">Credits are always mapped to the newest model versions. Your own API keys may point to older versions.</p>';
  el.innerHTML = html;
}

function renderProfiles() {
  // Render connected APIs and models table when profiles tab loads
  renderConnectedAPIs();
  renderModelsTable();
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
  { key: 'gemini', name: 'Google Gemini', placeholder: 'AIza...', url: 'https://aistudio.google.com/apikey', wizHint: 'Sign in with your Google account, tap "Create API key", copy it.', pattern: /^AIza[A-Za-z0-9_-]{30,}$/ },
  { key: 'xai', name: 'xAI / Grok', placeholder: 'xai-...', url: 'https://console.x.ai/', wizHint: 'Sign in, go to API Keys, create one and copy it.', pattern: /^xai-[A-Za-z0-9_-]{20,}$/ },
  { key: 'openai', name: 'OpenAI', placeholder: 'sk-...', url: 'https://platform.openai.com/api-keys', wizHint: 'Sign in, tap "Create new secret key", copy it before closing.', pattern: /^sk-[A-Za-z0-9_-]{20,}$/ },
  { key: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...', url: 'https://console.anthropic.com/settings/keys', wizHint: 'Sign in, go to API Keys, create and copy your key.', pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
  { key: 'perplexity', name: 'Perplexity', placeholder: 'pplx-...', url: 'https://www.perplexity.ai/settings/api', wizHint: 'Sign in, go to API settings, generate and copy your key.', pattern: /^pplx-[A-Za-z0-9_-]{20,}$/ },
  { key: 'mistral', name: 'Mistral', placeholder: 'sk-...', url: 'https://console.mistral.ai/api-keys', wizHint: 'Sign in, go to API Keys, create and copy.', pattern: /^[A-Za-z0-9]{20,}$/ },
  { key: 'openrouter', name: 'OpenRouter', placeholder: 'sk-or-...', url: 'https://openrouter.ai/settings/keys', wizHint: 'One key for NVIDIA, Xiaomi, MiniMax, Qwen. Sign in, create key, add credits.', pattern: /^sk-or-[A-Za-z0-9_-]{20,}$/ }
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
    // Auto-probe keys that haven't been detected yet
    _autoProbeExistingKeys();
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
    // Build cached model pills if we have detection data
    var cachedPills = '';
    var cached = DetectedModels[p.key];
    if (hasKey && cached && cached.ok) {
      if (p.key === 'openrouter') {
        cachedPills = '<div class="key-models"><span class="key-models-count">' + cached.total + ' models available</span></div>';
      } else if (cached.models && cached.models.length > 0) {
        cachedPills = '<div class="key-models">' + cached.models.map(function(m) {
          var cls = 'key-model-pill';
          if (m.type === 'image') cls += ' pill-image';
          else if (m.type === 'audio') cls += ' pill-audio';
          return '<span class="' + cls + '">' + m.name + '</span>';
        }).join('') + '</div>';
      } else {
        cachedPills = '<div class="key-models"><span class="key-models-ok">\u2713 Key valid (' + (cached.total || 0) + ' models)</span></div>';
      }
    } else if (hasKey && cached && cached.error) {
      cachedPills = '<div class="key-models"><span class="key-models-error">' + (cached.error === 'invalid_key' ? 'Invalid key' : 'Could not verify') + '</span></div>';
    } else if (hasKey && !cached) {
      cachedPills = '<div class="key-models"><span class="key-models-loading">Detecting models\u2026</span></div>';
    }
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
            value="${hasKey ? '••••••••' + getApiKey(p.key).slice(-4) : ''}"
            data-masked="${hasKey ? '1' : '0'}"
            onfocus="_unmaskKeyOnFocus('${p.key}', this)"
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
        ${cachedPills}
      </div>
    `;
  }).join('');
}

function handleKeyInput(provider, value) {
  setApiKey(provider, value);
  // Update dot color
  const item = document.querySelector(`#key-${provider}`).closest('.api-key-item');
  const dot = item.querySelector('.key-dot');
  dot.classList.toggle('configured', !!value.trim());
  dot.classList.toggle('missing', !value.trim());

  // Clear old detection state
  var modelsArea = item.querySelector('.key-models');
  if (modelsArea) modelsArea.innerHTML = '';

  // Auto-probe when key looks valid
  if (value.trim()) {
    var providerDef = API_PROVIDERS.find(function(p) { return p.key === provider; });
    if (providerDef && providerDef.pattern && providerDef.pattern.test(value.trim())) {
      _probeAndShowModels(provider, item);
    }
  }
}

var _probeTimers = {};
function _probeAndShowModels(provider, itemEl) {
  // Debounce 600ms
  clearTimeout(_probeTimers[provider]);
  _probeTimers[provider] = setTimeout(function() {
    var modelsArea = itemEl.querySelector('.key-models');
    if (!modelsArea) {
      modelsArea = document.createElement('div');
      modelsArea.className = 'key-models';
      itemEl.appendChild(modelsArea);
    }
    modelsArea.innerHTML = '<span class="key-models-loading">Detecting models…</span>';

    probeModels(provider).then(function(result) {
      if (!result) { modelsArea.innerHTML = ''; return; }
      if (result.error) {
        if (result.error === 'invalid_key') {
          modelsArea.innerHTML = '<span class="key-models-error">Invalid key</span>';
        } else {
          modelsArea.innerHTML = '<span class="key-models-error">Could not verify</span>';
        }
        return;
      }

      var models = result.models || [];
      var total = result.total || 0;

      if (provider === 'openrouter') {
        modelsArea.innerHTML = '<span class="key-models-count">' + total + ' models available</span>';
        return;
      }

      if (models.length === 0) {
        modelsArea.innerHTML = '<span class="key-models-ok">✓ Key valid (' + total + ' models)</span>';
        return;
      }

      var pills = models.map(function(m) {
        var cls = 'key-model-pill';
        if (m.type === 'image') cls += ' pill-image';
        else if (m.type === 'audio') cls += ' pill-audio';
        return '<span class="' + cls + '">' + m.name + '</span>';
      }).join('');

      modelsArea.innerHTML = pills;
    });
  }, 600);
}

// Auto-probe all existing keys that haven't been detected yet (or are stale >24h)
function _autoProbeExistingKeys() {
  var now = Date.now();
  var staleMs = 24 * 60 * 60 * 1000; // 24 hours
  API_PROVIDERS.forEach(function(p) {
    if (!hasApiKey(p.key)) return;
    var cached = DetectedModels[p.key];
    if (cached && cached.ok && cached.ts && (now - cached.ts) < staleMs) return; // fresh enough
    // Probe in background
    probeModels(p.key).then(function(result) {
      if (result && result.ok) {
        // Re-render to show the newly detected models
        renderKeyList();
      }
    }).catch(function() {});
  });
}

function _unmaskKeyOnFocus(provider, input) {
  if (input.dataset.masked === '1') {
    input.value = getApiKey(provider);
    input.dataset.masked = '0';
    input.select();
  }
}

function toggleKeyVisibility(provider) {
  const input = document.getElementById(`key-${provider}`);
  // If masked, unmask first
  if (input.dataset.masked === '1') {
    input.value = getApiKey(provider);
    input.dataset.masked = '0';
  }
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
  currentIndex: 0,
  autoRetrieveActive: false,
  lastAutoRetrieveCheck: 0,
};

// ── Auto-retrieve: detect API key from clipboard when user returns ──
function _wizAutoRetrieveListener() {
  if (document.visibilityState !== 'visible') return;
  if (!wizState.autoRetrieveActive) return;
  // Throttle: don't check more than once every 2 seconds
  if (Date.now() - wizState.lastAutoRetrieveCheck < 2000) return;
  wizState.lastAutoRetrieveCheck = Date.now();

  const key = wizState.selectedProviders[wizState.currentIndex];
  if (!key) return;
  const provider = API_PROVIDERS.find(function(p) { return p.key === key; });
  if (!provider) return;

  // Already has a key? Skip auto-retrieve
  if (hasApiKey(key)) return;

  // Try to read clipboard
  if (!navigator.clipboard || !navigator.clipboard.readText) return;

  navigator.clipboard.readText().then(function(text) {
    if (!text || !text.trim()) return;
    var val = text.trim();

    // Check if it matches the expected key format for this provider
    if (provider.pattern && provider.pattern.test(val)) {
      // Auto-fill the key
      var input = document.getElementById('wiz-key-input');
      if (input && !input.value) {
        input.value = val;
        setApiKey(key, val);
        document.getElementById('wiz-next-btn').disabled = false;

        // Show special auto-detected status
        document.getElementById('wiz-key-status').innerHTML = '\n          <div class="wiz-key-ok wiz-key-auto">\n            <svg viewBox="0 0 24 24" fill="none" stroke="#20b2aa" stroke-width="2.5" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>\n            Key detected \u2014 auto-filled\n          </div>\n        ';

        // Pulse the Next button to draw attention
        var nextBtn = document.getElementById('wiz-next-btn');
        if (nextBtn) {
          nextBtn.classList.add('wiz-btn-pulse');
          setTimeout(function() { nextBtn.classList.remove('wiz-btn-pulse'); }, 2000);
        }
      }
    }
  }).catch(function() { /* clipboard denied — silent */ });
}

document.addEventListener('visibilitychange', _wizAutoRetrieveListener);

// Also try on focus (some browsers fire this instead of visibilitychange)
window.addEventListener('focus', function() {
  setTimeout(_wizAutoRetrieveListener, 300);
});

function wizStartSetup() {
  // Gather selected providers
  const checks = document.querySelectorAll('#wiz-choices input[type=checkbox]:checked');
  wizState.selectedProviders = Array.from(checks).map(c => c.value);

  if (wizState.selectedProviders.length === 0) {
    showToast('Pick at least one');
    return;
  }

  wizState.currentIndex = 0;
  wizState.autoRetrieveActive = true;
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
  wizState.autoRetrieveActive = false;
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
  // Probe models for all entered keys (background)
  API_PROVIDERS.forEach(function(p) {
    if (hasApiKey(p.key)) probeModels(p.key);
  });
  // Switch to Auto tab
  switchTab('auto');
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
// ────────────────────────────────────
// Onboarding (premium first-launch)
// ────────────────────────────────────
var _onboardSlide = 0;

function initWelcome() {
  var overlay = document.getElementById('onboard-overlay');
  if (!overlay) return;

  // Already onboarded? Remove immediately
  if (window._store.get('chainrun_onboarded')) {
    overlay.remove();
    return;
  }

  // Show the overlay
  overlay.style.display = 'flex';
  requestAnimationFrame(function() { overlay.classList.add('active'); });
}

function onboardNext() {
  _onboardSlide++;
  _showOnboardSlide(_onboardSlide);
}

function _showOnboardSlide(index) {
  var slides = document.querySelectorAll('.onboard-slide');
  var dots = document.querySelectorAll('.onboard-dot');
  slides.forEach(function(s, i) {
    s.classList.toggle('onboard-slide-active', i === index);
  });
  dots.forEach(function(d, i) {
    d.classList.toggle('active', i === index);
  });
}

function onboardFinish(path) {
  window._store.set('chainrun_onboarded', '1');
  var overlay = document.getElementById('onboard-overlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(function() { overlay.remove(); }, 500);
  }
  if (path === 'keys') {
    switchTab('settings');
  } else if (path === 'credits') {
    showCreditStore();
  }
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
  if (document.querySelector('.update-banner')) return; // already showing
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = '<span>New version available</span>'
    + '<button onclick="_forceUpdate()">Update now</button>';
  document.body.appendChild(banner);
  setTimeout(function() { banner.classList.add('visible'); }, 100);
}

// ────────────────────────────────────
// Settings Sync (encrypted, passphrase-based)
// ────────────────────────────────────
var SYNC_KEYS = [
  'chainrun_api_keys', 'chainrun_receipt', 'chainrun_credit_uid',
  'chainrun_credit_balance', 'chainrun_my_ref_code', 'chainrun_recovery_email',
  'chainrun_detected_models', 'chainrun_onboarded', 'chainrun_ct_id',
  'chainrun_ct_code', 'chainrun_ref_conversions', 'chainrun_profiles',
  'chainrun_active_profile',
];

async function _deriveKey(passphrase, salt) {
  var enc = new TextEncoder();
  var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function _encryptData(data, passphrase) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var key = await _deriveKey(passphrase, salt);
  var enc = new TextEncoder();
  var encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(data)));
  // Combine salt + iv + ciphertext into one base64 string
  var combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode.apply(null, combined));
}

async function _decryptData(base64, passphrase) {
  var raw = Uint8Array.from(atob(base64), function(c) { return c.charCodeAt(0); });
  var salt = raw.slice(0, 16);
  var iv = raw.slice(16, 28);
  var ciphertext = raw.slice(28);
  var key = await _deriveKey(passphrase, salt);
  var decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function handleSyncPush() {
  var codeInput = document.getElementById('sync-code-input');
  var passInput = document.getElementById('sync-pass-input');
  var statusEl = document.getElementById('sync-status');
  var code = (codeInput ? codeInput.value : '').trim().toUpperCase();
  var pass = (passInput ? passInput.value : '').trim();

  if (!code || code.length < 6) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">CODE MUST BE 6+ CHARACTERS.</span>';
    return;
  }
  if (!pass || pass.length < 4) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">PASSPHRASE MUST BE 4+ CHARACTERS.</span>';
    return;
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">ENCRYPTING...</span>';

  // Collect all settings
  var data = {};
  SYNC_KEYS.forEach(function(k) {
    var val = window._store.get(k);
    if (val !== null) data[k] = val;
  });
  // Also collect any keys stored with the 'chainrun_key_' prefix
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var lk = localStorage.key(i);
      if (lk && lk.startsWith('chainrun_')) {
        var v = localStorage.getItem(lk);
        if (v !== null) data[lk] = v;
      }
    }
  } catch(e) {}

  data._sync_ts = Date.now();
  data._sync_version = typeof CR_APP_VERSION !== 'undefined' ? CR_APP_VERSION : 0;

  _encryptData(data, pass).then(function(encrypted) {
    return fetch(PROXY_BASE + '/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_code: code, encrypted_data: encrypted }),
    });
  }).then(function(r) { return r.json(); }).then(function(resp) {
    if (resp.ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--accent)">EXPORTED. Use code <strong>' + code + '</strong> on your other device.</span>';
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">' + (resp.error || 'EXPORT FAILED.') + '</span>';
    }
  }).catch(function(e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">EXPORT FAILED: ' + e.message + '</span>';
  });
}

function handleSyncPull() {
  var codeInput = document.getElementById('sync-code-input');
  var passInput = document.getElementById('sync-pass-input');
  var statusEl = document.getElementById('sync-status');
  var code = (codeInput ? codeInput.value : '').trim().toUpperCase();
  var pass = (passInput ? passInput.value : '').trim();

  if (!code || code.length < 6) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">CODE MUST BE 6+ CHARACTERS.</span>';
    return;
  }
  if (!pass || pass.length < 4) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">PASSPHRASE REQUIRED.</span>';
    return;
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">DOWNLOADING...</span>';

  fetch(PROXY_BASE + '/sync/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sync_code: code }),
  }).then(function(r) { return r.json(); }).then(function(resp) {
    if (!resp.found) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">NO DATA FOUND FOR THIS CODE.</span>';
      return;
    }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">DECRYPTING...</span>';
    return _decryptData(resp.encrypted_data, pass).then(function(data) {
      // Restore all settings
      var count = 0;
      Object.keys(data).forEach(function(k) {
        if (k.startsWith('_sync_')) return;
        try { window._store.set(k, data[k]); count++; } catch(e) {}
      });
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--accent)">IMPORTED ' + count + ' SETTINGS. RELOADING...</span>';
      setTimeout(function() { window.location.reload(); }, 1500);
    });
  }).catch(function(e) {
    if (e.name === 'OperationError') {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">WRONG PASSPHRASE.</span>';
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">IMPORT FAILED: ' + e.message + '</span>';
    }
  });
}

// PROXY_BASE is defined in paygate.js — use it directly
// (do NOT redeclare with var/const/let to avoid SyntaxError)

// ────────────────────────────────────
// Recover last chain result
// ────────────────────────────────────
function _recoverLastRun() {
  // First check localStorage
  var local = window._store.get('chainrun_last_result');
  if (local) {
    try {
      var data = JSON.parse(local);
      // Only show if less than 1 hour old
      if (data.ts && (Date.now() - data.ts) < 3600000 && data.result) {
        _showRecoveredResult(data);
        return;
      }
    } catch(e) {}
  }

  // Then check server (for when connection dropped before client could save)
  var uid = window._store.get('chainrun_credit_uid');
  if (!uid) return;
  fetch(PROXY_BASE + '/sync/last-run?uid=' + encodeURIComponent(uid))
    .then(function(r) { return r.json(); })
    .then(function(resp) {
      if (resp.found && resp.run && resp.run.result) {
        // Only show if less than 1 hour old and we don't already have it locally
        var age = Date.now() - (resp.run.ts || 0);
        if (age < 3600000) {
          var localTs = 0;
          try { localTs = JSON.parse(local || '{}').ts || 0; } catch(e) {}
          if (resp.run.ts > localTs) {
            _showRecoveredResult(resp.run);
          }
        }
      }
    })
    .catch(function() {});
}

function _showRecoveredResult(data) {
  var outputSection = document.getElementById('auto-output-section');
  var outputArea = document.getElementById('auto-output');
  var totalArea = document.getElementById('auto-total');
  if (!outputSection || !outputArea) return;

  // Show a subtle recovery banner
  var progressArea = document.getElementById('auto-progress');
  if (progressArea) {
    progressArea.classList.remove('hidden');
    var age = Math.round((Date.now() - (data.ts || Date.now())) / 60000);
    var ageText = age < 1 ? 'just now' : age + ' min ago';
    progressArea.innerHTML = '<div class="chain-recovered">'
      + '<span class="recovered-label">LAST RESULT RECOVERED</span>'
      + '<span class="recovered-time">' + ageText + '</span>'
      + '</div>';
  }

  outputSection.classList.remove('hidden');
  outputArea.innerHTML = '<div class="output-text">' + _formatChainOutput(data.result) + '</div>';

  if (totalArea && data.totalMs) {
    totalArea.classList.remove('hidden');
    var totalTime = document.getElementById('auto-total-time');
    if (totalTime) totalTime.textContent = (data.totalMs / 1000).toFixed(1) + 's';
  }
}

function _formatChainOutput(text) {
  if (!text) return '';
  // Basic markdown-ish formatting
  return escapeHtml(text)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function handleRestorePurchase() {
  var input = document.getElementById('restore-email-input');
  var status = document.getElementById('restore-status');
  var btn = document.getElementById('restore-btn');
  var email = (input && input.value || '').trim();
  if (!email || !email.includes('@')) {
    if (status) status.innerHTML = '<span style="color:#e53935">Enter a valid email address.</span>';
    return;
  }
  if (btn) { btn.textContent = 'Restoring...'; btn.disabled = true; }
  if (status) status.innerHTML = '<span style="color:#888">Looking up your purchase...</span>';

  restorePurchase(email).then(function(success) {
    if (success) {
      if (status) status.innerHTML = '<span style="color:#20b2aa">Purchase restored. Reloading...</span>';
      setTimeout(function() { window.location.reload(); }, 1500);
    } else {
      if (status) status.innerHTML = '<span style="color:#e53935">No purchase found for this email. Make sure it matches the one you registered.</span>';
      if (btn) { btn.textContent = 'Restore'; btn.disabled = false; }
    }
  });
}

function _forceUpdate() {
  // Nuclear: unregister SW, clear caches, reload
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(regs) {
      regs.forEach(function(r) { r.unregister(); });
      caches.keys().then(function(keys) {
        Promise.all(keys.map(function(k) { return caches.delete(k); })).then(function() {
          window.location.reload(true);
        });
      });
    });
  } else {
    window.location.reload(true);
  }
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
// Landing Page: CryptoTraders Access
// ────────────────────────────────────
function handleCTAccess() {
  handleDiscordVerify();
}

// ────────────────────────────────────
// Gate: Access Code + Discord Verify
// ────────────────────────────────────
function handleGateEnter() {
  var input = document.getElementById('gate-code-input');
  var errorEl = document.getElementById('gate-error');
  var code = (input ? input.value : '').trim();

  if (!code) {
    if (errorEl) errorEl.textContent = 'CODE REQUIRED.';
    return;
  }
  if (errorEl) errorEl.textContent = '';

  // Check if it's a valid receipt / access code
  // Accept: stored receipt SID, referral codes (CR-XXXXX), or admin codes
  if (code.toUpperCase().startsWith('CR-') || code.startsWith('cs_')) {
    // Treat as access code → store receipt and enter
    var receipt = { sid: code.startsWith('cs_') ? code : 'gate_' + code, ts: Date.now(), v: 1, gate: true };
    window._store.set('chainrun_receipt', JSON.stringify(receipt));
    PAYGATE_STATE.unlocked = true;
    showApp();
    return;
  }

  // Check against admin key
  if (code === 'cr-Rx7kP2mN9' || code === 'GENESIS') {
    var receipt = { sid: 'admin_' + Date.now(), ts: Date.now(), v: 1, admin: true };
    window._store.set('chainrun_receipt', JSON.stringify(receipt));
    PAYGATE_STATE.unlocked = true;
    showApp();
    return;
  }

  if (errorEl) errorEl.textContent = 'INVALID CODE.';
  if (input) { input.style.borderColor = 'var(--danger)'; setTimeout(function() { input.style.borderColor = ''; }, 2000); }
}

function handleDiscordVerify() {
  var statusEl = document.getElementById('gate-discord-status');
  if (statusEl) { statusEl.style.display = ''; statusEl.textContent = 'REDIRECTING TO DISCORD...'; }

  // For now: trigger the CT flow which registers and grants access
  // TODO: Replace with real Discord OAuth when app credentials are provided
  _registerCTMember().then(function(data) {
    if (data && data.code) {
      if (statusEl) statusEl.textContent = '[GENESIS::VERIFIED] — CODE: ' + data.code;
      setTimeout(function() { showApp(); }, 1200);
    }
  }).catch(function() {
    if (statusEl) { statusEl.textContent = 'VERIFICATION FAILED. TRY AGAIN.'; statusEl.style.color = 'var(--danger)'; }
  });
}

// Gate: handle Enter key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.getElementById('gate-code-input') === document.activeElement) {
    handleGateEnter();
  }
});

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
              + 'When a prompt lacks specificity, all five models essentially paraphrase the same generic answer.';
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

  // If returning owner, personalize the landing page
  _personalizeLandingForOwner();
}

// ────────────────────────────────────
// Init
// ────────────────────────────────────
// ────────────────────────────────────
// Landing page: owner personalization
// ────────────────────────────────────
function _personalizeLandingForOwner() {
  var receipt = window._store.get('chainrun_receipt');
  if (!receipt) return;
  try { var r = JSON.parse(receipt); if (!r.sid) return; } catch(e) { return; }

  var code = window._store.get('chainrun_my_ref_code');
  var conversions = parseInt(window._store.get('chainrun_ref_conversions') || '0', 10);
  var creditsEarned = Math.min(19, conversions * 4);
  var pct = Math.round((creditsEarned / 19) * 100);
  var conversionsLeft = Math.ceil((19 - creditsEarned) / 4);

  // 1. Transform sticky bottom bar
  var sticky = document.getElementById('sticky-cta');
  if (sticky) {
    if (creditsEarned >= 19) {
      sticky.innerHTML = '<span class="lp-sticky-price" style="color:var(--accent)">19/19 credits earned</span>'
        + '<button class="lp-sticky-btn" onclick="skipInstall()">Open App</button>';
    } else {
      sticky.innerHTML = '<span class="lp-sticky-price">' + creditsEarned + '/19 credits</span>'
        + '<button class="lp-sticky-btn" onclick="_shareRefFromSettings()">' + (navigator.share ? 'Share link' : 'Copy link') + '</button>';
    }
  }

  // 2. Replace mid-page CTA with referral progress card
  var midCta = document.querySelector('.lp-mid-cta');
  if (midCta && code) {
    midCta.innerHTML =
      '<div class="lp-owner-ref-card">'
      + '<div class="lp-owner-ref-header">'
      + '<span class="lp-owner-badge">Owner</span>'
      + '<span class="lp-owner-ref-title">Earn your $19 back</span>'
      + '</div>'
      + '<p class="lp-owner-ref-desc">Share your link. Friends pay $14. You earn 4 run credits per purchase, up to 19.</p>'
      + '<div class="lp-owner-ref-progress">'
      + '<div class="lp-owner-ref-pbar-header"><span>' + creditsEarned + ' / 19 credits</span><span>' + pct + '%</span></div>'
      + '<div class="pdt-bar"><div class="pdt-fill' + (pct >= 100 ? ' pdt-fill-done' : '') + '" style="width:' + Math.min(pct, 100) + '%"></div></div>'
      + (creditsEarned >= 19
        ? '<div class="lp-owner-ref-note" style="color:var(--accent)">Full refund earned. Credits in your balance.</div>'
        : '<div class="lp-owner-ref-note">' + conversionsLeft + ' more referral' + (conversionsLeft !== 1 ? 's' : '') + ' to go</div>'
      )
      + '</div>'
      + '<button class="lp-cta-primary lp-owner-share-btn" onclick="_shareRefFromSettings()" style="margin-top:12px">'
      + (navigator.share ? 'Share your link' : 'Copy referral link')
      + '</button>'
      + '</div>';
  }

  // 3. Replace purchase buttons with "Open App" (skip ones inside owner card)
  document.querySelectorAll('.lp-cta-primary').forEach(function(btn) {
    if (btn.classList.contains('lp-owner-share-btn')) return;
    if (btn.closest('.lp-owner-ref-card')) return;
    if (btn.closest('.demo-used-paths')) return;
    var text = btn.textContent || '';
    if (text.indexOf('Get ChainRun') >= 0) {
      btn.textContent = 'Open ChainRun';
      btn.setAttribute('onclick', 'skipInstall()');
    }
  });

  // 4. Add "You own this" to pricing badge
  var pricingBadge = document.querySelector('.lp-pricing-badge');
  if (pricingBadge) {
    pricingBadge.textContent = 'You own this';
    pricingBadge.style.background = 'rgba(32,178,170,0.15)';
    pricingBadge.style.color = '#20b2aa';
  }

  // 5. Update demo-used area for owners
  var usedArea = document.getElementById('demo-used-area');
  if (usedArea && !usedArea.classList.contains('hidden')) {
    var lead = usedArea.querySelector('.demo-used-lead');
    if (lead) lead.textContent = 'Your chain result is below.';
    var paths = usedArea.querySelector('.demo-used-paths');
    if (paths) {
      paths.innerHTML = '<button class="lp-cta-primary" onclick="skipInstall()" style="width:100%">Open ChainRun</button>';
    }
  }
}

function initApp() {
  // Register service worker with aggressive update detection
  if ('serviceWorker' in navigator) {
    // Listen for SW_UPDATED message — auto-reload
    navigator.serviceWorker.addEventListener('message', function(evt) {
      if (evt.data && evt.data.type === 'SW_UPDATED') {
        window.location.reload();
      }
    });

    navigator.serviceWorker.register('./sw.js').then(reg => {
      // Check for updates on load
      reg.update().catch(() => {});
      // When a new SW is found, tell it to skip waiting immediately
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Tell the waiting SW to take over now
            newWorker.postMessage('SKIP_WAITING');
            showUpdateBanner();
          }
        });
      });
    }).catch(() => {});
    // If a waiting SW is already there on page load, activate it
    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) {
        reg.waiting.postMessage('SKIP_WAITING');
        showUpdateBanner();
      }
    });
  }

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Auto button
  document.getElementById('auto-run-btn').addEventListener('click', handleRunChain);
  document.getElementById('auto-copy-btn').addEventListener('click', copyChainOutput);

  // Mode toggle + file upload
  initModeToggle();
  initFileUpload();

  // Recover last chain result if connection dropped
  _recoverLastRun();

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

  // Credit system: detect purchase return + fetch balance
  _detectCreditPurchase();
  _initCreditBalance();
  _initPriceDropTracker();

  // Prompt for recovery email if user has a receipt but no recovery email
  if (PAYGATE_STATE.unlocked && !window._store.get('chainrun_recovery_email')) {
    setTimeout(function() { if (typeof showRecoveryEmailPrompt === 'function') showRecoveryEmailPrompt(); }, 5000);
  }

  // CT in-app banner (gentle referral ask)
  _initCTBanner();

  // Landing page interactions (scroll reveal, sticky CTA, demo state)
  initLandingInteractions();

  // Live rate ticker
  _initRateTicker();

  // Set active tab
  switchTab('auto');
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
    navigator.share({ title: 'ChainRun', text: 'I use ChainRun — 5 AI models, one prompt, better answers.', url: link });
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
  var creditsEarned = Math.min(19, conversions * 4);
  var pct = Math.round((creditsEarned / 19) * 100);
  var remaining = 19 - creditsEarned;
  var conversionsLeft = Math.ceil(remaining / 4);
  var inviteLink = 'https://chainrun-proxy.markusraeder.workers.dev/invite/' + code;

  content.innerHTML =
    '<div class="ref-settings-card">' +
      '<p class="ref-settings-desc">Share your link. Friends pay $14 instead of $19. Each purchase earns you 4 run credits. 5 referrals = your full $19 back.</p>' +
      '<div class="ref-settings-code-row">' +
        '<code class="ref-settings-code">' + inviteLink.replace('https://', '') + '</code>' +
        '<button class="ref-settings-share" onclick="_shareRefFromSettings()">' +
          (navigator.share ? 'Share' : 'Copy link') +
        '</button>' +
      '</div>' +
      '<div class="ref-settings-progress">' +
        '<div class="ref-progress-header"><span>' + creditsEarned + ' / 19 credits</span><span>' + pct + '%</span></div>' +
        '<div class="pdt-bar"><div class="pdt-fill' + (pct >= 100 ? ' pdt-fill-done' : '') + '" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="ref-settings-stats">' +
        '<div class="ref-stat">' +
          '<span class="ref-stat-num">' + conversions + '</span>' +
          '<span class="ref-stat-label">referral' + (conversions !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div class="ref-stat">' +
          '<span class="ref-stat-num">' + creditsEarned + '</span>' +
          '<span class="ref-stat-label">credits earned</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function _shareRefFromSettings() {
  var code = window._store.get('chainrun_my_ref_code');
  if (!code) return;
  var link = 'https://chainrun.tech?ref=' + code;
  if (navigator.share) {
    navigator.share({ title: 'ChainRun', text: 'I use ChainRun \u2014 5 AI models, one prompt, better answers.', url: link });
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
    navigator.share({ title: 'ChainRun', text: 'I use ChainRun \u2014 5 AI models, one prompt, better answers.', url: link });
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
