import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Shield, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const demoEnabled = process.env.NEXT_PUBLIC_ENABLE_MFA_DEMO === 'true';

export default function MfaDemo() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [otp, setOtp] = useState('');
  const [verifyState, setVerifyState] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (!demoEnabled) {
      setLoading(false);
      return;
    }
    createSession();
  }, []);

  const createSession = async () => {
    try {
      setLoading(true);
      setError(null);
      setOtp('');
      setVerifyState('idle');
      setStatusMessage('');

      const response = await fetch(`${apiBaseUrl}/api/demo-mfa/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error('Failed to create MFA demo session');
      }

      const data = await response.json();
      setSession(data);
    } catch (err) {
      console.error('MFA demo session error:', err);
      setError(err.message || 'Unable to create a demo session');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();

    if (!session?.demoToken || !otp) {
      return;
    }

    try {
      setVerifyState('loading');
      setStatusMessage('');

      const response = await fetch(`${apiBaseUrl}/api/demo-mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoToken: session.demoToken, otp })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setVerifyState('error');
        setStatusMessage(payload.reason || payload.error || 'Verification failed');
        return;
      }

      setVerifyState('success');
      setStatusMessage(payload.message || 'Code verified successfully');
    } catch (err) {
      console.error('MFA demo verification error:', err);
      setVerifyState('error');
      setStatusMessage(err.message || 'Verification failed');
    }
  };

  if (!demoEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white shadow rounded-lg p-8 text-center max-w-md">
          <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">MFA Demo Disabled</h1>
          <p className="text-gray-600">
            Set <code className="font-mono text-sm">ENABLE_MFA_DEMO=true</code> and
            {' '}<code className="font-mono text-sm">NEXT_PUBLIC_ENABLE_MFA_DEMO=true</code> to enable this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>GhostPIN MFA Demo</title>
        <meta name="description" content="Demonstrate multi-factor authentication with OTP" />
      </Head>

      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Shield className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">MFA Demo</h1>
              <p className="text-sm text-gray-500">Scan a QR code and verify a one-time passcode</p>
            </div>
          </div>
          <button
            onClick={createSession}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
            disabled={loading}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            New Session
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {loading ? (
          <div className="bg-white shadow rounded-lg p-8 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Preparing your MFA demo session...</p>
          </div>
        ) : error ? (
          <div className="bg-white shadow rounded-lg p-8 text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Could not start demo</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={createSession}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 1. Scan the QR code</h2>
              <div className="flex flex-col items-center">
                <div className="bg-gray-100 border border-gray-200 rounded-lg p-4 mb-4">
                  <img
                    src={session?.qrCodeDataUrl}
                    alt="Scan to enroll in GhostPIN MFA demo"
                    className="w-60 h-60 object-contain"
                  />
                </div>
                <p className="text-sm text-gray-600 text-center">
                  Use any authenticator app (Google Authenticator, Authy, 1Password, etc.) to scan. Codes refresh every 30 seconds.
                </p>
              </div>
              <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-xs uppercase text-gray-500 mb-2">Secret (base32)</p>
                <p className="font-mono text-sm break-all text-gray-900">{session?.secretBase32}</p>
              </div>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 2. Enter the current code</h2>
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
                    6-digit code
                  </label>
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, ''))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="123456"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  disabled={verifyState === 'loading'}
                >
                  {verifyState === 'loading' ? 'Verifying…' : 'Verify Code'}
                </button>
              </form>

              {verifyState === 'success' && (
                <div className="mt-4 flex items-start space-x-3 text-green-600">
                  <CheckCircle2 className="h-6 w-6 mt-0.5" />
                  <div>
                    <p className="font-semibold">Success</p>
                    <p className="text-sm text-green-700">{statusMessage}</p>
                  </div>
                </div>
              )}

              {verifyState === 'error' && (
                <div className="mt-4 flex items-start space-x-3 text-red-600">
                  <XCircle className="h-6 w-6 mt-0.5" />
                  <div>
                    <p className="font-semibold">Check the code</p>
                    <p className="text-sm text-red-700">{statusMessage}</p>
                  </div>
                </div>
              )}

              <div className="mt-6 text-sm text-gray-600 space-y-2">
                <p>
                  If you verify successfully, refresh the session to demonstrate enrollment again without leaving the page.
                </p>
                <p>
                  Share this URL when deployed to showcase the full MFA flow without requiring a user account.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
