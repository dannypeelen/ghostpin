const express = require('express');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const {
  generateDemoToken,
  persistSecret,
  loadSecret,
  removeSecret
} = require('../services/demoMfaStore');

const router = express.Router();
const SESSION_TTL_SECONDS = Number(process.env.MFA_DEMO_TTL_SECONDS || 300);

router.post('/session', async (req, res) => {
  try {
    const demoToken = generateDemoToken();
    const secret = speakeasy.generateSecret({
      length: 20,
      issuer: 'GhostPIN Demo',
      name: 'GhostPIN Demo User'
    });

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url, { margin: 1 });

    await persistSecret(
      demoToken,
      {
        secret: secret.base32,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
      },
      SESSION_TTL_SECONDS
    );

    res.json({
      demoToken,
      secretBase32: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrCodeDataUrl: qrDataUrl,
      expiresIn: SESSION_TTL_SECONDS
    });
  } catch (error) {
    console.error('Failed to create MFA demo session:', error);
    res.status(500).json({ error: 'Failed to create MFA demo session' });
  }
});

router.post('/verify', async (req, res) => {
  const { demoToken, otp } = req.body || {};

  if (!demoToken || !otp) {
    return res.status(400).json({ error: 'demoToken and otp are required' });
  }

  try {
    const session = await loadSecret(demoToken);

    if (!session) {
      return res.status(404).json({ error: 'Demo session expired or not found' });
    }

    const isValid = speakeasy.totp.verify({
      secret: session.secret,
      encoding: 'base32',
      token: otp,
      window: 1
    });

    if (!isValid) {
      return res.status(401).json({ success: false, reason: 'Invalid or expired code' });
    }

    await removeSecret(demoToken);
    return res.json({ success: true, message: 'MFA code verified successfully' });
  } catch (error) {
    console.error('Failed to verify MFA demo code:', error);
    res.status(500).json({ error: 'Failed to verify MFA demo code' });
  }
});

router.get('/session/:demoToken', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const session = await loadSecret(req.params.demoToken);

    if (!session) {
      return res.status(404).json({ error: 'Demo session expired or not found' });
    }

    res.json({ session });
  } catch (error) {
    console.error('Failed to inspect MFA demo session:', error);
    res.status(500).json({ error: 'Failed to inspect MFA demo session' });
  }
});

module.exports = router;
