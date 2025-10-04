const express = require('express');
const crypto = require('crypto');
const { resolveMerchant } = require('../services/merchant-config');
const { getRedisClient } = require('../utils/redis');

const router = express.Router();

const MAX_PAYLOAD_BYTES = 10 * 1024; // 10KB
const TIMESTAMP_SKEW_MS = 120_000;

function toBase64Url(buffer) {
  const b64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + pad, 'base64');
}

function computeVisualNonceBytes(merchantComponent, domain, ts, intentHash) {
  const payload = `${merchantComponent || ''}|${domain}|${ts}|${intentHash}`;
  return crypto.createHash('sha256').update(payload).digest();
}

function canonicalIntent(intent = {}) {
  return `${Number(intent.amount || 0)}|${(intent.currency || 'USD').toUpperCase()}|${intent.description || ''}|${intent.merchant_reference || intent.reference || ''}`;
}

function computeIntentHash(intent) {
  return toBase64Url(crypto.createHash('sha256').update(canonicalIntent(intent)).digest());
}

function nowMs() {
  return Date.now();
}

function getRedisSafe() {
  try {
    return getRedisClient();
  } catch (error) {
    return null;
  }
}

const memoryCache = new Map();

function setOnce(key, ttlSeconds) {
  const redis = getRedisSafe();
  if (redis) {
    return redis
      .set(key, '1', { NX: true, EX: ttlSeconds })
      .then((result) => result === 'OK');
  }
  if (memoryCache.has(key)) {
    return false;
  }
  memoryCache.set(key, Date.now() + ttlSeconds * 1000);
  setTimeout(() => memoryCache.delete(key), ttlSeconds * 1000).unref?.();
  return true;
}

function rateLimit(key, windowSeconds, maxAttempts) {
  const redis = getRedisSafe();
  const ttl = windowSeconds;
  if (redis) {
    return redis
      .multi()
      .incr(key)
      .expire(key, ttl)
      .exec()
      .then((results) => {
        const incrResult = results?.[0];
        const count = Array.isArray(incrResult) ? Number(incrResult[1]) : Number(incrResult);
        return Number.isFinite(count) && count <= maxAttempts;
      })
      .catch(() => false);
  }
  const now = nowMs();
  const records = memoryCache.get(key) || [];
  const filtered = records.filter((ts) => now - ts < windowSeconds * 1000);
  filtered.push(now);
  memoryCache.set(key, filtered);
  return filtered.length <= maxAttempts;
}

function verifyTotp(code, secretHex, window = 1, digits = 6, stepSeconds = 30) {
  if (!secretHex) {
    return false;
  }
  const secret = Buffer.from(secretHex, 'hex');
  const currentCounter = Math.floor(nowMs() / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset++) {
    const counter = currentCounter + offset;
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', secret).update(counterBuffer).digest();
    const offsetBits = hmac[hmac.length - 1] & 0xf;
    const binaryCode = ((hmac[offsetBits] & 0x7f) << 24) |
      ((hmac[offsetBits + 1] & 0xff) << 16) |
      ((hmac[offsetBits + 2] & 0xff) << 8) |
      (hmac[offsetBits + 3] & 0xff);
    const otp = (binaryCode % 10 ** digits).toString().padStart(digits, '0');
    if (otp === code) {
      return true;
    }
  }
  return false;
}

async function verifyDeviceProof(devicePayload, sessionSecret, intentHash, req) {
  if (!devicePayload) {
    return { ok: false, reason: 'device_payload_missing' };
  }
  const { deviceHash, proof } = devicePayload;
  const expectedHash = computeDeviceHash(req, intentHash);
  if (deviceHash !== expectedHash) {
    return { ok: false, reason: 'device_hash_mismatch' };
  }
  if (sessionSecret) {
    if (!proof) {
      return { ok: false, reason: 'device_proof_missing' };
    }
    const expectedProof = crypto.createHmac('sha256', sessionSecret).update(deviceHash).digest('base64url');
    if (expectedProof !== proof) {
      return { ok: false, reason: 'device_proof_invalid' };
    }
  }
  return { ok: true };
}

