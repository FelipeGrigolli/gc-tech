// ==========================================
// GC TECH FLEET DATA — FONTE ÚNICA DA FROTA
// Usado por: Fleet Planner, Add Booking, Customer Portal e Agent Dashboard.
// Qualquer página que cria/altera reservas deve usar fleetFindFreePlate()
// para garantir que dois bookings nunca ocupem a mesma placa ao mesmo tempo.
// Todos os nomes globais aqui usam o prefixo fleet/FLEET_ para não colidir
// com os outros scripts (tudo roda no mesmo escopo global do navegador).
// ==========================================

const FLEET_DAY_MS = 1000 * 60 * 60 * 24;
const FLEET_REQUESTS_KEY = 'gc_unavailable_requests';
const FLEET_MULTI_PREFIX = 'gc_multi_bookings_';
const FLEET_MAIN_PREFIX = 'gc_booking_poc_';

// Status em que a reserva NÃO está segurando um veículo físico
const FLEET_NON_HOLDING_STATUSES = ['cancelled', 'fleet_pending', 'proposal_sent'];

const FLEET_BRANCHES = {
  PAR: 'Sydney - Parramatta',
  MAS: 'Sydney - Mascot',
  BLK: 'Sydney - Blacktown',
  NSY: 'Sydney - North Sydney',
  EGF: 'Brisbane - Eagle Farm',
  WGB: 'Brisbane - Woolloongabba'
};

// section: 'Passenger' | 'Commercial'
// model: nome canônico (igual ao catálogo do Customer Portal / search-results)
// aliases: nomes antigos que já existem em reservas gravadas no localStorage
const FLEET_CATEGORIES = [
  { id: 'small-auto',     section: 'Passenger',  name: 'SMALL CAR AUTOMATIC',          model: 'Toyota Yaris',               label: 'Yaris 4Dr',          rate: 59.00,  aliases: [] },
  { id: 'small-new',      section: 'Passenger',  name: 'SMALL CAR AUTOMATIC-NEW',      model: 'New Toyota Yaris',           label: 'Yaris 4Dr (New)',    rate: 64.00,  aliases: [] },
  { id: 'small-hybrid',   section: 'Passenger',  name: 'SMALL CAR HYBRID',             model: 'Hybrid Toyota Yaris',        label: 'Yaris Hybrid',       rate: 67.00,  aliases: ['Toyota Yaris Hybrid'] },
  { id: 'mid-hatch',      section: 'Passenger',  name: 'MID SIZE CAR HATCH HYBRID',    model: 'Toyota Corolla',             label: 'Corolla Hatch',      rate: 72.00,  aliases: ['Toyota Corolla Hatch'] },
  { id: 'mid-sedan',      section: 'Passenger',  name: 'MID SIZE CAR SEDAN HYBRID',    model: 'Toyota Corolla Sedan',       label: 'Corolla Sedan',      rate: 74.00,  aliases: [] },
  { id: 'full-car',       section: 'Passenger',  name: 'FULL SIZE CAR HYBRID',         model: 'Toyota Camry',               label: 'Camry',              rate: 79.00,  aliases: [] },
  { id: 'mid-suv',        section: 'Passenger',  name: 'MID SIZE SUV',                 model: 'Mitsubishi ASX',             label: 'ASX',                rate: 76.00,  aliases: [] },
  { id: 'cross-suv',      section: 'Passenger',  name: 'MID SIZE CROSS SUV',           model: 'Toyota Corolla Cross',       label: 'Corolla Cross',      rate: 81.00,  aliases: [] },
  { id: 'mid-7seat',      section: 'Passenger',  name: 'MID SIZE 7 SEATER SUV',        model: 'Mitsubishi Outlander',       label: 'Outlander 7 Seater', rate: 95.00,  aliases: ['Mitsubishi Outlander (7 Seater)'] },
  { id: 'full-7seat',     section: 'Passenger',  name: 'FULL SIZE 7 SEATER HYBRID',    model: 'Hybrid Toyota Kluger',       label: 'Kluger Hybrid',      rate: 129.00, aliases: ['Toyota Kluger'] },
  { id: 'eight-seat',     section: 'Passenger',  name: 'EIGHT SEATER AUTOMATIC',       model: 'Hyundai Staria',             label: 'Staria 8 Seater',    rate: 139.00, aliases: ['Hyundai Staria Van'] },
  { id: 'hiace-1t',       section: 'Commercial', name: 'TOYOTA HIACE 1T VAN AUTO',     model: 'Toyota Hiace 1T Van',        label: 'Hiace 1T Van',       rate: 85.00,  aliases: ['Toyota Hiace 1T Van DIESEL'] },
  { id: 'hiace-15t',      section: 'Commercial', name: 'TOYOTA HIACE 1.5T VAN AUTO',   model: 'Toyota Hiace 1.5T Van',      label: 'Hiace 1.5T Van',     rate: 99.00, aliases: [] },
  { id: 'pantech',        section: 'Commercial', name: 'PANTECH TRUCK + TAIL LIFT',    model: 'Auto Pantech Truck',         label: 'Hino 300 Pantech',   rate: 159.00, aliases: ['Hino 300 Series Pantech', 'Auto Pantech Truck (Long)+Lift', 'Hino 300 Series Pantech (Long) + Lift', 'Auto Pantech'] },
  { id: 'hilux-auto',     section: 'Commercial', name: 'TOYOTA HILUX UTILITY AUTO',    model: 'Toyota Hilux Utility Auto',  label: 'Hilux Ute Auto',     rate: 72.00,  aliases: ['Toyota Hilux'] },
  { id: 'hilux-diesel',   section: 'Commercial', name: 'TOYOTA HILUX UTILITY DIESEL',  model: 'Toyota Hilux Utility DIESEL', label: 'Hilux Ute 4x4',     rate: 78.00,  aliases: [] }
];

// Dados de vitrine para o site do cliente (Home / Search):
// aba do widget, foto, combustível, lugares e descrição curta
const FLEET_CATEGORY_WEB = {
  'small-auto':   { tab: 'Cars',   img: 'fleet-photos/yaris.jpg', fuel: 'Petrol', seats: 5, desc: 'Our best value entry' },
  'small-new':    { tab: 'Cars',   img: 'fleet-photos/yaris.jpg', fuel: 'Petrol', seats: 5, desc: 'Compact yet spacious' },
  'small-hybrid': { tab: 'Cars',   img: 'fleet-photos/yaris.jpg', fuel: 'Hybrid', seats: 5, desc: 'Impressive 3.3L/100km fuel consumption' },
  'mid-hatch':    { tab: 'Cars',   img: 'fleet-photos/corolla-hatch.jpg', fuel: 'Hybrid', seats: 5, desc: 'Saves 25–35% on fuel' },
  'mid-sedan':    { tab: 'Cars',   img: 'fleet-photos/corolla-sedan.jpg', fuel: 'Hybrid', seats: 5, desc: 'Achieves approx 3.9L/100km' },
  'full-car':     { tab: 'Cars',   img: 'fleet-photos/camry.jpg',  fuel: 'Hybrid', seats: 5, desc: 'Unlimited kilometres included' },
  'mid-suv':      { tab: 'SUVs',   img: 'fleet-photos/asx.jpg', fuel: 'Petrol', seats: 5, desc: 'Comfortable with plenty of boot space' },
  'cross-suv':    { tab: 'SUVs',   img: 'fleet-photos/corolla-cross.jpg', fuel: 'Hybrid', seats: 5, desc: 'Big on space, low on fuel' },
  'mid-7seat':    { tab: 'SUVs',   img: 'fleet-photos/outlander.jpg', fuel: 'Petrol', seats: 7, desc: 'Ideal for family travel' },
  'full-7seat':   { tab: 'SUVs',   img: 'fleet-photos/kluger.jpg', fuel: 'Hybrid', seats: 7, desc: 'Spacious interior, high efficiency' },
  'eight-seat':   { tab: 'Cars',   img: 'fleet-photos/staria.jpg', fuel: 'Diesel', seats: 8, desc: 'Perfect for group trips' },
  'hiace-1t':     { tab: 'Vans',   img: 'fleet-photos/hiace.jpg', fuel: 'Diesel', seats: 3, desc: 'Practical and efficient for daily use' },
  'hiace-15t':    { tab: 'Vans',   img: 'fleet-photos/hiace.jpg', fuel: 'Diesel', seats: 3, desc: 'Extra capacity for large cargo' },
  'pantech':      { tab: 'Trucks', img: 'fleet-photos/pantech.jpg', fuel: 'Diesel', seats: 3, desc: 'Hydraulic tail lift. Standard car licence' },
  'hilux-auto':   { tab: 'Utes',   img: 'fleet-photos/hilux.jpg', fuel: 'Diesel', seats: 5, desc: 'Spacious tub for easy loading' },
  'hilux-diesel': { tab: 'Utes',   img: 'fleet-photos/hilux.jpg', fuel: 'Diesel', seats: 5, desc: 'Rugged 4x4 for tough terrain' }
};
FLEET_CATEGORIES.forEach(c => Object.assign(c, FLEET_CATEGORY_WEB[c.id]));

