// ==========================================
// SEARCH RESULTS — lista de veículos + mapa da filial
// Modelos, preços, fotos e disponibilidade vêm de gc-fleet-data.js
// (a mesma fonte do Fleet Planner, Home e Checkout).
// Lê/grava 'gc_pending_search' e envia para checkout.html.
// ==========================================

let srActiveTab = 'Cars';
let srPickupPicker = null;
let srDropoffPicker = null;

// ---------- Leitura da busca ----------
function srTabFromVehicle(vehicle) {
  if (!vehicle) return 'Cars';
  if (FLEET_WEB_TABS.some(t => t.id === vehicle)) return vehicle;
  if (vehicle === 'Commercial') return 'Trucks'; // formato antigo do widget
  if (vehicle === 'Passenger') return 'Cars';
  const cat = fleetFindCategoryByModel(vehicle);   // voltou do checkout com um modelo
  return cat ? cat.tab : 'Cars';
}

function srReadRange() {
  const start = fleetParseDate(`${document.getElementById('sr-pickup-date').value} ${document.getElementById('sr-pickup-time').value}`);
  let end = fleetParseDate(`${document.getElementById('sr-dropoff-date').value} ${document.getElementById('sr-dropoff-time').value}`);
  return { start, end };
}

function srValidate() {
  const errorEl = document.getElementById('sr-error');
  document.querySelectorAll('.search-band .of-field.invalid').forEach(f => f.classList.remove('invalid'));
  const { start, end } = srReadRange();
  const mark = ids => ids.forEach(id => document.getElementById(id).closest('.of-field').classList.add('invalid'));

  if (isNaN(start) || start <= Date.now()) {
    mark(['sr-pickup-date', 'sr-pickup-time']);
    errorEl.textContent = 'Pick-up time must be in the future.';
    return false;
  }
  if (isNaN(end) || end <= start) {
    mark(['sr-dropoff-date', 'sr-dropoff-time']);
    errorEl.textContent = 'Drop-off must be after pick-up.';
    return false;
  }
  if (!fleetOneWayAllowed(document.getElementById('sr-pickup-loc').value, document.getElementById('sr-dropoff-loc').value)) {
    mark(['sr-dropoff-loc']);
    errorEl.textContent = FLEET_ONE_WAY_MESSAGE;
    return false;
  }
  errorEl.textContent = '';
  return true;
}

function srSaveSearch(vehicle) {
  localStorage.setItem('gc_pending_search', JSON.stringify({
    vehicle: vehicle,
    loc: document.getElementById('sr-pickup-loc').value,
    dropoff: document.getElementById('sr-dropoff-loc').value,
    date: document.getElementById('sr-pickup-date').value,
    time: document.getElementById('sr-pickup-time').value,
    dropoffDate: document.getElementById('sr-dropoff-date').value,
    dropoffTime: document.getElementById('sr-dropoff-time').value
  }));
}

// ---------- Widget ----------
function srRenderTabs() {
  document.getElementById('sr-tabs').innerHTML = FLEET_WEB_TABS.map(t => `
    <button type="button" class="w-tab ${t.id === srActiveTab ? 'active' : ''}" onclick="srSelectTab('${t.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
      ${t.id}
    </button>
  `).join('');
}

function srSelectTab(tabId) {
  srActiveTab = tabId;
  srRenderTabs();
  srRenderResults();
}

function srSyncDropoffLabel() {
  const pickup = document.getElementById('sr-pickup-loc').value;
  document.querySelector('#sr-dropoff-loc option[value="Same as Pick up"]').textContent = fleetBranchLabel(pickup);
  // Sem one-way entre Sydney e Brisbane
  fleetRestrictDropoffSelect(document.getElementById('sr-dropoff-loc'), pickup);
}

function srApplySearch() {
  if (!srValidate()) return;
  srSaveSearch(srActiveTab);
  srUpdateMap();
  srRenderResults();
}

