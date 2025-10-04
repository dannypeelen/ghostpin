(function () {
  'use strict';

  const config = readConfig();
  const resolveUrl = createUrlResolver(config.apiUrl);
  const statusEl = document.getElementById('status');
  let ghostpinInstancePromise;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireCheckoutButtons, { once: true });
  } else {
    wireCheckoutButtons();
  }

  function readConfig() {
    const script = document.getElementById('ghostpin-config');
    if (!script) {
      return {};
    }

    try {
      const json = JSON.parse(script.textContent.trim());
      return json || {};
    } catch (error) {
      console.warn('Invalid GhostPIN config JSON', error);
      return {};
    }
  }

  function createUrlResolver(baseUrl) {
    if (!baseUrl || baseUrl === 'inherit') {
      return (path) => new URL(path, window.location.origin).toString();
    }
    return (path) => new URL(path, baseUrl).toString();
  }

  function wireCheckoutButtons() {
    const buttons = document.querySelectorAll('[data-ghostpin="checkout"]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        handleCheckout(btn).catch((error) => {
          console.error('GhostPIN checkout failed', error);
        });
      });
    });
  }

  async function handleCheckout(btn) {
    if (btn.dataset.ghostpinProcessing === 'true') {
      return;
    }

    btn.dataset.ghostpinProcessing = 'true';

    const originalLabel = btn.textContent.trim();
    updateButton(btn, 'Verifying...', true);
    updateStatus('Starting GhostPIN verification...', 'info');

    try {
      const intent = await buildIntent(btn);
      const ghostpin = await getGhostpinInstance();
      const visualNonce = await ghostpin.generateVisualNonce(intent, btn);
      const intentHash = await hashIntent(intent);

      const attempts = [];
      const webauthnAttempt = await attemptWebAuthn(intent, visualNonce, attempts);
      const otpAttempt = webauthnAttempt?.success ? null : await attemptOtp(intent, attempts);
      const deviceAttempt = (webauthnAttempt?.success || otpAttempt?.success)
        ? null
        : await attemptDeviceProof(intent, attempts);

      const successfulAttempt = [webauthnAttempt, otpAttempt, deviceAttempt]
        .filter(Boolean)
        .find((attempt) => attempt.success);

      if (!successfulAttempt) {
        throw new Error('Multi-factor verification did not succeed.');
      }

      const proofPayload = await buildProofPayload({
        intent,
        visualNonce,
        intentHash,
        attempts,
        successfulAttempt,
      });

      const verifyResponse = await submitProof(proofPayload);

      if (verifyResponse.verified) {
        updateStatus('Verification complete. Finalizing transaction...', 'success');
        updateButton(btn, 'Verified', true);

        if (shouldCapture(verifyResponse)) {
          await capturePayment(verifyResponse);
        }

        showResultMessage(verifyResponse, true);
      } else {
        showResultMessage(verifyResponse, false);
        throw new Error(verifyResponse.reason || 'Verification failed');
      }
    } catch (error) {
      updateStatus(error.message || 'Verification failed.', 'error');
      updateButton(btn, originalLabel, false);
      throw error;
    } finally {
      btn.dataset.ghostpinProcessing = 'false';
    }
  }

  async function buildIntent(btn) {
    const amount = Number(btn.dataset.amount || 0);
    const currency = (btn.dataset.currency || 'USD').toUpperCase();
    const description = btn.dataset.description || btn.textContent.trim();
    const merchantReferencePrefix = btn.dataset.referencePrefix || 'order';

    return {
      amount,
      currency,
      description,
      merchant_reference: `${merchantReferencePrefix}-${Date.now()}`,
      metadata: {
        items: btn.dataset.items ? btn.dataset.items.split(',').map((item) => item.trim()) : [],
        campaign: btn.dataset.campaign || null,
        pagePath: window.location.pathname,
      },
    };
  }

  async function hashIntent(intent) {
    const normalized = `${intent.amount}|${intent.currency}|${intent.description}`;
    const data = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(digest);
  }

  async function getGhostpinInstance() {
    if (!ghostpinInstancePromise) {
      ghostpinInstancePromise = (async () => {
        if (window.GhostPINEnhanced) {
          return new window.GhostPINEnhanced(config);
        }
        if (window.GhostPIN) {
          return new window.GhostPIN(config);
        }
        throw new Error('GhostPIN SDK not available');
      })();
    }

    return ghostpinInstancePromise;
  }

  async function attemptWebAuthn(intent, visualNonce, attempts) {
    try {
      updateStatus('Requesting WebAuthn verification...', 'info');

      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const publicKey = {
        challenge: challenge.buffer,
        timeout: 60000,
        userVerification: 'required',
        rpId: config.rpId || window.location.hostname,
      };

      if (Array.isArray(config.allowCredentialIds) && config.allowCredentialIds.length > 0) {
        publicKey.allowCredentials = config.allowCredentialIds.map((id) => ({
          type: 'public-key',
          id: base64urlToUint8Array(id),
        }));
      }

      const credential = await navigator.credentials.get({ publicKey });

      const proof = {
        type: 'webauthn',
        signature: arrayBufferToBase64Url(credential.response.signature),
        clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON),
        authenticatorData: arrayBufferToBase64Url(credential.response.authenticatorData),
        credentialId: arrayBufferToBase64Url(credential.rawId),
        userHandle: credential.response.userHandle
          ? arrayBufferToBase64Url(credential.response.userHandle)
          : null,
        challenge: arrayBufferToBase64Url(challenge.buffer),
        visualNonce,
      };

      const attempt = { method: 'webauthn', success: true, proof };
      attempts.push(attempt);
      return attempt;
    } catch (error) {
      const attempt = {
        method: 'webauthn',
        success: false,
        error: sanitizeError(error),
      };
      attempts.push(attempt);
      updateStatus('WebAuthn unavailable, moving to OTP fallback...', 'warning');
      return attempt;
    }
  }

  async function attemptOtp(intent, attempts) {
    try {
      updateStatus('Requesting one-time code...', 'info');
      const otpPrompt = config.otpPromptMessage || 'Enter the code from your authenticator:';
      const otp = window.prompt(otpPrompt);

      if (!otp) {
        throw new Error('OTP not provided');
      }

      const attempt = {
        method: 'otp',
        success: true,
        proof: {
          otp,
          channel: config.otpChannel || 'totp',
          issuedAt: Date.now(),
          intentSummary: `${intent.amount}|${intent.currency}`,
        },
      };

      attempts.push(attempt);
      return attempt;
    } catch (error) {
      const attempt = {
        method: 'otp',
        success: false,
        error: sanitizeError(error),
      };
      attempts.push(attempt);
      updateStatus('OTP fallback unavailable, attempting device proof...', 'warning');
      return attempt;
    }
  }

  async function attemptDeviceProof(intent, attempts) {
    try {
      updateStatus('Deriving device proof...', 'info');
      const deviceFingerprint = await hashString([
        navigator.userAgent,
        navigator.language,
        navigator.platform,
        screen.width + 'x' + screen.height,
        intent.merchant_reference,
      ].join('|'));

      const attempt = {
        method: 'device-proof',
        success: true,
        proof: {
          deviceHash: deviceFingerprint,
          sessionEntropy: await hashString(String(performance.now())),
        },
      };

      attempts.push(attempt);
      return attempt;
    } catch (error) {
      const attempt = {
        method: 'device-proof',
        success: false,
        error: sanitizeError(error),
      };
      attempts.push(attempt);
      return attempt;
    }
  }

  async function buildProofPayload({ intent, visualNonce, intentHash, attempts, successfulAttempt }) {
    const timestamp = Date.now();

    return {
      merchantId: config.merchantId || null,
      origin: window.location.origin,
      referer: document.referrer || null,
      visualNonce,
      intent,
      intentHash,
      merchantReference: intent.merchant_reference,
      timestamp,
      attempts,
      successfulMethod: successfulAttempt.method,
      clientContext: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      },
      policy: config.riskPolicy || null,
      fetchMetadata: {
        site: inferFetchSite(),
        mode: 'cors',
      },
      dnsAttestation: config.dnsAttestation || null,
      nonceIssuedAt: timestamp,
    };
  }

  async function submitProof(proofPayload) {
    const response = await fetch(resolveUrl('/verify'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GhostPIN-Client': 'demo-checkout/1.0.0',
      },
      body: JSON.stringify(proofPayload),
    });

    if (!response.ok) {
      const reason = await safeReadJson(response);
      updateStatus(reason?.reason || 'Verification rejected.', 'error');
      return {
        verified: false,
        reason: reason?.reason || 'verification_failed',
      };
    }

    return await safeReadJson(response);
  }

  function shouldCapture(response) {
    if (response.capture === false) {
      return false;
    }
    if (response.capture === true) {
      return true;
    }
    return Boolean(config.capture === true);
  }

  async function capturePayment(response) {
    try {
      const payload = {
        merchantReference: response.merchantReference,
        proofId: response.proofId,
      };

      const captureEndpoint = response.captureEndpoint || config.captureEndpoint || '/capture-payment';
      await fetch(resolveUrl(captureEndpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn('Capture payment failed', error);
    }
  }

  function showResultMessage(response, success) {
    if (success) {
      const message = response.message || 'Payment captured with GhostPIN protection.';
      updateStatus(message, 'success');
    } else {
      const neutralMessage = response.reason || 'Verification blocked by policy.';
      updateStatus(neutralMessage, 'warning');
    }
  }

  async function hashString(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(digest);
  }

  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function arrayBufferToBase64Url(buffer) {
    const byteArray = new Uint8Array(buffer);
    let binary = '';
    byteArray.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64urlToUint8Array(base64url) {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  function sanitizeError(error) {
    if (!error) {
      return { message: 'unknown_error' };
    }
    if (typeof error === 'string') {
      return { message: error };
    }
    return {
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }

  async function safeReadJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
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

  function inferFetchSite() {
    try {
      const pageOrigin = window.location.origin;
      const apiOrigin = new URL(config.apiUrl || '', window.location.origin).origin;
      return pageOrigin === apiOrigin ? 'same-origin' : 'cross-site';
    } catch (error) {
      return 'unknown';
    }
  }

  window.handleCheckout = handleCheckout;
})();