// Excess (franquia) por faixa de veículo — valores da GC Tech (AUD)
// standard: excess sem redução | reducedPerDay: custo diário da redução | reduced: excess com redução
const FLEET_EXCESS_TIERS = {
  smallCar:  { standard: 1800, reducedPerDay: 11.00, reduced: 300 },
  midCar:    { standard: 2900, reducedPerDay: 15.00, reduced: 300 },
  largePax:  { standard: 3200, reducedPerDay: 27.00, reduced: 650 },
  vanUte:    { standard: 3200, reducedPerDay: 26.00, reduced: 1200 },
  truck:     { standard: 3800, reducedPerDay: 31.00, reduced: 1200 }
};
const FLEET_CATEGORY_EXCESS = {
  'small-auto': 'smallCar', 'small-new': 'smallCar', 'small-hybrid': 'smallCar',
  'mid-hatch': 'smallCar', 'mid-sedan': 'smallCar',
  'full-car': 'midCar', 'cross-suv': 'midCar', 'mid-7seat': 'midCar', 'mid-suv': 'midCar',
  'eight-seat': 'largePax', 'full-7seat': 'largePax',
  'hiace-1t': 'vanUte', 'hiace-15t': 'vanUte', 'hilux-auto': 'vanUte', 'hilux-diesel': 'vanUte',
  'pantech': 'truck'
};
FLEET_CATEGORIES.forEach(c => { c.excess = FLEET_EXCESS_TIERS[FLEET_CATEGORY_EXCESS[c.id]]; });

// Abas do widget de busca (Home e Search Results) com ícones SVG
const FLEET_WEB_TABS = [
  { id: 'Cars',   icon: '<path d="M5 17h14M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4h-2M3 13v4h2m-2-4h18"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>' },
  { id: 'SUVs',   icon: '<path d="M3 16V10l2-4h11l3 4h2v6h-2M3 16h2m4 0h6"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="17" cy="16.5" r="1.8"/><path d="M5 10h14"/>' },
  { id: 'Vans',   icon: '<path d="M2 16V7a1 1 0 0 1 1-1h11l5 4 3 1v5h-2M2 16h3m4 0h7"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="18" cy="16.5" r="1.8"/><path d="M14 6v4h5"/>' },
  { id: 'Trucks', icon: '<path d="M2 16V5h12v11M14 9h4l4 4v3h-2M2 16h3m4 0h7"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="18" cy="16.5" r="1.8"/>' },
  { id: 'Utes',   icon: '<path d="M2 15v-3h9V8h5l3 4h3v3h-2M2 15h3m4 0h7"/><circle cx="7" cy="15.5" r="1.8"/><circle cx="18" cy="15.5" r="1.8"/>' }
];

// "Sydney - Mascot" → "Mascot (SYD)", como no site oficial
// ==========================================
// PREFERÊNCIA DE CONTATO DO CLIENTE (WhatsApp ou e-mail), por e-mail do cliente.
// O cliente escolhe no checkout ou no perfil do portal; a equipe vê e pode mudar na ficha.
// whatsapp: false = o número não tem WhatsApp (descoberto quando uma mensagem não foi entregue).
// ==========================================
const FLEET_CONTACT_KEY = 'gc_contact_prefs';
const FLEET_CONTACT_LABELS = { whatsapp: 'WhatsApp', email: 'Email' };

function fleetReadContactPrefs() {
  try { return JSON.parse(localStorage.getItem(FLEET_CONTACT_KEY) || '{}') || {}; } catch (e) { return {}; }
}

// Sem escolha gravada: alguns clientes de demonstração preferem e-mail (para a demo ter os dois casos)
function fleetContactPref(email) {
  const key = String(email || '').toLowerCase().trim();
  const saved = fleetReadContactPrefs()[key];
  if (saved) return { channel: saved.channel || 'whatsapp', whatsapp: saved.whatsapp === false ? false : (saved.whatsapp === true ? true : null), ...saved };
  const h = fleetHash('contact:' + key);
  return { channel: key && h % 5 === 0 ? 'email' : 'whatsapp', whatsapp: null, source: 'Booking form', default: true };
}

// patch: { channel?, whatsapp? }  by: quem mudou (cliente ou agente)
function fleetSetContactPref(email, patch, by, source) {
  const key = String(email || '').toLowerCase().trim();
  if (!key) return null;
  const all = fleetReadContactPrefs();
  const cur = fleetContactPref(key);
  const next = { channel: cur.channel, whatsapp: cur.whatsapp, ...patch, updatedAt: Date.now(), updatedBy: by || '', source: source || cur.source || '' };
  // Sem WhatsApp no número: o canal passa a ser e-mail
  if (next.whatsapp === false) next.channel = 'email';
  delete next.default;
  all[key] = next;
  localStorage.setItem(FLEET_CONTACT_KEY, JSON.stringify(all));
  if (typeof fleetLog === 'function' && (patch.channel !== undefined && patch.channel !== cur.channel || patch.whatsapp === false && cur.whatsapp !== false)) {
    fleetLog({ bookingId: 'customer-' + key, ref: key, operator: by || undefined, action: 'Contact',
      details: patch.whatsapp === false ? `${key}: mobile is not on WhatsApp, contact switched to email` : `${key}: preferred contact changed to ${FLEET_CONTACT_LABELS[next.channel]}`,
      info: source || '' });
  }
  return next;
}

// Texto curto para mostrar ao lado do cliente
function fleetContactLabel(email) {
  const p = fleetContactPref(email);
  return p.whatsapp === false ? 'Email · no WhatsApp' : FLEET_CONTACT_LABELS[p.channel] || 'WhatsApp';
}

// ==========================================
// ONE-WAY: a GC Tech não faz devolução em outra cidade (Sydney ↔ Brisbane / NSW ↔ QLD).
// Devolver em outra filial da MESMA cidade continua permitido.
// ==========================================
const FLEET_ONE_WAY_MESSAGE = "One-way hires between Sydney and Brisbane aren't available. Please choose a return branch in the same city as the pick-up.";

// Cidade de uma filial: aceita o nome completo ("Sydney - Mascot") ou o código ("MAS")
function fleetBranchCity(loc) {
  const name = FLEET_BRANCHES[loc] || loc || '';
  return String(name).split(' - ')[0];
}

function fleetOneWayAllowed(pickup, dropoff) {
  if (!dropoff || dropoff === 'Same as Pick up' || !pickup) return true;
  return fleetBranchCity(pickup) === fleetBranchCity(dropoff);
}

// Lista de devolução: filiais da outra cidade ficam desativadas, com o motivo no texto
function fleetRestrictDropoffSelect(select, pickup) {
  if (!select) return;
  Array.from(select.options).forEach(o => {
    if (o.value === 'Same as Pick up') return;
    if (o.dataset.label === undefined) o.dataset.label = o.textContent;
    const ok = fleetOneWayAllowed(pickup, o.value);
    o.disabled = !ok;
    o.textContent = ok ? o.dataset.label : `${o.dataset.label} · not available`;
  });
  const sel = select.options[select.selectedIndex];
  if (sel && sel.disabled) {
    select.value = select.querySelector('option[value="Same as Pick up"]') ? 'Same as Pick up' : pickup;
  }
}

function fleetBranchLabel(fullName) {
  const [city, suburb] = fullName.split(' - ');
  return `${suburb} (${city === 'Brisbane' ? 'BNE' : 'SYD'})`;
}

// ==========================================
// HORÁRIO DE ATENDIMENTO: retiradas/devoluções só das 08:00 às 17:15, a cada 15 min
// ==========================================
const FLEET_OPEN_MINUTES = 8 * 60;        // 08:00
const FLEET_CLOSE_MINUTES = 17 * 60 + 15; // 17:15
const FLEET_TIME_STEP = 15;

// Idade mínima para alugar (todos os motoristas, na data da retirada)
const FLEET_MIN_DRIVER_AGE = 21;

// Idade completa em uma data. dobIso = 'YYYY-MM-DD'; null se não informada
function fleetAgeAt(dobIso, atMs) {
  if (!dobIso) return null;
  const [y, m, d] = dobIso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const at = new Date(atMs);
  let age = at.getFullYear() - y;
  if (at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d)) age--;
  return age;
}

// Intervalo mínimo entre dois bookings do mesmo veículo (limpeza, conferência, troca de chave)
const FLEET_TURNAROUND_MS = 15 * 60000;

// Dois períodos no mesmo veículo batem se ficam a menos de 15 min um do outro.
// Possible Extension / Weekend hold seguem colados no booking: noGap = sem intervalo.
function fleetTimesClash(aStart, aEnd, bStart, bEnd, noGap) {
  const gap = noGap ? 0 : FLEET_TURNAROUND_MS;
  return aStart < bEnd + gap && bStart < aEnd + gap;
}

function fleetIsValidBookingTime(ms) {
  if (isNaN(ms)) return false;
  const d = new Date(ms);
  const mins = d.getHours() * 60 + d.getMinutes();
  return d.getSeconds() === 0 && mins >= FLEET_OPEN_MINUTES && mins <= FLEET_CLOSE_MINUTES && mins % FLEET_TIME_STEP === 0;
}

const FLEET_HOURS_MESSAGE = 'Pick-up and drop-off times must be between 08:00 and 17:15, in 15-minute intervals.';