function srInitWidget(pending) {
  srActiveTab = srTabFromVehicle(pending.vehicle);
  srRenderTabs();

  const branchOptions = Object.values(FLEET_BRANCHES)
    .map(name => `<option value="${name}">${fleetBranchLabel(name)}</option>`).join('');
  const pickupSel = document.getElementById('sr-pickup-loc');
  const dropoffSel = document.getElementById('sr-dropoff-loc');
  pickupSel.innerHTML = branchOptions;
  pickupSel.value = Object.values(FLEET_BRANCHES).includes(pending.loc) ? pending.loc : 'Sydney - Mascot';
  dropoffSel.innerHTML = `<option value="Same as Pick up"></option>` + branchOptions;
  dropoffSel.value = Object.values(FLEET_BRANCHES).includes(pending.dropoff) ? pending.dropoff : 'Same as Pick up';
  srSyncDropoffLabel();

  document.getElementById('sr-pickup-time').innerHTML = fleetTimeOptions(pending.time || '08:30 AM');
  document.getElementById('sr-dropoff-time').innerHTML = fleetTimeOptions(pending.dropoffTime || pending.time || '08:30 AM');

  // Datas: as da busca, ou amanhã → depois de amanhã
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  let pickupDate = pending.date ? new Date(fleetParseDate(pending.date)) : tomorrow;
  if (isNaN(pickupDate)) pickupDate = tomorrow;
  let dropoffDate = pending.dropoffDate ? new Date(fleetParseDate(pending.dropoffDate)) : null;
  if (!dropoffDate || isNaN(dropoffDate) || dropoffDate < pickupDate) {
    dropoffDate = new Date(pickupDate); dropoffDate.setDate(dropoffDate.getDate() + 1);
  }

  const common = { dateFormat: 'd M Y', minDate: 'today', disableMobile: true };
  srPickupPicker = flatpickr('#sr-pickup-date', {
    ...common,
    defaultDate: pickupDate,
    onChange: dates => {
      if (!dates[0]) return;
      srDropoffPicker.set('minDate', dates[0]);
      if (srDropoffPicker.selectedDates[0] && srDropoffPicker.selectedDates[0] < dates[0]) {
        const next = new Date(dates[0]); next.setDate(next.getDate() + 1);
        srDropoffPicker.setDate(next);
      }
    }
  });
  srDropoffPicker = flatpickr('#sr-dropoff-date', { ...common, defaultDate: dropoffDate });
}

