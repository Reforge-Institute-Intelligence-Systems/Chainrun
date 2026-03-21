/* ═══════════════════════════════════════
   ChainRun — Paygate & Install Flow
   ═══════════════════════════════════════ */

// ────────────────────────────────────
// State
// ────────────────────────────────────
const PAYGATE_STATE = {
  STRIPE_LINK: 'https://buy.stripe.com/3cI7sK6VYblBgLu2Qe2oE02',
  STRIPE_LINK_REFERRAL: 'https://buy.stripe.com/4gM9AS5RUfBR7aU1Ma2oE03',

  // Unlock state
  unlocked: false,
  installDismissed: false,
  waitingForPayment: false,

  // Referral
  referralCode: null,  // code that referred THIS user (from ?ref= param)
  myReferralCode: null, // this user's own code (generated after purchase)

  // CryptoTraders community
  isCT: false,         // true if user arrived via ?ref=CT
  ctId: null,           // unique CT member ID (generated on register)
  ctCode: null,         // their referral code
  ctReferrals: 0,       // how many people they've referred
  ctSettled: false,     // true when 2+ conversions

  // PWA install prompt (Android / desktop Chromium)
  deferredInstallPrompt: null,
};

// ────────────────────────────────────
// Capture beforeinstallprompt (Android / Chromium)
// ────────────────────────────────────
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  PAYGATE_STATE.deferredInstallPrompt = e;
  // If install screen is already showing, swap to the native button
  updateInstallButton();
});

window.addEventListener('appinstalled', function() {
  PAYGATE_STATE.deferredInstallPrompt = null;
  // User installed — go straight to app
  showApp();
});

// ────────────────────────────────────
// Check if user has paid
// ────────────────────────────────────
function checkPaymentStatus() {
  // 1. Check for stored receipt (persistent across sessions)
  const storedReceipt = window._store.get('chainrun_receipt');
  if (storedReceipt) {
    try {
      const receipt = JSON.parse(storedReceipt);
      // Validate receipt structure
      if (receipt.sid && receipt.sid.startsWith('cs_') && receipt.ts) {
        PAYGATE_STATE.unlocked = true;
        return true;
      }
    } catch (e) { /* corrupted receipt, continue */ }
  }

  // 2. Check URL params — Stripe redirect back
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  if (sessionId && sessionId.startsWith('cs_')) {
    // Valid Stripe session ID — store receipt
    const receipt = {
      sid: sessionId,
      ts: Date.now(),
      v: 1,
    };
    window._store.set('chainrun_receipt', JSON.stringify(receipt));
    PAYGATE_STATE.unlocked = true;

    // Clean URL without reloading
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', clean);

    // Optional: verify with backend (non-blocking)
    verifyPaymentAsync(sessionId);
    return true;
  }

  // Clean up any stale URL params that aren't valid session IDs
  if (params.has('paid') || params.has('success')) {
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', clean);
  }

  return false;
}

