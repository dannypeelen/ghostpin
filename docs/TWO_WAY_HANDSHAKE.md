# GhostPIN Two-Way Handshake MFA Implementation

## Overview
GhostPIN implements a cryptographic two-way handshake that ensures mutual authentication between:
- **User** (via biometric/WebAuthn)
- **Merchant Page** (via visual nonce embedding)
- **Payment Gateway** (via signature verification)

## Handshake Flow

### Step 1: Merchant Page Authentication
1. **Visual Nonce Generation**: Page generates unique nonce embedded in checkout button
2. **Page Integrity Check**: Nonce ensures page hasn't been tampered with
3. **Domain Binding**: Nonce tied to specific merchant domain

### Step 2: User Authentication
1. **WebAuthn Challenge**: User authenticates with Face ID/Touch ID/hardware key
2. **Biometric Binding**: Authentication tied to specific user device
3. **Intent Verification**: User confirms payment amount and details

### Step 3: Mutual Verification
1. **Cryptographic Proof**: Both parties prove authenticity
2. **Signature Validation**: Server verifies all signatures
3. **Fraud Detection**: Real-time analysis of handshake patterns

## Security Properties

- **Non-repudiation**: Both parties can prove the other's identity
- **Replay Protection**: Each handshake is unique and time-bound
- **Tamper Detection**: Any page modification invalidates the handshake
- **Phishing Prevention**: Fake sites cannot complete the handshake
