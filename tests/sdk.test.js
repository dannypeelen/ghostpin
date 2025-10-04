/**
 * GhostPIN SDK Tests
 * Tests for the client-side SDK functionality
 */

// Mock browser APIs
global.window = {
  location: { origin: 'https://test-merchant.com' },
  crypto: {
    subtle: {
      digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
      sign: jest.fn().mockResolvedValue(new ArrayBuffer(64))
    },
    getRandomValues: jest.fn().mockImplementation(arr => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    })
  },
  PublicKeyCredential: {
    isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true)
  },
  navigator: {
    credentials: {
      get: jest.fn().mockResolvedValue({
        id: new ArrayBuffer(16),
        response: {
          signature: new ArrayBuffer(64),
          clientDataJSON: new ArrayBuffer(32),
          authenticatorData: new ArrayBuffer(32)
        }
      })
    }
  },
  fetch: jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ verified: true, attestation_score: 0.95 })
  }),
  btoa: jest.fn().mockImplementation(str => Buffer.from(str).toString('base64')),
  dispatchEvent: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

// Mock document
global.document = {
  createElement: jest.fn().mockReturnValue({
    getContext: jest.fn().mockReturnValue({
      fillRect: jest.fn(),
      getImageData: jest.fn().mockReturnValue({
        data: new Uint8Array(1000)
      }),
      putImageData: jest.fn()
    }),
    toDataURL: jest.fn().mockReturnValue('data:image/png;base64,test')
  }),
  querySelector: jest.fn().mockReturnValue({
    getAttribute: jest.fn().mockReturnValue('test-merchant')
  }),
  addEventListener: jest.fn()
};

// Mock TextEncoder/TextDecoder
global.TextEncoder = class TextEncoder {
  encode(str) {
    return new Uint8Array(Buffer.from(str));
  }
};

global.TextDecoder = class TextDecoder {
  decode(buffer) {
    return Buffer.from(buffer).toString();
  }
};

// Load the SDK
const GhostPIN = require('../sdk/ghostpin.js');

describe('GhostPIN SDK', () => {
  let ghostpin;

  beforeEach(() => {
    ghostpin = new GhostPIN({
      merchantId: 'test-merchant',
      apiUrl: 'https://api.test.com'
    });
  });

  describe('Initialization', () => {
    it('should initialize with valid configuration', async () => {
      expect(ghostpin.merchantId).toBe('test-merchant');
      expect(ghostpin.apiUrl).toBe('https://api.test.com');
      expect(ghostpin.isInitialized).toBe(true);
    });

    it('should throw error for missing merchant ID', () => {
      expect(() => new GhostPIN({})).toThrow('Merchant ID is required');
    });

    it('should check WebAuthn support', async () => {
      // Mock unsupported browser
      global.window.PublicKeyCredential = undefined;
      
      expect(() => new GhostPIN({ merchantId: 'test' })).toThrow('WebAuthn not supported');
      
      // Restore
      global.window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn()
      };
    });
  });

  describe('Nonce Generation', () => {
    it('should generate valid nonce', async () => {
      const paymentIntent = { amount: 100, currency: 'USD' };
      const nonce = await ghostpin.generateVisualNonce(paymentIntent);
      
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
      expect(ghostpin.currentNonce).toBe(nonce);
    });

    it('should embed nonce visually', async () => {
      const mockElement = {
        getBoundingClientRect: () => ({ width: 200, height: 50 }),
        style: {}
      };
      
      const nonce = await ghostpin.generateVisualNonce({ amount: 100 }, mockElement);
      
      expect(nonce).toBeDefined();
      expect(mockElement.style.backgroundImage).toBeDefined();
    });
  });

  describe('WebAuthn Integration', () => {
    it('should request WebAuthn authentication', async () => {
      const challenge = new ArrayBuffer(32);
      const credential = await ghostpin.requestWebAuthnAuth(challenge);
      
      expect(credential).toBeDefined();
      expect(credential.id).toBeDefined();
      expect(credential.response).toBeDefined();
    });

    it('should handle WebAuthn failures gracefully', async () => {
      global.window.navigator.credentials.get = jest.fn().mockRejectedValue(new Error('WebAuthn failed'));
      
      await expect(ghostpin.requestWebAuthnAuth(new ArrayBuffer(32)))
        .rejects.toThrow('WebAuthn failed');
    });
  });

  describe('Payment Verification', () => {
    it('should verify payment successfully', async () => {
      const paymentIntent = { amount: 100, currency: 'USD' };
      
      const result = await ghostpin.verifyPayment(paymentIntent);
      
      expect(result.verified).toBe(true);
      expect(result.attestation_score).toBe(0.95);
    });

    it('should prevent concurrent verifications', async () => {
      const paymentIntent = { amount: 100, currency: 'USD' };
      
      // Start first verification
      const promise1 = ghostpin.verifyPayment(paymentIntent);
      
      // Try second verification (should fail)
      await expect(ghostpin.verifyPayment(paymentIntent))
        .rejects.toThrow('Verification already in progress');
      
      // Wait for first to complete
      await promise1;
    });
  });

  describe('Cryptographic Functions', () => {
    it('should generate SHA256 hash', async () => {
      const hash = await ghostpin.sha256('test-data');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate random bytes', () => {
      const random = ghostpin.generateRandomBytes(32);
      expect(random).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it('should convert ArrayBuffer to hex', () => {
      const buffer = new ArrayBuffer(4);
      const view = new Uint8Array(buffer);
      view[0] = 0x12;
      view[1] = 0x34;
      view[2] = 0x56;
      view[3] = 0x78;
      
      const hex = ghostpin.arrayBufferToHex(buffer);
      expect(hex).toBe('12345678');
    });

    it('should convert ArrayBuffer to base64', () => {
      const buffer = new ArrayBuffer(4);
      const view = new Uint8Array(buffer);
      view[0] = 0x48;
      view[1] = 0x65;
      view[2] = 0x6c;
      view[3] = 0x6c;
      
      const base64 = ghostpin.arrayBufferToBase64(buffer);
      expect(base64).toBe('SGVsbA==');
    });

    it('should convert hex to binary', () => {
      const binary = ghostpin.hexToBinary('a1b2');
      expect(binary).toBe('1010000110110010');
    });
  });

  describe('Event System', () => {
    it('should emit events', () => {
      const callback = jest.fn();
      ghostpin.on('verification', callback);
      
      ghostpin.emit('verification', { verified: true });
      
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { verified: true }
        })
      );
    });

    it('should remove event listeners', () => {
      const callback = jest.fn();
      ghostpin.on('verification', callback);
      ghostpin.off('verification', callback);
      
      ghostpin.emit('verification', { verified: true });
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      global.window.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      
      await expect(ghostpin.verifyPayment({ amount: 100 }))
        .rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      global.window.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid signature' })
      });
      
      await expect(ghostpin.verifyPayment({ amount: 100 }))
        .rejects.toThrow('Invalid signature');
    });
  });
});