function computeDeviceHash(req, intentHash) {
  const ua = req.get('User-Agent') || '';
  const language = req.body?.uaHints?.language || req.get('Accept-Language') || '';
  const platform = req.body?.uaHints?.platform || '';
  const screen = req.body?.uaHints?.screen || '';
  const payload = `${ua}|${language}|${platform}|${screen}|${intentHash}`;
  return crypto.createHash('sha256').update(payload).digest('base64url');
}

router.post('/nonce', async (req, res) => {
  try {
    const { merchantId = null, domain, ts, intentHash } = req.body || {};
    if (!domain || !Number.isFinite(Number(ts)) || !intentHash) {
      return res.status(400).json({ error: 'invalid_request', message: 'domain, ts, and intentHash are required' });
    }

    if (Math.abs(nowMs() - Number(ts)) > TIMESTAMP_SKEW_MS) {
      return res.status(400).json({ error: 'stale_ts', message: 'timestamp outside allowed skew' });
    }

    let parsedDomain;
    try {
      const url = new URL(domain);
      parsedDomain = { origin: `${url.protocol}//${url.host}`, host: url.host };
    } catch (error) {
      return res.status(400).json({ error: 'invalid_domain', message: 'domain must be a valid URL' });
    }

    const merchant = resolveMerchant({ merchantId, origin: parsedDomain.origin, host: parsedDomain.host });
    if (!merchant) {
      return res.status(400).json({ error: 'unknown_merchant', message: 'Merchant could not be resolved for this domain' });
    }

    const merchantComponent = merchantId ?? '';
    const replayKey = `nonce:${merchant.merchantId}:${ts}:${intentHash}`;
    const setResult = await setOnce(replayKey, merchant.riskRules.replayTtlSeconds || 300);
    if (!setResult) {
      return res.status(400).json({ error: 'nonce_replay', message: 'Nonce already issued for this intent' });
    }

    const vnBytes = computeVisualNonceBytes(merchantComponent, parsedDomain.origin, ts, intentHash);
    const signature = crypto.createSign('SHA256').update(vnBytes).sign(merchant.privateKey);
    return res.json({ visualNonceSig: toBase64Url(signature) });
  } catch (error) {
    console.error('GhostPIN /nonce error', error);
    return res.status(500).json({ error: 'server_error', message: 'Failed to sign visual nonce' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const payloadSize = Buffer.byteLength(JSON.stringify(req.body || {}));
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ verified: false, reason: 'payload_too_large' });
    }

    const {
      merchantId = null,
      domain,
      ts,
      intent,
      intentHash,
      visualNonce,
      visualNonceHash,
      visualNonceSig,
      method,
      webauthn,
      otp,
      device,
      consent = 'enabled',
      uaHints = {}
    } = req.body || {};

    if (!domain || !intent || !intentHash || !visualNonce || !visualNonceHash || !visualNonceSig || !method) {
      return res.status(200).json({ verified: false, reason: 'missing_fields' });
    }

    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp) || Math.abs(nowMs() - timestamp) > TIMESTAMP_SKEW_MS) {
      return res.status(200).json({ verified: false, reason: 'stale_ts' });
    }

    let parsedDomain;
    try {
      const url = new URL(domain);
      parsedDomain = { origin: `${url.protocol}//${url.host}`, host: url.host };
    } catch (error) {
      return res.status(200).json({ verified: false, reason: 'invalid_domain' });
    }

    const originHeader = req.get('Origin');
    const refererHeader = req.get('Referer');
    const forwardedHost = req.get('X-Forwarded-Host');
    const fetchSite = (req.get('Sec-Fetch-Site') || '').toLowerCase();

    const merchant = resolveMerchant({ merchantId, origin: originHeader || parsedDomain.origin, host: forwardedHost || parsedDomain.host });
    if (!merchant) {
      return res.status(200).json({ verified: false, reason: 'unknown_merchant' });
    }

    if (merchantId && merchantId !== merchant.merchantId) {
      return res.status(200).json({ verified: false, reason: 'merchant_mismatch' });
    }

    const allowedOriginMatch = merchant.allowedOrigins.includes(parsedDomain.origin) || merchant.allowedHosts.includes(parsedDomain.host);
    if (!allowedOriginMatch) {
      return res.status(200).json({ verified: false, reason: 'domain_mismatch' });
    }

    if (originHeader && originHeader !== parsedDomain.origin) {
      return res.status(200).json({ verified: false, reason: 'origin_mismatch' });
    }

    if (refererHeader) {
      try {
        const refererUrl = new URL(refererHeader);
        const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
        if (refererOrigin !== parsedDomain.origin) {
          return res.status(200).json({ verified: false, reason: 'referer_mismatch' });
        }
      } catch (error) {
        return res.status(200).json({ verified: false, reason: 'invalid_referer' });
      }
    }

    if (forwardedHost && !merchant.allowedHosts.includes(forwardedHost)) {
      return res.status(200).json({ verified: false, reason: 'forwarded_host_mismatch' });
    }

    if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
      return res.status(200).json({ verified: false, reason: 'fetch_metadata_violation' });
    }

    if (merchant.riskRules.requireDnsAttestation && merchant.dnsTxt.length > 0) {
      const attested = merchant.dnsTxt.includes(parsedDomain.host) || merchant.dnsTxt.includes(parsedDomain.origin);
      if (!attested) {
        return res.status(200).json({ verified: false, reason: 'dns_attestation_failed' });
      }
    }

    const computedIntentHash = computeIntentHash(intent);
    if (computedIntentHash !== intentHash) {
      return res.status(200).json({ verified: false, reason: 'intent_mismatch' });
    }

    const merchantComponent = merchantId ?? '';
    const expectedVnBytes = computeVisualNonceBytes(merchantComponent, parsedDomain.origin, timestamp, intentHash);
    const providedVnBytes = fromBase64Url(visualNonce);

    if (expectedVnBytes.length !== providedVnBytes.length || !crypto.timingSafeEqual(expectedVnBytes, providedVnBytes)) {
      return res.status(200).json({ verified: false, reason: 'visual_nonce_mismatch' });
    }

    const expectedVnHash = crypto.createHash('sha256').update(expectedVnBytes).digest('base64url');
    if (expectedVnHash !== visualNonceHash) {
      return res.status(200).json({ verified: false, reason: 'visual_nonce_hash_mismatch' });
    }

    const signature = fromBase64Url(visualNonceSig);
    const verifier = crypto.createVerify('SHA256');
    verifier.update(expectedVnBytes);
    const signatureValid = verifier.verify(merchant.publicKey, signature);
    if (!signatureValid) {
      return res.status(200).json({ verified: false, reason: 'visual_nonce_signature_invalid' });
    }

    const replayKey = `proof:${merchant.merchantId}:${visualNonceHash}`;
    const replayOk = await setOnce(replayKey, merchant.riskRules.replayTtlSeconds || 300);
    if (!replayOk) {
      return res.status(200).json({ verified: false, reason: 'replay' });
    }

    const amount = Number(intent.amount || 0);
    if (merchant.riskRules.stepUpAmount && amount >= merchant.riskRules.stepUpAmount && method !== 'webauthn') {
      return res.status(200).json({ verified: false, reason: 'policy_requires_webauthn' });
    }

    const velocityKey = `velocity:${merchant.merchantId}:${Math.floor(nowMs() / 1000 / merchant.riskRules.velocity.windowSeconds)}`;
    const velocityOk = await rateLimit(velocityKey, merchant.riskRules.velocity.windowSeconds, merchant.riskRules.velocity.maxAttempts);
    if (!velocityOk) {
      return res.status(200).json({ verified: false, reason: 'velocity_exceeded' });
    }

    if (method === 'webauthn') {
      const webauthnResult = validateWebAuthn(webauthn, {
        merchantId: merchantComponent,
        domain: parsedDomain.origin,
        ts: timestamp,
        intentHash,
        visualNonceHash,
        rpId: req.body?.rpId || parsedDomain.host
      });
      if (!webauthnResult.ok) {
        return res.status(200).json({ verified: false, reason: webauthnResult.reason });
      }
  } else if (method === 'otp') {
      const minuteKey = `otp:${merchant.merchantId}:m:${Math.floor(nowMs() / 60000)}`;
      const hourKey = `otp:${merchant.merchantId}:h:${Math.floor(nowMs() / 3600000)}`;
      const withinMinute = await rateLimit(minuteKey, 60, 5);
      const withinHour = await rateLimit(hourKey, 3600, 10);
      if (!withinMinute || !withinHour || !otp?.code || !verifyTotp(String(otp.code), merchant.otpSecretHex)) {
        return res.status(200).json({ verified: false, reason: 'otp_invalid_or_rate_limited' });
      }
    } else if (method === 'device') {
      const check = await verifyDeviceProof(device, merchant.sessionSecret, intentHash, req);
      if (!check.ok) {
        return res.status(200).json({ verified: false, reason: check.reason });
      }
    } else {
      return res.status(200).json({ verified: false, reason: 'unsupported_method' });
    }

    return res.json({
      verified: true,
      method,
      policy: merchant.riskRules.stepUpAmount,
      proof: { visualNonceHash }
    });
  } catch (error) {
    console.error('GhostPIN /verify error', error);
    return res.status(500).json({ verified: false, reason: 'server_error' });
  }
});

