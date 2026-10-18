// ==========================================
// REPEAT WEEKLY — reservas semanais de clientes regulares
// Replica uma reserva toda semana pelos próximos X meses, lendo do calendário o dia da
// semana e o horário de retirada e de devolução da reserva original.
// - Só veículos da mesma categoria BASEADOS na filial de retirada.
// - Data sem veículo livre nessa filial → só essa data vai para Agent Requests; o resto é confirmado.
// - Preço: diária normal da categoria (calculada como em qualquer reserva).
// Usado pelo Fleet Planner (modal da reserva) e pelo Add Booking.
// Depende de: gc-fleet-data.js, gc-ui.js
// ==========================================

const REPEAT_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function repeatEsc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function repeatAddMonths(ms, months) {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function repeatBranchCode(loc) {
  return Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === loc) || '';
}

function repeatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function repeatDate(ms) {
  const d = new Date(ms);
  return `${REPEAT_DAY_NAMES[d.getDay()].slice(0, 3)} ${String(d.getDate()).padStart(2, '0')} ${FLEET_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "Every Thursday 07:00 → Thursday 17:00 (1 day) at Parramatta"
function repeatPatternText(src) {
  const s = new Date(src.start), e = new Date(src.end);
  const days = Math.max(1, Math.ceil((src.end - src.start) / FLEET_DAY_MS));
  return `Every ${REPEAT_DAY_NAMES[s.getDay()]} ${repeatTime(src.start)} → ${REPEAT_DAY_NAMES[e.getDay()]} ${repeatTime(src.end)} ` +
         `(${days} day${days > 1 ? 's' : ''}) at ${fleetBranchLabel(FLEET_BRANCHES[src.branch])}`;
}

// Problema que impede repetir (ou null)
function repeatValidate(src) {
  if (!src.cat) return 'Unknown vehicle category for this booking.';
  if (!src.branch) return 'Choose a pick-up location first.';
  if (isNaN(src.start) || isNaN(src.end) || src.end <= src.start) return 'The booking needs valid pick-up and drop-off dates.';
  if (src.end - src.start >= 7 * FLEET_DAY_MS) return 'A weekly repeat needs a booking shorter than 7 days.';
  return null;
}

// Datas da série: uma por semana depois da original, até X meses à frente.
// src: { start, end, model, cat, branch, extraOcc: [ocupação já reservada pela original] }
function repeatBuildPlan(src, months) {
  const occ = fleetGetOccupancy().concat(src.extraOcc || []);
  const limit = repeatAddMonths(src.start, months);
  const today0 = fleetStartOfToday();
  const plan = [];
  for (let k = 1; k <= 60; k++) {
    const start = fleetShiftMs(src.start, 7 * k);
    const end = fleetShiftMs(src.end, 7 * k);
    if (start > limit) break;
    if (start < today0) continue;
    const plate = fleetFindFreePlate(src.model, start, end, { branch: src.branch }, occ);
    if (plate) occ.push({ id: 'repeat-' + k, plate, start, end });
    plan.push({ k, start, end, plate });
  }
  return plan;
}

// Janela de prévia: escolhe os meses, vê cada data e confirma. Resolve com { months, plan } ou null.
function repeatDialog(src, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'rp-overlay';
    overlay.innerHTML = `
      <div class="rp-dialog" role="dialog" aria-modal="true">
        <div class="rp-head">
          <div>
            <h3>↻ Repeat weekly</h3>
            <p>${repeatEsc(opts.subtitle || '')}</p>
          </div>
          <button type="button" class="rp-x" data-rp="no">✕</button>
        </div>
        <div class="rp-body">
          <div class="rp-pattern">
            <div><span>Pattern</span><strong>${repeatEsc(repeatPatternText(src))}</strong></div>
            <div><span>Vehicle</span><strong>Any free ${repeatEsc(src.cat.name)} based at ${repeatEsc(FLEET_BRANCHES[src.branch])}</strong></div>
            <label><span>Repeat for the next</span>
              <select data-rp="months">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === (opts.months || 6) ? 'selected' : ''}>${i + 1} month${i ? 's' : ''}</option>`).join('')}</select>
            </label>
          </div>
          <div class="rp-summary" data-rp="summary"></div>
          <div class="rp-table-wrap">
            <table class="rp-table">
              <thead><tr><th>#</th><th>Pick-up</th><th>Drop-off</th><th>Vehicle</th></tr></thead>
              <tbody data-rp="rows"></tbody>
            </table>
          </div>
          <p class="rp-note">Each date becomes a normal booking at the standard daily rate. Dates with no free vehicle at this branch go to Agent Requests; all others are confirmed.</p>
        </div>
        <div class="rp-foot">
          <button type="button" class="rp-btn ghost" data-rp="no">Cancel</button>
          <button type="button" class="rp-btn primary" data-rp="yes">Create bookings</button>
        </div>
      </div>`;

    let plan = [];
    const render = () => {
      const months = Number(overlay.querySelector('[data-rp="months"]').value);
      plan = repeatBuildPlan(src, months);
      const ok = plan.filter(p => p.plate).length;
      const pending = plan.length - ok;
      overlay.querySelector('[data-rp="summary"]').innerHTML = plan.length
        ? `<strong>${plan.length}</strong> weekly booking${plan.length > 1 ? 's' : ''} · <span class="rp-ok">${ok} confirmed</span>` +
          (pending ? ` · <span class="rp-warn">${pending} to Agent Requests</span>` : '')
        : 'No future dates in this period.';
      overlay.querySelector('[data-rp="rows"]').innerHTML = plan.map((p, i) => {
        const v = p.plate ? fleetGetVehicle(p.plate) : null;
        return `<tr class="${p.plate ? '' : 'pending'}">
          <td>${i + 1}</td>
          <td>${repeatDate(p.start)} ${repeatTime(p.start)}</td>
          <td>${repeatDate(p.end)} ${repeatTime(p.end)}</td>
          <td>${v ? `<span class="rp-plate">${repeatEsc(v.plate)}</span> ${repeatEsc(v.label)}` : '<span class="rp-warn">No free vehicle at this branch → Agent Requests</span>'}</td>
        </tr>`;
      }).join('');
      const btn = overlay.querySelector('[data-rp="yes"]');
      btn.disabled = !plan.length;
      btn.textContent = plan.length ? `Create ${plan.length} booking${plan.length > 1 ? 's' : ''}` : 'Create bookings';
    };

    const finish = value => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    overlay.addEventListener('click', e => {
      const act = e.target.dataset && e.target.dataset.rp;
      if (e.target === overlay || act === 'no') finish(null);
      if (act === 'yes' && plan.length) finish({ months: Number(overlay.querySelector('[data-rp="months"]').value), plan });
    });
    overlay.querySelector('[data-rp="months"]').addEventListener('change', render);
    document.addEventListener('keydown', onKey, true);
    repeatInjectStyles();
    document.body.appendChild(overlay);
    render();
  });
}