// <option>s de 08:00 a 17:15 a cada 15 min; value no formato "08:30 AM" usado no sistema
function fleetTimeOptions(selected) {
  let html = '';
  for (let mins = FLEET_OPEN_MINUTES; mins <= FLEET_CLOSE_MINUTES; mins += FLEET_TIME_STEP) {
    const d = new Date(2026, 0, 1, Math.floor(mins / 60), mins % 60);
    const value = fleetFormatTime(d.getTime());
    const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    html += `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
  }
  return html;
}

const FLEET_VEHICLES_PER_CATEGORY = 10;

// Gera placas estilo NSW (ex: CZ11KS) de forma DETERMINÍSTICA: sempre as mesmas
// placas a cada carregamento, porque reservas gravadas referenciam a placa.
const FLEET_VEHICLES = (function buildFleetVehicles() {
  let seed = 20260929;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const letter = () => letters[Math.floor(rand() * letters.length)];
  const branchRotation = ['PAR', 'MAS', 'PAR', 'BLK', 'NSY', 'MAS', 'PAR', 'EGF', 'WGB', 'BLK'];
  const used = new Set();
  const vehicles = [];

  FLEET_CATEGORIES.forEach(cat => {
    for (let i = 0; i < FLEET_VEHICLES_PER_CATEGORY; i++) {
      let plate;
      do {
        plate = letter() + letter() + String(Math.floor(rand() * 90) + 10) + letter() + letter();
      } while (used.has(plate));
      used.add(plate);
      vehicles.push({ plate, categoryId: cat.id, model: cat.model, label: cat.label, branch: branchRotation[i] });
    }
  });
  return vehicles;
})();

// Número estável a partir de um texto (placa, referência): dados de exemplo sem aleatoriedade
function fleetHash(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function fleetPlateOf(categoryId, index) {
  const list = FLEET_VEHICLES.filter(v => v.categoryId === categoryId);
  return list[index] ? list[index].plate : null;
}

function fleetGetCategory(categoryId) {
  return FLEET_CATEGORIES.find(c => c.id === categoryId) || null;
}

// Faixas "VIRTUAL-n" do Fleet Planner: área de espera para trocar veículos quando
// tudo está bookado. Não são carros de verdade — não ocupam frota nem passam pela alocação.
const FLEET_VIRTUAL_PREFIX = 'VIRTUAL-';

function fleetIsVirtualPlate(plate) {
  return typeof plate === 'string' && plate.startsWith(FLEET_VIRTUAL_PREFIX);
}

function fleetGetVehicle(plate) {
  return FLEET_VEHICLES.find(v => v.plate === plate) || null;
}

// ==========================================
// ODÔMETRO E COMBUSTÍVEL: última leitura de cada veículo
// Toda saída e devolução tem foto do odômetro. O Kms In / Fuel In da devolução (ou da volta da
// manutenção) vira o Kms Out / Fuel Out do próximo booking do mesmo veículo.
// { [placa]: [{ kms, fuel, atMs, ref, bookingId, kind: 'out' | 'in', by }] }
// ==========================================
const FLEET_ODO_KEY = 'gc_vehicle_odometer';

// Leitura de partida de cada veículo na demo (sem histórico ainda): fixa por placa
function fleetOdoBase(plate) {
  return 15000 + (fleetHash('odo:' + plate) % 80000);
}

function fleetReadOdo() {
  try { return JSON.parse(localStorage.getItem(FLEET_ODO_KEY) || '{}') || {}; } catch (e) { return {}; }
}

// Grava (ou corrige) a leitura de um booking: uma por booking e tipo (saída/devolução)
function fleetRecordOdometer(plate, kms, fuel, info) {
  if (!plate || kms === '' || kms == null || !Number.isFinite(Number(kms))) return;
  const all = fleetReadOdo();
  const list = (all[plate] || []).filter(r => !(info.bookingId && r.bookingId === info.bookingId && r.kind === info.kind));
  list.push({ kms: Number(kms), fuel: fuel || '', atMs: info.atMs || Date.now(), ref: info.ref || '', bookingId: info.bookingId || '', kind: info.kind || 'in', by: info.by || '' });
  all[plate] = list.sort((a, b) => a.atMs - b.atMs).slice(-30);
  localStorage.setItem(FLEET_ODO_KEY, JSON.stringify(all));
}

// Última leitura do veículo até um momento (ex.: a retirada de um booking), sem contar o próprio booking
function fleetLastOdometer(plate, beforeMs, excludeBookingId) {
  const list = (fleetReadOdo()[plate] || [])
    .filter(r => (beforeMs == null || r.atMs <= beforeMs) && (!excludeBookingId || r.bookingId !== excludeBookingId))
    .sort((a, b) => b.atMs - a.atMs);
  return list[0] || { kms: fleetOdoBase(plate), fuel: 'Full', atMs: null, ref: '', kind: 'fleet' };
}

// ==========================================
// CHAVE RESERVA: em qual unidade está a chave reserva de cada veículo
// Padrão = unidade do veículo. Alguns exemplos ficam em outra unidade (transferências).
// ==========================================
const FLEET_SPARE_KEY_STORE = 'gc_spare_keys';

function fleetReadSpareKeys() {
  try { return JSON.parse(localStorage.getItem(FLEET_SPARE_KEY_STORE) || '{}') || {}; } catch (e) { return {}; }
}

function fleetSpareKeyDefault(v) {
  const h = fleetHash('spare-' + v.plate);
  const day = new Date(); day.setHours(10, 30, 0, 0);
  day.setDate(day.getDate() - (12 + h % 40));
  // ~1 em cada 9 veículos: chave reserva ficou em outra unidade da mesma cidade
  if (h % 9 === 0) {
    const city = FLEET_BRANCHES[v.branch].split(' - ')[0];
    const others = Object.keys(FLEET_BRANCHES).filter(c => c !== v.branch && FLEET_BRANCHES[c].startsWith(city));
    const branch = others[h % others.length];
    return { branch, note: 'Spare key stayed here after a branch transfer', by: 'Fleet team', at: day.getTime(), history: [] };
  }
  return { branch: v.branch, note: 'Key cabinet', by: 'Fleet team', at: day.getTime(), history: [] };
}

function fleetSpareKey(plate) {
  const v = fleetGetVehicle(plate);
  if (!v) return null;
  const rec = fleetReadSpareKeys()[plate] || fleetSpareKeyDefault(v);
  return Object.assign({ history: [] }, rec, { away: rec.branch !== v.branch, home: v.branch });
}

function fleetSetSpareKey(plate, branch, note, by) {
  const cur = fleetSpareKey(plate);
  if (!cur || !FLEET_BRANCHES[branch]) return null;
  const all = fleetReadSpareKeys();
  const history = [{ branch: cur.branch, note: cur.note, by: cur.by, at: cur.at }].concat(cur.history || []).slice(0, 10);
  all[plate] = { branch, note: String(note || '').trim(), by: by || 'Agent', at: Date.now(), history };
  localStorage.setItem(FLEET_SPARE_KEY_STORE, JSON.stringify(all));
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: 'vehicle-' + plate, ref: plate, plate, operator: by || undefined, action: 'Spare key',
      details: (cur.branch === branch ? `Spare key location updated at ${branch}` : `Spare key moved from ${cur.branch} to ${branch}`) +
        (note ? ` (${String(note).trim()})` : ''), info: 'Vehicle record' });
  }
  return fleetSpareKey(plate);
}

// Comparação EXATA (normalizada) pelo modelo ou alias. Nada de "includes":
// era isso que fazia "Toyota Yaris" casar com "Hybrid Toyota Yaris" e
// modelos desconhecidos caírem no primeiro veículo da frota.
function fleetNormalizeModel(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fleetFindCategoryByModel(modelName) {
  const n = fleetNormalizeModel(modelName);
  if (!n) return null;
  const nNoParens = fleetNormalizeModel(n.replace(/\(.*?\)/g, ''));
  return FLEET_CATEGORIES.find(c =>
    [c.model, ...c.aliases].some(a => {
      const na = fleetNormalizeModel(a);
      return na === n || na === nNoParens;
    })
  ) || null;
}

// Preferência do cliente quando não há veículo do tipo reservado (Customer Portal → Agent Requests)
// Gravada na reserva: b.altPreference = { choices: [categoryId, categoryId?], onlyThis, note, at }
function fleetAltPreferenceChoices(pref) {
  if (!pref || pref.onlyThis) return [];
  return (pref.choices || []).map(id => fleetGetCategory(id)).filter(Boolean);
}

// "Toyota Hiace 1T Van, then Toyota Hiace 1.5T Van" · "Only the vehicle booked"
function fleetAltPreferenceText(pref) {
  if (!pref) return '';
  if (pref.onlyThis) return 'Only the vehicle booked';
  return fleetAltPreferenceChoices(pref).map(c => c.model).join(', then ');
}

// <option>s das alternativas (Checkout e Customer Portal): todas as categorias menos a reservada,
// a mesma seção primeiro (ex.: caminhão → vans e utes), com a diária
function fleetAltPreferenceOptions(requested, selectedId, placeholder) {
  const sections = requested && requested.section === 'Passenger' ? ['Passenger', 'Commercial'] : ['Commercial', 'Passenger'];
  return `<option value="">${placeholder || 'Choose a vehicle…'}</option>` + sections.map(section =>
    `<optgroup label="${section === 'Commercial' ? 'Vans, utes & trucks' : 'Cars & people movers'}">` +
    FLEET_CATEGORIES.filter(c => c.section === section && (!requested || c.id !== requested.id))
      .map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${c.model} · from $${c.rate.toFixed(2)}/day</option>`).join('') +
    '</optgroup>').join('');
}

// Lê e valida a escolha: { pref } (null = cliente não escolheu nada) ou { error }
function fleetReadAltPreference(first, second, onlyThis, note, required) {
  note = String(note || '').trim();
  if (onlyThis) return { pref: { choices: [], onlyThis: true, note, at: Date.now() } };
  if (!first) return required ? { error: 'Choose your first back-up vehicle, or tick "Only the vehicle I booked".' } : { pref: null };
  if (second && second === first) return { error: 'Your second choice must be a different vehicle.' };
  return { pref: { choices: [first, second].filter(Boolean), onlyThis: false, note, at: Date.now() } };
}

