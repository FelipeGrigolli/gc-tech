// ==========================================
// GC TECH UI — AVISOS E CONFIRMAÇÕES NO VISUAL DO SISTEMA
// Substitui alert() e confirm() do navegador (caixas cinza do Windows).
//
//   gcToast('Saved.')                                  → aviso verde
//   gcToast('Title\n\nDetails…', 'error')              → título + texto
//   gcConfirm({ title, message, confirmText, danger }) → Promise<boolean>
//
// Tipos: 'success' | 'error' | 'warning' | 'info'. Estilo próprio injetado,
// funciona em qualquer página (RCM escuro ou site claro).
// ==========================================

// Cada aba lembra o agente que fez login nela (sessionStorage) e o reafirma no armazenamento
// compartilhado ao abrir ou voltar para a aba. Assim duas abas podem ser dois agentes
// diferentes (ex.: Felipe e Alex) — o que vale é sempre a aba em que a pessoa está.
(function () {
  function claimAgent() {
    try {
      const n = sessionStorage.getItem('gc_agent_name');
      const p = sessionStorage.getItem('gc_agent_profile');
      if (n && localStorage.getItem('gc_agent_name') !== n) localStorage.setItem('gc_agent_name', n);
      if (p && localStorage.getItem('gc_agent_profile') !== p) localStorage.setItem('gc_agent_profile', p);
    } catch (e) {}
  }
  claimAgent();
  window.addEventListener('focus', claimAgent);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) claimAgent(); });
})();

(function () {
  const ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
  };
  const COLORS = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };

  const css = `
    .oui-stack { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 100001; display: flex; flex-direction: column-reverse; gap: 10px; align-items: center; pointer-events: none; width: max-content; max-width: calc(100vw - 32px); }
    .oui-toast { pointer-events: auto; display: flex; gap: 12px; align-items: flex-start; min-width: 280px; max-width: 460px; padding: 13px 16px; border-radius: 10px;
      background: #1e293b; color: #f1f5f9; border: 1px solid #334155; border-left: 4px solid var(--oui-c); box-shadow: 0 14px 34px rgba(0,0,0,.4);
      font: 14px/1.45 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; cursor: pointer; opacity: 0; transform: translateY(12px); transition: opacity .2s, transform .2s; }
    .oui-toast.show { opacity: 1; transform: none; }
    .oui-toast svg { flex-shrink: 0; color: var(--oui-c); margin-top: 1px; }
    .oui-toast strong { display: block; font-weight: 600; }
    .oui-toast span { display: block; color: #cbd5e1; font-size: 13px; margin-top: 2px; white-space: pre-line; }
    .oui-overlay { position: fixed; inset: 0; background: rgba(2, 6, 23, .65); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 100002; opacity: 0; transition: opacity .15s; }
    .oui-overlay.show { opacity: 1; }
    .oui-dialog { width: 100%; max-width: 420px; background: #1e293b; color: #f1f5f9; border: 1px solid #334155; border-radius: 12px; padding: 22px 22px 18px;
      box-shadow: 0 24px 60px rgba(0,0,0,.5); font: 14px/1.5 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; transform: translateY(8px); transition: transform .15s; }
    .oui-overlay.show .oui-dialog { transform: none; }
    .oui-dialog-head { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .oui-dialog-icon { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--oui-c); background: color-mix(in srgb, var(--oui-c) 16%, transparent); }
    .oui-dialog h3 { margin: 0; font-size: 17px; font-weight: 600; color: #f8fafc; }
    .oui-dialog p { margin: 0 0 18px; color: #cbd5e1; white-space: pre-line; }
    .oui-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .oui-btn { border: none; border-radius: 6px; padding: 9px 16px; font: 600 13px 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; cursor: pointer; }
    .oui-btn.ghost { background: transparent; color: #e2e8f0; border: 1px solid #475569; }
    .oui-btn.ghost:hover { background: #0f172a; }
    .oui-btn.primary { background: #15803D; color: #fff; }
    .oui-btn.primary:hover { background: #166534; }
    .oui-btn.danger { background: #dc2626; color: #fff; }
    .oui-btn.danger:hover { background: #b91c1c; }
  `;

  function injectStyles() {
    if (document.getElementById('oui-styles')) return;
    const style = document.createElement('style');
    style.id = 'oui-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function icon(kind, size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind] || ICONS.info}</svg>`;
  }

  // "Título\n\nTexto" → { title, body }. Remove emojis de aviso antigos do começo.
  function split(message) {
    const text = String(message == null ? '' : message).replace(/^\s*(⚠️|✅|❌)\s*/u, '').trim();
    const i = text.indexOf('\n\n');
    return i === -1 ? { title: text, body: '' } : { title: text.slice(0, i).trim(), body: text.slice(i + 2).trim() };
  }

  function stack() {
    let el = document.querySelector('.oui-stack');
    if (!el) {
      el = document.createElement('div');
      el.className = 'oui-stack';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  window.gcToast = function (message, kind, opts) {
    kind = COLORS[kind] ? kind : 'success';
    injectStyles();
    const { title, body } = split(message);
    const toast = document.createElement('div');
    toast.className = 'oui-toast';
    toast.style.setProperty('--oui-c', COLORS[kind]);
    toast.innerHTML = `${icon(kind, 18)}<div><strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}</div>`;
    const remove = () => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 220); };
    toast.addEventListener('click', remove);
    stack().appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    const duration = (opts && opts.duration) || (kind === 'success' || kind === 'info' ? 3200 : 6000);
    setTimeout(remove, duration);
  };

  // Aviso para mostrar na PRÓXIMA página (ex.: salvar e redirecionar)
  const FLASH_KEY = 'gc_flash_toast';
  window.gcFlash = function (message, kind) {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, kind })); } catch (e) { window.gcToast(message, kind); }
  };
  function showFlash() {
    let flash = null;
    try { flash = JSON.parse(sessionStorage.getItem(FLASH_KEY)); sessionStorage.removeItem(FLASH_KEY); } catch (e) {}
    if (flash && flash.message) window.gcToast(flash.message, flash.kind, { duration: 6000 });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFlash);
  else showFlash();

  window.gcConfirm = function (opts) {
    opts = opts || {};
    injectStyles();
    const kind = opts.danger ? 'error' : (opts.kind || 'warning');
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'oui-overlay';
      overlay.innerHTML = `
        <div class="oui-dialog" role="dialog" aria-modal="true" style="--oui-c: ${COLORS[kind]};">
          <div class="oui-dialog-head"><div class="oui-dialog-icon">${icon(kind, 18)}</div><h3>${esc(opts.title || 'Are you sure?')}</h3></div>
          ${opts.message ? `<p>${esc(opts.message)}</p>` : '<p></p>'}
          <div class="oui-actions">
            <button type="button" class="oui-btn ghost" data-oui="no">${esc(opts.cancelText || 'Cancel')}</button>
            <button type="button" class="oui-btn ${opts.danger ? 'danger' : 'primary'}" data-oui="yes">${esc(opts.confirmText || 'Confirm')}</button>
          </div>
        </div>`;

      const finish = answer => {
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 150);
        resolve(answer);
      };
      const onKey = e => {
        // Enter aciona o botão em foco (Cancel nas ações destrutivas, Confirm nas outras)
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      };
      overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.dataset.oui === 'no') finish(false);
        else if (e.target.dataset.oui === 'yes') finish(true);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      overlay.querySelector(opts.danger ? '[data-oui="no"]' : '[data-oui="yes"]').focus();
    });
  };
})();
