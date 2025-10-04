/**
 * GhostPIN Enhanced SDK - Simplified Version
 * Two-Way Handshake MFA for Demo Purposes
 */

(function(window) {
  'use strict';

  class GhostPINEnhanced {
    constructor(options = {}) {
      this.merchantId = options.merchantId || 'default-merchant';
      this.apiUrl = options.apiUrl || 'http://localhost:3001';
      this.handshakeState = 'idle';
      this.merchantChallenge = null;
      this.userChallenge = null;
      this.mutualProof = null;
      this.isInitialized = true;
      
      console.log('🔐 GhostPIN Enhanced SDK initialized:', {
        merchantId: this.merchantId,
        apiUrl: this.apiUrl
      });
    }

    /**
     * Initiate two-way handshake
     */
    async initiateHandshake(paymentIntent, options = {}) {
      try {
        console.log('🚀 Starting two-way handshake...', paymentIntent);
        this.handshakeState = 'initiating';
        
        // Step 1: Generate merchant challenge
        const merchantChallenge = await this.generateMerchantChallenge(paymentIntent, options.targetElement);
        console.log('✅ Merchant challenge generated');
        
        // Step 2: Request user authentication
        const userResponse = await this.requestUserAuthentication(merchantChallenge);
        console.log('✅ User authentication completed');
        
        // Step 3: Create mutual proof
        const mutualProof = await this.createMutualProof(merchantChallenge, userResponse);
        console.log('✅ Mutual proof created');
        
        // Step 4: Verify handshake
        const verification = await this.verifyHandshake(mutualProof);
        console.log('✅ Handshake verified');
        
        this.handshakeState = 'completed';
        return verification;
        
      } catch (error) {
        console.error('❌ Handshake failed:', error);
        this.handshakeState = 'failed';
        throw error;
      }
    }

    /**
     * Generate merchant challenge
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
     * Request user authentication
     */
    async requestUserAuthentication(merchantChallenge) {
      const userChallenge = {
        challenge: await this.generateUserChallenge(merchantChallenge),
        credential: await this.simulateWebAuthn(),
        user_proof: await this.generateUserProof(null, merchantChallenge),
        device_binding: await this.generateDeviceBinding()
      };

      this.userChallenge = userChallenge;
      return userChallenge;
    }

    /**
     * Create mutual proof
     */
    async createMutualProof(merchantChallenge, userResponse) {
      const mutualProof = {
        handshake_id: this.generateHandshakeId(),
        merchant_challenge: merchantChallenge,
        user_response: userResponse,
        mutual_signature: await this.signMutualProof(merchantChallenge, userResponse),
        timestamp: Date.now()
      };

      this.mutualProof = mutualProof;
      return mutualProof;
    }

    /**
     * Verify handshake
     */
    async verifyHandshake(mutualProof) {
      const verificationRequest = {
        handshake_proof: mutualProof,
        merchant_id: this.merchantId,
        origin: window.location.origin,
        timestamp: Date.now()
      };

      console.log('🔍 Sending handshake verification request...', verificationRequest);

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
      console.log('✅ Handshake verification result:', result);
      
      return result;
    }

    /**
     * Generate visual nonce
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
     * Generate domain proof
     */
    async generateDomainProof() {
      const domainData = {
        domain: window.location.hostname,
        protocol: window.location.protocol,
        timestamp: Date.now()
      };

      return await this.sha256(JSON.stringify(domainData));
    }

    /**
     * Generate page integrity hash
     */
    async generatePageIntegrityHash() {
      const pageData = {
        title: document.title,
        url: window.location.href,
        timestamp: Date.now()
      };

      return await this.sha256(JSON.stringify(pageData));
    }

    /**
     * Generate user challenge
     */
    async generateUserChallenge(merchantChallenge) {
      const challengeData = {
        merchant_challenge: merchantChallenge,
        user_timestamp: Date.now(),
        session_id: this.generateSessionId()
      };

      return await this.sha256(JSON.stringify(challengeData));
    }

    /**
     * Simulate WebAuthn
     */
    async simulateWebAuthn() {
      // Simulate WebAuthn credential for demo
      return {
        id: 'demo-credential-' + Date.now(),
        type: 'public-key',
        response: {
          clientDataJSON: btoa(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'demo-challenge',
            origin: window.location.origin
          })),
          authenticatorData: 'demo-authenticator-data',
          signature: 'demo-signature'
        }
      };
    }

    /**
     * Generate user proof
     */
    async generateUserProof(credential, merchantChallenge) {
      const proofData = {
        credential: credential,
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
        user_agent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
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
      
      return await this.sha256(proofHash + this.merchantId);
    }

    /**
     * Generate handshake ID
     */
    generateHandshakeId() {
      return 'handshake_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Generate session ID
     */
    generateSessionId() {
      return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * SHA256 hash
     */
    async sha256(data) {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      return this.arrayBufferToHex(hashBuffer);
    }

    /**
     * Generate random bytes
     */
    generateRandomBytes(length) {
      const array = new Uint8Array(length);
      crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Convert ArrayBuffer to hex string
     */
    arrayBufferToHex(buffer) {
      return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
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
        console.log('🔐 Visual nonce embedded:', nonce);
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
  }

  // Export enhanced version
  window.GhostPINEnhanced = GhostPINEnhanced;
  console.log('🔐 GhostPIN Enhanced SDK loaded successfully');

})(window);
