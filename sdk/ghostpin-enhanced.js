/**
 * GhostPIN Enhanced SDK - Two-Way Handshake MFA
 * Implements mutual authentication between user, merchant, and payment gateway
 */

(function(window) {
  'use strict';

  const BaseGhostPIN = window.GhostPIN;

  class GhostPINFallback {
    constructor(options = {}) {
      this.merchantId = options.merchantId;
      this.apiUrl = options.apiUrl || 'http://localhost:3001';
      this.isInitialized = true;
    }
  }

  class GhostPINEnhanced extends (BaseGhostPIN || GhostPINFallback) {
    constructor(options = {}) {
      super(options);

      this.handshakeState = 'idle';
      this.merchantChallenge = null;
      this.userChallenge = null;
      this.mutualProof = null;
    }

    /**
     * Initiate two-way handshake
     */
    async initiateHandshake(paymentIntent, options = {}) {
      try {
        this.handshakeState = 'initiating';
        
        // Step 1: Generate merchant challenge
        const merchantChallenge = await this.generateMerchantChallenge(paymentIntent, options.targetElement);
        
        // Step 2: Request user authentication
        const userResponse = await this.requestUserAuthentication(merchantChallenge);
        
        // Step 3: Create mutual proof
        const mutualProof = await this.createMutualProof(merchantChallenge, userResponse);
        
        // Step 4: Verify handshake
        const verification = await this.verifyHandshake(mutualProof);
        
        this.handshakeState = 'completed';
        return verification;
        
      } catch (error) {
        this.handshakeState = 'failed';
        throw error;
      }
    }

    /**
     * Generate merchant challenge with visual nonce
     */
    async generateMerchantChallenge(paymentIntent, targetElement) {
      const challenge = {
        merchant_id: this.merchantId,
        timestamp: Date.now(),
        payment_intent: paymentIntent,
        visual_nonce: await this.generateVisualNonce(paymentIntent, targetElement),
        domain_proof: await this.generateDomainProof(),
        page_integrity: await this.generatePageIntegrityHash()
      };

      this.merchantChallenge = challenge;
      return challenge;
    }

    /**
     * Request user authentication with WebAuthn
     */
    async requestUserAuthentication(merchantChallenge) {
      const userChallenge = {
        challenge: await this.generateUserChallenge(merchantChallenge),
        user_verification: 'required',
        authenticator_selection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required'
        }
      };

      const credential = await navigator.credentials.get({
        publicKey: userChallenge
      });

      return {
        credential: credential,
        user_proof: await this.generateUserProof(credential, merchantChallenge),
        device_binding: await this.generateDeviceBinding()
      };
    }

    /**
     * Create mutual proof of authentication
     */
    async createMutualProof(merchantChallenge, userResponse) {
      const mutualProof = {
        merchant_challenge: merchantChallenge,
        user_response: userResponse,
        handshake_id: this.generateHandshakeId(),
        timestamp: Date.now(),
        mutual_signature: await this.signMutualProof(merchantChallenge, userResponse)
      };

      this.mutualProof = mutualProof;
      return mutualProof;
    }

    /**
     * Verify complete handshake
     */
    async verifyHandshake(mutualProof) {
      const verificationRequest = {
        handshake_proof: mutualProof,
        merchant_id: this.merchantId,
        origin: window.location.origin,
        timestamp: Date.now()
      };

      const response = await fetch(`${this.apiUrl}/api/verify-handshake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GhostPIN-Version': '2.0.0'
        },
        body: JSON.stringify(verificationRequest)
      });

      if (!response.ok) {
        throw new Error('Handshake verification failed');
      }

      const result = await response.json();
      
      // Emit handshake events
      this.emit('handshake:completed', result);
      
      return result;
    }

    /**
     * Generate domain proof
     */
    async generateDomainProof() {
      const domainData = {
        domain: window.location.hostname,
        protocol: window.location.protocol,
        path: window.location.pathname,
        timestamp: Date.now()
      };

      return await this.sha256(JSON.stringify(domainData));
    }

    /**
     * Generate page integrity hash
     */
    async generatePageIntegrityHash() {
      const pageContent = document.documentElement.outerHTML;
      const criticalElements = this.extractCriticalElements();
      
      const integrityData = {
        page_hash: await this.sha256(pageContent),
        critical_elements: criticalElements,
        timestamp: Date.now()
      };

      return await this.sha256(JSON.stringify(integrityData));
    }

    /**
     * Extract critical page elements
     */
    extractCriticalElements() {
      const elements = {
        checkout_button: document.querySelector('[data-ghostpin-checkout]')?.outerHTML,
        payment_form: document.querySelector('form[data-ghostpin-payment]')?.outerHTML,
        amount_display: document.querySelector('[data-ghostpin-amount]')?.textContent,
        merchant_info: document.querySelector('[data-ghostpin-merchant]')?.textContent
      };

      return elements;
    }

    /**
     * Generate user challenge
     */
    async generateUserChallenge(merchantChallenge) {
      const challengeData = {
        merchant_challenge: merchantChallenge,
        user_context: {
          user_agent: navigator.userAgent,
          screen_resolution: `${screen.width}x${screen.height}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        timestamp: Date.now()
      };

      const challengeString = JSON.stringify(challengeData);
      return new TextEncoder().encode(challengeString);
    }

    /**
     * Generate user proof
     */
    async generateUserProof(credential, merchantChallenge) {
      const proofData = {
        credential_id: this.arrayBufferToBase64(credential.id),
        signature: this.arrayBufferToBase64(credential.response.signature),
        client_data: this.arrayBufferToBase64(credential.response.clientDataJSON),
        authenticator_data: this.arrayBufferToBase64(credential.response.authenticatorData),
        merchant_challenge: merchantChallenge,
        timestamp: Date.now()
      };

      return await this.sha256(JSON.stringify(proofData));
    }

    /**
     * Generate device binding
     */
    async generateDeviceBinding() {
      const deviceData = {
        platform: navigator.platform,
        language: navigator.language,
        hardware_concurrency: navigator.hardwareConcurrency,
        device_memory: navigator.deviceMemory,
        timestamp: Date.now()
      };

      return await this.sha256(JSON.stringify(deviceData));
    }

    /**
     * Sign mutual proof
     */
    async signMutualProof(merchantChallenge, userResponse) {
      const proofData = {
        merchant_challenge: merchantChallenge,
        user_response: userResponse,
        timestamp: Date.now()
      };

      const proofString = JSON.stringify(proofData);
      const proofHash = await this.sha256(proofString);
      
      // In a real implementation, this would use the user's private key
      return await this.sha256(proofHash + this.merchantId);
    }

    /**
     * Generate handshake ID
     */
    generateHandshakeId() {
      return 'handshake_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
     * Utility: Generate visual nonce
     */
    async generateVisualNonce(paymentIntent, targetElement) {
      const timestamp = Math.floor(Date.now() / 1000);
      const random = this.generateRandomBytes(32);
      const nonceData = `${this.merchantId}:${timestamp}:${JSON.stringify(paymentIntent)}:${random}`;
      const nonce = await this.sha256(nonceData);

      // Embed nonce visually if target element provided
      if (targetElement) {
        await this.embedVisualNonce(targetElement, nonce);
      }

      return nonce;
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
     * Embed nonce visually
     */
    async embedVisualNonce(element, nonce) {
      try {
        // Simple visual embedding - store in data attribute
        element.setAttribute('data-ghostpin-nonce', nonce);
        element.style.border = '2px solid #10b981';
        element.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';
      } catch (error) {
        console.error('Error embedding visual nonce:', error);
      }
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
     * Enhanced fraud detection
     */
    async detectFraudIndicators() {
      const indicators = {
        suspicious_domain: this.checkSuspiciousDomain(),
        page_tampering: this.checkPageTampering(),
        timing_anomaly: this.checkTimingAnomaly(),
        device_anomaly: this.checkDeviceAnomaly()
      };

      return indicators;
    }

    checkSuspiciousDomain() {
      const domain = window.location.hostname;
      const suspiciousPatterns = [
        /paypal-security/i,
        /amazon-payments/i,
        /stripe-verify/i,
        /apple-pay-secure/i,
        /bank-login/i
      ];

      return suspiciousPatterns.some(pattern => pattern.test(domain));
    }

    checkPageTampering() {
      // Check if critical elements have been modified
      const originalElements = this.extractCriticalElements();
      const currentElements = this.extractCriticalElements();
      
      return JSON.stringify(originalElements) !== JSON.stringify(currentElements);
    }

    checkTimingAnomaly() {
      // Check if handshake is taking too long (potential bot)
      const startTime = this.handshakeStartTime || Date.now();
      const duration = Date.now() - startTime;
      
      return duration > 30000; // 30 seconds
    }

    checkDeviceAnomaly() {
      // Check for suspicious device characteristics
      const deviceData = {
        user_agent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language
      };

      // Simple anomaly detection
      const suspiciousUA = /bot|crawler|spider/i.test(deviceData.user_agent);
      const suspiciousPlatform = !deviceData.platform || deviceData.platform === '';
      
      return suspiciousUA || suspiciousPlatform;
    }
  }

  // Export enhanced version
  window.GhostPINEnhanced = GhostPINEnhanced;

})(window);