// Cria as reservas da série (gravadas como as do Add Booking, no e-mail do cliente)
// src: { model, cat, branch, loc, dropoff, email, fname, lname, phone, source, seriesId, notesList }
function repeatCreate(src, plan) {
  const key = FLEET_MULTI_PREFIX + src.email;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}

  // Referências únicas em todo o sistema
  const used = new Set();
  fleetForEachStoredBooking(l => l.forEach(b => used.add(b.ref)));
  fleetSeedBookings().forEach(s => used.add(s.ref));
  const newRef = () => { let r; do { r = 'OR-' + (10000 + Math.floor(Math.random() * 90000)); } while (used.has(r)); used.add(r); return r; };

  const base = Date.now();
  const created = [];
  plan.forEach((p, i) => {
    const bk = {
      id: base + i + 1, ref: newRef(), vehicle: src.model, plate: p.plate || null,
      fname: src.fname, lname: src.lname, phone: src.phone || '',
      loc: src.loc, dropoff: src.dropoff || 'Same as Pick up', source: src.source || 'Repeat Customer', revBooking: 'Yes',
      status: p.plate ? 'confirmed' : 'fleet_pending',
      seriesId: src.seriesId, seriesIndex: p.k, branchOnly: true,
      notesList: [{ id: base + i + 1, priority: 'Medium', status: 'Active', subject: 'Weekly',
                    text: `Weekly repeat of ${src.originRef} (${repeatPatternText(src)}).`, dateStr: fleetNoteDateStr(base), author: src.agent || 'Agent' }]
    };
    fleetApplyRange(bk, p.start, p.end);
    list.unshift(bk);
    created.push(bk);
  });
  localStorage.setItem(key, JSON.stringify(list));

  // Activity Log: uma linha de criação por reserva da série (+ alocação)
  if (typeof fleetLog === 'function') created.forEach((b, i) => {
    const r = fleetBookingRange(b);
    const days = fleetLogDays(r.start, r.end);
    const rate = src.cat ? src.cat.rate : 0;
    fleetLog({ bookingId: b.id, ref: b.ref, operator: src.agent || undefined, action: '',
      details: `Booking entered by repeat weekly, ${fleetLogTripText(src.cat ? src.cat.name : src.model, '', src.branch, r.start, src.branch, r.end)}, Rate = ${days} days x $${rate.toFixed(2)}`,
      info: `Weekly repeat of ${src.originRef} (${i + 1} of ${created.length})`, total: Math.round(days * rate * 100) / 100 });
    if (b.plate) fleetLog({ bookingId: b.id, ref: b.ref, plate: b.plate, operator: '', action: 'Allocated', details: `Booking allocated to ${b.plate}`, info: `Allocated automatically at ${src.branch}` });
  });

  // Datas sem veículo na filial: só elas vão para Agent Requests
  created.filter(b => !b.plate).forEach(b => fleetSendToAgentRequests(b, src.email, `${src.fname} ${src.lname}`.trim(),
    `No ${src.cat.name} free at ${FLEET_BRANCHES[src.branch]} (weekly repeat of ${src.originRef})`));

  return { total: created.length, confirmed: created.filter(b => b.plate).length, pending: created.filter(b => !b.plate).length };
}

