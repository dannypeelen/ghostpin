const crypto = require('crypto');

const DEFAULT_MERCHANTS = () => [{
  merchantId: 'secure-store',
  displayName: 'Secure Store',
  allowedOrigins: [
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3001'
  ],
  allowedHosts: ['localhost:3001', '127.0.0.1:3001'],
  dnsTxt: ['secure-store.localhost'],
  privateKeyPem: process.env.SECURE_STORE_PRIVATE_KEY || `-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIEeYjhUZfB7/9gRY2VZJPfoWD1+4KwqfiOZQKgZNGFL4oAoGCCqGSM49\nAwEHoUQDQgAEMz+DM1BZ8Q6nQccBNtxmMnzdYHB2VirpHiX1Lg7y3nSSfM9cdb+8\nnh8fpgxe8Gt37jVnLqdkZDtzvmAS4F9ebQ==\n-----END EC PRIVATE KEY-----\n`,
  publicKeyPem: process.env.SECURE_STORE_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMz+DM1BZ8Q6nQccBNtxmMnzdYHB2\nVirpHiX1Lg7y3nSSfM9cdb+8nh8fpgxe8Gt37jVnLqdkZDtzvmAS4F9ebQ==\n-----END PUBLIC KEY-----\n`,
  sessionSecret: process.env.SECURE_STORE_SESSION_SECRET || 'secure-store-session-secret',
  otpSecretHex: process.env.SECURE_STORE_OTP_SECRET_HEX || 'd3c4c1b2a5a4e3f2d1c0b9a897867564',
  riskRules: {
    stepUpAmount: 25000,
    replayTtlSeconds: 300,
    velocity: { windowSeconds: 60, maxAttempts: 6 }
  }
}, {
  merchantId: 'clone-store',
  displayName: 'Clone Store',
  allowedOrigins: [
    'http://localhost:3002'
  ],
  allowedHosts: ['localhost:3002'],
  dnsTxt: ['clone-store.localhost'],
  privateKeyPem: process.env.CLONE_STORE_PRIVATE_KEY || `-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIB2ex/4gceVboe8S64DNA8iaYbeSEAwYhbvYxxXX/1ipoAoGCCqGSM49\nAwEHoUQDQgAE7lWcAGBGx4p/jXoroNCFGnpAoBCKLdqOW5UrS/1mzRA4t1yGWIHS\nwska2sOv2NkFo+noRkTC0rrGY0f6hGOq8w==\n-----END EC PRIVATE KEY-----\n`,
  publicKeyPem: process.env.CLONE_STORE_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7lWcAGBGx4p/jXoroNCFGnpAoBCK\nLdqOW5UrS/1mzRA4t1yGWIHSwska2sOv2NkFo+noRkTC0rrGY0f6hGOq8w==\n-----END PUBLIC KEY-----\n`,
  sessionSecret: process.env.CLONE_STORE_SESSION_SECRET || 'clone-store-session-secret',
  otpSecretHex: process.env.CLONE_STORE_OTP_SECRET_HEX || 'aabbccddeeff00112233445566778899',
  riskRules: {
    stepUpAmount: 10000,
    replayTtlSeconds: 180,
    velocity: { windowSeconds: 60, maxAttempts: 4 }
  }
}];

let merchantsCache = null;

function parseMerchants() {
  if (merchantsCache) {
    return merchantsCache;
  }

  let source;
  try {
    source = process.env.MERCHANTS_JSON ? JSON.parse(process.env.MERCHANTS_JSON) : null;
  } catch (error) {
    console.warn('GhostPIN: MERCHANTS_JSON invalid JSON, falling back to defaults', error);
  }

  const merchants = Array.isArray(source) && source.length > 0 ? source : DEFAULT_MERCHANTS();

  merchantsCache = merchants.map((merchant) => normaliseMerchant(merchant));
  return merchantsCache;
}

function normaliseMerchant(raw) {
  const origins = Array.from(new Set((raw.allowedOrigins || raw.allowedDomain || []).map(normaliseOrigin))).filter(Boolean);
  const hosts = Array.from(new Set([
    ...(raw.allowedHosts || []),
    ...origins.map((origin) => {
      try {
        return new URL(origin).host;
      } catch (error) {
        return null;
      }
    }).filter(Boolean)
  ]));

  const privateKeyPem = raw.privateKeyPem || raw.privateKey || '';
  const publicKeyPem = raw.publicKeyPem || raw.publicKey || '';

  let privateKey;
  let publicKey;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch (error) {
    throw new Error(`Invalid key material for merchant ${raw.merchantId}: ${error.message}`);
  }

  return {
    merchantId: raw.merchantId,
    displayName: raw.displayName || raw.merchantId,
    allowedOrigins: origins,
    allowedHosts: hosts,
    dnsTxt: raw.dnsTxt || [],
    privateKey,
    publicKey,
    privateKeyPem,
    publicKeyPem,
    sessionSecret: raw.sessionSecret || null,
    otpSecretHex: raw.otpSecretHex || null,
    riskRules: {
      stepUpAmount: raw.riskRules?.stepUpAmount ?? 25000,
      replayTtlSeconds: raw.riskRules?.replayTtlSeconds ?? 300,
      velocity: {
        windowSeconds: raw.riskRules?.velocity?.windowSeconds ?? 60,
        maxAttempts: raw.riskRules?.velocity?.maxAttempts ?? 6
      },
      requireDnsAttestation: raw.riskRules?.requireDnsAttestation ?? false
    }
  };
}

function normaliseOrigin(origin) {
  if (!origin) {
    return null;
  }
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    return null;
  }
}

function listMerchants() {
  return parseMerchants();
}

function getMerchantById(id) {
  if (!id) {
    return null;
  }
  return parseMerchants().find((merchant) => merchant.merchantId === id) || null;
}

function inferMerchantByOrigin(origin) {
  if (!origin) {
    return null;
  }
  try {
    const url = new URL(origin);
    const originString = `${url.protocol}//${url.host}`;
    const host = url.host;
    return parseMerchants().find((merchant) => merchant.allowedOrigins.includes(originString) || merchant.allowedHosts.includes(host)) || null;
  } catch (error) {
    return null;
  }
}

function resolveMerchant({ merchantId, origin, host }) {
  let merchant = merchantId ? getMerchantById(merchantId) : null;
  if (!merchant) {
    merchant = inferMerchantByOrigin(origin);
  }
  if (!merchant && host) {
    merchant = parseMerchants().find((item) => item.allowedHosts.includes(host));
  }
  return merchant;
}

module.exports = {
  listMerchants,
  getMerchantById,
  inferMerchantByOrigin,
  resolveMerchant
};
