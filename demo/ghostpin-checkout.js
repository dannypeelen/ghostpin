(function () {
  'use strict';

  const statusEl = document.getElementById('status');

  async function bootstrap() {
    try {
      const instance = await window.GhostPIN.init();
      wireButtons(instance);
    } catch (error) {
      console.error('GhostPIN bootstrap failed:', error);
      updateStatus('Verification system unavailable. Try again later.', 'error');
    }
  }

  function wireButtons(instance) {
    const buttons = document.querySelectorAll('[data-ghostpin="checkout"]');
    buttons.forEach((btn) => {
      if (btn.dataset.ghostpinBound === 'true') {
        return;
      }
      btn.dataset.ghostpinBound = 'true';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        handleCheckout(instance, btn).catch((error) => {
          console.error('GhostPIN checkout error:', error);
        });
      });
    });
  }

  function buildIntent(btn) {
    const amount = Number(btn.dataset.amount || btn.getAttribute('data-amount') || 0);
    const currency = (btn.dataset.currency || btn.getAttribute('data-currency') || 'USD').toUpperCase();
    const description = btn.dataset.description || btn.getAttribute('data-description') || btn.textContent.trim();
    const merchantReference = btn.dataset.reference || btn.dataset.merchantReference || `ref-${Date.now()}`;

    return {
      amount,
      currency,
      description,
      merchant_reference: merchantReference
    };
  }

  async function handleCheckout(instance, btn) {
    if (btn.dataset.ghostpinProcessing === 'true') {
      return;
    }

    btn.dataset.ghostpinProcessing = 'true';
    const originalLabel = btn.innerHTML;
    updateButton(btn, 'Verifying...', true);
    updateStatus('Confirming your identity...', 'info');

    try {
      const intent = buildIntent(btn);
      const result = await window.GhostPIN.authenticateAndVerify({ intent, targetElement: btn });

      if (result.verified) {
        updateButton(btn, 'Verified', true);
        updateStatus('Verification passed. Capturing payment...', 'success');
        await capturePayment(instance, intent, result);
        updateStatus('Payment captured successfully.', 'success');
      } else {
        updateButton(btn, originalLabel, false);
        updateStatus(result.reason || 'Verification blocked.', 'warning');
      }
    } catch (error) {
      updateButton(btn, originalLabel, false);
      updateStatus(error.message || 'Verification failed.', 'error');
      throw error;
    } finally {
      btn.dataset.ghostpinProcessing = 'false';
    }
  }

  async function capturePayment(instance, intent, verification) {
    try {
      const endpoint = new URL('/capture-payment', instance.apiUrl || window.location.origin).toString();
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, verification })
      });
    } catch (error) {
      console.warn('Capture payment failed', error);
    }
  }

  function updateButton(btn, label, disabled) {
    btn.innerHTML = `<span>${label}</span>`;
    btn.disabled = Boolean(disabled);
  }

  function updateStatus(message, type) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.className = type ? `status ${type}` : 'status';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
