/**
 * GhostPIN SDK - Anti-phishing payment verification
 * Version: 1.0.0
 *
 * Server enforcement contract:
 * - Origin/domain allowlist validation (Origin, Referer, x-forwarded-host)
 * - Fetch Metadata checks (Sec-Fetch-Site same-origin/same-site)
 * - Optional DNS/TXT attestation binding domains to merchants
 * - Timestamp skew windows and replay prevention on nonces
 * - Visual nonce integrity verification against deterministic recompute
 * - Intent binding (amount|currency|description|merchant_reference)
 * - Authentication method validation (WebAuthn, OTP, device proofs)
 * - Risk rule execution (thresholds, velocity, geo, step-up policies)
 *
 * Client collects signals; server decides.
 */

(function(window) {
  'use strict';

  const DEFAULT_CONFIG = {
    NONCE_TTL: 300,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
  };

  // WebAuthn configuration
  const WEBAUTHN_CONFIG = {
    timeout: 60000,
    userVerification: 'required',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required'
    }
  };

  function readConfigFromScript() {
    const script = document.getElementById('ghostpin-config');
    if (!script) {
      return {};
    }

    try {
      const text = script.textContent || script.innerText || '';
      if (!text.trim()) {
        return {};
      }
      return JSON.parse(text);
    } catch (error) {
      console.warn('GhostPIN: failed to parse ghostpin-config JSON', error);
      return {};
    }
  }

  function mergeConfig(overrides = {}) {
    const scriptConfig = readConfigFromScript();
    return { ...DEFAULT_CONFIG, ...scriptConfig, ...overrides };
  }

  function bufferToBase64Url(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToArrayBuffer(base64url) {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function sha256Buffer(input) {
    let data;
    if (typeof input === 'string') {
      data = new TextEncoder().encode(input);
    } else if (input instanceof ArrayBuffer) {
      data = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      data = new Uint8Array(input.buffer);
    } else {
      data = new TextEncoder().encode(String(input));
    }
    return crypto.subtle.digest('SHA-256', data);
  }

  async function sha256Base64Url(input) {
    const hashBuffer = await sha256Buffer(input);
    return bufferToBase64Url(hashBuffer);
  }

  async function computeVisualNonce({ merchantId, domain, ts, intentHash }) {
    const payload = `${merchantId || ''}|${domain}|${ts}|${intentHash}`;
    const buffer = await sha256Buffer(payload);
    return new Uint8Array(buffer);
  }

  function resolveUrl(baseUrl, path) {
    try {
      return new URL(path, baseUrl || window.location.origin).toString();
    } catch (error) {
      return path;
    }
  }

  function isMobileUserAgent() {
    return /Mobi/i.test(navigator.userAgent || '');
  }

  class GhostPIN {
    constructor(options = {}) {
      this._overrides = { ...options };
      this.applyConfig(this._overrides);
      this.isInitialized = false;
      this.currentNonce = null;
      this.verificationInProgress = false;
      
      this.initPromise = this.init();
    }

    applyConfig(overrides = {}) {
      this._overrides = { ...this._overrides, ...overrides };
      this.config = mergeConfig(this._overrides);
      this.merchantId = this.config.merchantId;
      if (typeof this.merchantId === 'undefined') {
        this.merchantId = null;
      }
      this.apiUrl = this.config.apiUrl || window.location.origin;
      this.onConsent = typeof this.config.onConsent === 'function' ? this.config.onConsent : null;
      this.requireStrongestDefault = Boolean(this.config.requireStrongestFactor);
      this.sessionSecret = this.config.sessionSecret || null;
      this.transports = Array.isArray(this.config.transports) && this.config.transports.length > 0
        ? this.config.transports
        : ['internal'];
    }

    /**
     * Initialize GhostPIN SDK
     */
    async init() {
      try {
        // Check WebAuthn support
        if (!window.PublicKeyCredential || !navigator.credentials) {
          console.warn('GhostPIN: WebAuthn not supported, will attempt fallbacks.');
        }

        // Check crypto.subtle support
        if (!window.crypto || !window.crypto.subtle) {
          throw new Error('Web Crypto API not supported');
        }

        // Merchant ID is optional; when absent, backend must infer from origin
        if (!this.merchantId) {
          console.info('GhostPIN initialized without explicit merchantId; server will infer by origin.');
        }

        this.isInitialized = true;
        console.log('🔐 GhostPIN SDK initialized successfully');
        
      } catch (error) {
        console.error('❌ GhostPIN initialization failed:', error);
        throw error;
      }
    }

    async ensureInitialized() {
      if (this.isInitialized) {
        return;
      }

      if (this.initPromise) {
        await this.initPromise;
      }

      if (!this.isInitialized) {
        throw new Error('GhostPIN not initialized');
      }
    }

    /**
     * Generate deterministic visual nonce and embed in checkout button
     */
    async generateVisualNonce({ intentHash, targetElement, ts }) {
      try {
        await this.ensureInitialized();

        const domain = window.location.origin;
        const nonceBytes = await computeVisualNonce({
          merchantId: this.merchantId,
          domain,
          ts,
          intentHash
        });

        if (targetElement) {
          await this.embedVisualNonce(targetElement, nonceBytes);
        }

        const visualNonce = bufferToBase64Url(nonceBytes);
        const visualNonceHash = await sha256Base64Url(nonceBytes);
        this.currentNonce = visualNonce;

        return {
          bytes: nonceBytes,
          visualNonce,
          visualNonceHash
        };
      } catch (error) {
        console.error('Error generating visual nonce:', error);
        throw error;
      }
    }

    /**
     * Embed nonce visually using steganography
     */
    async embedVisualNonce(element, nonceBytes) {
      try {
        if (!element) {
          return;
        }

        const canvas = document.createElement('canvas');
        const stripeHeight = 2;
        canvas.width = Math.max(64, Math.min(256, element.getBoundingClientRect().width || 128));
        canvas.height = stripeHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error('Canvas context unavailable');
        }

        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        const bytes = nonceBytes instanceof Uint8Array ? nonceBytes : new Uint8Array(nonceBytes);
        const step = canvas.width / bytes.length;

        bytes.forEach((byte, index) => {
          const offset = Math.min(1, (index * step) / canvas.width);
          const hue = byte % 360;
          gradient.addColorStop(offset, `hsl(${hue}, 70%, 55%)`);
        });

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        element.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
        element.style.backgroundRepeat = 'repeat-x';
        element.style.backgroundSize = '100% 2px';
        element.setAttribute('data-ghostpin-nonce', bufferToBase64Url(bytes));
      } catch (error) {
        console.error('Error embedding visual nonce:', error);
        element?.setAttribute('data-ghostpin-nonce', bufferToBase64Url(nonceBytes));
      }
    }

    normalizeIntent(intent = {}) {
      const normalized = {
        amount: Number(intent.amount || 0),
        currency: (intent.currency || 'USD').toUpperCase(),
        description: intent.description || '',
        merchant_reference: intent.merchant_reference || intent.reference || `ref-${Date.now()}`
      };

      return normalized;
    }

    async buildIntentHash(intent) {
      const canonical = `${intent.amount}|${intent.currency}|${intent.description || ''}|${intent.merchant_reference}`;
      return sha256Base64Url(canonical);
    }

    /**
     * Main entry: authenticate factors and verify with GhostPIN backend
     */
    async authenticateAndVerify({ intent = {}, targetElement = null, requireStrongestFactor = false } = {}) {
      await this.ensureInitialized();

      if (this.verificationInProgress) {
        return { verified: false, reason: 'verification_in_progress' };
      }

      this.verificationInProgress = true;

      const normalizedIntent = this.normalizeIntent(intent);
      const intentHash = await this.buildIntentHash(normalizedIntent);
      const ts = Date.now();

      const domain = window.location.origin;

      const { visualNonce, visualNonceHash } = await this.generateVisualNonce({
        intentHash,
        targetElement,
        ts
      });

      const visualNonceSig = await this.fetchVisualNonceSignature({
        intentHash,
        ts,
        domain
      });

      const enforceStrongest = requireStrongestFactor || this.requireStrongestDefault;
      let method = 'webauthn';
      let consentState = 'enabled';
      let webauthnData = null;
      let otpData = null;
      let deviceData = null;

      try {
        const webauthnResult = await this.tryWebAuthn({
          domain,
          ts,
          intentHash,
          visualNonceHash
        });

        if (webauthnResult.success) {
          webauthnData = webauthnResult.payload;
        } else {
          if (enforceStrongest) {
            this.verificationInProgress = false;
            return { verified: false, reason: webauthnResult.error || 'webauthn_required' };
          }

          consentState = 'fallback';
          if (this.onConsent) {
            try {
              const consentResult = await this.onConsent({
                stage: 'fallback',
                reason: webauthnResult.error,
                suggestedMethod: 'otp'
              });
              if (consentResult === false || consentResult === 'declined') {
                this.verificationInProgress = false;
                return { verified: false, reason: 'user_declined_consent' };
              }
              if (consentResult === 'fallback') {
                consentState = 'fallback';
              }
            } catch (error) {
              console.warn('GhostPIN consent callback failed', error);
            }
          }

          const otpResult = await this.tryOtpFallback();
          if (otpResult.success) {
            method = 'otp';
            otpData = otpResult.payload;
            consentState = otpResult.consent || consentState;
          } else {
            if (otpResult.error === 'otp_cancelled') {
              this.verificationInProgress = false;
              return { verified: false, reason: 'otp_cancelled' };
            }

            const deviceResult = await this.tryDeviceFallback(intentHash);
            if (deviceResult.success) {
              method = 'device';
              deviceData = deviceResult.payload;
            } else {
              this.verificationInProgress = false;
              return { verified: false, reason: deviceResult.error || otpResult.error || webauthnResult.error || 'verification_aborted' };
            }
          }
        }

        const payload = {
          v: 1,
          merchantId: this.merchantId || null,
          domain,
          ts,
          intentHash,
          intent: {
            amount: normalizedIntent.amount,
            currency: normalizedIntent.currency,
            description: normalizedIntent.description,
            merchant_reference: normalizedIntent.merchant_reference
          },
        visualNonce,
        visualNonceHash,
        visualNonceSig,
        method,
          webauthn: webauthnData,
          otp: otpData,
          device: deviceData,
          consent: consentState,
          uaHints: {
            platform: navigator.platform || null,
            mobile: isMobileUserAgent(),
            screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
            language: navigator.language || null
          }
        };

        const response = await this.sendVerificationRequest(payload);
        this.emit('verification', response);
        this.verificationInProgress = false;

        if (response && response.verified) {
          return {
            verified: true,
            method,
            policy: response.policy,
            proof: response.proof
          };
        }

        return {
          verified: false,
          reason: response?.reason || 'verification_rejected'
        };
      } catch (error) {
        this.verificationInProgress = false;
        console.error('GhostPIN authenticateAndVerify error:', error);
        throw error;
      }
    }

    async tryWebAuthn({ domain, ts, intentHash, visualNonceHash }) {
      if (!navigator.credentials || !window.PublicKeyCredential) {
        return { success: false, error: 'webauthn_unavailable' };
      }

      try {
        if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
          const platformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          const hasCredentialIds = Array.isArray(this.config.allowCredentialIds) && this.config.allowCredentialIds.length > 0;
          if (!platformAvailable && !hasCredentialIds) {
            return { success: false, error: 'webauthn_unavailable' };
          }
        }

        const challengeInput = `${this.merchantId || ''}|${domain}|${ts}|${intentHash}|${visualNonceHash}`;
        const challengeBuffer = await sha256Buffer(challengeInput);
        const hostname = (() => {
          try {
            return new URL(domain).hostname;
          } catch (error) {
            return window.location.hostname;
          }
        })();

        const publicKey = {
          challenge: challengeBuffer,
          timeout: WEBAUTHN_CONFIG.timeout,
          userVerification: WEBAUTHN_CONFIG.userVerification,
          rpId: this.config.rpId || hostname
        };

        if (Array.isArray(this.config.allowCredentialIds) && this.config.allowCredentialIds.length > 0) {
          publicKey.allowCredentials = this.config.allowCredentialIds.map((id) => ({
            type: 'public-key',
            id: base64UrlToArrayBuffer(id),
            transports: ['internal']
          }));
        }

        const mediation = this.config.mediation || 'optional';
        const credential = await navigator.credentials.get({ publicKey, mediation });
        const payload = this.formatWebAuthnPayload(credential);

        return { success: true, payload };
      } catch (error) {
        const name = error?.name || '';
        const code = (name === 'NotAllowedError' || name === 'AbortError') ? 'user_cancelled' : 'webauthn_failed';
        console.warn('GhostPIN WebAuthn attempt failed:', name, error?.message || '');
        return { success: false, error: code };
      }
    }

    formatWebAuthnPayload(credential) {
      if (!credential) {
        return null;
      }

      const response = credential.response || {};
      return {
        rawId: credential.rawId ? bufferToBase64Url(credential.rawId) : null,
        signature: response.signature ? bufferToBase64Url(response.signature) : null,
        clientDataJSON: response.clientDataJSON ? bufferToBase64Url(response.clientDataJSON) : null,
        authenticatorData: response.authenticatorData ? bufferToBase64Url(response.authenticatorData) : null,
        userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null
      };
    }

    async tryOtpFallback() {
      try {
        const code = await this.promptForOtp();
        if (!code) {
          return { success: false, error: 'otp_cancelled' };
        }
        if (!/^\d{6}$/.test(code)) {
          return { success: false, error: 'otp_invalid' };
        }

        return {
          success: true,
          payload: { code },
          consent: 'fallback'
        };
      } catch (error) {
        console.warn('GhostPIN OTP fallback error:', error);
        return { success: false, error: error?.message || 'otp_failed' };
      }
    }

    async tryDeviceFallback(intentHash) {
      try {
        const fingerprint = [
          navigator.userAgent || '',
          navigator.language || '',
          navigator.platform || '',
          `${screen?.width || 0}x${screen?.height || 0}`,
          intentHash
        ].join('|');

        const deviceHash = await sha256Base64Url(fingerprint);
        let proof = null;

        if (this.sessionSecret) {
          proof = await this.hmacSha256Base64Url(this.sessionSecret, deviceHash);
        }

        return {
          success: true,
          payload: {
            deviceHash,
            proof
          }
        };
      } catch (error) {
        console.warn('GhostPIN device fallback error:', error);
        return { success: false, error: error?.message || 'device_proof_failed' };
      }
    }

    async promptForOtp() {
      return new Promise((resolve) => {
        const existing = document.getElementById('ghostpin-otp-modal');
        if (existing) {
          existing.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'ghostpin-otp-modal';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(15,23,42,0.72)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '2147483647';

        const dialog = document.createElement('div');
        dialog.style.background = '#ffffff';
        dialog.style.padding = '24px';
        dialog.style.borderRadius = '16px';
        dialog.style.width = '320px';
        dialog.style.boxShadow = '0 20px 60px rgba(15,23,42,0.35)';
        dialog.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

        const heading = document.createElement('h3');
        heading.textContent = 'Enter verification code';
        heading.style.margin = '0 0 12px 0';
        heading.style.fontSize = '18px';
        heading.style.color = '#0f172a';

        const description = document.createElement('p');
        description.textContent = 'Enter the 6-digit code from your authenticator.';
        description.style.margin = '0 0 16px 0';
        description.style.fontSize = '14px';
        description.style.color = '#475569';

        const input = document.createElement('input');
        input.type = 'tel';
        input.maxLength = 6;
        input.placeholder = '000000';
        input.style.fontSize = '20px';
        input.style.letterSpacing = '8px';
        input.style.textAlign = 'center';
        input.style.width = '100%';
        input.style.padding = '12px';
        input.style.marginBottom = '16px';
        input.style.border = '1px solid #cbd5f5';
        input.style.borderRadius = '12px';

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '12px';
        actions.style.justifyContent = 'flex-end';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.border = 'none';
        cancelBtn.style.background = '#e2e8f0';
        cancelBtn.style.color = '#0f172a';
        cancelBtn.style.padding = '10px 16px';
        cancelBtn.style.borderRadius = '10px';
        cancelBtn.style.cursor = 'pointer';

        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'Verify';
        submitBtn.style.border = 'none';
        submitBtn.style.background = '#2563eb';
        submitBtn.style.color = '#ffffff';
        submitBtn.style.padding = '10px 16px';
        submitBtn.style.borderRadius = '10px';
        submitBtn.style.cursor = 'pointer';

        const cleanup = (result) => {
          overlay.remove();
          resolve(result);
        };

        cancelBtn.addEventListener('click', () => cleanup(null));
        submitBtn.addEventListener('click', () => cleanup(input.value.trim()));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            cleanup(input.value.trim());
          }
        });

        dialog.appendChild(heading);
        dialog.appendChild(description);
        dialog.appendChild(input);
        actions.appendChild(cancelBtn);
        actions.appendChild(submitBtn);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        input.focus();
      });
    }

  async sendVerificationRequest(payload) {
      const endpoint = resolveUrl(this.apiUrl, '/verify');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout || 60000);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GhostPIN-Version': '1.0.0'
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          credentials: 'include'
        });

        clearTimeout(timeout);

        let data = null;
        try {
          data = await response.json();
        } catch (error) {
          data = null;
        }

        if (!response.ok) {
          return data || { verified: false, reason: `http_${response.status}` };
        }

        return data || { verified: false, reason: 'empty_response' };
      } catch (error) {
        clearTimeout(timeout);
        console.error('GhostPIN network error:', error);
        throw error;
      }
    }

  async hmacSha256Base64Url(secret, message) {
      const enc = new TextEncoder();
      const keyData = enc.encode(secret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: { name: 'SHA-256' } },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
      return bufferToBase64Url(signature);
    }

    async sha256(data) {
      const buffer = await sha256Buffer(data);
      return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    async fetchVisualNonceSignature({ intentHash, ts, domain }) {
      const endpoint = resolveUrl(this.apiUrl, '/nonce');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: this.merchantId,
          domain,
          ts,
          intentHash
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to sign visual nonce');
      }

      const data = await response.json();
      if (!data?.visualNonceSig) {
        throw new Error('Missing visual nonce signature');
      }
      return data.visualNonceSig;
    }

    wireCheckoutButtons() {
      const buttons = document.querySelectorAll('[data-ghostpin="checkout"]');
      buttons.forEach((btn) => {
        if (btn.dataset.ghostpinBound === 'true') {
          return;
        }

        btn.dataset.ghostpinBound = 'true';
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          const intent = this.buildIntentFromElement(btn);
          await this.authenticateAndVerify({ intent, targetElement: btn });
        });
      });
    }

    buildIntentFromElement(btn) {
      if (!btn) {
        return { amount: 0, currency: 'USD', description: '', merchant_reference: `ref-${Date.now()}` };
      }

      const amount = Number(btn.dataset.amount || btn.getAttribute('data-amount') || 0);
      const currency = (btn.dataset.currency || btn.getAttribute('data-currency') || 'USD').toUpperCase();
      const description = btn.dataset.description || btn.getAttribute('data-description') || btn.textContent.trim();
      const merchantReference = btn.dataset.merchantReference || btn.dataset.reference || btn.getAttribute('data-reference') || `ref-${Date.now()}`;

      return {
        amount,
        currency,
        description,
        merchant_reference: merchantReference
      };
    }

    /**
     * Event emitter functionality
     */
    emit(event, data) {
      const customEvent = new CustomEvent(`ghostpin:${event}`, {
        detail: data
      });
      window.dispatchEvent(customEvent);
    }

    /**
     * Add event listener
     */
    on(event, callback) {
      window.addEventListener(`ghostpin:${event}`, callback);
    }

    /**
     * Remove event listener
     */
    off(event, callback) {
      window.removeEventListener(`ghostpin:${event}`, callback);
    }
  }

  GhostPIN._singleton = null;

  GhostPIN.init = async function(options = {}) {
    if (!GhostPIN._singleton) {
      GhostPIN._singleton = new GhostPIN(options);
    } else {
      GhostPIN._singleton.applyConfig(options);
      GhostPIN._singleton.isInitialized = false;
      GhostPIN._singleton.initPromise = GhostPIN._singleton.init();
    }

    await GhostPIN._singleton.ensureInitialized();
    return GhostPIN._singleton;
  };

  GhostPIN.authenticateAndVerify = async function(params = {}) {
    const instance = GhostPIN._singleton || await GhostPIN.init();
    return instance.authenticateAndVerify(params);
  };

  GhostPIN.wireCheckoutButtons = async function(options = {}) {
    const instance = GhostPIN._singleton || await GhostPIN.init(options);
    instance.wireCheckoutButtons();
    return instance;
  };

  GhostPIN.getInstance = function() {
    return GhostPIN._singleton;
  };

  // Auto-initialize if merchant ID is provided via data attributes
  document.addEventListener('DOMContentLoaded', function() {
    const scripts = Array.from(document.querySelectorAll('script[src*="ghostpin.js"]'));
    if (scripts.length === 0) {
      return;
    }

    const firstScript = scripts[0];
    const merchantAttr = firstScript.getAttribute('data-merchant-id');
    const apiAttr = firstScript.getAttribute('data-api-url');

    const parsedOptions = {};
    if (merchantAttr) {
      parsedOptions.merchantId = merchantAttr === 'null' ? null : merchantAttr;
    }
    if (apiAttr) {
      parsedOptions.apiUrl = apiAttr;
    }

    GhostPIN.init(parsedOptions).then((instance) => {
      firstScript.__ghostpinInstance = instance;
      window.GhostPINClient = instance;
      window.GhostPINInstance = instance;
      window.__ghostpin = instance;

      window.dispatchEvent(new CustomEvent('ghostpin:ready', {
        detail: instance
      }));

      if (firstScript.getAttribute('data-auto-wire') === 'true') {
        instance.wireCheckoutButtons();
      }
    }).catch((error) => {
      console.error('GhostPIN auto-init failed:', error);
    });
  });

  // Export for module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GhostPIN;
  } else {
    window.GhostPIN = GhostPIN;
  }

})(window);
