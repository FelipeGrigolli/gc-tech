// ==========================================
// GC TECH DEMO — RESET DOS DADOS DA APRESENTAÇÃO
// Todo o protótipo grava no navegador com chaves "gc_*". Os dados de exemplo
// (frota, reservas, bonds, planos, avarias) ficam no código e são recriados
// sozinhos quando essas chaves não existem. Então "resetar" = apagar as chaves.
//
// Como usar:
//   - Botão "Reset demo data" na capa (index.html) ou na barra do Customer Portal
//   - Atalho em qualquer página: Alt + Shift + R
// Outras abas/janelas do protótipo abertas recarregam sozinhas após o reset.
// ==========================================

(function () {
  const PREFIX = 'gc_';
  const SIGNAL_KEY = 'gc_demo_reset_signal';
  const NOTICE_KEY = 'gc_demo_reset_notice';
  // URL da capa, calculada a partir deste script (js/gc-demo.js → ../index.html)
  const scriptSrc = document.currentScript ? document.currentScript.src : '';
  const homeUrl = scriptSrc ? new URL('../index.html', scriptSrc).href : 'index.html';

  function clearStorage(storage) {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach(k => storage.removeItem(k));
    return keys.length;
  }

  function doReset() {
    try {
      clearStorage(localStorage);
      clearStorage(sessionStorage);
      // Avisa as outras abas (o evento "storage" só dispara nas outras)
      localStorage.setItem(SIGNAL_KEY, String(Date.now()));
      localStorage.removeItem(SIGNAL_KEY);
      sessionStorage.setItem(NOTICE_KEY, '1');
    } catch (e) { /* navegador sem storage: nada a limpar */ }
    window.location.href = homeUrl;
  }

  // ---------- Modal de confirmação (estilo próprio, funciona em qualquer página) ----------
  const css = `
    .od-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, .62); display: flex; align-items: center; justify-content: center; z-index: 100000; padding: 16px; opacity: 0; transition: opacity .15s; }
    .od-overlay.show { opacity: 1; }
    .od-card { background: #fff; color: #1a1a1a; border-radius: 14px; max-width: 420px; width: 100%; padding: 26px 26px 22px; box-shadow: 0 24px 60px rgba(0,0,0,.35); font-family: 'Outfit', 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; transform: translateY(8px); transition: transform .15s; }
    .od-overlay.show .od-card { transform: none; }
    .od-icon { width: 42px; height: 42px; border-radius: 50%; background: #dcfce7; color: #15803D; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
    .od-card h3 { margin: 0 0 8px; font-size: 19px; font-weight: 600; }
    .od-card p { margin: 0 0 10px; font-size: 14px; line-height: 1.5; color: #4b5563; }
    .od-card ul { margin: 0 0 18px; padding-left: 18px; font-size: 13px; line-height: 1.6; color: #4b5563; }
    .od-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .od-btn { border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .od-btn.ghost { background: #f1f5f9; color: #334155; }
    .od-btn.ghost:hover { background: #e2e8f0; }
    .od-btn.primary { background: #15803D; color: #fff; }
    .od-btn.primary:hover { background: #166534; }
    .od-toast { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 20px); background: #0f172a; color: #fff; border: 1px solid #334155; padding: 12px 20px; border-radius: 10px; font: 500 14px 'Outfit', 'Inter', -apple-system, 'Segoe UI', sans-serif; box-shadow: 0 12px 30px rgba(0,0,0,.3); z-index: 100000; opacity: 0; transition: opacity .2s, transform .2s; }
    .od-toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;

  function injectStyles() {
    if (document.getElementById('od-styles')) return;
    const style = document.createElement('style');
    style.id = 'od-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function openResetDialog() {
    if (document.querySelector('.od-overlay')) return;
    injectStyles();
    const overlay = document.createElement('div');
    overlay.className = 'od-overlay';
    overlay.innerHTML = `
      <div class="od-card" role="dialog" aria-modal="true" aria-labelledby="od-title">
        <div class="od-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
        </div>
        <h3 id="od-title">Reset demo data?</h3>
        <p>The prototype goes back to its original sample data:</p>
        <ul>
          <li>Bookings, chats, payment plans and damage reports created during tests are removed</li>
          <li>Customer and staff sessions are signed out</li>
          <li>Other open tabs of the prototype reload automatically</li>
        </ul>
        <div class="od-actions">
          <button type="button" class="od-btn ghost" data-od="cancel">Cancel</button>
          <button type="button" class="od-btn primary" data-od="confirm">Reset demo</button>
        </div>
      </div>`;

    const close = () => {
      overlay.classList.remove('show');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => overlay.remove(), 150);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.dataset.od === 'cancel') close();
      if (e.target.dataset.od === 'confirm') doReset();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    overlay.querySelector('[data-od="confirm"]').focus();
  }

  function showToast(text) {
    injectStyles();
    const toast = document.createElement('div');
    toast.className = 'od-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 250); }, 3200);
  }

  // Outra aba fez o reset: recarrega esta para não regravar dados antigos da memória
  window.addEventListener('storage', e => {
    if (e.key === SIGNAL_KEY && e.newValue) window.location.reload();
  });

  // Atalho: Alt + Shift + R
  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && (e.key === 'R' || e.key === 'r' || e.code === 'KeyR')) {
      e.preventDefault();
      openResetDialog();
    }
  });

  // Aviso de sucesso depois do redirecionamento para a capa
  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (sessionStorage.getItem(NOTICE_KEY)) {
        sessionStorage.removeItem(NOTICE_KEY);
        showToast('Demo data reset. Everything is back to the original sample data.');
      }
    } catch (e) { /* sem storage */ }
  });

  window.gcOpenResetDemo = openResetDialog;
})();