// Nota na reserva para a equipe (Agent Requests e Planner)
function fleetAltPreferenceNote(vehicle, pref, author) {
  return {
    id: Date.now(), priority: 'Medium', status: 'Active', subject: 'Customer preference',
    text: `If no ${vehicle} is available: ${fleetAltPreferenceText(pref)}${pref.note ? ` · "${pref.note}"` : ''}.`,
    dateStr: fleetNoteDateStr(Date.now()), author: author || 'Customer'
  };
}

// ==========================================
// DATAS
// ==========================================
// Aceita: "26 Sep 2026 08:30 AM", "26 Sep 2026, 08:30 AM", "Fri 25-Sep 2026 09:00",
// "29 Sep 2026 at 09:00 AM" e ISO. Devolve ms ou NaN.
function fleetParseDate(str) {
  if (!str) return NaN;
  const clean = String(str).replace(/^[A-Za-z]{3} (?=\d)/, '').replace(/,/g, ' ').replace(/ at /, ' ').replace(/\s+/g, ' ').trim();
  return new Date(clean).getTime();
}

const FLEET_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "29 Sep 2026" (formato manual: toLocaleDateString gera "Sept" em alguns Chrome e quebra o parse)
function fleetFormatDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')} ${FLEET_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fleetFormatTime(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

// Período (ms) de uma reserva gravada em gc_multi_bookings_*
function fleetBookingRange(bk) {
  let start = bk.dateISO ? new Date(bk.dateISO).getTime() : fleetParseDate(`${bk.date || ''} ${bk.time || ''}`);
  if (isNaN(start)) start = fleetParseDate(bk.date);
  let end = bk.dropoffISO ? new Date(bk.dropoffISO).getTime() : fleetParseDate(bk.dropoffDateTime || `${bk.dropoffDate || ''} ${bk.dropoffTime || ''}`);
  if (isNaN(end) || end <= start) end = start + FLEET_DAY_MS;
  return { start, end };
}

// Grava o período em TODOS os formatos que as outras páginas leem
function fleetApplyRange(bk, start, end) {
  bk.dateISO = new Date(start).toISOString();
  bk.dropoffISO = new Date(end).toISOString();
  bk.date = fleetFormatDate(start);
  bk.time = fleetFormatTime(start);
  bk.dropoffDate = fleetFormatDate(end);
  bk.dropoffTime = fleetFormatTime(end);
  bk.dropoffDateTime = `${bk.dropoffDate}, ${bk.dropoffTime}`;
}

// ==========================================
// RESERVAS FIXAS DE DEMONSTRAÇÃO (aparecem no Planner e bloqueiam a frota)
// ==========================================
const FLEET_MAIN_BOOKING_PLATE = fleetPlateOf('pantech', 0); // reserva "main" GC-8832 do Customer Portal

// ------------------------------------------
// DATA DA DEMO: as reservas de exemplo foram desenhadas como se "hoje" fosse 06/Oct/2026.
// Ao abrir o protótipo, tudo é deslocado (em dias de calendário) para o dia de hoje,
// então qualquer dia de ensaio — e a apresentação de 14/Oct — mostra o mesmo cenário.
// ------------------------------------------
const FLEET_DEMO_DESIGN_DAY = { y: 2026, m: 9, d: 6 };
// Dia em que todos os Pantech estão ocupados (demo do checkout sem veículo): data real, não deslocada
const FLEET_DEMO_FULL_DAY = '2026-10-22';

function fleetStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const FLEET_DEMO_SHIFT = (function () {
  const t = new Date();
  return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) -
                     Date.UTC(FLEET_DEMO_DESIGN_DAY.y, FLEET_DEMO_DESIGN_DAY.m, FLEET_DEMO_DESIGN_DAY.d)) / 86400000);
})();

// Soma dias de calendário (mantém o horário local mesmo na troca de horário de verão)
function fleetShiftMs(ms, days) {
  if (isNaN(ms)) return ms;
  const d = new Date(ms);
  d.setDate(d.getDate() + (days === undefined ? FLEET_DEMO_SHIFT : days));
  return d.getTime();
}

// "05/Oct/2026 16:40" → mesma hora, deslocada para a data da demo
function fleetShiftDateStr(str, days) {
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(str || '');
  if (!m) return str;
  const ms = fleetShiftMs(new Date(Number(m[3]), FLEET_MONTHS.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5])).getTime(), days);
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Situação de uma reserva de exemplo em relação a agora: o passado fica "limpo"
// (já terminou → Returned; já começou → Hired), também no horário de hoje: na demo ninguém marca
// Hired/Returned no balcão. As que ainda não começaram seguem Reservation.
function fleetDeriveDemoType(type, startMs, endMs) {
  const now = Date.now();
  // Locação de exemplo que já terminou foi devolvida (senão o carro ficaria com duas locações ativas)
  if (type === 'hired' && endMs < now) return 'returned';
  if (type !== 'reservation') return type;
  if (endMs < now) return 'returned';
  if (startMs < now) return 'hired';
  return 'reservation';
}

