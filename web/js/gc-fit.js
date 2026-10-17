// ==========================================
// GC TECH FIT — ENCAIXA O LAYOUT NA TELA
// O protótipo foi desenhado para uma área útil de ~1600 × 760 px. Em telas menores
// (ex.: notebook 1920×1080 com escala de 150% no Windows = 1280×~590 no navegador)
// a página inteira é reduzida com CSS zoom para caber sem cortar nada.
// Carregar no <head> de todas as páginas, antes dos CSS.
//
// Regras que usam vh/vw dividem por var(--fit-zoom), porque o zoom também encolhe vh/vw.
// Popups posicionados por coordenada do mouse/viewport (flatpickr, tooltip do planner)
// recebem o zoom inverso para continuar alinhados.
// ==========================================
(function () {
  var DESIGN_W = 1600;
  var DESIGN_H = 760;
  var MIN_ZOOM = 0.7;
  var MIN_FIT_WIDTH = 900;   // janelas estreitas (popup do chat, celular) têm layout próprio: sem zoom
  var root = document.documentElement;

  function compute() {
    var w = window.innerWidth || root.clientWidth;
    var h = window.innerHeight || root.clientHeight;
    if (w < MIN_FIT_WIDTH) return 1;
    var z = Math.min(1, w / DESIGN_W, h / DESIGN_H);
    return Math.round(Math.max(MIN_ZOOM, z) * 100) / 100;
  }

  var current = 0;
  function apply() {
    var z = compute();
    if (z === current) return;
    current = z;
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--fit-zoom', String(z));
    window.GC_FIT_ZOOM = z;
  }

  var style = document.createElement('style');
  style.id = 'gc-fit-styles';
  style.textContent =
    '.flatpickr-calendar:not(.inline):not(.static), #hover-tooltip { zoom: calc(1 / var(--fit-zoom, 1)); }';
  (document.head || root).appendChild(style);

  apply();
  var timer = null;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 80);
  });
})();