router.post('/capture-payment', async (req, res) => {
  // Demo endpoint simply proxies verification result
  const verification = req.body?.verification;
  if (!verification || typeof verification !== 'object') {
    return res.status(400).json({ captured: false, reason: 'missing_verification' });
  }

  const response = await fetchVerificationEcho(verification);
  if (!response.verified) {
    return res.status(200).json({ captured: false, reason: response.reason || 'verification_failed' });
  }

  return res.json({ captured: true, reference: verification?.intent?.merchant_reference || null });
});

async function fetchVerificationEcho(payload) {
  return payload;
}

function validateWebAuthn(data, { merchantId, domain, ts, intentHash, visualNonceHash, rpId }) {
  if (!data) {
    return { ok: false, reason: 'webauthn_payload_missing' };
  }
  try {
    const { clientDataJSON, authenticatorData, signature } = data;
    if (!clientDataJSON || !authenticatorData || !signature || !data.rawId) {
      return { ok: false, reason: 'webauthn_fields_missing' };
    }

    const clientData = JSON.parse(fromBase64Url(clientDataJSON).toString('utf8'));
    if (clientData.type !== 'webauthn.get') {
      return { ok: false, reason: 'webauthn_type_invalid' };
    }

    if (clientData.origin !== domain) {
      return { ok: false, reason: 'webauthn_origin_mismatch' };
    }

    const expectedChallengeBuffer = computeWebAuthnChallenge({ merchantId, domain, ts, intentHash, visualNonceHash });
    const challengeB64 = toBase64Url(expectedChallengeBuffer);
    if (clientData.challenge !== challengeB64) {
      return { ok: false, reason: 'webauthn_challenge_mismatch' };
    }

    const authData = fromBase64Url(authenticatorData);
    if (!verifyAuthenticatorRpId(authData, rpId)) {
      return { ok: false, reason: 'webauthn_rpid_mismatch' };
    }

    const flags = authData[32];
    const userPresent = (flags & 0x01) !== 0;
    const userVerified = (flags & 0x04) !== 0;
    if (!userPresent || !userVerified) {
      return { ok: false, reason: 'webauthn_flags_invalid' };
    }

    // Signature verification requires the user's credential public key, which
    // is outside the scope of this demo. Assume downstream proof.
    return { ok: true };
  } catch (error) {
    console.error('GhostPIN WebAuthn validation error:', error);
    return { ok: false, reason: 'webauthn_validation_error' };
  }
}

function computeWebAuthnChallenge({ merchantId, domain, ts, intentHash, visualNonceHash }) {
  const input = `${merchantId || ''}|${domain}|${ts}|${intentHash}|${visualNonceHash}`;
  return crypto.createHash('sha256').update(input).digest();
}

function verifyAuthenticatorRpId(authData, expectedRpId) {
  try {
    const hashBuffer = authData.slice(0, 32);
    const expectedHash = crypto.createHash('sha256').update(expectedRpId).digest();
    return crypto.timingSafeEqual(hashBuffer, expectedHash);
  } catch (error) {
    return false;
  }
}

module.exports = router;