// Reservas de demonstração ORIGINAIS (sem as alterações gravadas). Use FLEET_SEED_BOOKINGS ou fleetSeedBookings().
const FLEET_SEED_BASE = (function buildSeedBookings() {
  const seeds = [
    { id: 'bk1', ref: '101992', cat: 'small-auto', idx: 0, fname: 'James', lname: 'Smith', clientEmail: 'james.smith@example.com', type: 'reservation', start: '2026-09-25T09:00', end: '2026-09-29T09:00',
      notesList: [{ id: 1, priority: 'Medium', status: 'Active', subject: '-', text: 'called cust regarding pick up, no answer.', dateStr: '24/Sep/2026 16:05', author: 'Felipe Grigolli' }] },
    { id: 'bk2', ref: '429424', cat: 'small-auto', idx: 1, fname: 'Emily', lname: 'Clarke', clientEmail: 'emily.clarke@example.com', type: 'hired', start: '2026-09-24T08:00', end: '2026-09-26T12:00' },
    { id: 'bk3', ref: 'MAINT', cat: 'small-auto', idx: 1, fname: 'System', lname: 'Maintenance', clientEmail: 'system@gctech.example', name: 'DAMAGE HOLD', type: 'maintenance', start: '2026-09-26T13:00', end: '2026-09-29T17:00',
      notesList: [{ id: 2, priority: 'High', status: 'Active', subject: 'Damage Report', text: 'Damage report form has been sent, cust will fill out and send it back asap', dateStr: '26/Sep/2026 10:01', author: 'Felipe Grigolli' }] },
    { id: 'bk6', ref: '493149', cat: 'mid-7seat', idx: 0, fname: 'Daniel', lname: 'Hughes', clientEmail: 'daniel.hughes@example.com', type: 'reservation', start: '2026-09-28T14:30', end: '2026-09-30T08:30' },
    { id: 'bk7', ref: '492814', cat: 'mid-7seat', idx: 1, fname: 'Lucas', lname: 'Bennett', clientEmail: 'lucas.bennett@example.com', type: 'reservation', doNotMove: true, start: '2026-09-26T14:00', end: '2026-09-29T14:00' },
    // Locação anterior do cliente do Customer Portal (o dano dela está num Payment Plan)
    { id: 'bk-or7716', ref: 'GC-7716', cat: 'pantech', idx: 1, fname: 'Felipe', lname: 'Grigolli', clientEmail: 'felipe@testgctech.com', type: 'reservation', start: '2026-08-20T09:00', end: '2026-08-22T16:00' }
  ];

  // Cenário de demonstração: TODOS os 10 Pantech ocupados de 30/Sep a 02/Oct.
  // Qualquer booking de Pantech nesse período cai em Agent Requests.
  const truckClients = [['Liam', 'Nguyen'], ['Olivia', 'Brown'], ['Noah', 'Wilson'], ['Ava', 'Taylor'], ['Jack', 'Martin'],
                        ['Mia', 'Thompson'], ['Leo', 'White'], ['Isla', 'Harris'], ['Oscar', 'Clark'], ['Grace', 'Lewis']];
  truckClients.forEach(([fname, lname], i) => {
    seeds.push({
      id: 'bk-truck-' + i, ref: String(500100 + i), cat: 'pantech', idx: i, fname, lname,
      clientEmail: `${fname}.${lname}@example.com`.toLowerCase(), type: i % 4 === 0 ? 'hired' : 'reservation',
      start: `2026-09-30T${String(9 + (i % 3)).padStart(2, '0')}:00`, end: `2026-10-02T${String(15 + (i % 3)).padStart(2, '0')}:00`
    });
  });

  // Outubro/2026 (a partir do dia 4): reservas em todas as categorias, nos veículos 0–4
  // (5–9 ficam livres para reservas novas do portal). Determinístico: mesmo resultado a cada F5.
  let seed = 20261004;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = list => list[Math.floor(rand() * list.length)];
  const firstNames = ['Ethan', 'Chloe', 'Lucas', 'Zoe', 'Mason', 'Ruby', 'Henry', 'Ella', 'Samuel', 'Lily', 'Daniel', 'Harper',
                      'Arjun', 'Mei', 'Mateo', 'Fatima', 'Ryan', 'Hana', 'Omar', 'Lucia', 'Callum', 'Nina', 'Kai', 'Aria'];
  const lastNames = ['Anderson', 'Walker', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill',
                     'Campbell', 'Mitchell', 'Roberts', 'Patel', 'Chen', 'Kim', 'Silva', 'Haddad', 'Novak', 'Ferrari', 'Okafor', 'Tran', 'Kowalski'];
  const slot = () => { // horário válido: 08:00–17:15 a cada 15 min
    const mins = FLEET_OPEN_MINUTES + Math.floor(rand() * ((FLEET_CLOSE_MINUTES - FLEET_OPEN_MINUTES) / FLEET_TIME_STEP + 1)) * FLEET_TIME_STEP;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  };
  const iso = d => `2026-10-${String(d).padStart(2, '0')}`;
  let octRef = 495100;

  FLEET_CATEGORIES.forEach(cat => {
    for (let idx = 0; idx < 5; idx++) {
      let day = 4 + Math.floor(rand() * 4); // 01–03/Oct ainda têm os Pantech ocupados
      while (day <= 29) {
        const commercial = cat.section === 'Commercial';
        const len = commercial ? 1 + Math.floor(rand() * 4) : 3 + Math.floor(rand() * 6); // vans/trucks: aluguéis curtos
        const endDay = Math.min(31, day + len);
        const fname = pick(firstNames), lname = pick(lastNames);
        const ref = String(octRef++);
        seeds.push({
          id: 'bk-oct-' + ref, ref, cat: cat.id, idx, fname, lname,
          clientEmail: `${fname}.${lname}.${ref.slice(-3)}@example.com`.toLowerCase(),
          type: 'reservation', doNotMove: rand() < 0.08,
          start: `${iso(day)}T${slot()}`, end: `${iso(endDay)}T${slot()}`
        });
        day = endDay + 2 + Math.floor(rand() * 5); // folga de 2–6 dias entre clientes
      }
    }
  });

  // Bloqueios de oficina desta semana (último veículo de cada categoria, que as reservas acima não usam)
  const maintNote = (id, subject, text, dateStr) => ({ id, priority: 'High', status: 'Active', subject, text, dateStr, author: 'Felipe Grigolli' });
  seeds.push(
    { id: 'bk-maint-1', ref: '499001', cat: 'hilux-auto', idx: 9, fname: 'System', lname: 'Maintenance', clientEmail: 'system@gctech.example', name: 'TYRES HOLD', type: 'maintenance',
      start: '2026-10-06T07:00', end: '2026-10-08T17:00',
      notesList: [maintNote(9001, 'Tyres', 'FRONT RIGHT WORN photos in RA', '05/Oct/2026 16:40'),
                  maintNote(9002, 'Parts', 'Front driver tyre worn - Roadstone 215/65R16 109/107T - $97.00 - PO 00002579 - rotate to match front brands', '05/Oct/2026 16:52')] },
    { id: 'bk-maint-2', ref: '499002', cat: 'hiace-1t', idx: 9, fname: 'System', lname: 'Maintenance', clientEmail: 'system@gctech.example', name: 'TYRES HOLD', type: 'maintenance',
      start: '2026-10-06T09:00', end: '2026-10-09T12:00',
      notesList: [maintNote(9003, 'Tyres', 'REAR LEFT WORN', '05/Oct/2026 17:05'),
                  maintNote(9004, 'Parts', 'Rear passenger tyre worn - Kumho 215/70R16C 108/106T - $140.00 - PO 00002583', '05/Oct/2026 17:10')] },
    { id: 'bk-maint-3', ref: '499003', cat: 'mid-7seat', idx: 9, fname: 'System', lname: 'Maintenance', clientEmail: 'system@gctech.example', name: 'VEHICLE FOR SALE - DO NOT RENT', type: 'maintenance',
      start: '2026-10-06T10:30', end: '2026-10-27T17:00',
      notesList: [maintNote(9005, 'Disposal', 'Listed for sale. Keep off rent until the buyer collects it.', '04/Oct/2026 11:20')] },
    { id: 'bk-maint-4', ref: '499004', cat: 'small-hybrid', idx: 9, fname: 'System', lname: 'Maintenance', clientEmail: 'system@gctech.example', name: 'SERVICE', type: 'maintenance',
      start: '2026-10-07T08:00', end: '2026-10-08T15:00',
      notesList: [maintNote(9006, 'Service', 'Lube service due - booked with the dealer for 08:00 drop-off.', '03/Oct/2026 09:15')] }
  );

  // Exemplo de reserva vencida: o cliente não apareceu ONTEM e a reserva continua "Reservation".
  // keepReservation: não é "limpa" automaticamente — o sistema avisa até o agente cancelar ou mudar a data.
  seeds.push({
    id: 'bk-stale-1', ref: '495990', cat: 'mid-suv', idx: 9, fname: 'Marcus', lname: 'Reid',
    clientEmail: 'marcus.reid@example.com', type: 'reservation', keepReservation: true,
    start: '2026-10-05T09:00', end: '2026-10-08T09:00',
    notesList: [{ id: 9101, priority: 'High', status: 'Active', subject: 'No show',
                  text: 'Customer did not arrive for pick-up. Called twice and sent an SMS, no answer yet.',
                  dateStr: '05/Oct/2026 16:30', author: 'Felipe Grigolli' }]
  });

  // Notas de exemplo nas reservas de outubro (~30%), fixas por referência (não usa rand para não mudar as reservas)
  const NOTE_TEXTS = [
    ['Call', 'Called customer to confirm pick-up time, no answer. Left voicemail.'],
    ['Licence', 'Licence expires next month - sight the renewal at pick-up.'],
    ['Corporate', 'Corporate hire - pays with the company card at the branch on pick-up.'],
    ['Request', 'Customer asked for a vehicle with a tow bar if available.'],
    ['Arrival', 'Arriving on a domestic flight, may be up to 30 min late.'],
    ['Repeat', 'Repeat customer - prefers a car with a reversing camera.'],
    ['Payment', 'Will pay at pick-up with a debit card in the driver\'s name (reminded: no cash).'],
    ['Extras', 'Child seat requested - fit before pick-up.'],
    ['Call', 'Customer confirmed pick-up by SMS.']
  ];
  const COMMERCIAL_NOTES = [
    ['Vehicle', 'Check tail lift operation before release.'],
    ['Customer', 'Moving house - explained load limits and toll tag.'],
    ['Vehicle', 'Customer will return the vehicle after hours - key drop box.']
  ];
  seeds.forEach(s => {
    if (!s.id.startsWith('bk-oct-')) return;
    const h = fleetHash(s.ref);
    if (h % 10 >= 3) return;
    const commercial = (fleetGetCategory(s.cat) || {}).section === 'Commercial';
    const pool = commercial && h % 2 ? COMMERCIAL_NOTES : NOTE_TEXTS;
    const [subject, text] = pool[(h >>> 4) % pool.length];
    const noteDay = new Date(s.start);
    noteDay.setDate(noteDay.getDate() - 1 - (h % 3));
    const pad = n => String(n).padStart(2, '0');
    s.notesList = [{
      id: 8000 + (h % 100000), priority: h % 7 === 0 ? 'High' : 'Medium', status: 'Active', subject, text,
      dateStr: `${pad(noteDay.getDate())}/${FLEET_MONTHS[noteDay.getMonth()]}/${noteDay.getFullYear()} ${pad(9 + (h % 8))}:${pad((h >>> 8) % 60)}`,
      author: h % 3 === 0 ? 'Alex' : 'Felipe Grigolli'
    }];
  });

  // Danos de exemplo lançados na devolução (os mesmos do Damage Control e dos Payment Plans):
  // o bond fica com a GC Tech e abate o dano; o resto o cliente paga em parcelas no Payment Plan.
  const DAMAGE_AT_RETURN = { 'bk1': ['tyre', 900], 'bk2': ['damage-ext', 1400], 'bk6': ['damage-ext', 2500], 'bk7': ['damage-ext', 1100],
                             'bk-truck-0': ['damage-ext', 1240], 'bk-truck-1': ['damage-ext', 2800], 'bk-or7716': ['damage-ext', 1650] };
  seeds.forEach(s => {
    const dmg = DAMAGE_AT_RETURN[s.id];
    if (!dmg) return;
    s.fees = { rate: fleetGetCategory(s.cat).rate, discount: '', insurance: 'standard', kms: 'unlimited',
      items: [{ id: 'debit-bond', qty: 1, amount: 404.00 }, { id: 'debit-bond-refund', qty: 1, amount: -400.00 },
              { id: dmg[0], qty: 1, amount: dmg[1], atReturn: true }] };
  });

  // Datas deslocadas para o dia de hoje (ver FLEET_DEMO_SHIFT)
  const shifted = seeds.map(s => ({
    ...s,
    plate: fleetPlateOf(s.cat, s.idx),
    startMs: fleetShiftMs(new Date(s.start).getTime()),
    endMs: fleetShiftMs(new Date(s.end).getTime()),
    notesList: (s.notesList || []).map(n => ({ ...n, dateStr: fleetShiftDateStr(n.dateStr) }))
  }));
  return shifted.concat(fleetFullyBookedDay(shifted, 'pantech', FLEET_DEMO_FULL_DAY));
})();

