(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  const demoContext = document.body?.dataset.demoContext || 'real';
  const summaryEl = document.querySelector('[data-verification-summary]');
  const summaryListEl = summaryEl?.querySelector('[data-verification-list]') || null;
  const summaryTitleEl = summaryEl?.querySelector('[data-verification-title]') || null;

  let configData = {};
  const configEl = document.getElementById('ghostpin-config');
  if (configEl?.textContent) {
    try {
      configData = JSON.parse(configEl.textContent);
    } catch (error) {
      console.warn('GhostPIN demo: failed to parse config JSON', error);
    }
  }

  async function bootstrap() {
    try {
      const instance = await window.GhostPIN.init();
      wireButtons(instance);
      if (window.GhostPINMfaDemo && typeof window.GhostPINMfaDemo.onVerified === 'function') {
        window.GhostPINMfaDemo.onVerified(() => {
          updateStatus('Integrity challenge accepted. Running GhostPIN attestation…', 'info');
        });
      }
    } catch (error) {
      console.error('GhostPIN bootstrap failed:', error);
      updateStatus('Verification system unavailable. Try again later.', 'error');
    }
  }

  function wireButtons(instance) {
    const buttons = document.querySelectorAll('[data-ghostpin="checkout"]');
    buttons.forEach((btn) => {
      if (btn.dataset.ghostpinBound === 'true') {
        return;
      }
      btn.dataset.ghostpinBound = 'true';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        handleCheckout(instance, btn).catch((error) => {
          console.error('GhostPIN checkout error:', error);
        });
      });
    });
  }

  function buildIntent(btn) {
    const amount = Number(btn.dataset.amount || btn.getAttribute('data-amount') || 0);
    const currency = (btn.dataset.currency || btn.getAttribute('data-currency') || 'USD').toUpperCase();
    const description = btn.dataset.description || btn.getAttribute('data-description') || btn.textContent.trim();
    const merchantReference = btn.dataset.reference || btn.dataset.merchantReference || `ref-${Date.now()}`;

    return {
      amount,
      currency,
      description,
      merchant_reference: merchantReference
    };
  }

  async function handleCheckout(instance, btn) {
    if (btn.dataset.ghostpinProcessing === 'true') {
      return;
    }

    resetSummary();

    btn.dataset.ghostpinProcessing = 'true';
    const originalLabel = btn.innerHTML;

    try {
      if (window.GhostPINMfaDemo && typeof window.GhostPINMfaDemo.requireVerification === 'function') {
        updateButton(btn, 'Preparing integrity challenge…', true);
        updateStatus('Authenticating page integrity. Scan the QR that just appeared.', 'info');
        await window.GhostPINMfaDemo.requireVerification();
      }

      updateButton(btn, 'Running attestation…', true);
      updateStatus('Confirming device, merchant, and session integrity…', 'info');

      const intent = buildIntent(btn);
      const attestation = await performAttestation(instance, intent);

      renderSummary(attestation);

      if (attestation.verified) {
        updateButton(btn, 'Verified', true);
        updateStatus(attestation.statusMessage || 'Attestation succeeded. Capturing payment…', 'success');
        await capturePayment(instance, intent, attestation);
        updateStatus('Payment captured successfully.', 'success');
        window.setTimeout(() => updateButton(btn, originalLabel, false), 1600);
      } else {
        handleFailure(btn, originalLabel, attestation.statusMessage || attestation.reason || 'Verification blocked.', attestation);
      }
    } catch (error) {
      const fallbackMessage =
        demoContext === 'scam'
          ? 'GhostPIN detected a spoofed flow and stopped the payment.'
          : 'Verification failed. Please try again.';
      handleFailure(btn, originalLabel, error.message || fallbackMessage, { error });
    } finally {
      btn.dataset.ghostpinProcessing = 'false';
    }
  }

  function handleFailure(btn, originalLabel, message, details) {
    updateButton(btn, originalLabel, false);
    const tone = demoContext === 'scam' ? 'error' : 'warning';
    updateStatus(message, tone);
    renderSummary(Object.assign({ verified: false, statusMessage: message }, details));
    if (typeof window.GhostPINMfaDemo?.resetSession === 'function') {
      window.GhostPINMfaDemo.resetSession({ hide: false, silent: true });
    }
  }

  async function capturePayment(instance, intent, attestation) {
    try {
      const apiBase = instance?.apiUrl || configData.apiUrl || window.location.origin;
      const endpoint = new URL('/capture-payment', apiBase).toString();
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, verification: attestation })
      });
    } catch (error) {
      console.warn('Capture payment failed', error);
    }
  }

  function updateButton(btn, label, disabled) {
    btn.innerHTML = `<span>${label}</span>`;
    btn.disabled = Boolean(disabled);
  }

  function updateStatus(message, type) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.className = type ? `status ${type}` : 'status';
  }

  function resetSummary() {
    if (!summaryEl) {
      return;
    }
    summaryEl.dataset.state = 'hidden';
    if (summaryTitleEl) {
      summaryTitleEl.textContent = 'GhostPIN Attestation Results';
    }
    if (summaryListEl) {
      summaryListEl.innerHTML = '';
    }
  }

  function renderSummary(result = {}) {
    if (!summaryEl || !summaryListEl) {
      return;
    }

    const pass = Boolean(result.verified);
    summaryEl.dataset.state = pass ? 'success' : 'failure';

    const entries = selectEntries(result, pass);

    if (summaryTitleEl) {
      summaryTitleEl.textContent = result.summaryTitle || (pass ? 'GhostPIN Attestation: All checks passed' : 'GhostPIN Attestation: Blocked');
    }

    summaryListEl.innerHTML = '';
    entries.forEach((entry) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="check-icon" data-state="${entry.pass ? 'pass' : 'fail'}"></span><span>${entry.text}</span>`;
      summaryListEl.appendChild(li);
    });
  }

  function selectEntries(result, pass) {
    if (Array.isArray(result.entries) && result.entries.length) {
      return result.entries;
    }

    return pass ? buildPassEntries(result) : buildFailureEntries(result);
  }

  function buildPassEntries(result = {}) {
    const origin = window.location.origin;
    const merchantName = result.merchantName || configData.merchantId || 'Registered merchant';
    const description = result.intent?.description ? ` for ${result.intent.description}` : '';

    return [
      { text: `Merchant origin verified (${origin}).`, pass: true },
      { text: `Handshake signature validated for ${merchantName}.`, pass: true },
      { text: 'Page nonce intact; DOM fingerprint matches baseline.', pass: true },
      { text: `Risk engine cleared the transaction${description}.`, pass: true }
    ];
  }

  function buildFailureEntries(result = {}) {
    const origin = window.location.origin;
    const message = result.statusMessage || result.reason || 'Verification blocked.';

    if (demoContext === 'scam') {
      return [
        { text: `Domain mismatch detected (${origin}).`, pass: false },
        { text: 'Handshake signature rejected – spoofed payload detected.', pass: false },
        { text: 'Visual nonce missing or tampered.', pass: false },
        { text: message, pass: false }
      ];
    }

    return [
      { text: message, pass: false },
      { text: 'Retry the flow to regenerate a fresh attestation.', pass: false }
    ];
  }

  async function performAttestation(instance, intent) {
    await delay(350 + Math.random() * 300);

    const merchantName = instance?.merchantId || configData.merchantId || 'Registered merchant';
    const origin = window.location.origin;

    if (demoContext === 'real') {
      return {
        verified: true,
        statusMessage: 'All GhostPIN checks passed. Capturing payment…',
        summaryTitle: 'GhostPIN Attestation: All checks passed',
        merchantName,
        intent,
        entries: [
          { text: `Merchant origin verified (${origin}).`, pass: true },
          { text: `Handshake signature validated for ${merchantName}.`, pass: true },
          { text: 'Page nonce intact; DOM fingerprint matches baseline.', pass: true },
          { text: 'Risk engine cleared the transaction.', pass: true }
        ]
      };
    }

    return {
      verified: false,
      statusMessage: 'GhostPIN blocked this phishing attempt: merchant attestation failed.',
      summaryTitle: 'GhostPIN Attestation: Blocked',
      merchantName,
      intent,
      reason: 'Merchant registry mismatch.',
      entries: [
        { text: `Domain mismatch detected (${origin}).`, pass: false },
        { text: 'Handshake signature rejected – spoofed payload detected.', pass: false },
        { text: 'Visual nonce missing or tampered.', pass: false },
        { text: 'Risk score exceeded policy thresholds.', pass: false }
      ]
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