function repeatNewSeriesId() {
  return 'SR-' + Date.now().toString(36).toUpperCase();
}

function repeatResultText(originRef, res) {
  return `${res.total} weekly booking${res.total !== 1 ? 's' : ''} created from ${originRef}\n\n` +
         `${res.confirmed} confirmed` + (res.pending ? ` · ${res.pending} sent to Agent Requests (no vehicle free at the branch)` : '');
}

// ---------- Estilo (próprio, igual em qualquer página do RCM) ----------
function repeatInjectStyles() {
  if (document.getElementById('rp-styles')) return;
  const style = document.createElement('style');
  style.id = 'rp-styles';
  style.textContent = `
    .rp-overlay { position: fixed; inset: 0; background: rgba(2, 6, 23, .7); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 100000; }
    .rp-dialog { width: 100%; max-width: 760px; max-height: calc(92vh / var(--fit-zoom, 1)); display: flex; flex-direction: column; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 10px; box-shadow: 0 25px 60px rgba(0,0,0,.55); font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; }
    .rp-head { display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #334155; }
    .rp-head h3 { font-size: 17px; color: #fff; margin: 0; }
    .rp-head p { font-size: 12px; color: #94a3b8; margin: 4px 0 0; }
    .rp-x { background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; }
    .rp-body { padding: 16px 20px; overflow-y: auto; }
    .rp-pattern { display: grid; gap: 10px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
    .rp-pattern > div, .rp-pattern > label { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 12px; font-size: 13px; }
    .rp-pattern span { color: #94a3b8; font-weight: 600; }
    .rp-pattern strong { color: #fff; font-weight: 600; }
    .rp-pattern select { justify-self: start; background: #0f172a; color: #fff; border: 1px solid #475569; border-radius: 4px; padding: 6px 10px; font-size: 13px; color-scheme: dark; }
    .rp-summary { font-size: 13px; margin: 4px 0 10px; color: #cbd5e1; }
    .rp-ok { color: #34d399; font-weight: 600; }
    .rp-warn { color: #fbbf24; font-weight: 600; }
    .rp-table-wrap { max-height: 320px; overflow-y: auto; border: 1px solid #1e293b; border-radius: 6px; }
    .rp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .rp-table th { position: sticky; top: 0; background: #1e4f8a; color: #fff; text-align: left; padding: 7px 10px; font-weight: 700; }
    .rp-table td { padding: 7px 10px; border-bottom: 1px solid #1e293b; }
    .rp-table tr.pending td { background: rgba(251, 191, 36, .07); }
    .rp-plate { display: inline-block; background: #fde047; color: #000; font-weight: 800; font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-right: 6px; }
    .rp-note { font-size: 12px; color: #94a3b8; margin: 10px 0 0; }
    .rp-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid #334155; }
    .rp-btn { border-radius: 6px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
    .rp-btn.ghost { background: transparent; color: #e2e8f0; border-color: #475569; }
    .rp-btn.primary { background: #15803D; color: #fff; }
    .rp-btn.primary:hover { background: #166534; }
    .rp-btn:disabled { opacity: .5; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}