// ------------------------------------------
// DIA LOTADO PARA A DEMO DO CHECKOUT: todos os Pantech ocupados em 22/Oct/2026 (data fixa, sem deslocamento).
// Uma busca de caminhão nesse dia no site mostra "fully booked" e o cliente escolhe a alternativa no checkout.
// Ocupa só os horários livres de cada caminhão entre 08:00 e 17:15, então nunca sobrepõe outra reserva.
// ------------------------------------------
function fleetFullyBookedDay(seeds, catId, day) {
  const [y, m, d] = day.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d, Math.floor(FLEET_OPEN_MINUTES / 60), FLEET_OPEN_MINUTES % 60).getTime();
  const dayEnd = new Date(y, m - 1, d, Math.floor(FLEET_CLOSE_MINUTES / 60), FLEET_CLOSE_MINUTES % 60).getTime();
  const clients = [['Ben', 'Carter'], ['Sophie', 'Reed'], ['Max', 'Fischer'], ['Layla', 'Ahmed'], ['Tom', 'Becker'],
                   ['Zara', 'Lopez'], ['Finn', 'Murray'], ['Elena', 'Rossi'], ['Hugo', 'Bauer'], ['Maya', 'Singh']];
  const out = [];
  // Só lacunas de 4 h ou mais: pedaços curtos viravam barras minúsculas desenhadas por cima de outras.
  // Uma lacuna menor não atrapalha a demo: qualquer busca de meio dia ou dia inteiro bate no booking ao lado.
  const MIN_GAP = 4 * 3600000;
  FLEET_VEHICLES.filter(v => v.categoryId === catId).forEach((v, idx) => {
    const busy = seeds.filter(s => s.plate === v.plate && s.startMs < dayEnd + FLEET_TURNAROUND_MS && s.endMs > dayStart - FLEET_TURNAROUND_MS)
      .sort((a, b) => a.startMs - b.startMs);
    // Lacunas livres do dia nesse caminhão, com 15 min de intervalo antes e depois de cada booking
    const gaps = [];
    let cursor = dayStart;
    busy.forEach(s => {
      const gapEnd = Math.min(s.startMs - FLEET_TURNAROUND_MS, dayEnd);
      if (gapEnd - cursor >= MIN_GAP) gaps.push([cursor, gapEnd]);
      cursor = Math.max(cursor, s.endMs + FLEET_TURNAROUND_MS);
    });
    if (dayEnd - cursor >= MIN_GAP) gaps.push([cursor, dayEnd]);
    gaps.forEach(([a, b], n) => {
      const [fname, lname] = clients[idx % clients.length];
      const ref = String(496200 + idx * 10 + n);
      out.push({
        id: `bk-full-${day}-${idx}-${n}`, ref, cat: catId, idx, fname, lname,
        clientEmail: `${fname}.${lname}.${ref.slice(-3)}@example.com`.toLowerCase(),
        type: 'reservation', plate: v.plate, startMs: a, endMs: b, notesList: []
      });
    });
  });
  return out;
}

// ==========================================
// ALTERAÇÕES GRAVADAS NAS RESERVAS DE DEMONSTRAÇÃO (e na GC-8832)
// O que o agente muda no Fleet Planner ou nas notas fica salvo aqui, por id,
// e é aplicado por cima das reservas originais em todas as telas.
// { [id]: { plate, startMs, endMs, type, doNotMove, fname, lname, notesList, cancelled } }
// ==========================================
const FLEET_SEED_OVERRIDES_KEY = 'gc_seed_overrides';

function fleetReadOverrides() {
  try { return JSON.parse(localStorage.getItem(FLEET_SEED_OVERRIDES_KEY)) || {}; } catch (e) { return {}; }
}

function fleetGetOverride(id) {
  return fleetReadOverrides()[id] || null;
}

function fleetSetOverride(id, patch) {
  const all = fleetReadOverrides();
  // Datas gravadas guardam o deslocamento do dia (a reserva acompanha a data da demo nos dias seguintes)
  const extra = patch.startMs !== undefined ? { shift: FLEET_DEMO_SHIFT } : {};
  all[id] = { ...(all[id] || {}), ...patch, ...extra };
  localStorage.setItem(FLEET_SEED_OVERRIDES_KEY, JSON.stringify(all));
}

function fleetApplySeedOverride(s, o) {
  if (!o) return s;
  const out = { ...s };
  // Só placas reais (a área Virtual do Planner não é gravada para reservas de demonstração)
  if (o.plate && fleetGetVehicle(o.plate)) out.plate = o.plate;
  if (o.startMs && o.endMs && o.endMs > o.startMs) {
    const delta = FLEET_DEMO_SHIFT - (typeof o.shift === 'number' ? o.shift : 0);
    out.startMs = fleetShiftMs(o.startMs, delta);
    out.endMs = fleetShiftMs(o.endMs, delta);
  }
  ['type', 'doNotMove', 'fname', 'lname', 'notesList', 'seriesId',
   'fees', 'details', 'phone', 'licence', 'driver', 'loc', 'dropoffLoc', 'clientEmail', 'paidSnapshot'].forEach(k => { if (o[k] !== undefined && o[k] !== null) out[k] = o[k]; });
  return out;
}

// Reservas de demonstração com as alterações atuais (lê o localStorage na hora).
// Sem tipo gravado pelo agente, a situação vem da data (passado limpo); o exemplo vencido fica como está.
function fleetSeedBookings() {
  const overrides = fleetReadOverrides();
  return FLEET_SEED_BASE
    .filter(s => !(overrides[s.id] && overrides[s.id].cancelled))
    .map(s => {
      const out = fleetApplySeedOverride(s, overrides[s.id]);
      const typeSaved = overrides[s.id] && overrides[s.id].type !== undefined;
      if (!typeSaved && !s.keepReservation) out.type = fleetDeriveDemoType(out.type, out.startMs, out.endMs);
      return out;
    });
}

const FLEET_SEED_BOOKINGS = fleetSeedBookings();

// ---------- Notas de qualquer reserva (Planner, Daily Activity, janela de notas) ----------
// Reserva gravada (site/portal/Add Booking) → notesList dela; demonstração e GC-8832 → alterações gravadas
function fleetFindStoredBooking(id) {
  let found = null;
  fleetForEachStoredBooking((list, key, email) => {
    if (found) return;
    const b = list.find(x => String(x.id) === String(id));
    if (b) found = { key, list, b, email };
  });
  return found;
}

function fleetBookingNotes(id) {
  const stored = fleetFindStoredBooking(id);
  if (stored) return stored.b.notesList || [];
  const o = fleetGetOverride(id);
  if (o && Array.isArray(o.notesList)) return o.notesList;
  const seed = FLEET_SEED_BASE.find(s => s.id === id);
  return seed ? seed.notesList : [];
}

function fleetSetBookingNotes(id, notes) {
  const stored = fleetFindStoredBooking(id);
  if (stored) {
    stored.b.notesList = notes;
    localStorage.setItem(stored.key, JSON.stringify(stored.list));
    return;
  }
  fleetSetOverride(id, { notesList: notes });
}

// ---------- Possible Extensions (bloqueios criados no Fleet Planner) ----------
// [{ id, plate, startMs, endMs, note, createdBy, createdAt }]
const FLEET_EXT_KEY = 'gc_possible_extensions';

function fleetReadExtensions() {
  try {
    const list = JSON.parse(localStorage.getItem(FLEET_EXT_KEY)) || [];
    return Array.isArray(list) ? list.filter(x => x && x.plate && x.endMs > x.startMs) : [];
  } catch (e) { return []; }
}

function fleetWriteExtensions(list) {
  localStorage.setItem(FLEET_EXT_KEY, JSON.stringify(list));
}

// "06/Oct/2026 12:52" — mesmo formato das notas do Planner
function fleetNoteDateStr(ms) {
  const d = new Date(ms || Date.now());
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ==========================================
// OCUPAÇÃO E ALOCAÇÃO
// ==========================================
function fleetForEachStoredBooking(callback) {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MULTI_PREFIX)) continue;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { continue; }
    callback(list, key, key.replace(FLEET_MULTI_PREFIX, ''));
  }
}

function fleetMainBookingRange(state) {
  let start = fleetParseDate(state.pickupTime || fleetMainDefaultPickup());
  if (isNaN(start)) start = new Date('2026-09-26T08:30').getTime();
  return { start, end: start + 4 * FLEET_DAY_MS };
}

// Retirada padrão da GC-8832 (cliente de demonstração do portal): o primeiro período livre
// de 4 dias no caminhão dela, a partir de daqui a 2 dias, às 08:30 — o portal sempre abre
// com uma "próxima viagem", em qualquer dia de ensaio ou de apresentação.
function fleetMainDefaultPickup() {
  const seeds = fleetSeedBookings().filter(s => s.plate === FLEET_MAIN_BOOKING_PLATE);
  for (let d = 2; d < 40; d++) {
    const s = new Date(); s.setDate(s.getDate() + d); s.setHours(8, 30, 0, 0);
    const start = s.getTime(), end = start + 4 * FLEET_DAY_MS;
    if (!seeds.some(b => fleetTimesClash(b.startMs, b.endMs, start, end))) {
      return `${fleetFormatDate(start)}, ${fleetFormatTime(start)}`;
    }
  }
  return '26 Sep 2026, 08:30 AM';
}

// Tipo da GC-8832 no Planner: Hired se o agente marcou; senão pela data (passado limpo)
function fleetMainBookingType(state) {
  if (state.status === 'hired') return 'hired';
  const r = fleetMainBookingRange(state);
  return fleetDeriveDemoType('reservation', r.start, r.end);
}

