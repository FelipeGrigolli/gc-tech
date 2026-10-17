// ==========================================
// NOTES — janela de notas de uma reserva (aberta pelo "View" do Daily Activity)
// gc-notes.html?id=<id da reserva>
// Lê e grava pelas funções de gc-fleet-data.js (fleetBookingNotes / fleetSetBookingNotes),
// as mesmas notas que aparecem na aba Notes do Fleet Planner e no Daily Activity.
// ==========================================

const ntId = new URLSearchParams(window.location.search).get('id') || '';
const ntSortState = { key: 'entered', dir: -1 };
const NT_PRIORITY_ORDER = { High: 3, Medium: 2, Low: 1 };

function ntEsc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ntAgent() {
  let name = localStorage.getItem('gc_agent_name');
  if (!name) { try { name = (JSON.parse(localStorage.getItem('gc_agent_profile')) || {}).name; } catch (e) {} }
  return name || 'Agent';
}

// "06/Oct/2026 12:52" → ms (para ordenar)
function ntParseDateStr(str) {
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(str || '');
  if (!m) return 0;
  return new Date(Number(m[3]), FLEET_MONTHS.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5])).getTime();
}

function ntFollowLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00');
  return isNaN(d) ? iso : `${String(d.getDate()).padStart(2, '0')}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}

// Cabeçalho: referência, cliente e veículo da reserva
function ntBookingInfo() {
  const stored = fleetFindStoredBooking(ntId);
  if (stored) {
    const b = stored.b;
    return { ref: b.ref || ntId, who: `${b.fname || ''} ${b.lname || ''}`.trim() || stored.email, plate: b.plate || '', vehicle: b.vehicle || '' };
  }
  const seed = fleetSeedBookings().find(s => s.id === ntId);
  if (seed) {
    const v = fleetGetVehicle(seed.plate);
    return { ref: seed.ref, who: seed.type === 'maintenance' ? (seed.name || 'Maintenance') : `${seed.fname} ${seed.lname}`, plate: seed.plate, vehicle: v ? v.model : '' };
  }
  if (ntId.startsWith('main-')) return { ref: 'GC-8832', who: 'Felipe Grigolli', plate: FLEET_MAIN_BOOKING_PLATE, vehicle: 'Auto Pantech Truck' };
  return null;
}

function ntNotes() { return fleetBookingNotes(ntId) || []; }

// Atualiza o Daily Activity que abriu esta janela
function ntNotifyOpener() {
  try {
    if (window.opener && !window.opener.closed && typeof window.opener.daView === 'function') window.opener.daView();
  } catch (e) {}
}

function ntSorted(list) {
  const { key, dir } = ntSortState;
  const val = n => key === 'priority' ? (NT_PRIORITY_ORDER[n.priority] || 0)
    : key === 'entered' ? (ntParseDateStr(n.dateStr) || Number(n.id) || 0)
    : key === 'followUp' ? (n.followUp || '')
    : String(n[key] || '').toLowerCase();
  return list.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
}

function ntSort(key) {
  ntSortState.dir = ntSortState.key === key ? -ntSortState.dir : (key === 'entered' ? -1 : 1);
  ntSortState.key = key;
  ntRender();
}

function ntRender() {
  const term = document.getElementById('nt-filter').value.trim().toLowerCase();
  const all = ntNotes();
  const list = ntSorted(all).filter(n => !term ||
    [n.priority, n.status, n.subject, n.text, n.author, n.dateStr, ntFollowLabel(n.followUp)].join(' ').toLowerCase().includes(term));

  document.querySelectorAll('.nt-table th[data-sort]').forEach(th => {
    th.classList.toggle('asc', th.dataset.sort === ntSortState.key && ntSortState.dir === 1);
    th.classList.toggle('desc', th.dataset.sort === ntSortState.key && ntSortState.dir === -1);
  });

  document.getElementById('nt-body').innerHTML = list.length
    ? list.map(n => `
      <tr class="${n.priority === 'High' ? 'high' : ''}">
        <td>${ntEsc(n.priority || 'Medium')}</td>
        <td class="${n.status === 'Active' ? 'st-active' : 'st-done'}">${ntEsc(n.status || 'Active')}</td>
        <td>${ntEsc(n.subject || '-')}</td>
        <td class="wide">${ntEsc(n.text)}</td>
        <td>${ntEsc(ntFollowLabel(n.followUp))}</td>
        <td class="entered">${ntEsc(n.dateStr || '')}<br>${ntEsc(n.author || '')}</td>
        <td class="c"><button type="button" class="nt-del" title="Delete note" onclick="ntDelete(${ntEsc(JSON.stringify(n.id))})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button></td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="nt-empty">${all.length ? 'No notes match the filter.' : 'No notes on this booking yet.'}</td></tr>`;

  document.getElementById('nt-count').textContent = `Showing ${list.length ? 1 : 0} to ${list.length} of ${all.length} entries`;
}