// ---------- Resultados ----------
function srRenderResults() {
  const { start, end } = srReadRange();
  const validRange = !isNaN(start) && !isNaN(end) && end > start;
  const days = validRange ? Math.max(1, Math.ceil((end - start) / FLEET_DAY_MS)) : 1;
  const occupancy = fleetGetOccupancy();
  const hybridOnly = document.getElementById('sr-hybrid-only').checked;
  const sort = document.getElementById('sr-sort').value;
  const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  let cats = FLEET_CATEGORIES.filter(c => c.tab === srActiveTab && (!hybridOnly || c.fuel === 'Hybrid'));
  if (sort === 'price-asc') cats = cats.slice().sort((a, b) => a.rate - b.rate);
  if (sort === 'price-desc') cats = cats.slice().sort((a, b) => b.rate - a.rate);

  document.getElementById('sr-count').textContent = `${cats.length} ${hybridOnly ? 'hybrid ' : ''}${srActiveTab.toLowerCase()} found`;
  const dropoff = document.getElementById('sr-dropoff-loc').value;
  const pickup = document.getElementById('sr-pickup-loc').value;
  document.getElementById('sr-trip-summary').textContent = validRange
    ? `${fleetBranchLabel(pickup)}${dropoff !== 'Same as Pick up' ? ' → ' + fleetBranchLabel(dropoff) : ''} · ${fleetFormatDate(start)} ${fleetFormatTime(start)} – ${fleetFormatDate(end)} ${fleetFormatTime(end)} · ${days} day${days > 1 ? 's' : ''}`
    : 'Choose your dates to see availability and total price.';

  if (cats.length === 0) {
    document.getElementById('sr-results').innerHTML = `<div class="no-results">No ${hybridOnly ? 'hybrid ' : ''}${srActiveTab.toLowerCase()} in this category. Try another vehicle type.</div>`;
    return;
  }

  document.getElementById('sr-results').innerHTML = cats.map(c => {
    const vehicles = FLEET_VEHICLES.filter(v => v.categoryId === c.id);
    const free = validRange ? vehicles.filter(v => fleetIsPlateFree(v.plate, start, end, null, occupancy)).length : vehicles.length;
    const available = free > 0;
    const availHtml = !available
      ? `<span class="avail-none">Booked out for your dates — we'll offer an alternative</span>`
      : free <= 2 ? `<span class="avail-low">Only ${free} left for your dates</span>`
      : `<span class="avail-ok">✓ Available for your dates</span>`;

    return `
      <article class="result-card ${available ? '' : 'unavailable'}">
        <div class="result-img">
          <span class="fuel-tag ${c.fuel === 'Hybrid' ? 'hybrid' : ''}">${c.fuel}</span>
          <img src="../assets/img/${c.img}" alt="${c.model}">
        </div>
        <div class="result-body">
          <div class="result-top">
            <div>
              <div class="result-type">${titleCase(c.name)}</div>
              <div class="result-name">${c.model}</div>
              <div class="result-desc">${c.desc}</div>
            </div>
            <div class="result-price">
              <div class="per-day"><strong>$${c.rate.toFixed(2)}</strong> /day</div>
              <div class="total">${days} day${days > 1 ? 's' : ''} · <strong>$${(c.rate * days).toFixed(2)}</strong> total</div>
              <div class="total" style="font-size:11px;opacity:.75">+ $404.00 bond, refunded after return · pay at pick-up, card only</div>
            </div>
          </div>
          <div class="result-specs"><span>👤 ${c.seats} seats</span><span>⚙️ Automatic</span><span>⛽ ${c.fuel}</span></div>
          <div class="result-foot">
            ${availHtml}
            <button class="btn-brand ${available ? '' : 'btn-request'}" onclick="selectVehicle('${c.model}')">${available ? 'Select' : 'Request'}</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ---------- Mapa ----------
function srUpdateMap() {
  const name = document.getElementById('sr-pickup-loc').value;
  const [city, suburb] = name.split(' - ');
  const state = city === 'Brisbane' ? 'QLD' : 'NSW';
  const code = Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === name);
  const count = FLEET_VEHICLES.filter(v => v.branch === code).length;

  // Sem internet: troca o Google Maps por um quadro com o nome da filial
  const map = document.getElementById('sr-map');
  const offline = document.getElementById('sr-map-offline');
  const isOffline = navigator.onLine === false;
  map.hidden = isOffline;
  if (offline) {
    offline.hidden = !isOffline;
    offline.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
      <strong>${suburb}</strong>
      <span>${city}, ${state}</span>`;
  }
  const mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(`${suburb} ${state} Australia`)}&z=13&output=embed`;
  if (!isOffline && map.src !== mapSrc) map.src = mapSrc;
  document.getElementById('sr-map-info').innerHTML = `
    <small>Pick-up branch</small>
    <strong>${suburb}</strong>
    ${city}, ${state} · ${count} vehicles based here
  `;
}

// Internet caiu ou voltou com a página aberta: atualiza o mapa
window.addEventListener('online', srUpdateMap);
window.addEventListener('offline', srUpdateMap);

// ---------- Selecionar → Checkout ----------
function selectVehicle(model) {
  if (!srValidate()) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  srSaveSearch(model);
  window.location.href = 'checkout.html';
}

function srOpenChat() {
  openCustomerChatWithPrompt(); // gc-chat.js
}

window.addEventListener('DOMContentLoaded', () => {
  let pending = {};
  try { pending = JSON.parse(localStorage.getItem('gc_pending_search') || '{}') || {}; } catch (e) {}
  srInitWidget(pending);
  srUpdateMap();
  srRenderResults();
});
