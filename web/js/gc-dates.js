// ==========================================
// GC TECH DATES — TODOS OS CALENDÁRIOS EM DIA/MÊS/ANO
// O <input type="date"> nativo mostra a data no formato do idioma do navegador
// (em inglês dos EUA: MM/DD/AAAA). Este script troca cada campo de data e de data/hora
// pelo flatpickr exibindo DD/MM/AAAA (e DD/MM/AAAA HH:MM), em qualquer navegador.
//
// O valor do campo continua igual para o resto do código: "2026-10-15" e "2026-10-15T09:00".
// Ler ou gravar input.value funciona como antes; o "change" continua disparando.
// Campos criados depois (formulários, janelas) são trocados automaticamente.
// Fica nativo: campo dentro de .bd-cal (calendário escondido do botão 📅 do Planner)
// ou com o atributo data-native-date.
// ==========================================
(function () {
  // vendor/flatpickr/ ao lado da pasta js/ deste script (funciona em qualquer página)
  const self = document.currentScript && document.currentScript.src;
  const BASE = self ? self.replace(/js\/gc-dates\.js(\?.*)?$/, 'vendor/flatpickr/') : '../vendor/flatpickr/';
  const SELECTOR = 'input[type="date"], input[type="datetime-local"]';
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  // Visual do campo original copiado para o campo novo (as regras de CSS da página miram input[type="date"])
  const COPY = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
    'backgroundColor', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'height', 'boxSizing'];

  function loadCss(href, id) {
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.id = id;
    document.head.appendChild(l);
  }

  function ensureLib(cb) {
    if (!document.querySelector('link[href*="flatpickr.min.css"]')) loadCss(BASE + 'flatpickr.min.css', 'od-fp-css');
    if (window.flatpickr) { cb(); return; }
    const s = document.createElement('script');
    s.src = BASE + 'flatpickr.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  // Página escura (RCM) usa o tema escuro do calendário
  function isDarkPage() {
    const m = (getComputedStyle(document.body).backgroundColor || '').match(/\d+(\.\d+)?/g);
    if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return false;
    const [r, g, b] = m.map(Number);
    return (r * 299 + g * 587 + b * 114) / 1000 < 110;
  }

  function skip(input) {
    return input._odPicker || input.hasAttribute('data-native-date') || input.closest('.bd-cal');
  }

  function upgrade(input) {
    if (skip(input)) return;
    const withTime = input.type === 'datetime-local';
    const fmt = withTime ? 'Y-m-d\\TH:i' : 'Y-m-d';
    const cs = getComputedStyle(input);
    const look = {};
    COPY.forEach(k => { look[k] = cs[k]; });
    const width = input.style.width || (input.offsetParent !== null ? cs.width : '');
    const step = Number(input.getAttribute('step')) || 0;
    const initial = valueDesc.get.call(input);

    const fp = flatpickr(input, {
      altInput: true,
      altInputClass: (input.className + ' od-date').trim(),
      altFormat: withTime ? 'd/m/Y H:i' : 'd/m/Y',
      dateFormat: fmt,
      enableTime: withTime,
      time_24hr: true,
      minuteIncrement: step >= 60 ? Math.round(step / 60) : 5,
      allowInput: true,
      disableMobile: true,
      minDate: input.getAttribute('min') || null,
      maxDate: input.getAttribute('max') || null,
      defaultDate: initial || null
    });
    input._odPicker = fp;

    const alt = fp.altInput;
    Object.assign(alt.style, look);
    if (width && width !== 'auto') alt.style.width = width;
    alt.placeholder = withTime ? 'DD/MM/YYYY HH:MM' : 'DD/MM/YYYY';
    if (input.title) alt.title = input.title;

    // input.value = '2026-10-15' feito pelo código atualiza o que aparece na tela
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) {
        valueDesc.set.call(this, v);
        const cur = fp.selectedDates[0] ? fp.formatDate(fp.selectedDates[0], fmt) : '';
        if ((v || '') === cur) return; // o próprio flatpickr gravando: nada a fazer
        if (v) fp.setDate(v, false, fmt);
        else fp.clear(false);
      }
    });
  }

  function upgradeIn(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SELECTOR)) upgrade(root);
    root.querySelectorAll && root.querySelectorAll(SELECTOR).forEach(upgrade);
  }

  // Campo removido da tela (formulário redesenhado): solta o calendário dele
  function cleanupIn(root) {
    if (!root || root.nodeType !== 1) return;
    const list = root.matches && root.matches('input') ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll('input') : []);
    list.forEach(i => { if (i._odPicker && !i.isConnected) { try { i._odPicker.destroy(); } catch (e) {} i._odPicker = null; } });
  }

  function start() {
    ensureLib(() => {
      if (isDarkPage() && !document.querySelector('link[href*="themes/dark.css"]')) loadCss(BASE + 'themes/dark.css', 'od-fp-dark');
      upgradeIn(document.body);
      new MutationObserver(muts => muts.forEach(m => {
        m.addedNodes.forEach(upgradeIn);
        m.removedNodes.forEach(cleanupIn);
      })).observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