function ntToggleForm(open) {
  const form = document.getElementById('nt-form');
  form.hidden = !open;
  if (open) {
    form.reset();
    document.getElementById('nt-text').focus();
  }
}

function ntSave(e) {
  e.preventDefault();
  const text = document.getElementById('nt-text').value.trim();
  if (!text) { gcToast('Please enter the note.', 'warning'); return; }
  const note = {
    id: Date.now(),
    priority: document.getElementById('nt-priority').value,
    status: document.getElementById('nt-status').value,
    subject: document.getElementById('nt-subject').value.trim() || '-',
    text,
    followUp: document.getElementById('nt-follow').value || '',
    dateStr: fleetNoteDateStr(Date.now()),
    author: ntAgent()
  };
  fleetSetBookingNotes(ntId, [...ntNotes(), note]);
  { const r = fleetLogRefOf(ntId);
    fleetLog({ bookingId: ntId, ref: r.ref, plate: r.plate, operator: ntAgent(), action: 'Note',
      details: `Note added${note.subject !== '-' ? ' (' + note.subject + ')' : ''}: ${text}`, info: note.priority + ' priority' }); }
  ntToggleForm(false);
  ntRender();
  ntNotifyOpener();
  gcToast('Note added.');
}

async function ntDelete(noteId) {
  const ok = await gcConfirm({ title: 'Delete this note?', message: 'The note will be removed from this booking.', confirmText: 'Delete', danger: true });
  if (!ok) return;
  const gone = ntNotes().find(n => n.id === noteId);
  fleetSetBookingNotes(ntId, ntNotes().filter(n => n.id !== noteId));
  if (gone) { const r = fleetLogRefOf(ntId);
    fleetLog({ bookingId: ntId, ref: r.ref, plate: r.plate, operator: ntAgent(), action: 'Note', details: `Note deleted: ${gone.text}`, info: gone.author ? 'Written by ' + gone.author : '' }); }
  ntRender();
  ntNotifyOpener();
  gcToast('Note deleted.');
}

// ---------- Copiar / exportar ----------
function ntRows() {
  const head = ['Priority', 'Status', 'Subject', 'Notes', 'Follow Up', 'Entered', 'Entered By'];
  return [head, ...ntSorted(ntNotes()).map(n => [n.priority || '', n.status || '', n.subject || '', n.text || '', ntFollowLabel(n.followUp), n.dateStr || '', n.author || ''])];
}

function ntCopy() {
  const text = ntRows().map(r => r.join('\t')).join('\n');
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); gcToast('Notes copied to the clipboard.'); } catch (e) { gcToast('Could not copy the notes.', 'error'); }
  ta.remove();
}

function ntExport() {
  const csv = ntRows().map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const info = ntBookingInfo();
  a.download = `notes-${info ? info.ref : ntId}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- Início ----------
window.addEventListener('DOMContentLoaded', () => {
  let authed = false;
  try { authed = sessionStorage.getItem('gc_agent_auth') === 'true'; } catch (e) {}
  const info = ntBookingInfo();
  if (!authed || !info) {
    document.getElementById('nt-main').innerHTML = `<p class="nt-empty">${!authed ? 'Please sign in to the GC Tech RCM to see booking notes.' : 'Booking not found.'}</p>`;
    return;
  }
  document.title = `Notes :: ${info.ref} :: GC Tech Rentals`;
  document.getElementById('nt-title').textContent = `Notes · Res ${info.ref}`;
  document.getElementById('nt-sub').textContent = [info.who, info.vehicle, info.plate].filter(Boolean).join(' · ');
  ntRender();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('nt-form').hidden) ntToggleForm(false); });
});

// Notas mudaram em outra janela (Planner, outra janela de notas)
window.addEventListener('storage', e => {
  if (e.key && (e.key === FLEET_SEED_OVERRIDES_KEY || e.key.startsWith(FLEET_MULTI_PREFIX))) ntRender();
});
