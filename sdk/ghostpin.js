/**
 * GhostPIN SDK - Anti-phishing payment verification
 * Version: 1.0.0
 * 
 * Provides cryptographic proof of authenticity between user, merchant page, and payment gateway
 */

(function(window) {
  'use strict';

  // Configuration
  const CONFIG = {
    API_BASE_URL: 'https://api.ghostpin.com',
    NONCE_TTL: 300, // 5 minutes
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

  class GhostPIN {
    constructor(options = {}) {
      this.config = { ...CONFIG, ...options };
      this.merchantId = options.merchantId;
      this.apiUrl = options.apiUrl || CONFIG.API_BASE_URL;
      this.isInitialized = false;
      this.currentNonce = null;
      this.verificationInProgress = false;
      
      this.init();
    }

    /**
     * Initialize GhostPIN SDK
     */
    async init() {
      try {
        // Check WebAuthn support
        if (!window.PublicKeyCredential) {
          throw new Error('WebAuthn not supported in this browser');
        }

        // Check crypto.subtle support
        if (!window.crypto || !window.crypto.subtle) {
          throw new Error('Web Crypto API not supported');
        }

        // Validate merchant ID
        if (!this.merchantId) {
          throw new Error('Merchant ID is required');
        }

        this.isInitialized = true;
        console.log('🔐 GhostPIN SDK initialized successfully');
        
      } catch (error) {
        console.error('❌ GhostPIN initialization failed:', error);
        throw error;
      }
    }

    /**
     * Generate visual nonce and embed in checkout button
     */
    async generateVisualNonce(paymentIntent, targetElement) {
      try {
        if (!this.isInitialized) {
          throw new Error('GhostPIN not initialized');
        }

        // Generate cryptographic nonce
        const timestamp = Math.floor(Date.now() / 1000);
        const random = this.generateRandomBytes(32);
        const nonceData = `${this.merchantId}:${timestamp}:${JSON.stringify(paymentIntent)}:${random}`;
        const nonce = await this.sha256(nonceData);

        this.currentNonce = nonce;

        // Embed nonce visually in target element
        if (targetElement) {
          await this.embedVisualNonce(targetElement, nonce);
        }

        return nonce;
      } catch (error) {
        console.error('Error generating visual nonce:', error);
        throw error;
      }
    }

    /**
     * Embed nonce visually using steganography
     */
    async embedVisualNonce(element, nonce) {
      try {
        // Create canvas for visual embedding
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size to match element
        const rect = element.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Draw element background
        const computedStyle = window.getComputedStyle(element);
        ctx.fillStyle = computedStyle.backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Embed nonce in subpixel patterns
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Convert nonce to binary and embed in LSB
        const nonceBinary = this.hexToBinary(nonce);
        let bitIndex = 0;
        
        for (let i = 0; i < data.length && bitIndex < nonceBinary.length; i += 4) {
          const bit = nonceBinary[bitIndex % nonceBinary.length];
          data[i] = (data[i] & 0xFE) | (bit === '1' ? 1 : 0);
          bitIndex++;
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        // Apply as background to element
        element.style.backgroundImage = `url(${canvas.toDataURL()})`;
        element.style.backgroundSize = 'cover';
        
      } catch (error) {
        console.error('Error embedding visual nonce:', error);
        // Fallback: store nonce in data attribute
        element.setAttribute('data-ghostpin-nonce', nonce);
      }
    }

    /**
     * Verify payment with WebAuthn authentication
     */
    async verifyPayment(paymentIntent, options = {}) {
      try {
        if (this.verificationInProgress) {
          throw new Error('Verification already in progress');
        }

        this.verificationInProgress = true;

        // Generate nonce
        const nonce = await this.generateVisualNonce(paymentIntent, options.targetElement);
        
        // Prepare WebAuthn challenge
        const challenge = await this.generateChallenge(nonce, paymentIntent);
        
        // Request WebAuthn authentication
        const credential = await this.requestWebAuthnAuth(challenge);
        
        // Create signed payload
        const payload = await this.createSignedPayload({
          nonce,
          paymentIntent,
          credential,
          origin: window.location.origin
        });
        
        // Send to verification endpoint
        const result = await this.sendVerificationRequest(payload);
        
        this.verificationInProgress = false;
        return result;
        
      } catch (error) {
        this.verificationInProgress = false;
        console.error('Payment verification failed:', error);
        throw error;
      }
    }

    /**
     * Request WebAuthn authentication
     */
    async requestWebAuthnAuth(challenge) {
      try {
        const publicKeyCredentialRequestOptions = {
          challenge: challenge,
          allowCredentials: [], // Allow any credential
          userVerification: WEBAUTHN_CONFIG.userVerification,
          timeout: WEBAUTHN_CONFIG.timeout
        };

        const credential = await navigator.credentials.get({
          publicKey: publicKeyCredentialRequestOptions
        });

        return credential;
      } catch (error) {
        console.error('WebAuthn authentication failed:', error);
        
        // Fallback to OTP if WebAuthn fails
        if (options.fallbackToOTP) {
          return await this.requestOTP();
        }
        
        throw error;
      }
    }

    /**
     * Create signed payload for verification
     */
    async createSignedPayload({ nonce, paymentIntent, credential, origin }) {
      const timestamp = Math.floor(Date.now() / 1000);
      
      const payload = {
        merchant_id: this.merchantId,
        origin: origin,
        nonce: nonce,
        payment_intent: paymentIntent,
        timestamp: timestamp,
        credential_id: this.arrayBufferToBase64(credential.id),
        signature: this.arrayBufferToBase64(credential.response.signature),
        client_data: this.arrayBufferToBase64(credential.response.clientDataJSON),
        authenticator_data: this.arrayBufferToBase64(credential.response.authenticatorData)
      };

      return payload;
    }

    /**
     * Send verification request to backend
     */
    async sendVerificationRequest(payload) {
      try {
        const response = await fetch(`${this.apiUrl}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GhostPIN-Version': '1.0.0'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.reason || 'Verification failed');
        }

        const result = await response.json();
        
        // Emit verification event
        this.emit('verification', result);
        
        return result;
      } catch (error) {
        console.error('Verification request failed:', error);
        throw error;
      }
    }

    /**
     * Generate cryptographic challenge
     */
    async generateChallenge(nonce, paymentIntent) {
      const challengeData = {
        nonce,
        paymentIntent,
        timestamp: Date.now(),
        origin: window.location.origin
      };
      
      const challengeString = JSON.stringify(challengeData);
      const challengeBuffer = new TextEncoder().encode(challengeString);
      
      return challengeBuffer;
    }

    /**
     * Utility: SHA256 hash
     */
    async sha256(data) {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      return this.arrayBufferToHex(hashBuffer);
    }

    /**
     * Utility: Generate random bytes
     */
    generateRandomBytes(length) {
      const array = new Uint8Array(length);
      crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Utility: Convert ArrayBuffer to hex string
     */
    arrayBufferToHex(buffer) {
      return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    /**
     * Utility: Convert ArrayBuffer to base64
     */
    arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }

    /**
     * Utility: Convert hex to binary
     */
    hexToBinary(hex) {
      return hex.split('').map(h => parseInt(h, 16).toString(2).padStart(4, '0')).join('');
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

  // Auto-initialize if merchant ID is provided via data attributes
  document.addEventListener('DOMContentLoaded', function() {
    const script = document.querySelector('script[src*="ghostpin.js"]');
    if (script) {
      const merchantId = script.getAttribute('data-merchant-id');
      const apiUrl = script.getAttribute('data-api-url');
      
      if (merchantId) {
        window.GhostPIN = new GhostPIN({
          merchantId: merchantId,
          apiUrl: apiUrl
        });
      }
    }
  });

  // Export for module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GhostPIN;
  } else {
    window.GhostPIN = GhostPIN;
  }

})(window);