// ==========================================
// RESERVAS VENCIDAS: ainda "Reservation" com retirada antes de hoje.
// Precisam ser canceladas ou ir para outra data — o sistema avisa até alguém resolver.
// ==========================================
function fleetStaleReservations() {
  const today0 = fleetStartOfToday();
  const out = [];
  const push = (r) => {
    const v = fleetGetVehicle(r.plate);
    out.push({ ...r, model: v ? v.model : '', branch: v ? v.branch : '', daysLate: Math.max(1, Math.ceil((today0 - fleetStartOfDayMs(r.start)) / FLEET_DAY_MS)) });
  };

  fleetSeedBookings().forEach(s => {
    if (s.type === 'reservation' && s.startMs < today0) push({ id: s.id, ref: s.ref, customer: `${s.fname} ${s.lname}`, email: s.clientEmail, plate: s.plate, start: s.startMs, end: s.endMs, source: 'demo' });
  });

  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    if (!b.plate || fleetIsVirtualPlate(b.plate) || FLEET_NON_HOLDING_STATUSES.includes(b.status) || b.status === 'cancelled') return;
    const type = b.plannerType && b.plannerType !== 'donotmove' ? b.plannerType : 'reservation';
    const r = fleetBookingRange(b);
    if (type === 'reservation' && r.start < today0) push({ id: String(b.id), ref: b.ref || String(b.id), customer: `${b.fname || ''} ${b.lname || ''}`.trim() || email, email, plate: b.plate, start: r.start, end: r.end, source: 'stored' });
  }));

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state || !Object.keys(state).length || state.status === 'cancelled') continue;
    const r = fleetMainBookingRange(state);
    if (fleetMainBookingType(state) === 'reservation' && r.start < today0) {
      const email = key.replace(FLEET_MAIN_PREFIX, '');
      push({ id: 'main-' + email, ref: 'GC-8832', customer: 'Felipe Grigolli', email, plate: FLEET_MAIN_BOOKING_PLATE, start: r.start, end: r.end, source: 'main' });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function fleetStartOfDayMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Cancela qualquer reserva pelo id (demonstração, site/portal/Add Booking ou GC-8832)
// Referência e placa de uma reserva por id (para o Activity Log)
function fleetLogRefOf(id) {
  id = String(id);
  const stored = fleetFindStoredBooking(id);
  if (stored) return { ref: stored.b.ref || ('OR-' + id.slice(-6)), plate: stored.b.plate || '' };
  if (id.startsWith('main-')) return { ref: 'GC-8832', plate: FLEET_MAIN_BOOKING_PLATE };
  const s = fleetSeedBookings().find(x => x.id === id);
  return s ? { ref: s.ref, plate: s.plate } : { ref: id, plate: '' };
}

function fleetCancelBooking(id) {
  if (typeof fleetLog === 'function') {
    const r = fleetLogRefOf(id);
    fleetLog({ bookingId: id, ref: r.ref, plate: r.plate, action: 'Cancelled', details: `Booking cancelled${r.plate ? ', ' + r.plate + ' released' : ''}` });
  }
  const stored = fleetFindStoredBooking(id);
  if (stored) {
    stored.b.status = 'cancelled';
    localStorage.setItem(stored.key, JSON.stringify(stored.list));
    return true;
  }
  if (String(id).startsWith('main-')) {
    const key = FLEET_MAIN_PREFIX + String(id).slice(5);
    try {
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      state.status = 'cancelled';
      localStorage.setItem(key, JSON.stringify(state));
      return true;
    } catch (e) { return false; }
  }
  if (FLEET_SEED_BASE.some(s => s.id === id)) { fleetSetOverride(id, { cancelled: true }); return true; }
  return false;
}

// Abre a reserva na janela separada de edição (modal do Fleet Planner)
// extraQuery (opcional): ex. '&tab=fees&fee=damage-ext&amount=380&damage=dmg-seed-02' (cobrança vinda do Damage Control)
function fleetOpenBookingWindow(id, extraQuery) {
  const w = Math.min(1180, screen.availWidth - 40), h = Math.min(860, screen.availHeight - 60);
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY || 0) + (window.outerHeight - h) / 2);
  const win = window.open('gc-fleet-planner.html?popup=1&open=' + encodeURIComponent(id) + (extraQuery || ''), 'gcBooking_' + String(id).replace(/\W/g, '_'),
    `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`);
  if (!win && typeof gcToast === 'function') gcToast('The browser blocked the pop-up window\n\nAllow pop-ups for this page and try again.', 'warning');
  else if (win) win.focus();
  return win;
}

// Texto curto da reserva vencida: "Was due Tue 13 Oct · 1 day ago"
function fleetStaleLabel(r) {
  const d = new Date(r.start);
  const pad = n => String(n).padStart(2, '0');
  return `Was due ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${FLEET_MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${r.daysLate} day${r.daysLate > 1 ? 's' : ''} ago`;
}

// Lista de tudo que está ocupando uma placa: [{ id, plate, start, end }]
// includeStored=false → só reservas fixas (seed + main), usado na migração
function fleetGetOccupancy(includeStored = true) {
  const occ = FLEET_SEED_BOOKINGS.map(s => ({ id: s.id, ref: s.ref, plate: s.plate, start: s.startMs, end: s.endMs }));

  if (includeStored) fleetForEachStoredBooking(list => {
    list.forEach(bk => {
      if (!bk.plate || FLEET_NON_HOLDING_STATUSES.includes(bk.status)) return;
      const r = fleetBookingRange(bk);
      occ.push({ id: String(bk.id), ref: bk.ref, plate: bk.plate, start: r.start, end: r.end });
    });
  });

  // Possible Extensions seguram o veículo para novas reservas (fora da realocação automática)
  if (includeStored) fleetReadExtensions().forEach(x =>
    occ.push({ id: x.id, ref: 'POSS-EXT', plate: x.plate, start: x.startMs, end: x.endMs }));

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state || !Object.keys(state).length || state.status === 'cancelled') continue;
    const r = fleetMainBookingRange(state);
    occ.push({ id: 'main-' + key.replace(FLEET_MAIN_PREFIX, ''), ref: 'GC-8832', plate: FLEET_MAIN_BOOKING_PLATE, start: r.start, end: r.end });
  }
  return occ;
}

function fleetIsPlateFree(plate, start, end, ignoreId, occupancy) {
  const occ = occupancy || fleetGetOccupancy();
  return !occ.some(o => o.plate === plate && o.id !== String(ignoreId) && fleetTimesClash(o.start, o.end, start, end, o.ref === 'POSS-EXT'));
}

// Devolve uma placa livre do MESMO modelo, ou null se a categoria estiver lotada.
// opts.preferredPlate: tenta essa primeiro (ex: placa clicada no Planner, ou a atual numa remarcação)
// opts.ignoreId: id da própria reserva (para remarcações não conflitarem consigo mesmas)
function fleetFindFreePlate(model, start, end, opts = {}, occupancy) {
  const cat = fleetFindCategoryByModel(model);
  if (!cat || isNaN(start) || isNaN(end)) return null;
  const occ = occupancy || fleetGetOccupancy();
  // opts.branch: só veículos baseados nessa filial (ex.: reservas semanais de clientes regulares)
  const candidates = FLEET_VEHICLES.filter(v => v.categoryId === cat.id && (!opts.branch || v.branch === opts.branch));

  if (opts.preferredPlate && candidates.some(v => v.plate === opts.preferredPlate) &&
      fleetIsPlateFree(opts.preferredPlate, start, end, opts.ignoreId, occ)) {
    return opts.preferredPlate;
  }
  const free = candidates.find(v => fleetIsPlateFree(v.plate, start, end, opts.ignoreId, occ));
  return free ? free.plate : null;
}

// Coloca a reserva na fila "Agent Requests" (sem duplicar)
function fleetSendToAgentRequests(bk, email, clientName, reason) {
  let reqs = [];
  try { reqs = JSON.parse(localStorage.getItem(FLEET_REQUESTS_KEY) || '[]'); } catch (e) {}
  if (reqs.some(r => String(r.id) === String(bk.id))) return;

  const cat = fleetFindCategoryByModel(bk.vehicle);
  const r = fleetBookingRange(bk);
  reqs.unshift({
    id: bk.id,
    ref: bk.ref,
    client: clientName || `${bk.fname || ''} ${bk.lname || ''}`.trim() || email,
    email: email,
    vehicle: bk.vehicle,
    loc: bk.loc || 'N/A',
    dates: `${fleetFormatDate(r.start)} ${fleetFormatTime(r.start)} → ${fleetFormatDate(r.end)} ${fleetFormatTime(r.end)}`,
    type: reason || (cat ? `No ${cat.name} available for the requested dates` : `Unknown vehicle model "${bk.vehicle}"`),
    status: 'pending'
  });
  localStorage.setItem(FLEET_REQUESTS_KEY, JSON.stringify(reqs));
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: bk.id, ref: bk.ref, action: 'On Request', operator: '',
      details: `Sent to Agent Requests: ${reqs[0].type}`, info: 'Waiting for an agent to allocate a vehicle' });
  }
}

