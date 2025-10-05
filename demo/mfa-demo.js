(function () {
  'use strict';

  const root = document.querySelector('[data-mfa-demo]');
  const globalState = window.GhostPINMfaDemo || {};

  function noop() {}
  function noopPromise() {
    return Promise.resolve();
  }

  if (!root) {
    window.GhostPINMfaDemo = Object.assign(globalState, {
      requireVerification: noopPromise,
      isVerified: () => true,
      resetSession: noop,
      nudge: noop,
      onVerified: () => noop
    });
    return;
  }

  const container = root.closest('.mfa-demo');
  const refreshBtn = container?.querySelector('[data-mfa-refresh]') || null;
  const form = root.querySelector('[data-mfa-form]') || null;
  const otpInput = root.querySelector('[data-mfa-otp]') || null;
  const secretEl = root.querySelector('[data-mfa-secret]') || null;
  const feedbackEl = root.querySelector('[data-mfa-feedback]') || null;
  const qrImg = root.querySelector('[data-mfa-qr]') || null;
  const hintEl = root.querySelector('[data-mfa-hint]') || null;
  const submitBtn = form ? form.querySelector('.mfa-submit') : null;
  const configEl = document.getElementById('ghostpin-config');

  let apiBase = window.location.origin;
  try {
    if (configEl?.textContent) {
      const parsed = JSON.parse(configEl.textContent);
      if (parsed.apiUrl) {
        apiBase = parsed.apiUrl;
      }
    }
  } catch (error) {
    console.warn('GhostPIN MFA demo: unable to parse config', error);
  }
  apiBase = (apiBase || window.location.origin).replace(/\/$/, '');

  const state = {
    demoToken: null,
    verified: false,
    loading: false
  };

  let sessionPromise = null;
  let requirementPromise = null;
  let requirementResolve = null;
  let requirementReject = null;
  const verifiedCallbacks = new Set();

  function openPanel() {
    if (container) {
      container.classList.add('is-open');
      if (typeof container.scrollIntoView === 'function') {
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function hidePanel() {
    if (container) {
      container.classList.remove('is-open');
    }
  }

  function setGridClass(name, active) {
    root.classList.toggle(name, Boolean(active));
  }

  function setFeedback(message, tone = 'info') {
    if (!feedbackEl) {
      return;
    }
    feedbackEl.textContent = message;
    feedbackEl.className = tone ? `mfa-feedback ${tone}` : 'mfa-feedback';
  }

  function setOtpEnabled(enabled, focus = false) {
    if (!otpInput) {
      return;
    }
    otpInput.disabled = !enabled;
    if (!enabled) {
      otpInput.blur();
    } else if (focus) {
      window.requestAnimationFrame(() => otpInput.focus());
    }
    if (submitBtn) {
      submitBtn.disabled = !enabled;
    }
  }

  function clearVisuals() {
    if (qrImg) {
      qrImg.style.display = 'none';
      qrImg.removeAttribute('src');
    }
    if (secretEl) {
      secretEl.textContent = 'Pending checkout';
    }
    if (hintEl) {
      hintEl.textContent = 'A new GhostPIN integrity challenge will appear when required.';
    }
  }

  async function startNewSession({ focus = false } = {}) {
    if (state.loading) {
      return sessionPromise ?? Promise.resolve(false);
    }

    state.loading = true;
    state.verified = false;
    state.demoToken = null;
    setGridClass('verified', false);
    setGridClass('loading', true);
    setFeedback('Issuing GhostPIN integrity challenge…', 'info');
    if (form) {
      form.reset();
    }
    setOtpEnabled(false);
    clearVisuals();
    if (secretEl) {
      secretEl.textContent = 'Loading…';
    }
    if (hintEl) {
      hintEl.textContent = 'Codes refresh every 30 seconds. Session expires in 5 minutes.';
    }
    refreshBtn?.setAttribute('disabled', 'true');

    sessionPromise = (async () => {
      try {
        const response = await fetch(`${apiBase}/api/demo-mfa/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to create MFA demo session');
        }

        state.demoToken = payload.demoToken;

        if (qrImg && payload.qrCodeDataUrl) {
          qrImg.src = payload.qrCodeDataUrl;
          qrImg.style.display = 'block';
        }

        if (secretEl) {
          secretEl.textContent = payload.secretBase32 || 'Unavailable';
        }

        if (hintEl) {
          const ttlMinutes = payload.expiresIn ? Math.max(1, Math.round(payload.expiresIn / 60)) : 5;
          hintEl.textContent = `Codes refresh every 30 seconds. Session expires in ${ttlMinutes} minute${ttlMinutes === 1 ? '' : 's'}.`;
        }

        setFeedback('Scan the QR with your authenticator, then enter the current code.', 'info');
        setOtpEnabled(true, focus);
        return true;
      } catch (error) {
        console.error('GhostPIN MFA demo session error:', error);
        setFeedback(error.message || 'Unable to create a demo session.', 'error');
        state.demoToken = null;
        if (requirementReject) {
          requirementReject(error);
          requirementPromise = null;
          requirementResolve = null;
          requirementReject = null;
        }
        return false;
      } finally {
        state.loading = false;
        setGridClass('loading', false);
        refreshBtn?.removeAttribute('disabled');
        sessionPromise = null;
      }
    })();

    return sessionPromise;
  }

  async function ensureSession({ focus = false, forceNew = false } = {}) {
    if (state.loading) {
      const ok = await (sessionPromise ?? Promise.resolve(false));
      if (ok && focus) {
        setOtpEnabled(true, true);
      }
      return ok;
    }

    if (!forceNew && state.demoToken) {
      if (!state.verified) {
        setFeedback('Enter the current 6-digit code from your authenticator.', 'info');
        setOtpEnabled(true, focus);
      }
      return true;
    }

    return startNewSession({ focus });
  }

  async function requireVerification() {
    if (state.verified) {
      return;
    }

    openPanel();

    const ok = await ensureSession({ focus: true });
    if (!ok) {
      throw new Error('Unable to start MFA session. Please try again.');
    }

    if (!requirementPromise) {
      requirementPromise = new Promise((resolve, reject) => {
        requirementResolve = resolve;
        requirementReject = reject;
      });
    }

    return requirementPromise;
  }

  function nudge() {
    openPanel();
    ensureSession({ focus: true }).then((ok) => {
      if (ok && !state.verified) {
      setFeedback('Complete the GhostPIN integrity challenge to continue checkout.', 'warning');
      }
    }).catch((error) => {
      console.warn('GhostPIN MFA demo nudge error:', error);
    });
  }

  async function verifyOtp(event) {
    event?.preventDefault?.();

    if (state.verified) {
      setFeedback('Session already verified. Continue the checkout.', 'success');
      return;
    }

    if (!state.demoToken) {
      setFeedback('No active session. Use “New session” to regenerate a code.', 'warning');
      return;
    }

    const code = otpInput ? otpInput.value.trim() : '';
    if (code.length !== 6) {
      setFeedback('Enter the 6-digit code from your authenticator app.', 'warning');
      setOtpEnabled(true, true);
      return;
    }

    setGridClass('loading', true);
    setFeedback('Verifying code…', 'info');
    setOtpEnabled(false);
    refreshBtn?.setAttribute('disabled', 'true');

    try {
      const response = await fetch(`${apiBase}/api/demo-mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoToken: state.demoToken, otp: code })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.reason || payload.error || 'Verification failed. Try again.');
      }

      state.verified = true;
      state.demoToken = null;
      setGridClass('verified', true);
      setFeedback(payload.message || 'Integrity challenge accepted. Continuing GhostPIN attestation…', 'success');
      if (hintEl) {
        hintEl.textContent = 'Code accepted. Waiting for GhostPIN attestation…';
      }
      if (otpInput) {
        otpInput.value = '';
      }

      if (requirementResolve) {
        requirementResolve();
      }
      requirementPromise = null;
      requirementResolve = null;
      requirementReject = null;

      verifiedCallbacks.forEach((callback) => {
        try {
          callback();
        } catch (callbackError) {
          console.warn('GhostPIN MFA callback error:', callbackError);
        }
      });
    } catch (error) {
      console.warn('GhostPIN MFA demo verification error:', error);
      setFeedback(error.message || 'Verification failed. Try the next code.', 'error');
      setOtpEnabled(true, true);
    } finally {
      setGridClass('loading', false);
      refreshBtn?.removeAttribute('disabled');
      if (!state.verified) {
        setOtpEnabled(true, false);
      }
    }
  }

  function resetSession({ hide = true, silent = false } = {}) {
    state.demoToken = null;
    state.verified = false;
    state.loading = false;
    sessionPromise = null;
    if (requirementReject) {
      requirementReject(new Error('Integrity challenge reset.'));
    }
    requirementPromise = null;
    requirementResolve = null;
    requirementReject = null;

    setGridClass('loading', false);
    setGridClass('verified', false);

    if (form) {
      form.reset();
    }
    setOtpEnabled(false);
    clearVisuals();

    if (!silent) {
      setFeedback('A new GhostPIN integrity challenge will appear when you start checkout.', 'info');
    }

    if (hide) {
      hidePanel();
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (event) => {
      event.preventDefault();
      ensureSession({ focus: true, forceNew: true });
    });
  }

  if (form) {
    form.addEventListener('submit', verifyOtp);
  }

  resetSession({ hide: true, silent: true });

  window.GhostPINMfaDemo = Object.assign(globalState, {
    requireVerification,
    isVerified: () => state.verified,
    resetSession,
    nudge,
    onVerified(callback) {
      if (typeof callback === 'function') {
        verifiedCallbacks.add(callback);
        return () => verifiedCallbacks.delete(callback);
      }
      return noop;
    }
  });
})();
