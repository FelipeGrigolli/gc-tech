// ==========================================
// GC TECH RCM SHELL — SIDEBAR ÚNICA DO RCM
// Fonte única do menu lateral. Usado no Agent Dashboard e nas telas avulsas do RCM
// (Fleet Planner, Customers & Vehicles, Damage Control, Add Booking, Daily Activity).
//
// - No Agent Dashboard: preenche o <aside class="sidebar"> existente. Os módulos
//   abrem com switchModule(), como antes.
// - Nas outras telas: exige login de agente, envolve o conteúdo da página num
//   layout com a sidebar à esquerda e leva os módulos do dashboard por link
//   (agent-dashboard.html#module-x ou #module-placeholder=Título).
//
// Incluir ANTES dos outros scripts da página, depois de todo o HTML do body.
// ==========================================

(function () {
  const AUTH_KEY = 'gc_agent_auth';
  const PROFILE_KEY = 'gc_agent_profile';
  const DASHBOARD = 'agent-dashboard.html';
  const page = (location.pathname.split('/').pop() || '').toLowerCase();
  const onDashboard = page === DASHBOARD;

  // ---------- Menu ----------
  // module: módulo do dashboard | page: tela avulsa | placeholder: módulo ainda não construído
  const MENU = [
    { label: 'Main', items: [
      { icon: '👔', text: 'Executive Overview', module: 'module-executive', title: 'Executive Overview', access: 'executive' },
      { icon: '📊', text: 'Dashboard', module: 'module-dashboard', title: "Today's Overview" },
      { icon: '📅', text: 'Bookings', page: 'gc-add-booking.html' },
      { icon: '🔑', text: 'Rentals & Contracts', placeholder: 'Rentals & Contracts' }
    ]},
    { label: 'Operations', items: [
      { icon: '⚠️', text: 'Agent Requests', module: 'module-agent-requests', title: 'Agent Requests & Allocations' },
      { icon: '📋', text: 'Daily Activity', page: 'gc-daily-activity.html' },
      { icon: '🕘', text: 'Activity Log', page: 'gc-activity-log.html' },
      { icon: '🛣️', text: 'Tolls', page: 'gc-tolls.html' },
      { icon: '💬', text: 'Live Chat', module: 'module-livechat', title: 'Live Chat System', after: 'renderLiveChatModule();' },
      { icon: '📞', text: '3CX Calls', module: 'module-3cx', title: '3CX · Calls' },
      { icon: '🟢', text: 'WhatsApp', module: 'module-whatsapp', title: 'WhatsApp · via 3CX', count: 'wa-menu-count' }
    ]},
    { label: 'Fleet & Customers', items: [
      { icon: '🚙', text: 'Vehicles', page: 'gc-fleet-planner.html' },
      { icon: '👥', text: 'Customers & Vehicles', page: 'gc-customers.html' },
      { icon: '🔧', text: 'Maintenance', placeholder: 'Maintenance Schedules' },
      { icon: '⚠️', text: 'Damage Control', page: 'gc-damage-control.html' }
    ]},
    { label: 'Administration', items: [
      { icon: '📍', text: 'Branches', placeholder: 'Branch Operations' },
      { icon: '💳', text: 'Payment Plans', module: 'module-payments', title: 'Payment Plans' },
      { icon: '💰', text: 'Bond Refunds', module: 'module-bonds', title: 'Bond Refunds', access: 'bonds', count: 'bn-menu-count' },
      { icon: '📈', text: 'Reports & Analytics', module: 'module-analytics', title: 'Reports & Analytics', access: 'analytics' },
      { icon: '⚙️', text: 'Settings', placeholder: 'System Settings' }
    ]}
  ];

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Texto dentro de onclick="switchModule(..., 'Título')": escapa aspas simples para JS e o resto para HTML
  function jsArg(text) {
    return esc(String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  }

  function itemHtml(it) {
    const attrs = [];
    if (it.access) attrs.push(`data-access="${it.access}"`);
    const count = it.count ? ` <span class="bn-menu-count" id="${it.count}"></span>` : '';
    const label = `${it.icon} ${esc(it.text)}${count}`;

    if (it.page) {
      const active = !onDashboard && page === it.page ? ' active' : '';
      return `<a href="${it.page}" class="menu-item${active}" ${attrs.join(' ')}>${label}</a>`;
    }
    const moduleId = it.placeholder ? 'module-placeholder' : it.module;
    const title = it.placeholder || it.title;
    if (onDashboard) {
      const onclick = `switchModule('${moduleId}', this, '${jsArg(title)}');${it.after ? ' ' + it.after : ''} return false;`;
      return `<a href="#" class="menu-item" ${attrs.join(' ')} onclick="${onclick}">${label}</a>`;
    }
    const hash = it.placeholder ? `#module-placeholder=${encodeURIComponent(title)}` : `#${moduleId}`;
    return `<a href="${DASHBOARD}${hash}" class="menu-item" ${attrs.join(' ')}>${label}</a>`;
  }

  function sidebarHtml() {
    const sections = MENU.map(s => `<div class="menu-label">${esc(s.label)}</div>${s.items.map(itemHtml).join('')}`).join('');
    const logout = onDashboard ? 'agentLogout()' : 'gcShellLogout()';
    return `
      <div class="sidebar-logo">
        <img src="../assets/img/gc-logo.png" alt="GC Tech">
        <span>GC Tech Dashboard</span>
      </div>
      <div class="sidebar-menu">${sections}</div>
      <div class="sidebar-footer">
        <div class="agent-profile">
          <div class="avatar">👤</div>
          <div>
            <div id="logged-agent-name" class="shell-agent-name">Agent Name</div>
            <div id="logged-agent-role" class="shell-agent-role">Role</div>
          </div>
        </div>
        <button type="button" class="shell-logout" onclick="${logout}">Log out</button>
      </div>`;
  }

  function readProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch (e) { return null; }
  }

  // Esconde Executive / Analytics / Bond Refunds para quem não tem acesso (mesma regra do dashboard)
  function applyAccess(aside, profile) {
    const access = (profile && profile.access ? profile.access : []).slice();
    const username = profile && profile.username;
    let bondsAllowed = false;
    if (typeof bondHasAccess === 'function') bondsAllowed = bondHasAccess(username);
    else {
      let list = [];
      try { list = JSON.parse(localStorage.getItem('gc_bond_access') || '[]') || []; } catch (e) {}
      bondsAllowed = !!username && (['felipe', 'alex'].includes(username) || list.includes(username));
    }
    if (bondsAllowed) access.push('bonds');
    aside.querySelectorAll('.menu-item[data-access]').forEach(a => { a.hidden = !access.includes(a.dataset.access); });
  }

  window.gcShellLogout = function () {
    try {
      sessionStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem('gc_agent_name');
      localStorage.removeItem('gc_agent_role');
    } catch (e) {}
    location.href = DASHBOARD;
  };

  // ---------- No Agent Dashboard: só preenche a sidebar ----------
  if (onDashboard) {
    const aside = document.querySelector('aside.sidebar');
    if (aside) aside.innerHTML = sidebarHtml();
    return; // login, acesso e nome do agente continuam com o agent-script.js
  }

  // ---------- Nas telas avulsas: login obrigatório ----------
  let authed = false;
  try { authed = sessionStorage.getItem(AUTH_KEY) === 'true'; } catch (e) {}
  const profile = readProfile();
  if (!authed || !profile) {
    document.documentElement.style.visibility = 'hidden';
    location.replace(DASHBOARD);
    return;
  }

  // Janela separada (?popup=1, aberta pelo Daily Activity): sem menu lateral
  if (new URLSearchParams(location.search).get('popup') === '1') {
    document.body.classList.add('rcm-popup');
    return;
  }

  // Envolve o conteúdo atual da página (menos scripts) num layout com sidebar
  const body = document.body;
  const shell = document.createElement('div');
  shell.className = 'rcm-shell';
  const aside = document.createElement('aside');
  aside.className = 'sidebar rcm-shell-sidebar';
  aside.innerHTML = sidebarHtml();
  const main = document.createElement('div');
  main.className = 'rcm-shell-main';

  Array.from(body.childNodes).forEach(node => {
    if (node.nodeName === 'SCRIPT') return;
    main.appendChild(node);
  });
  shell.appendChild(aside);
  shell.appendChild(main);
  body.insertBefore(shell, body.firstChild);
  body.classList.add('has-rcm-shell');

  aside.querySelector('#logged-agent-name').textContent = profile.name || 'Agent';
  aside.querySelector('#logged-agent-role').textContent = profile.role || '';
  applyAccess(aside, profile);
})();