// Garante a regra "nunca sobrepor" para reservas antigas/sem placa:
// percorre as reservas em ordem de criação; cada uma mantém a placa se estiver
// livre, senão ganha outra do mesmo modelo, senão vai para Agent Requests.
function fleetEnsureAllocations() {
  const occ = fleetGetOccupancy(false);
  const all = [];
  fleetForEachStoredBooking((list, key, email) => list.forEach(bk => all.push({ bk, key, email, list })));
  all.sort((a, b) => Number(a.bk.id) - Number(b.bk.id));

  const changedKeys = new Map();
  all.forEach(({ bk, key, email, list }) => {
    if (FLEET_NON_HOLDING_STATUSES.includes(bk.status)) return;
    if (fleetIsVirtualPlate(bk.plate)) return; // estacionado no Virtual pelo agente: não realocar
    const r = fleetBookingRange(bk);
    const plateIsValid = bk.plate && fleetGetVehicle(bk.plate) && fleetFindCategoryByModel(bk.vehicle) &&
                         fleetGetVehicle(bk.plate).categoryId === fleetFindCategoryByModel(bk.vehicle).id;
    // Reserva Hired (carro com o cliente) mantém a placa sempre
    const onHire = bk.plannerType === 'hired' && plateIsValid;
    let plate = plateIsValid && (onHire || fleetIsPlateFree(bk.plate, r.start, r.end, bk.id, occ)) ? bk.plate : null;
    // Reserva de série semanal: só realoca para veículo da filial de retirada
    const branch = bk.branchOnly ? Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === bk.loc) : null;
    if (plate && branch && !onHire && fleetGetVehicle(plate).branch !== branch) plate = null;
    if (!plate) plate = fleetFindFreePlate(bk.vehicle, r.start, r.end, branch ? { branch } : {}, occ);

    if (plate) {
      occ.push({ id: String(bk.id), plate, start: r.start, end: r.end });
      if (bk.plate !== plate) { bk.plate = plate; changedKeys.set(key, list); }
    } else {
      bk.plate = null;
      bk.status = 'fleet_pending';
      changedKeys.set(key, list);
      fleetSendToAgentRequests(bk, email, null);
    }
  });
  changedKeys.forEach((list, key) => localStorage.setItem(key, JSON.stringify(list)));
}

// ==========================================
// ACTIVITY LOG — quem fez o quê e quando, em cada reserva (como o "Booking Log" do RCM)
// Entradas gravadas: gc_activity_log = [{ id, bookingId, ref, plate, at, operator, action, details, rate, info, total }]
// As reservas de demonstração também têm um histórico de exemplo (criação, alocação, pagamento, hired...).
// ==========================================
const FLEET_LOG_KEY = 'gc_activity_log';
const FLEET_LOG_MAX = 3000;

function fleetLogOperator() {
  try {
    if (sessionStorage.getItem('gc_agent_auth') === 'true') return localStorage.getItem('gc_agent_name') || 'Agent';
  } catch (e) {}
  return 'Online Booking';
}

function fleetReadLog() {
  try { const l = JSON.parse(localStorage.getItem(FLEET_LOG_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}

// fleetLog({ bookingId, ref, plate, action, details, rate, info, total, operator })
function fleetLog(entry) {
  if (!entry || (!entry.bookingId && !entry.ref)) return null;
  const list = fleetReadLog();
  const rec = {
    id: 'log-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    bookingId: entry.bookingId != null ? String(entry.bookingId) : '',
    ref: entry.ref || '',
    plate: entry.plate || '',
    at: entry.at || Date.now(),
    operator: entry.operator || fleetLogOperator(),
    action: entry.action || '',
    details: entry.details || '',
    rate: entry.rate || '',
    info: entry.info || '',
    total: typeof entry.total === 'number' ? entry.total : null
  };
  list.push(rec);
  try { localStorage.setItem(FLEET_LOG_KEY, JSON.stringify(list.slice(-FLEET_LOG_MAX))); } catch (e) {}
  return rec;
}

function fleetLogDateStr(ms) {
  return fleetNoteDateStr(ms);
}

// "06/Oct/2026 12:52" → ms
function fleetParseNoteDate(str) {
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(String(str || ''));
  if (!m) return NaN;
  const mon = FLEET_MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  return new Date(+m[3], mon, +m[1], +m[4], +m[5]).getTime();
}

function fleetLogBranchCode(full) {
  return Object.keys(FLEET_BRANCHES).find(c => FLEET_BRANCHES[c] === full) || full || '';
}

// Texto padrão "Small Car Automatic, PAR 21/Sep/2026 17:00 to PAR 10/Oct/2026 12:00"
function fleetLogTitle(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s(+\/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function fleetLogTripText(catName, plate, fromCode, startMs, toCode, endMs) {
  return `${fleetLogTitle(catName)}${plate ? ', ' + plate : ''}, ${fromCode} ${fleetNoteDateStr(startMs)} to ${toCode || fromCode} ${fleetNoteDateStr(endMs)}`;
}

function fleetLogDays(startMs, endMs) {
  return Math.max(1, Math.ceil((endMs - startMs) / FLEET_DAY_MS));
}

// Histórico de exemplo de uma reserva de demonstração (não gravado; sempre igual)
function fleetSeedLog(s) {
  const out = [];
  const now = Date.now();
  const h = fleetHash('log-' + s.id);
  const v = fleetGetVehicle(s.plate);
  const cat = fleetGetCategory(s.cat) || (v ? fleetGetCategory(v.categoryId) : null);
  const catName = cat ? cat.name : 'Vehicle';
  const rate = cat && cat.rate ? cat.rate : 0;
  const code = v ? v.branch : '';
  const type = s.keepReservation ? s.type : fleetDeriveDemoType(s.type, s.startMs, s.endMs);
  const days = fleetLogDays(s.startMs, s.endMs);
  const total = Math.round(days * rate * 100) / 100;
  const agents = ['Felipe Grigolli', 'Alex'];
  const agent = agents[h % agents.length];
  const add = (at, e) => { if (at <= now) out.push({ id: `seed-${s.id}-${out.length}`, bookingId: s.id, ref: s.ref, plate: s.plate, at, seed: true, ...e }); };

  if (type === 'maintenance') {
    const at = s.startMs - FLEET_DAY_MS + 3 * 3600000;
    add(at, { operator: agent, action: 'Maintenance', details: `${s.plate} placed on hold: ${s.name || 'Maintenance'}, ${fleetNoteDateStr(s.startMs)} to ${fleetNoteDateStr(s.endMs)}`, info: 'Vehicle off fleet', total: 0 });
  } else {
    // Reserva feita alguns dias antes da retirada — e sempre antes de hoje (reservas futuras também têm histórico)
    const created = new Date(Math.min(s.startMs - (2 + h % 18) * FLEET_DAY_MS, now - (1 + h % 9) * FLEET_DAY_MS));
    created.setHours(7 + (h >>> 3) % 10, (h >>> 7) % 60, 0, 0);
    const c = created.getTime();
    const online = h % 3 !== 0;
    add(c, {
      operator: online ? 'Online Booking' : agent, action: '',
      details: `Booking entered ${online ? 'webApi3' : 'by phone'}, ${fleetLogTripText(catName, '', code, s.startMs, code, s.endMs)}, Rate = ${days} days x $${rate.toFixed(2)}`,
      info: online ? 'No CC entered, saved as quote.' : 'Agent booking', total
    });
    add(c + 60000, { operator: '', action: 'Allocated', details: `Booking allocated to ${s.plate}`, info: `Allocated via API to ${s.plate}`, total: 0 });
    const paidAt = Math.min(c + (1 + h % 5) * 3600000, s.startMs - 3600000);
    add(paidAt, { operator: agent, action: 'Payment', details: `${h % 2 ? 'Mastercard' : 'Visa'} payment - ${s.fname} ${s.lname}`, info: `Processed by payment provider: $${total.toFixed(2)}`, total: 0 });
    add(paidAt + 60000, { operator: agent, action: '', details: `Invoice emailed to customer [${s.clientEmail}]`, total: 0 });
    (s.notesList || []).forEach(n => {
      const at = fleetParseNoteDate(n.dateStr);
      if (!isNaN(at)) add(at, { operator: n.author || agent, action: 'Note', details: `Note added${n.subject && n.subject !== '-' ? ' (' + n.subject + ')' : ''}: ${n.text}`, total: 0 });
    });
    if (type === 'hired' || type === 'returned') {
      const kmsOut = 20000 + h % 140000;
      add(s.startMs - 20 * 60000, { operator: '', action: 'E-Signed', details: 'Customer e-signed rental agreement', total: 0 });
      add(s.startMs + 5 * 60000, { operator: agent, action: 'Hired', details: fleetLogTripText(catName, s.plate, code, s.startMs, code, s.endMs), rate: `${days}x$${rate.toFixed(2)}`, info: `Hired, kms out ${kmsOut}`, total });
      if (type === 'returned') add(s.endMs + 10 * 60000, { operator: agent, action: 'Returned', details: `${s.plate} returned to ${code}`, info: `kms in ${kmsOut + 80 * days + h % 300}`, total: 0 });
    }
  }
  return out;
}

// Todas as entradas de uma reserva (exemplo + gravadas), da mais antiga para a mais nova
function fleetLogFor(bookingId, ref) {
  const id = String(bookingId || '');
  const seed = FLEET_SEED_BASE.find(s => s.id === id);
  const list = (seed ? fleetSeedLog(seed) : []).concat(
    fleetReadLog().filter(e => (id && e.bookingId === id) || (!id && ref && e.ref === ref)));
  return list.sort((a, b) => a.at - b.at);
}

// Log completo (relatório): exemplos de todas as reservas de demonstração + gravadas
function fleetLogAll() {
  const list = [];
  FLEET_SEED_BASE.forEach(s => list.push(...fleetSeedLog(s)));
  list.push(...fleetReadLog());
  return list.sort((a, b) => b.at - a.at);
}

// Última alteração (quem e quando)
function fleetLogLast(bookingId, ref) {
  const list = fleetLogFor(bookingId, ref).filter(e => e.operator);
  return list.length ? list[list.length - 1] : null;
}