// Non-blocking verification against Stripe (if verify worker is available)
function verifyPaymentAsync(sessionId) {
  fetch('https://chainrun-verify.markusraeder.workers.dev/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  .then(r => r.json())
  .then(data => {
    if (data.valid === false) {
      // Payment not actually completed — revoke receipt
      window._store.remove('chainrun_receipt');
      PAYGATE_STATE.unlocked = false;
      // Reload to show landing
      window.location.reload();
    }
    // If valid or if the worker isn't set up yet, keep the receipt
  })
  .catch(() => {
    // Worker not available — keep the receipt (graceful degradation)
  });
}

// ────────────────────────────────────
// Detect if installed as PWA
// ────────────────────────────────────
function isInstalledAsPWA() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

// ────────────────────────────────────
// Detect platform
// ────────────────────────────────────
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

// ────────────────────────────────────
// Screen navigation
// ────────────────────────────────────
function showLanding() {
  document.getElementById('landing-screen').classList.add('active');
  document.getElementById('install-screen').classList.remove('active');
  document.getElementById('app-main').classList.remove('active');
  hidePaymentOverlay();
}

function showInstallScreen() {
  document.getElementById('landing-screen').classList.remove('active');
  document.getElementById('install-screen').classList.add('active');
  document.getElementById('app-main').classList.remove('active');

  const iosGuide = document.getElementById('install-ios');
  const androidGuide = document.getElementById('install-android');
  const desktopGuide = document.getElementById('install-desktop');

  if (isIOS()) {
    iosGuide.classList.add('show');
    // Start the iOS animation sequence
    startIOSAnimation();
  } else if (isAndroid()) {
    androidGuide.classList.add('show');
  } else {
    desktopGuide.classList.add('show');
  }

  updateInstallButton();
}

// ────────────────────────────────────
// Native install (Android / Chromium)
// ────────────────────────────────────
function updateInstallButton() {
  const nativeBtn = document.getElementById('native-install-btn');
  const manualSteps = document.getElementById('install-android');
  if (!nativeBtn) return;

  if (PAYGATE_STATE.deferredInstallPrompt) {
    // We can trigger native install — show the real button, hide manual steps
    nativeBtn.classList.add('show');
    if (manualSteps && isAndroid()) {
      manualSteps.querySelector('.install-steps').style.display = 'none';
    }
  }
}

async function triggerNativeInstall() {
  const prompt = PAYGATE_STATE.deferredInstallPrompt;
  if (!prompt) return;

  prompt.prompt();
  const result = await prompt.userChoice;

  if (result.outcome === 'accepted') {
    PAYGATE_STATE.deferredInstallPrompt = null;
    // appinstalled event will fire and call showApp()
  }
}

// ────────────────────────────────────
// iOS animated guide
// ────────────────────────────────────
function startIOSAnimation() {
  const steps = document.querySelectorAll('#install-ios .install-step');
  steps.forEach(function(step, i) {
    step.style.opacity = '0';
    step.style.transform = 'translateY(12px)';
    setTimeout(function() {
      step.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      step.style.opacity = '1';
      step.style.transform = 'translateY(0)';
    }, 300 + (i * 250));
  });

  // Pulse the share icon after steps animate in
  setTimeout(function() {
    const shareIcon = document.querySelector('#install-ios .ios-share-icon-animated');
    if (shareIcon) shareIcon.classList.add('pulse');
  }, 1200);
}

function showApp() {
  document.getElementById('landing-screen').classList.remove('active');
  document.getElementById('install-screen').classList.remove('active');
  document.getElementById('app-main').classList.add('active');
}

function skipInstall() {
  PAYGATE_STATE.installDismissed = true;
  showApp();
}

// ────────────────────────────────────
// Payment overlay (shown while Stripe is open)
// ────────────────────────────────────
function showPaymentOverlay() {
  let overlay = document.getElementById('payment-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'payment-overlay';
    overlay.innerHTML = `
      <div class="po-content">
        <div class="po-spinner"></div>
        <h2 class="po-title">Complete your purchase</h2>
        <p class="po-desc">Stripe checkout is open in another tab. Come back here after payment.</p>
        <button class="po-done-btn" onclick="onPaymentDone()">
          I've completed payment
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="po-retry-btn" onclick="retryPayment()">
          Re-open checkout
        </button>
        <button class="po-cancel-btn" onclick="cancelPayment()">
          Cancel
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.classList.add('active');
}

function hidePaymentOverlay() {
  const overlay = document.getElementById('payment-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ────────────────────────────────────
// Handle purchase click
// ────────────────────────────────────
function _getPaymentLink() {
  // Use referral link ($14) if user arrived via ?ref= code
  return PAYGATE_STATE.referralCode
    ? PAYGATE_STATE.STRIPE_LINK_REFERRAL
    : PAYGATE_STATE.STRIPE_LINK;
}

function showReferralInfo() {
  const el = document.querySelector('.demo-used-options');
  if (!el) return;
  // Replace the button with an explanation
  el.innerHTML = `
    <div style="padding:12px;background:#111;border:1px solid var(--border);border-radius:10px;">
      <p style="font-size:13px;color:var(--text);line-height:1.5;margin-bottom:8px;">Ask someone who already owns ChainRun for their referral link. When you open it, the price drops to <strong style="color:var(--accent)">$14</strong> automatically.</p>
      <p style="font-size:11px;color:var(--text-muted);line-height:1.4;">Every owner gets a unique link after purchase. They earn V2 discounts for sharing it.</p>
    </div>
  `;
}

function handlePurchase() {
  const link = _getPaymentLink();

  if (link === 'PASTE_YOUR_STRIPE_PAYMENT_LINK_HERE') {
    PAYGATE_STATE.unlocked = true;
    onPaymentSuccess();
    return;
  }

  // Open Stripe in new tab and show waiting overlay
  PAYGATE_STATE.waitingForPayment = true;
  window.open(link, '_blank');
  showPaymentOverlay();
}

function retryPayment() {
  window.open(_getPaymentLink(), '_blank');
}

function cancelPayment() {
  PAYGATE_STATE.waitingForPayment = false;
  hidePaymentOverlay();
}

function onPaymentDone() {
  // Store a receipt with a self-declared flag
  // Less secure than session_id redirect, but better than nothing
  const receipt = {
    sid: 'self_' + Date.now(),
    ts: Date.now(),
    v: 1,
    selfDeclared: true,
  };
  window._store.set('chainrun_receipt', JSON.stringify(receipt));
  PAYGATE_STATE.unlocked = true;
  PAYGATE_STATE.waitingForPayment = false;
  hidePaymentOverlay();
  onPaymentSuccess();
}

// ────────────────────────────────────
// Auto-detect return from Stripe tab
// ────────────────────────────────────
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && PAYGATE_STATE.waitingForPayment) {
    // User returned to the tab — they might have paid
    // Show them the "I've completed payment" button prominently
    const overlay = document.getElementById('payment-overlay');
    if (overlay) {
      const title = overlay.querySelector('.po-title');
      if (title) title.textContent = 'Welcome back';
      const desc = overlay.querySelector('.po-desc');
      if (desc) desc.textContent = 'Tap below if you completed your purchase.';
    }
  }
});

// ────────────────────────────────────
// Post-payment flow
// ────────────────────────────────────
function onPaymentSuccess() {
  // Generate referral code for this buyer (non-blocking)
  _createMyReferralCode();

  // Record conversion if this was a referred purchase
  if (PAYGATE_STATE.referralCode) {
    _recordReferralConversion(PAYGATE_STATE.referralCode);
  }

  if (isInstalledAsPWA()) {
    showApp();
  } else {
    showInstallScreen();
  }
}

// ────────────────────────────────────
// Referral System
// ────────────────────────────────────
const VERIFY_BASE = 'https://chainrun-verify.markusraeder.workers.dev';

// Detect ?ref=CODE on page load
function _detectReferral() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');

  // ── CryptoTraders special path ──
  if (ref === 'CT') {
    PAYGATE_STATE.isCT = true;
    window._store.set('chainrun_ct', '1');
    // Clean URL
    params.delete('ref');
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', clean);
    return; // CT flow handled separately in initPaygate
  }

  // ── Check if returning CT member ──
  if (window._store.get('chainrun_ct') === '1') {
    PAYGATE_STATE.isCT = true;
    return;
  }

  // ── Normal referral code (CR-XXXXXX) ──
  if (ref && ref.startsWith('CR-')) {
    PAYGATE_STATE.referralCode = ref.toUpperCase();
    window._store.set('chainrun_referrer', ref.toUpperCase());
    // Clean URL
    params.delete('ref');
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', clean);
    // Show discount on landing
    _showReferralBadge();
  } else {
    // Restore from storage (in case they refreshed)
    const stored = window._store.get('chainrun_referrer');
    if (stored) {
      PAYGATE_STATE.referralCode = stored;
      _showReferralBadge();
    }
  }
}

function _showReferralBadge() {
  // Update all CTA buttons to show $14 price
  document.querySelectorAll('.lp-cta-primary').forEach(function(btn) {
    btn.innerHTML = 'Get ChainRun &mdash; <s style="opacity:.5">$19</s> $14';
  });
  // Update sticky bar
  var stickyPrice = document.querySelector('.lp-sticky-price');
  if (stickyPrice) stickyPrice.innerHTML = '<s style="opacity:.5">$19</s> $14 &middot; Lifetime';
  // Show referral badge on hero
  var hero = document.querySelector('.lp-hero .lp-container');
  if (hero && !document.getElementById('ref-badge')) {
    var badge = document.createElement('div');
    badge.id = 'ref-badge';
    badge.className = 'ref-badge';
    badge.textContent = '$5 off — referred by a friend';
    hero.insertBefore(badge, hero.querySelector('.lp-demo-input'));
  }
  // Update post-demo CTA
  var demoCta = document.querySelector('#demo-cta .lp-cta-primary');
  if (demoCta) demoCta.innerHTML = 'Get ChainRun &mdash; <s style="opacity:.5">$19</s> $14';
  var demoMicro = document.querySelector('#demo-cta .lp-micro');
  if (demoMicro) demoMicro.textContent = 'One-time purchase. $5 off via referral.';
}

// Create referral code for the current user after they purchase
function _createMyReferralCode() {
  // Get email from receipt or prompt
  var receipt = window._store.get('chainrun_receipt');
  var email = null;
  try {
    var r = JSON.parse(receipt);
    email = r.email || null;
  } catch(e) {}

  // If no email in receipt, try to get from verify response
  // For now, generate with a placeholder — the user's email gets added on first Settings visit
  var storedCode = window._store.get('chainrun_my_ref_code');
  if (storedCode) {
    PAYGATE_STATE.myReferralCode = storedCode;
    _renderReferralUI();
    return;
  }

  // Ask worker for a code
  fetch(VERIFY_BASE + '/referral/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email || ('user_' + Date.now() + '@chainrun.local') }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.code) {
      PAYGATE_STATE.myReferralCode = data.code;
      window._store.set('chainrun_my_ref_code', data.code);
      window._store.set('chainrun_ref_conversions', String(data.conversions || 0));
      _renderReferralUI();
    }
  })
  .catch(function() { /* silent */ });
}

// Record that a referral converted
function _recordReferralConversion(code) {
  var receipt = window._store.get('chainrun_receipt');
  var email = 'unknown';
  try { email = JSON.parse(receipt).email || email; } catch(e) {}

  fetch(VERIFY_BASE + '/referral/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code, referred_email: email }),
  }).catch(function() { /* silent */ });

  // Clear the referrer from storage now that it's been used
  window._store.remove('chainrun_referrer');
}

// Render referral share UI on thank-you screen
function _renderReferralUI() {
  var code = PAYGATE_STATE.myReferralCode;
  if (!code) return;

  var container = document.getElementById('ty-referral');
  if (!container) return;

  var link = 'https://chainrun.tech?ref=' + code;
  var conversions = parseInt(window._store.get('chainrun_ref_conversions') || '0', 10);
  var v2Discount = Math.min(50 + conversions * 5, 100);

  container.innerHTML =
    '<div class="ty-section-label">Share ChainRun</div>' +
    '<div class="ty-ref-card">' +
      '<p class="ty-ref-desc">Your friends get $5 off. You get +5% extra V2 discount for every referral.</p>' +
      '<div class="ty-ref-code-row">' +
        '<span class="ty-ref-code">' + code + '</span>' +
        '<button class="ty-ref-copy" onclick="_copyRefLink()">Copy link</button>' +
      '</div>' +
      '<div class="ty-ref-stats">' +
        '<span>' + conversions + ' referral' + (conversions !== 1 ? 's' : '') + '</span>' +
        '<span class="ty-ref-dot">&middot;</span>' +
        '<span>V2 discount: ' + v2Discount + '% off first 6mo</span>' +
      '</div>' +
    '</div>';

  container.style.display = '';
}

function _copyRefLink() {
  var code = PAYGATE_STATE.myReferralCode;
  if (!code) return;
  var link = 'https://chainrun.tech?ref=' + code;
  if (navigator.share) {
    navigator.share({ title: 'ChainRun', text: 'Get $5 off ChainRun — 4 AI models, one prompt, better answers.', url: link });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() {
      var btn = document.querySelector('.ty-ref-copy');
      if (btn) { btn.textContent = 'Copied'; setTimeout(function() { btn.textContent = 'Copy link'; }, 1500); }
    });
  }
}

// ────────────────────────────────────
// Show install from settings
// ────────────────────────────────────
function showInstallFromSettings() {
  showInstallScreen();
}

// ────────────────────────────────────
// Live Demo — chain-focused, runs real WrapEngine
// ────────────────────────────────────
const DEMO_PROMPTS = {
  designer: {
    scenario: 'You need a SaaS pricing page that actually converts.',
    prompt: 'redesign my pricing page to get more sign-ups and reduce drop-off on the checkout step',
    chain: [
      { model: 'Perplexity', role: 'Research conversion benchmarks' },
      { model: 'Gemini', role: 'Structure UX framework' },
      { model: 'Grok 3', role: 'Challenge assumptions' },
      { model: 'GPT-5.4', role: 'Write final copy + layout' }
    ]
  },
  manager: {
    scenario: 'Your team missed the deadline. Morale is low. You need a plan.',
    prompt: 'help me figure out why my team keeps missing deadlines and create a recovery plan for the stakeholders',
    chain: [
      { model: 'Perplexity', role: 'Research root causes + methods' },
      { model: 'Gemini', role: 'Structure recovery framework' },
      { model: 'Grok 3', role: 'Challenge weak points' },
      { model: 'GPT-5.4', role: 'Write stakeholder plan' }
    ]
  },
  marketer: {
    scenario: 'Product launch next week. You need an email sequence that converts.',
    prompt: 'write a 5-email launch sequence for my new B2B productivity tool that gets people to actually buy',
    chain: [
      { model: 'Perplexity', role: 'Research B2B email benchmarks' },
      { model: 'Gemini', role: 'Structure sequence flow' },
      { model: 'Grok 3', role: 'Sharpen hooks + CTAs' },
      { model: 'GPT-5.4', role: 'Write final sequence' }
    ]
  },
  developer: {
    scenario: 'Your API is responding in 2+ seconds. Users are leaving.',
    prompt: 'my Node.js API endpoint with PostgreSQL is slow at 2.3 seconds, I need to get it under 200ms',
    chain: [
      { model: 'Perplexity', role: 'Research optimization patterns' },
      { model: 'Gemini', role: 'Structure bottleneck analysis' },
      { model: 'Grok 3', role: 'Challenge architecture' },
      { model: 'GPT-5.4', role: 'Write optimized code' }
    ]
  },
  student: {
    scenario: 'Research paper due Friday. You have a topic but no structure.',
    prompt: 'help me structure a research paper about why carbon pricing is the best climate change policy',
    chain: [
      { model: 'Perplexity', role: 'Find sources + real data' },
      { model: 'Gemini', role: 'Build outline + thesis' },
      { model: 'Grok 3', role: 'Find counterarguments' },
      { model: 'GPT-5.4', role: 'Write final structure' }
    ]
  }
};

function runLiveDemo(role) {
  const data = DEMO_PROMPTS[role];
  if (!data) return;

  // Highlight active button
  document.querySelectorAll('.lp-role-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.role === role);
  });

  // Run the REAL wrap engine
  const result = WrapEngine.wrap(data.prompt, 'chatgpt', 'auto');

  // Fill the UI
  document.getElementById('lp-live-scenario').textContent = data.scenario;
  document.getElementById('lp-live-before').textContent = data.prompt;
  document.getElementById('lp-live-after').textContent = result.wrapped;

  // Tag shows the chain, not a single model
  document.getElementById('lp-live-after-tag').textContent = 'ChainRun → Optimized';

  // Badges: intent + chain step count
  var badges = '<span class="lp-badge">Detected: ' + (INTENT_LABELS[result.intent] || result.intent) + '</span>';
  badges += '<span class="lp-badge">' + data.chain.length + '-model chain</span>';
  if (result.fixes.length > 0) {
    badges += '<span class="lp-badge">' + result.fixes.length + ' fix' + (result.fixes.length > 1 ? 'es' : '') + '</span>';
  }
  document.getElementById('lp-live-badges').innerHTML = badges;

  // Chain visualization callout — show each model and its role
  var chainViz = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  data.chain.forEach(function(step, i) {
    chainViz += '<span style="font-size:12px;font-weight:600;color:#e8e8e6">' + step.model + '</span>';
    chainViz += '<span style="font-size:10px;color:#666">' + step.role + '</span>';
    if (i < data.chain.length - 1) chainViz += '<span style="color:#20b2aa;font-size:14px">→</span>';
  });
  chainViz += '</div>';
  chainViz += '<span style="font-size:13px;color:#9a9a98">Each model covers what the last one missed. That\u2019s the chain advantage.</span>';
  document.getElementById('lp-live-callout').innerHTML = chainViz;

  // Show result
  const el = document.getElementById('lp-live-result');
  el.style.display = '';
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'fadeIn 0.3s ease';

  setTimeout(function() {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

// ────────────────────────────────────
// CryptoTraders — Free Access Flow
// ────────────────────────────────────
function _handleCTFlow() {
  // Check if already registered
  var storedCtId = window._store.get('chainrun_ct_id');
  if (storedCtId) {
    PAYGATE_STATE.ctId = storedCtId;
    PAYGATE_STATE.ctCode = window._store.get('chainrun_ct_code');
    PAYGATE_STATE.ctReferrals = parseInt(window._store.get('chainrun_ct_referrals') || '0', 10);
    PAYGATE_STATE.ctSettled = window._store.get('chainrun_ct_settled') === '1';
    PAYGATE_STATE.unlocked = true;
    return true; // already registered, skip landing
  }
  return false; // need to show CT landing
}

function _registerCTMember() {
  var ctId = 'ct_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  return fetch(VERIFY_BASE + '/ct/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ct_id: ctId }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.code) {
      PAYGATE_STATE.ctId = ctId;
      PAYGATE_STATE.ctCode = data.code;
      PAYGATE_STATE.ctReferrals = data.referrals || 0;
      PAYGATE_STATE.ctSettled = data.settled || false;
      PAYGATE_STATE.myReferralCode = data.code;
      PAYGATE_STATE.unlocked = true;

      // Store persistently
      window._store.set('chainrun_ct_id', ctId);
      window._store.set('chainrun_ct_code', data.code);
      window._store.set('chainrun_ct_referrals', String(data.referrals || 0));
      window._store.set('chainrun_ct_settled', data.settled ? '1' : '0');
      window._store.set('chainrun_my_ref_code', data.code);

      // Store a CT-type receipt so the app treats them as unlocked
      var receipt = {
        sid: 'ct_' + ctId,
        ts: Date.now(),
        v: 1,
        ct: true,
      };
      window._store.set('chainrun_receipt', JSON.stringify(receipt));

      return data;
    }
    throw new Error('No code returned');
  });
}

function _refreshCTStatus() {
  var ctId = PAYGATE_STATE.ctId;
  if (!ctId) return;

  fetch(VERIFY_BASE + '/ct/status?id=' + encodeURIComponent(ctId))
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.registered) {
      PAYGATE_STATE.ctReferrals = data.referrals || 0;
      PAYGATE_STATE.ctSettled = data.settled || false;
      window._store.set('chainrun_ct_referrals', String(data.referrals || 0));
      window._store.set('chainrun_ct_settled', data.settled ? '1' : '0');
    }
  })
  .catch(function() { /* silent */ });
}

// Show CT-specific landing overlay instead of normal $19 flow
function _showCTLanding() {
  var hero = document.querySelector('.lp-hero .lp-container');
  if (!hero) return;

  // Replace normal CTA with CT welcome
  var normalCtas = document.querySelectorAll('.lp-cta-primary');
  normalCtas.forEach(function(btn) {
    btn.textContent = 'Get ChainRun — Free';
    btn.onclick = _ctUnlock;
  });

  // Replace sticky bar
  var stickyPrice = document.querySelector('.lp-sticky-price');
  if (stickyPrice) stickyPrice.innerHTML = 'Free &middot; CryptoTraders';
  var stickyBtn = document.querySelector('.lp-sticky-btn');
  if (stickyBtn) {
    stickyBtn.innerHTML = 'Unlock Free <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    stickyBtn.onclick = _ctUnlock;
  }

  // Add CT badge on hero
  if (!document.getElementById('ct-badge')) {
    var badge = document.createElement('div');
    badge.id = 'ct-badge';
    badge.className = 'ct-badge';
    badge.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10 2a6 6 0 0 0-6 6c0 1.66.68 3.16 1.76 4.24L10 16.49l4.24-4.25A6 6 0 0 0 10 2z"/></svg> CryptoTraders Community — free access';
    hero.insertBefore(badge, hero.querySelector('.lp-demo-input'));
  }

  // Hide the "or pay less" options in demo-used (CT user gets it free)
  var demoUsedOptions = document.querySelector('.demo-used-options');
  var demoUsedOr = document.querySelector('.demo-used-or');
  if (demoUsedOptions) demoUsedOptions.style.display = 'none';
  if (demoUsedOr) demoUsedOr.style.display = 'none';
}

function _ctUnlock() {
  // Show a brief loading state
  var btns = document.querySelectorAll('.lp-cta-primary');
  btns.forEach(function(b) { b.textContent = 'Unlocking…'; b.disabled = true; });

  _registerCTMember()
  .then(function() {
    // Go straight to install/thank-you screen (CT-flavored)
    _showCTThankYou();
    if (isInstalledAsPWA()) {
      showApp();
    } else {
      showInstallScreen();
    }
  })
  .catch(function() {
    // Fallback: unlock anyway locally
    PAYGATE_STATE.unlocked = true;
    var receipt = { sid: 'ct_offline_' + Date.now(), ts: Date.now(), v: 1, ct: true };
    window._store.set('chainrun_receipt', JSON.stringify(receipt));
    window._store.set('chainrun_ct', '1');
    if (isInstalledAsPWA()) {
      showApp();
    } else {
      showInstallScreen();
    }
  });
}

function _showCTThankYou() {
  // Modify thank-you screen for CT members
  var tyTitle = document.querySelector('.ty-title');
  var tySub = document.querySelector('.ty-sub');
  if (tyTitle) tyTitle.textContent = "Welcome, trader.";
  if (tySub) tySub.textContent = "ChainRun is yours — free, from the CryptoTraders community.";

  // Replace referral section with CT referral card
  var refContainer = document.getElementById('ty-referral');
  if (refContainer && PAYGATE_STATE.ctCode) {
    var link = 'https://chainrun.tech?ref=' + PAYGATE_STATE.ctCode;
    refContainer.innerHTML =
      '<div class="ty-section-label">Share with a friend</div>' +
      '<div class="ty-ref-card ct-ref-card">' +
        '<p class="ty-ref-desc">Know someone who could use this? Share your link. If 2 people grab it, your access is locked in forever. If not — no stress, it\'s still yours.</p>' +
        '<div class="ty-ref-code-row">' +
          '<span class="ty-ref-code">' + PAYGATE_STATE.ctCode + '</span>' +
          '<button class="ty-ref-copy" onclick="_copyCtLink()">Copy link</button>' +
        '</div>' +
        '<div class="ty-ref-stats">' +
          '<span>' + PAYGATE_STATE.ctReferrals + ' of 2 referrals</span>' +
        '</div>' +
      '</div>';
    refContainer.style.display = '';
  }
}

function _copyCtLink() {
  var code = PAYGATE_STATE.ctCode;
  if (!code) return;
  var link = 'https://chainrun.tech?ref=' + code;
  if (navigator.share) {
    navigator.share({ title: 'ChainRun', text: 'Get $5 off ChainRun — 4 AI models, one prompt, better answers.', url: link });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() {
      var btn = document.querySelector('.ct-ref-card .ty-ref-copy');
      if (btn) { btn.textContent = 'Copied'; setTimeout(function() { btn.textContent = 'Copy link'; }, 1500); }
    });
  }
}

// ────────────────────────────────────
// Init paygate system
// ────────────────────────────────────
function initPaygate() {
  // Detect referral code from URL before anything else
  _detectReferral();

  // ── CryptoTraders path ──
  if (PAYGATE_STATE.isCT) {
    var alreadyRegistered = _handleCTFlow();
    if (alreadyRegistered) {
      // Refresh status in background
      _refreshCTStatus();
      if (isInstalledAsPWA()) {
        showApp();
      } else {
        onPaymentSuccess();
      }
      return;
    }
    // Show CT-flavored landing (free, no payment)
    showLanding();
    _showCTLanding();
    return;
  }

  // ── Normal paid path ──
  const isPaid = checkPaymentStatus();

  if (isPaid) {
    onPaymentSuccess();
  } else if (isInstalledAsPWA()) {
    showApp();
  } else {
    showLanding();
  }
}

// Auto-initialize on DOM ready
document.addEventListener('DOMContentLoaded', initPaygate);
