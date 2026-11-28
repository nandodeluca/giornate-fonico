// Interfaccia dell'app.
import * as C from './core.js';
import {
  store, onChange, setMeta, fetchMonthEvents, cachedMonthEvents, syncData, updateDay, resetDay,
  saveService, deleteService, setInvoice, setSettings, importFile, exportBackup, clearLocal, checkUpdate, syncCoop,
} from './store.js';
import { PLATFORM, APP_VERSION, signIn, signOut, isConfigured, shareText, copyText, openExternal, saveTextFile, coop, onBackButton } from './platform.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');

const todayISO = () => C.toISODate(new Date());
const thisMonth = () => todayISO().slice(0, 7);

function lsGetStr(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function lsSetStr(k, v) { try { localStorage.setItem(k, v); } catch { /* niente */ } }
function applyTheme() { document.documentElement.dataset.theme = lsGetStr('gf.theme', 'scuro'); }
applyTheme();

const ui = {
  view: lsGetStr('gf.view', 'griglia'),
  page: null,          // pagine del menù: prospetto, pagamenti, enpals
  monthsLoading: null, // {done, total}
  coopBusy: false,
  coopError: null,
  tab: 'giornate',
  ym: thisMonth(),
  events: {},        // ym -> items
  loading: false,
  loadError: null,
  update: null,
  showOthers: false,
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const services = () => store.data.services.filter(s => !s.deleted);
const svcById = id => store.data.services.find(s => s.id === id);
const colorOf = s => (s && s.colorId && C.GOOGLE_COLORS[s.colorId]?.hex) || '#8a8f98';

function toast(msg, ms = 2400) {
  $toast.textContent = msg;
  $toast.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('on'), ms);
}

function shiftYM(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ago(ts) {
  if (!ts) return 'mai';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'adesso';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return new Date(ts).toLocaleDateString('it-IT');
}

// ---------- dati del mese ----------

function monthModel(ym) {
  const items = ui.events[ym] || cachedMonthEvents(ym)?.items || [];
  const from = `${ym}-01`;
  const to = `${shiftYM(ym, 1)}-01`;
  const { days, others } = C.buildDays(items, store.data, { from, to }, todayISO());
  const sums = C.summarize(days, services(), ym, store.data);
  return { days, others, sums, hasEvents: !!(ui.events[ym] || cachedMonthEvents(ym)) };
}

async function loadMonth(ym, { quiet = false } = {}) {
  if (!store.meta.email) return;
  ui.loading = true; ui.loadError = null;
  if (!quiet) render();
  try {
    ui.events[ym] = await fetchMonthEvents(ym);
  } catch (e) {
    ui.loadError = e;
    if (e.message === 'login_required') { setMeta({ needLogin: true }); }
  } finally {
    ui.loading = false;
    render();
  }
}

async function fullSync() {
  try {
    await syncData();
  } catch (e) {
    if (e.message === 'login_required') setMeta({ needLogin: true });
  }
  await loadMonth(ui.ym, { quiet: true });
}

// ---------- schermate ----------

function render() {
  if (!isConfigured()) { $app.innerHTML = viewNotConfigured(); return; }
  if (!store.meta.email) { $app.innerHTML = viewLogin(); bind(); return; }
  const m = monthModel(ui.ym);
  const toCheck = m.days.filter(d => d.status === 'controllare').length;
  let body = '';
  if (ui.page === 'prospetto') body = viewForecast();
  else if (ui.page === 'pagamenti') body = viewPayments();
  else if (ui.page === 'enpals') body = viewEnpals();
  else if (ui.page === 'concerti') body = viewConcerts();
  else if (ui.tab === 'giornate') body = viewDays(m);
  else if (ui.tab === 'fatture') body = viewInvoices(m);
  else if (ui.tab === 'service') body = viewServices();
  else body = viewMore();
  const showMonth = !ui.page && (ui.tab === 'giornate' || ui.tab === 'fatture');
  const PAGE_TITLES = { prospetto: 'Prospetto incassi', pagamenti: 'Pagamenti fatture', enpals: 'Giornate ENPALS', concerti: 'Concerti' };
  $app.innerHTML = `
    ${ui.update ? `<div class="update"><span class="grow">Nuova versione <b>${esc(ui.update.version)}</b> disponibile</span><button class="btn small" data-act="get-update">Scarica</button></div>` : ''}
    ${store.meta.needLogin ? `<div class="update"><span class="grow">Google chiede di confermare di nuovo l'accesso</span><button class="btn small" data-act="login">Accedi</button></div>` : ''}
    <header class="top">
      ${ui.page ? `
      <div class="top-row">
        <button class="icon-btn" data-act="menu" aria-label="Menù">☰</button>
        <div class="month">${esc(PAGE_TITLES[ui.page])}</div>
        <button class="icon-btn" data-act="page-close" aria-label="Chiudi">✕</button>
      </div>` : showMonth ? `
      <div class="top-row">
        <button class="icon-btn" data-act="menu" aria-label="Menù">☰</button>
        <button class="icon-btn" data-act="prev" aria-label="Mese precedente">‹</button>
        <div class="month" data-act="today">${esc(C.monthLabel(ui.ym))}</div>
        <button class="icon-btn" data-act="next" aria-label="Mese successivo">›</button>
        ${ui.tab === 'giornate' ? `<div class="seg seg-top">
          <button class="${ui.view === 'griglia' ? 'on' : ''}" data-act="view" data-id="griglia" title="Griglia"><span class="lbl">Griglia</span><span class="ico">▦</span></button>
          <button class="${ui.view === 'elenco' ? 'on' : ''}" data-act="view" data-id="elenco" title="Elenco"><span class="lbl">Elenco</span><span class="ico">≣</span></button></div>` : ''}
        <button class="icon-btn" data-act="sync" aria-label="Aggiorna">${ui.loading || store.syncing ? '…' : '↻'}</button>
      </div>` : `<div class="top-row"><button class="icon-btn" data-act="menu" aria-label="Menù">☰</button><div class="month">${ui.tab === 'service' ? 'Service' : 'Impostazioni'}</div><span style="width:40px"></span></div>`}
      <div class="sync-line">${syncLine()}</div>
    </header>
    <main>${body}</main>
    <nav class="tabs"><div class="tabs-inner">
      ${tabBtn('giornate', '▦', 'Giornate', toCheck)}
      ${tabBtn('fatture', '€', 'Fatture', 0)}
      ${tabBtn('service', '☰', 'Service', 0)}
      ${tabBtn('altro', '⚙', 'Altro', 0)}
    </div></nav>`;
  bind();
  fitGrid();
}

// Adatta l'altezza delle righe della griglia allo spazio libero della finestra
function fitGrid() {
  const g = $app.querySelector('.cal-grid');
  if (!g) return;
  const weeks = Math.max(1, Math.round(g.children.length / 7));
  const tabs = document.querySelector('.tabs');
  const tabsH = tabs ? tabs.getBoundingClientRect().height : 0;
  const legend = $app.querySelector('.legend');
  const legendH = legend ? legend.getBoundingClientRect().height + 10 : 0;
  const top = g.getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - tabsH - legendH - 14;
  const minRow = window.innerWidth < 560 ? 66 : 33;
  const row = Math.max(minRow, Math.floor(avail / weeks));
  g.style.gridAutoRows = `${row}px`;
  g.classList.add('fit');
  // finestra bassa: etichette su una riga sola (importo), senza nome
  const compact = window.innerWidth >= 560 && row < 64;
  g.classList.toggle('compact', compact);
  g.classList.toggle('wide', g.clientWidth / 7 >= 125);
  if (legend) legend.style.display = compact ? 'none' : '';
  // quante etichette stanno in una cella
  const chipH = compact ? 19 : (window.innerWidth < 560 ? 40 : 32);
  const per = Math.max(1, Math.floor((row - 21) / chipH));
  for (const cell of g.children) {
    const evs = cell.querySelectorAll('.ev');
    let hidden = 0;
    evs.forEach((ev, i) => { const h = i >= per; ev.style.display = h ? 'none' : ''; if (h) hidden++; });
    const extra = Number(cell.dataset.more || 0) + hidden;
    let m = cell.querySelector('.more-n');
    if (extra > 0) {
      if (!m) { m = document.createElement('span'); m.className = 'more-n'; cell.appendChild(m); }
      m.textContent = `+${extra}`;
    } else if (m) m.remove();
  }
}
let fitTimer = null;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitGrid, 60); });

function tabBtn(id, ic, label, n) {
  return `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-id="${id}"><span class="ic">${ic}</span>${label}${n ? `<span class="dot">${n}</span>` : ''}</button>`;
}

function syncLine() {
  if (ui.loadError && ui.loadError.message !== 'login_required') return `<span class="bad">Calendario non raggiungibile: ${esc(ui.loadError.message)} (uso i dati salvati)</span>`;
  const ev = store.meta.lastEventsSync?.[ui.ym];
  const parts = [];
  parts.push(`Calendario: ${ui.loading ? 'aggiorno…' : ago(ev)}`);
  if (store.meta.dirty) parts.push('modifiche da salvare su Drive');
  else if (store.meta.lastDataSync) parts.push(`Drive: ${ago(store.meta.lastDataSync)}`);
  return esc(parts.join(' · '));
}

function viewNotConfigured() {
  return `<div class="login"><div class="box"><div class="logo">♪</div><h1>Quasi pronta</h1>
    <p>Questa versione dell'app non ha ancora i codici del progetto Google Cloud. Arriveranno con il prossimo aggiornamento.</p>
    <p class="muted">Versione ${esc(APP_VERSION)} · ${esc(PLATFORM)}</p></div></div>`;
}

function viewLogin() {
  return `<div class="login"><div class="box">
    <div class="logo">♪</div>
    <h1>Cachet</h1>
    <p>Accedi con il tuo account Google: l'app legge il calendario (solo lettura) e salva i suoi dati in una cartella nascosta del tuo Drive, così PC e telefono restano allineati.</p>
    <button class="btn primary block" data-act="login" style="margin-top:14px">Accedi con Google</button>
    <p class="muted" style="font-size:12.5px;margin-top:16px">Versione ${esc(APP_VERSION)}</p>
  </div></div>`;
}

function dayRow(d) {
  const s = svcById(d.serviceId);
  const orario = d.shifts.length ? d.shifts.map(x => `${C.hhmm(x.start)}–${C.hhmm(x.end)}`).join(' + ') : (d.partialStart ? `${C.hhmm(d.partialStart)}–?` : 'orario ?');
  const extra = [];
  if (d.minutes != null) extra.push(C.fmtMin(d.minutes));
  if (d.tipo === 'normale' && d.otHours > 0) extra.push(`+${d.otHours} extra`);
  const badges = [];
  if (d.status === 'prevista') badges.push('<span class="badge">prevista</span>');
  if (d.status === 'controllare') badges.push('<span class="badge warn">da controllare</span>');
  if (d.tipo === 'doppia') badges.push('<span class="badge acc">doppia</span>');
  if (d.tipo === 'reperibilita') badges.push('<span class="badge">reperibilità</span>');
  if (d.compensoManuale) badges.push('<span class="badge">a mano</span>');
  if (d.escluso) badges.push('<span class="badge">esclusa</span>');
  if (d.opzione) badges.push('<span class="badge">opzione</span>');
  return `<button class="day ${d.escluso ? 'excluded' : ''}" data-act="day" data-key="${esc(d.key)}">
    <span class="bar" style="background:${colorOf(s)}"></span>
    <span class="body">
      <span class="t1"><span class="date">${esc(C.dateLabel(d.date))}</span><span class="name">${d.concerto ? '♪ ' + esc(d.place || 'Concerto') : `${esc(d.serviceName || 'Service ?')}${d.place ? ` · ${esc(d.place)}` : ''}`}</span></span>
      <span class="t2 calc">${esc(orario)}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</span>
      ${d.status === 'controllare' ? `<span class="t3">${esc(d.issues[0]?.text || '')}${d.issues.length > 1 ? ` (+${d.issues.length - 1})` : ''}</span>` : ''}
    </span>
    <span class="right"><span class="amt" ${d.opzione ? 'style="opacity:.5"' : ''}>${d.escluso ? '—' : esc(C.eur(d.compenso + d.rimborsiTot))}</span>${badges.join('')}</span>
  </button>`;
}

function viewDays(m) {
  if (!services().length) return viewNoServices();
  if (!m.hasEvents && ui.loading) return `<div class="empty">Leggo il calendario…</div>`;
  const tot = m.sums.reduce((a, s) => a + s.compensi, 0);
  const rimb = m.sums.reduce((a, s) => a + s.rimborsi, 0);
  const work = m.days.filter(d => !d.escluso && !d.opzione && !d.concerto);
  const conc = C.concertSummary(m.days)[0];
  const prev = work.filter(d => d.status === 'prevista').reduce((a, d) => a + d.compenso, 0);
  const check = m.days.filter(d => d.status === 'controllare');
  let h = `<div class="card">
    <div class="kpis">
      <div class="kpi"><div class="v">${work.length}</div><div class="l">giornate</div></div>
      <div class="kpi"><div class="v">${esc(C.eur(tot))}</div><div class="l">compensi (no IVA)</div></div>
      <div class="kpi"><div class="v">${esc(C.eur(rimb))}</div><div class="l">rimborsi</div></div>
    </div>
    ${m.sums.length ? `<div class="svc-strip">${m.sums.map(s => {
      const prevS = s.days.filter(d => d.status === 'prevista').reduce((a, d) => a + d.compenso, 0);
      const fatto = s.compensi - prevS;
      return `<span class="chip chip2"><span class="sw" style="background:${colorOf(s.service)}"></span>
        <span><span class="c-name">${esc(s.service.name)} · ${s.giornate} gg</span>
        <span class="c-amt">${esc(C.eur(fatto))}${prevS ? ` <small>+ ${esc(C.eur(prevS))} previsti</small>` : ''}</span></span></span>`;
    }).join('')}${conc ? `<span class="chip chip2"><span class="sw" style="background:${colorOf(services().find(x => x.tipo === 'concerti'))}"></span>
        <span><span class="c-name">CONCERTI · ${conc.concerti.length} · a parte</span><span class="c-amt">${esc(C.eur(conc.totale))}${conc.senzaCifra ? ` <small>${conc.senzaCifra} senza cifra</small>` : ''}</span></span></span>` : ''}</div>` : (conc ? `<div class="svc-strip"><span class="chip chip2"><span class="sw" style="background:${colorOf(services().find(x => x.tipo === 'concerti'))}"></span>
        <span><span class="c-name">CONCERTI · ${conc.concerti.length} · a parte</span><span class="c-amt">${esc(C.eur(conc.totale))}</span></span></span></div>` : '')}
  </div>`;
  h += '<div style="height:10px"></div>';
  if (ui.view === 'griglia') {
    h += viewGrid(m);
    h += `<div class="legend"><span><i style="opacity:.55"></i>prevista</span><span><i style="box-shadow:inset 0 0 0 2px var(--warn)"></i>da controllare</span><span><i style="opacity:.3"></i>esclusa</span><span><i style="opacity:.45;outline:1px dashed var(--text)"></i>opzione (???)</span></div>`;
  }
  if (check.length) {
    h += `<h2>Da controllare (${check.length})</h2><div class="card">${check.map(dayRow).join('')}</div>`;
  }
  if (ui.view === 'elenco') {
    h += `<h2>Tutte le giornate</h2>`;
    h += work.length || m.days.length ? `<div class="card">${m.days.map(dayRow).join('')}</div>`
      : `<div class="card"><div class="empty"><b>Nessuna giornata di lavoro</b>Nessun evento del calendario corrisponde ai tuoi service in questo mese.</div></div>`;
  }
  const others = m.others.filter(o => !o.ignored);
  if (others.length || m.others.length) {
    h += `<details class="more" ${ui.showOthers ? 'open' : ''} data-act="others"><summary>Altri eventi del mese non conteggiati (${m.others.length})</summary>
      <div class="card">${m.others.map(o => `<button class="list-row" data-act="assign" data-ev="${esc(o.ev.id)}">
        <span class="sw" style="background:${C.GOOGLE_COLORS[o.ev.colorId]?.hex || 'transparent'};outline:1px solid var(--line)"></span>
        <span class="grow"><div>${esc(o.ev.summary || '(senza titolo)')}</div><div class="muted">${esc(C.dateLabel(o.date))}${o.ignored ? ' · ignorato per parola' : ''}</div></span>
        <span class="muted">Assegna ›</span></button>`).join('')}</div></details>`;
  }
  return h;
}

const WD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

function shortName(s) {
  if (!s) return '?';
  const n = String(s.name || '').trim();
  const w = n.split(/\s+/)[0];
  return w.length <= 9 ? w : w.slice(0, 8);
}

function viewGrid(m) {
  const [y, mo] = ui.ym.split('-').map(Number);
  const startDow = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
  const daysIn = new Date(y, mo, 0).getDate();
  const total = Math.ceil((startDow + daysIn) / 7) * 7;
  const byDate = new Map();
  for (const d of m.days) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date).push(d);
  }
  const today = todayISO();
  let cells = '';
  for (let i = 0; i < total; i++) {
    const dt = new Date(y, mo - 1, 1 - startDow + i);
    const iso = C.toISODate(dt);
    const out = dt.getMonth() !== mo - 1;
    const we = i % 7 >= 5;
    const list = out ? [] : (byDate.get(iso) || []);
    const shown = list.slice(0, 6);
    const chips = shown.map(d => {
      const s = svcById(d.serviceId);
      const cls = ['ev', d.status === 'prevista' ? 'prev' : '', d.status === 'controllare' ? 'chk' : '', d.escluso ? 'excl' : '', d.opzione ? 'opt' : '', s ? '' : 'unk'].join(' ');
      const amt = d.escluso ? '—' : d.opzione ? '???' : d.concerto && !d.compenso ? '€ ?' : `${Math.round(d.compenso + d.rimborsiTot)}€`;
      const extra = d.escluso || d.opzione ? '' : d.tipo === 'doppia' ? '×2' : d.tipo === 'reperibilita' ? 'rep.' : d.otHours > 0 ? `+${d.otHours}h` : '';
      const nm = d.concerto ? '♪' : shortName(s);
      const pl = d.concerto ? (String(d.place || 'Concerto').split('@')[0].trim() || 'Concerto') : (d.place || '');
      return `<span class="${cls}${pl ? '' : ' nopl'}" style="background:${colorOf(s)}" title="${esc(d.concerto ? d.place : `${s?.name || ''}${d.place ? ' · ' + d.place : ''}`)}"><span class="ln1"><span class="nm">${esc(nm)}</span>${pl ? `<span class="pl">${esc(pl)}</span>` : ''}</span><small><b>${esc(amt)}</b>${extra ? ` <i>${esc(extra)}</i>` : ''}</small></span>`;
    }).join('');
    const warn = list.some(d => d.status === 'controllare');
    cells += `<button class="cell ${out ? 'out' : ''} ${we ? 'we' : ''} ${iso === today ? 'today' : ''}" data-act="cell" data-date="${iso}" data-more="${Math.max(0, list.length - 6)}" ${out ? 'disabled' : ''}>
      <span class="num">${dt.getDate()}</span>${chips}</button>`;
  }
  return `<div class="cal"><div class="cal-head">${WD.map(w => `<span>${w}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
}

// Scorrere col dito sul calendario: a sinistra mese dopo, a destra mese prima
function bindSwipe() {
  const area = $app.querySelector('.cal') || (ui.tab === 'giornate' && !ui.page ? $app.querySelector('main') : null);
  if (!area) return;
  let x0 = null, y0 = null, t0 = 0;
  area.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  area.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 800) return;
    goMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function goMonth(n) {
  ui.ym = shiftYM(ui.ym, n);
  render();
  const cal = $app.querySelector('.cal');
  if (cal) cal.animate([{ transform: `translateX(${n > 0 ? 40 : -40}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
  const c = cachedMonthEvents(ui.ym);
  if (!c || Date.now() - c.at > 60 * 1000) loadMonth(ui.ym, { quiet: !!c });
}

function openCell(date) {
  const list = monthModel(ui.ym).days.filter(d => d.date === date);
  if (!list.length) { toast('Nessun lavoro in questo giorno'); return; }
  if (list.length === 1) { openDay(list[0].key); return; }
  openSheet(`<h3 style="text-transform:capitalize">${esc(new Date(date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
    <div class="sub">${list.length} lavori in questo giorno</div>
    <div class="card">${list.map(dayRow).join('')}</div>
    <div class="sheet-actions btn-row"><button class="btn" data-close-btn>Chiudi</button></div>`, sh => {
    sh.addEventListener('click', e => {
      const b = e.target.closest('[data-act=day]');
      if (b) { closeSheet(); openDay(b.dataset.key); }
    });
  });
}

function viewNoServices() {
  return `<div class="card pad"><div class="empty" style="padding:10px"><b>Nessun service</b>Importa il file dei service che ti ho preparato, oppure aggiungili a mano.</div>
    <div class="btn-row"><label class="btn primary">Importa file<input type="file" accept=".json,application/json" data-act="import" hidden></label>
    <button class="btn" data-act="svc-new">Aggiungi a mano</button></div></div>`;
}

const INV_STATES = { emessa: 'Emessa', pagata: 'Pagata' };

function invBadge(inv, ci) {
  if (!inv && ci) return ci.pagata ? `<span class="badge good">pagata · n. ${esc(ci.numero)}</span>` : `<span class="badge bad">emessa · n. ${esc(ci.numero)}</span>`;
  if (!inv) return '<span class="badge">da chiedere</span>';
  if (inv.stato === 'pagata') return `<span class="badge good">pagata${inv.numero ? ' · n. ' + esc(inv.numero) : ''}</span>`;
  return `<span class="badge bad">emessa${inv.numero ? ' · n. ' + esc(inv.numero) : ''}</span>`;
}

function viewInvoices(m) {
  let h = '';
  if (!m.sums.length) h += `<div class="card"><div class="empty"><b>Nessuna fattura per questo mese</b>Non ci sono giornate di lavoro nei tuoi service.</div></div>`;
  for (const s of m.sums) {
    const inv = s.invoice;
    const ci = C.coopInvoiceFor(store.data.coop, services(), s.service.id, ui.ym);
    h += `<div class="card">
      <div class="inv-head"><span class="sw" style="background:${colorOf(s.service)};width:12px;height:12px"></span><span class="n">${esc(s.service.name)}</span>${invBadge(inv, ci)}</div>
      <div class="inv-body">
        <div class="inv-grid">
          <span>${s.giornate} ${s.giornate === 1 ? 'giornata' : 'giornate'}${s.straord ? ` · ${s.straord} h extra` : ''}${s.doppie ? ` · ${s.doppie} doppie` : ''}${s.reperibilita ? ` · ${s.reperibilita} reperib.` : ''}</span><span class="r">${esc(C.eur(s.compensi))}</span>
          <span>IVA ${s.iva}%</span><span class="r">${esc(C.eur(s.ivaImp))}</span>
          ${s.rimborsi ? `<span>Rimborsi spese</span><span class="r">${esc(C.eur(s.rimborsi))}</span>` : ''}
          <span class="tot">Totale</span><span class="tot r">${esc(C.eur(s.totale))}</span>
        </div>
        ${s.daControllare ? `<div class="note warn">${s.daControllare} ${s.daControllare === 1 ? 'giornata da controllare' : 'giornate da controllare'} prima di chiedere la fattura.</div>` : ''}
        ${s.previste ? `<div class="note info">${s.previste} ${s.previste === 1 ? 'giornata ancora futura' : 'giornate ancora future'}.</div>` : ''}
        ${ci && Math.abs((ci.imponibile || 0) - s.compensi - s.rimborsi) > 0.5 ? `<div class="note warn">Fattura della cooperativa n. ${esc(ci.numero)}: ${esc(C.eur(ci.imponibile || 0))}, l'app calcola ${esc(C.eur(s.compensi + s.rimborsi))} (compensi + rimborsi).</div>` : ''}
        ${s.cambiata ? `<div class="note bad">Attenzione: dopo l'emissione i conti sono cambiati (in fattura: ${esc(C.eur(inv.snapshot.compensi))} + ${esc(C.eur(inv.snapshot.rimborsi))} rimborsi).</div>` : ''}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" data-act="inv-text" data-id="${esc(s.service.id)}">Riepilogo</button>
          ${!inv ? `<button class="btn primary" data-act="inv-emit" data-id="${esc(s.service.id)}">Segna emessa</button>` : ''}
          ${inv && inv.stato !== 'pagata' ? `<button class="btn primary" data-act="inv-paid" data-id="${esc(s.service.id)}">Segna pagata</button>` : ''}
          ${inv ? `<button class="btn" data-act="inv-edit" data-id="${esc(s.service.id)}">Modifica</button>` : ''}
        </div>
      </div></div>`;
  }
  const unpaid = Object.entries(store.data.invoices).filter(([, v]) => v && !v.deleted && v.stato === 'emessa')
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (unpaid.length) {
    const tot = unpaid.reduce((a, [, v]) => a + (v.snapshot?.totale || 0), 0);
    h += `<h2>Da incassare · ${esc(C.eur(tot))}</h2><div class="card">${unpaid.map(([k, v]) => {
      const [ym, sid] = k.split('|');
      const s = svcById(sid);
      return `<button class="list-row" data-act="goto-month" data-ym="${esc(ym)}">
        <span class="sw" style="background:${colorOf(s)}"></span>
        <span class="grow"><div>${esc(s?.name || sid)} · <span style="text-transform:capitalize">${esc(C.monthLabel(ym))}</span></div>
        <div class="muted">${v.numero ? 'Fattura n. ' + esc(v.numero) : 'Fattura'}${v.dataEmissione ? ' del ' + esc(v.dataEmissione.split('-').reverse().join('/')) : ''}</div></span>
        <span class="amt">${esc(C.eur(v.snapshot?.totale || 0))}</span></button>`;
    }).join('')}</div>`;
  }
  return h;
}

function viewServices() {
  const list = services();
  let h = `<div class="card">${list.map(s => `<button class="list-row" data-act="svc" data-id="${esc(s.id)}">
    <span class="sw" style="background:${colorOf(s)};width:14px;height:14px"></span>
    <span class="grow"><div><b>${esc(s.name)}</b></div><div class="muted">${esc(svcRuleText(s))}</div></span><span class="muted">›</span></button>`).join('')
    || '<div class="empty"><b>Nessun service</b></div>'}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="svc-new">Aggiungi service</button>
    <label class="btn">Importa file<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
    <div class="note info">L'app abbina un evento a un service se il titolo <b>inizia</b> con una delle sue parole chiave (es. "Congress Magna Pars"). Se non trova il nome, usa il colore — ma solo se quel colore è di un solo service.</div>`;
  return h;
}

function svcRuleText(s) {
  const col = (s.colorId ? C.GOOGLE_COLORS[s.colorId]?.name : 'nessun colore') + ` · paga a ${C.num(s.pagamentoGiorni || 30)} gg`;
  if (s.tipo === 'concerti') return `Concerti: cifra netta dall'evento, conteggio a parte · ${s.colorId ? C.GOOGLE_COLORS[s.colorId]?.name : 'nessun colore'}`;
  if (s.tipo === 'fissa') return `${C.eur(C.num(s.tariffa))} a giornata fissa · ${col}`;
  return `${C.eur(C.num(s.tariffa))} fino a ${C.num(s.oreIncluse)} h, poi ${C.eur(C.num(s.straordinario))}/h${C.num(s.doppiaDa) ? `, doppia dalla ${C.num(s.doppiaDa)}ª ora extra` : ''} · ${col}`;
}

function viewMore() {
  const st = store.data.settings;
  return `<div class="card pad">
      <div><b>Account Google</b></div><div class="muted">${esc(store.meta.email)}</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-act="sync-all">Sincronizza ora</button><button class="btn danger" data-act="logout">Esci</button></div>
    </div>
    <h2>Aspetto</h2>
    <div class="card pad">
      <label class="field" style="margin-top:0"><span>Tema</span><select data-theme-sel>
        ${[['scuro', 'Scuro'], ['chiaro', 'Chiaro'], ['sistema', 'Come Windows/Android']].map(([v, l]) => `<option value="${v}" ${lsGetStr('gf.theme', 'scuro') === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
    </div>
    <h2>Regole generali</h2>
    <div class="card pad">
      <label class="field"><span>IVA %</span><input type="number" inputmode="decimal" value="${esc(st.iva ?? 22)}" data-set="iva"></label>
      <label class="field"><span>Parole da ignorare nel titolo</span><input type="text" value="${esc((st.ignora || []).join(', '))}" data-set="ignora" placeholder="es. sost">
      <small>Gli eventi con una di queste parole nel titolo non vengono conteggiati, anche se hanno il colore di un service. Separale con una virgola.</small></label>
    </div>
    <h2>Cooperativa</h2>
    <div class="card pad">
      <label class="field" style="margin-top:0"><span>Trattenuta della cooperativa % (per le stime)</span><input type="number" inputmode="decimal" value="${esc(st.trattenutaCoop ?? 32)}" data-set="trattenutaCoop"></label>
      <small class="muted">Quando la cooperativa ha già calcolato il "netto al socio" di una fattura, l'app usa quella cifra vera.</small>
      ${coop ? `<div id="coop-box" style="margin-top:14px"><div class="muted">Controllo il collegamento…</div></div>`
        : `<div class="note info">Le fatture e le giornate aperte vengono lette dal sito della cooperativa dall'app Windows, e arrivano qui tramite Drive.${store.data.coop?.aggiornatoIl ? ` Ultimo aggiornamento: ${esc(ago(store.data.coop.aggiornatoIl))}.` : ''}</div>`}
    </div>
    <h2>Copia di sicurezza</h2>
    <div class="card pad">
      <div class="muted" style="font-size:13.5px">I dati sono già salvati sul tuo Google Drive. Qui puoi scaricarne una copia o reimportarla.</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-act="backup">Esporta copia</button>
      <label class="btn">Importa<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
    </div>
    <h2>App</h2>
    <div class="card pad">
      <div>Versione <b>${esc(APP_VERSION)}</b> · ${PLATFORM === 'windows' ? 'Windows' : PLATFORM === 'android' ? 'Android' : 'browser'}</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-act="check-update">Controlla aggiornamenti</button></div>
    </div>`;
}

// ---------- menù e pagine ----------

function openMenu() {
  const item = (id, ic, title, sub) => `<button class="list-row" data-page="${id}"><span style="font-size:20px;width:26px;text-align:center">${ic}</span>
    <span class="grow"><div><b>${title}</b></div><div class="muted">${sub}</div></span><span class="muted">›</span></button>`;
  openSheet(`<h3>Menù</h3><div class="sub">Strumenti</div>
    <div class="card">
      ${item('prospetto', '📅', 'Prospetto incassi', 'Quanto ti entra ogni mese, secondo i termini di pagamento')}
      ${item('pagamenti', '✔', 'Pagamenti fatture', 'Fatture della cooperativa: pagate, in attesa, in ritardo')}
      ${item('enpals', '🗂', 'Giornate ENPALS', 'Giornate aperte dalla cooperativa e quelle da far aprire')}
      ${item('concerti', '♪', 'Concerti', 'Cachet dei concerti, mese per mese, a parte dal resto')}
    </div>
    <div class="sheet-actions btn-row"><button class="btn" data-close-btn>Chiudi</button></div>`, sh => {
    sh.addEventListener('click', e => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      ui.page = b.dataset.page;
      closeSheet(); render(); window.scrollTo(0, 0);
      if (ui.page === 'prospetto') ensureMonths(forecastWorkMonths());
      if (ui.page === 'enpals') ensureMonths(enpalsMonths());
      if (ui.page === 'concerti') ensureMonths(concertMonths());
      if (coop && (ui.page === 'pagamenti' || ui.page === 'enpals' || ui.page === 'prospetto')) {
        const at = store.data.coop?.aggiornatoIl || 0;
        if (Date.now() - at > 30 * 60 * 1000) doCoopSync(false);
      }
    });
  });
}

/** Legge dal calendario i mesi che mancano (o sono vecchi), uno alla volta */
async function ensureMonths(list) {
  if (ui.monthsLoading || !store.meta.email) return;
  const todo = list.filter(ym => { const c = cachedMonthEvents(ym); return !c || Date.now() - c.at > 30 * 60 * 1000; });
  if (!todo.length) return;
  ui.monthsLoading = { done: 0, total: todo.length };
  render();
  for (const ym of todo) {
    try { ui.events[ym] = await fetchMonthEvents(ym); } catch { /* resta la copia salvata */ }
    ui.monthsLoading.done++;
    if (ui.page) render();
  }
  ui.monthsLoading = null;
  render();
}

function forecastWorkMonths() {
  const cur = thisMonth();
  const out = [];
  for (let i = -5; i <= 3; i++) out.push(shiftYM(cur, i));
  return out;
}
function enpalsMonths() {
  const cur = thisMonth();
  return [shiftYM(cur, -1), cur, shiftYM(cur, 1), shiftYM(cur, 2), shiftYM(cur, 3), shiftYM(cur, 4)];
}

function concertMonths() {
  const y = Number(thisMonth().slice(0, 4));
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  out.push(`${y + 1}-01`, `${y + 1}-02`, `${y + 1}-03`);
  return out;
}

function viewConcerts() {
  const months = concertMonths();
  const all = [];
  for (const ym of months) all.push(...monthModel(ym).days);
  const cs = C.concertSummary(all);
  const today = todayISO();
  const y = thisMonth().slice(0, 4);
  const anno = cs.filter(m => m.mese.startsWith(y));
  const totAnno = anno.reduce((a, m) => a + m.totale, 0);
  const fatti = anno.reduce((a, m) => a + m.concerti.filter(d => d.date <= today).length, 0);
  const prossimi = all.filter(d => d.concerto && !d.escluso && !d.opzione && d.date > today).sort((a, b) => a.date.localeCompare(b.date));
  const cSvc = services().find(x => x.tipo === 'concerti');
  let h = loadingLine();
  h += `<div class="card"><div class="kpis">
      <div class="kpi"><div class="v">${esc(C.eur(totAnno))}</div><div class="l">concerti ${y} (netto)</div></div>
      <div class="kpi"><div class="v">${fatti}</div><div class="l">concerti fatti</div></div>
      <div class="kpi"><div class="v">${prossimi.length}</div><div class="l">in programma</div></div>
    </div></div>
    <div class="note info">Sono gli eventi con il colore ${esc(C.GOOGLE_COLORS[cSvc?.colorId]?.name || 'dei concerti')}. Scrivi la cifra netta nella descrizione dell'evento (basta il numero, es. "80"). Sono contati a parte: niente fatture, prospetto o ENPALS.</div>`;
  const row = d => `<button class="list-row" data-act="day-any" data-key="${esc(d.key)}" data-ym="${d.date.slice(0, 7)}"><span class="sw" style="background:${colorOf(cSvc)}"></span>
    <span class="grow"><div><b>${esc(C.dateLabel(d.date))}</b> · ${esc(d.place || 'Concerto')}</div></span>
    <span class="amt">${d.compenso ? esc(C.eur(d.compenso)) : '<span class="badge warn">cifra?</span>'}</span></button>`;
  if (prossimi.length) h += `<h2>In programma (${prossimi.length})</h2><div class="card">${prossimi.map(row).join('')}</div>`;
  if (!cs.length) h += `<div class="card"><div class="empty"><b>Nessun concerto</b>Non ci sono eventi con il colore dei concerti nei mesi letti.</div></div>`;
  for (const m of cs.slice().reverse()) {
    h += `<h2 style="display:flex;justify-content:space-between"><span style="text-transform:capitalize">${esc(C.monthLabel(m.mese))}</span><span>${esc(C.eur(m.totale))}</span></h2>
      <div class="card">${m.concerti.map(row).join('')}</div>`;
  }
  return h;
}

function loadingLine() {
  return ui.monthsLoading ? `<div class="note info">Leggo il calendario… (${ui.monthsLoading.done}/${ui.monthsLoading.total} mesi)</div>` : '';
}

function coopLine() {
  const c = store.data.coop;
  if (ui.coopBusy) return `<div class="note info">Leggo i dati dal sito della cooperativa…</div>`;
  if (ui.coopError) return `<div class="note bad">Sito della cooperativa: ${esc(ui.coopError)}${coop ? ' · <a href="#" data-act="coop-sync">riprova</a>' : ''}</div>`;
  if (!c) return coop
    ? `<div class="note warn">Non hai ancora collegato il sito della cooperativa: vai in <b>Altro → Cooperativa</b>.</div>`
    : `<div class="note warn">I dati della cooperativa arrivano dall'app Windows: collega il sito da lì (Altro → Cooperativa).</div>`;
  return `<div class="note info">Dati cooperativa aggiornati ${esc(ago(c.aggiornatoIl))}${coop ? ' · <a href="#" data-act="coop-sync">aggiorna ora</a>' : ''}</div>`;
}

async function doCoopSync(manual) {
  if (!coop || ui.coopBusy) return;
  const st = await coop.status();
  if (!st.configured) { if (manual) toast('Prima inserisci nome utente e password in Altro → Cooperativa'); return; }
  ui.coopBusy = true; ui.coopError = null; render();
  try {
    const r = await syncCoop(C);
    if (manual) toast(`Letti ${r.fatture} fatture e ${r.eventi} giornate`);
  } catch (e) {
    ui.coopError = e?.message || String(e);
  } finally {
    ui.coopBusy = false; render();
  }
}

async function renderCoopBox(box) {
  const st = await coop.status();
  box.innerHTML = `
    <div><b>Sito della cooperativa (Crew Logic)</b></div>
    <div class="muted" style="font-size:13.5px">${st.configured ? `Collegato come <b>${esc(st.user)}</b>. ${store.data.coop?.aggiornatoIl ? 'Ultima lettura: ' + esc(ago(store.data.coop.aggiornatoIl)) + '.' : ''}` : 'Non collegato.'}
      Nome utente e password restano cifrati solo su questo PC.</div>
    <div class="grid2">
      <label class="field"><span>Nome utente</span><input type="text" id="co-user" autocomplete="off" value="${esc(st.user || '')}"></label>
      <label class="field"><span>Password</span><input type="password" id="co-pass" autocomplete="off" placeholder="${st.configured ? '••••••• (invariata)' : ''}"></label>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn primary" id="co-save">${st.configured ? 'Aggiorna e prova' : 'Collega'}</button>
      ${st.configured ? '<button class="btn" id="co-sync">Leggi ora</button><button class="btn danger" id="co-forget">Scollega</button>' : ''}
    </div>`;
  box.querySelector('#co-save').onclick = async () => {
    const user = box.querySelector('#co-user').value.trim();
    const pass = box.querySelector('#co-pass').value;
    if (!user || (!pass && !st.configured)) return toast('Scrivi nome utente e password');
    if (!pass) return toast('Per cambiare il collegamento riscrivi anche la password');
    toast('Provo l\'accesso…');
    const r = await coop.save(user, pass);
    if (r.ok) { toast('Collegato'); await doCoopSync(true); } else toast('Accesso non riuscito: ' + r.error, 5000);
    render();
  };
  const sy = box.querySelector('#co-sync');
  if (sy) sy.onclick = () => doCoopSync(true);
  const fg = box.querySelector('#co-forget');
  if (fg) fg.onclick = async () => { await coop.forget(); toast('Scollegato'); render(); };
}

function viewForecast() {
  const months = forecastWorkMonths();
  const sumsByMonth = {};
  for (const ym of months) {
    const mm = monthModel(ym);
    if (mm.sums.length) sumsByMonth[ym] = mm.sums;
  }
  const fc = C.buildForecast(sumsByMonth, services(), store.data);
  const cur = thisMonth();
  const vis = fc.filter(m => m.mese >= shiftYM(cur, -2));
  const tr = C.num(store.data.settings?.trattenutaCoop ?? 32);
  let h = loadingLine() + coopLine();
  h += `<div class="note info">Incasso = ultimo giorno del mese, secondo i giorni di pagamento di ogni service (in Service). Netto <b>✓</b> = cifra vera della cooperativa; <b>~</b> = stima con trattenuta ${tr}%. I rimborsi sono a parte.</div>`;
  if (!vis.length) h += `<div class="card"><div class="empty"><b>Niente da mostrare</b>Non ci sono giornate nei mesi letti.</div></div>`;
  for (const m of vis) {
    const past = m.mese < cur;
    h += `<h2 style="display:flex;justify-content:space-between;gap:8px"><span>Scadenza fine <span style="text-transform:capitalize">${esc(C.monthLabel(m.mese))}</span>${m.mese === cur ? ' · questo mese' : ''}</span><span>${esc(C.eur(m.netto))}${m.rimborsi ? ` + ${esc(C.eur(m.rimborsi))} rimb.` : ''}</span></h2>
      <div class="card">${m.righe.map(r => {
        let badge;
        if (r.coop?.pagata) badge = '<span class="badge good">pagata</span>';
        else if (r.coop) badge = past ? '<span class="badge bad">non pagata</span>' : '<span class="badge">in attesa</span>';
        else if (r.previste) badge = '<span class="badge">lavoro in corso</span>';
        else badge = '<span class="badge warn">fattura da emettere</span>';
        return `<div class="list-row">
          <span class="sw" style="background:${colorOf(r.service)}"></span>
          <span class="grow"><div><b>${esc(r.service.name)}</b> · <span style="text-transform:capitalize">lavoro ${esc(C.MESI[Number(r.ym.slice(5)) - 1])}</span></div>
          <div class="muted">${r.giornate} gg · compensi ${esc(C.eur(r.compensi))}${r.rimborsiSeparati ? ` · rimborsi ${esc(C.eur(r.rimborsiSeparati))}` : ''} · ${r.giorni} gg${r.coop ? ` · fatt. ${esc(r.coop.numero)}` : ''}</div></span>
          <span style="text-align:right"><div class="amt">${r.nettoReale ? '✓' : '~'} ${esc(C.eur(r.netto))}</div>${badge}</span></div>`;
      }).join('')}</div>`;
  }
  return h;
}

function viewPayments() {
  let h = coopLine();
  const c = store.data.coop;
  if (!c) return h;
  const list = C.paymentsStatus(c, services(), todayISO());
  const scadute = list.filter(f => f.stato === 'scaduta');
  const attesa = list.filter(f => f.stato === 'attesa');
  const pagate = list.filter(f => f.stato === 'pagata');
  const tot = arr => arr.reduce((a, f) => a + (f.netto ?? (f.imponibile || 0) * (1 - C.num(store.data.settings?.trattenutaCoop ?? 32) / 100)), 0);
  h += `<div class="card"><div class="kpis">
      <div class="kpi"><div class="v" style="color:var(--bad)">${scadute.length}</div><div class="l">in ritardo · ~${esc(C.eur(tot(scadute)))}</div></div>
      <div class="kpi"><div class="v">${attesa.length}</div><div class="l">in attesa · ~${esc(C.eur(tot(attesa)))}</div></div>
      <div class="kpi"><div class="v" style="color:var(--ok)">${pagate.length}</div><div class="l">pagate</div></div>
    </div></div>`;
  const row = f => `<div class="list-row">
      <span class="sw" style="background:${colorOf(f.service)}"></span>
      <span class="grow"><div><b>${esc(f.service?.name || f.cliente)}</b> · n. ${esc(f.numero)} del ${esc(f.data.split('-').reverse().join('/'))}</div>
      <div class="muted"><span style="text-transform:capitalize">lavoro ${esc(C.monthLabel(f.meseLavoro))}</span> · imponibile ${esc(C.eur(f.imponibile || 0))}${f.netto != null ? ` · netto ${esc(C.eur(f.netto))}` : ''} · scadenza ${esc(f.scadenza.split('-').reverse().join('/'))}</div></span>
      <span>${f.stato === 'pagata' ? '<span class="badge good">pagata</span>' : f.stato === 'scaduta' ? `<span class="badge bad">${f.ritardo} gg di ritardo</span>` : '<span class="badge">in attesa</span>'}</span></div>`;
  if (scadute.length) h += `<h2>In ritardo – da sollecitare (${scadute.length})</h2><div class="card">${scadute.map(row).join('')}</div>`;
  if (attesa.length) h += `<h2>In attesa (${attesa.length})</h2><div class="card">${attesa.map(row).join('')}</div>`;
  if (pagate.length) h += `<details class="more"><summary>Pagate (${pagate.length})</summary><div class="card">${pagate.map(row).join('')}</div></details>`;
  return h;
}

function viewEnpals() {
  let h = loadingLine() + coopLine();
  const c = store.data.coop;
  if (!c) return h;
  const months = enpalsMonths();
  const work = [];
  for (const ym of months) work.push(...monthModel(ym).days);
  const from = `${months[0]}-01`;
  const today = todayISO();
  const r = C.enpalsCompare(work, c.eventi, from);
  const fut = r.mancanti.filter(d => d.date >= today);
  const pas = r.mancanti.filter(d => d.date < today);
  const workByDate = new Map();
  for (const d of work) if (!d.escluso && !d.opzione && !workByDate.has(d.date)) workByDate.set(d.date, d);
  const aperteFuture = (c.eventi || []).filter(e => e.data >= today);
  const storico = (c.eventi || []).filter(e => e.data < today).sort((a, b) => b.data.localeCompare(a.data));
  const line = d => `${C.dateLabel(d.date)} – ${d.serviceName || '?'}${d.place ? ' – ' + d.place : ''}`;
  const mailText = `Buongiorno, vi chiedo di aprire le seguenti giornate:\n${fut.map(d => '- ' + line(d)).join('\n')}\n\nGrazie, Fernando`;

  h += `<div class="card"><div class="kpis">
      <div class="kpi"><div class="v" style="color:${fut.length ? 'var(--bad)' : 'var(--ok)'}">${fut.length}</div><div class="l">da far aprire</div></div>
      <div class="kpi"><div class="v">${aperteFuture.length}</div><div class="l">prossime già aperte</div></div>
      <div class="kpi"><div class="v">${storico.length}</div><div class="l">aperte in passato</div></div>
    </div></div>`;

  const rowW = d => `<button class="list-row" data-act="day-any" data-key="${esc(d.key)}" data-ym="${d.date.slice(0, 7)}"><span class="sw" style="background:${colorOf(svcById(d.serviceId))}"></span>
    <span class="grow"><div><b>${esc(C.dateLabel(d.date))}</b> · ${esc(d.serviceName || '?')}${d.place ? ' · ' + esc(d.place) : ''}</div></span></button>`;
  const rowE = e => {
    const w = workByDate.get(e.data);
    const s = w ? svcById(w.serviceId) : null;
    return `<div class="list-row"><span class="sw" style="background:${s ? colorOf(s) : 'transparent'};outline:1px solid var(--line)"></span>
      <span class="grow"><div><b>${esc(C.dateLabel(e.data))}</b> · ${esc(e.luogo)}</div>
      <div class="muted">${w ? `Calendario: ${esc(w.serviceName || '?')}${w.place ? ' · ' + esc(w.place) : ''}` : (e.data >= from ? 'Non c\'è sul calendario: manca l\'evento, oppure è una giornata aperta senza lavoro' : '')}</div></span>
      ${w ? '<span class="badge good">✓</span>' : (e.data >= from ? '<span class="badge warn">non in calendario</span>' : '')}</div>`;
  };

  h += `<h2>Da far aprire – lavori in calendario non ancora aperti (${fut.length})</h2>`;
  h += fut.length
    ? `<div class="card">${fut.map(rowW).join('')}</div>
       <div class="btn-row" style="margin-top:8px"><button class="btn primary" data-act="copy-enpals" data-text="${esc(mailText)}">Copia elenco per la mail</button></div>`
    : `<div class="card"><div class="empty" style="padding:16px"><b>Niente da aprire</b>Tutti i lavori futuri del calendario risultano già aperti (le opzioni "???" non contano).</div></div>`;

  h += `<h2>Prossime giornate già aperte (${aperteFuture.length})</h2>`;
  h += aperteFuture.length ? `<div class="card">${aperteFuture.map(rowE).join('')}</div>`
    : `<div class="card"><div class="empty" style="padding:16px">Nessuna giornata futura aperta sul portale.</div></div>`;

  if (pas.length) h += `<h2>Lavori passati senza giornata aperta (${pas.length})</h2><div class="card">${pas.map(rowW).join('')}</div>`;

  // storico per mese
  const byM = new Map();
  for (const e of storico) { const k = e.data.slice(0, 7); if (!byM.has(k)) byM.set(k, []); byM.get(k).push(e); }
  h += `<h2>Storico giornate aperte</h2>`;
  if (!byM.size) h += `<div class="card"><div class="empty" style="padding:16px">Nessuna giornata passata sul portale.</div></div>`;
  for (const [k, list] of byM) {
    h += `<details class="more" ${k === shiftYM(thisMonth(), 0) || k === shiftYM(thisMonth(), -1) ? 'open' : ''}><summary><span style="text-transform:capitalize">${esc(C.monthLabel(k))}</span> · ${list.length} ${list.length === 1 ? 'giornata' : 'giornate'}</summary>
      <div class="card">${list.slice().sort((a, b) => a.data.localeCompare(b.data)).map(rowE).join('')}</div></details>`;
  }
  return h;
}

// ---------- foglio dettaglio giornata ----------

function openSheet(html, onBind) {
  $sheet.innerHTML = `<div class="sheet-bg" data-close="1"><div class="sheet" role="dialog"><div class="sheet-grip"></div>${html}</div></div>`;
  const bg = $sheet.firstElementChild;
  bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
  $sheet.querySelectorAll('[data-close-btn]').forEach(b => b.addEventListener('click', closeSheet));
  onBind && onBind($sheet.querySelector('.sheet'));
}
function closeSheet() { $sheet.innerHTML = ''; }

function findDay(key) {
  const m = monthModel(ui.ym);
  return m.days.find(d => d.key === key);
}

function openDay(key) {
  const d = findDay(key);
  if (!d) return;
  const ov = store.data.days[key] && !store.data.days[key].deleted ? store.data.days[key] : {};
  const s = svcById(d.serviceId);
  const svcOptions = services().map(x => `<option value="${esc(x.id)}" ${x.id === d.serviceId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const orario = d.shifts.length ? d.shifts.map(x => `${C.hhmm(x.start)}–${C.hhmm(x.end)}`).join(' + ') : '—';
  const src = { descrizione: 'dalla descrizione', titolo: 'dal titolo', manuale: 'inserito a mano', evento: 'dall\'evento' }[d.source] || '';

  const issuesHtml = d.issues.map(i => {
    if (i.code === 'straord') return `<div class="issue">${esc(i.text)}<div class="btn-row">
      <button class="btn small" data-fix="ot" data-v="${i.noted}">Usa +${i.noted} (la tua nota)</button>
      <button class="btn small" data-fix="ot" data-v="${i.calc}">Usa +${i.calc} (dall'orario)</button></div></div>`;
    if (i.code === 'servizio') return `<div class="issue">${esc(i.text)}<div class="btn-row">${(d.candidates || []).map(id => `<button class="btn small" data-fix="svc" data-v="${esc(id)}">${esc(svcById(id)?.name)}</button>`).join('')}</div></div>`;
    if (i.code === 'cachet') return `<div class="issue">${esc(i.text)}<div class="btn-row"><input type="number" inputmode="decimal" placeholder="€" style="max-width:110px" class="btn small" data-fixinput="compenso"><button class="btn small" data-fix="compenso">Salva cifra</button></div></div>`;
    if (i.code === 'disp') return `<div class="issue">${esc(i.text)}<div class="btn-row"><input type="number" inputmode="decimal" placeholder="€" style="max-width:110px" class="btn small" data-fixinput="compenso"><button class="btn small" data-fix="compenso">Salva cifra</button><button class="btn small" data-fix="nodisp">Non era reperibilità</button></div></div>`;
    return `<div class="issue">${esc(i.text)}</div>`;
  }).join('');

  const rimbHtml = d.rimborsi.map(r => `<div class="rimb">
      <span class="grow">${esc(r.desc)} <span class="muted">· ${r.origine === 'nota' ? 'dalle note' : 'aggiunto'}</span></span>
      <b class="calc">${esc(C.eur(r.amount))}</b>
      ${r.origine === 'nota' ? `<input type="checkbox" ${r.incluso ? 'checked' : ''} data-rimb-toggle="${esc(r.id)}" aria-label="Includi">` : `<button class="btn small danger" data-rimb-del="${esc(r.id)}">✕</button>`}
    </div>`).join('') || '<div class="muted" style="font-size:13.5px">Nessun rimborso. Puoi scriverli nella descrizione dell\'evento (es. "+18 cena") o aggiungerli qui.</div>';

  let calcRows = '';
  if (d.concerto) calcRows += `<div class="row"><span>Concerto – cifra netta ${d.compensoManuale ? '(a mano)' : '(dall\'evento)'}</span><span>${esc(d.compenso ? C.eur(d.compenso) : 'da inserire')}</span></div>`;
  else if (d.compensoManuale) calcRows += `<div class="row"><span>Cifra concordata (a mano)</span><span>${esc(C.eur(d.compenso))}</span></div>`;
  else if (d.tipo === 'doppia') calcRows += `<div class="row"><span>Doppia (${d.otHours}ª ora extra)</span><span>${esc(C.eur(d.compenso))}</span></div>`;
  else {
    calcRows += `<div class="row"><span>${d.tipo === 'reperibilita' ? 'Reperibilità' : 'Giornata'}</span><span>${esc(C.eur(d.base))}</span></div>`;
    if (d.otHours > 0) calcRows += `<div class="row"><span>Straordinario ${d.otHours} h × ${esc(C.eur(C.num(s?.straordinario)))}</span><span>${esc(C.eur(d.otPay))}</span></div>`;
  }
  if (d.rimborsiTot) calcRows += `<div class="row"><span>Rimborsi</span><span>${esc(C.eur(d.rimborsiTot))}</span></div>`;
  calcRows += `<div class="row"><span>Totale giornata</span><span>${esc(C.eur(d.compenso + d.rimborsiTot))}</span></div>`;

  openSheet(`
    <h3>${esc(d.serviceName || 'Service da scegliere')}${d.place ? ' · ' + esc(d.place) : ''}</h3>
    <div class="sub" style="text-transform:capitalize">${esc(new Date(d.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${d.multi ? ' · <span style="text-transform:none">evento su più giorni</span>' : ''}</div>
    ${issuesHtml}
    <h2>Dal calendario</h2>
    <div class="raw">${esc(d.title)}${d.description ? '\n\n' + esc(d.description) : ''}</div>
    <h2>Calcolo</h2>
    <div class="card pad calc">
      <div class="row"><span>Orario ${esc(src)}</span><span>${esc(orario)}${d.minutes != null ? ' · ' + esc(C.fmtMin(d.minutes)) : ''}</span></div>
      ${calcRows}
    </div>
    ${d.info.length ? `<div class="note info">${d.info.map(esc).join('<br>')}</div>` : ''}
    <h2>Rimborsi</h2>
    <div class="card pad">${rimbHtml}
      <div class="grid2" style="margin-top:6px"><label class="field"><span>Voce</span><input type="text" id="r-desc" placeholder="es. parcheggio"></label>
      <label class="field"><span>Importo €</span><input type="number" inputmode="decimal" id="r-amt"></label></div>
      <button class="btn small" data-fix="rimb-add" style="margin-top:8px">Aggiungi rimborso</button>
    </div>
    <h2>Correggi a mano</h2>
    <div class="card pad">
      <label class="field"><span>Service</span><select id="f-svc"><option value="">— dal calendario —</option>${svcOptions}</select></label>
      <div class="grid2">
        <label class="field"><span>Inizio</span><input type="time" id="f-start" value="${esc(ov.start || '')}"></label>
        <label class="field"><span>Fine</span><input type="time" id="f-end" value="${esc(ov.end || '')}"></label>
      </div>
      <small class="muted">Lascia vuoto per usare l'orario del calendario. Se finisci dopo mezzanotte va bene lo stesso (es. 14:00 → 02:30).</small>
      <div class="grid2">
        <label class="field"><span>Ore extra</span><input type="number" inputmode="numeric" id="f-ot" value="${esc(ov.otHours ?? '')}" placeholder="${d.otCalc ?? ''}"></label>
        <label class="field"><span>Cifra concordata €</span><input type="number" inputmode="decimal" id="f-comp" value="${esc(ov.compenso ?? '')}" placeholder="calcolata"></label>
      </div>
      <small class="muted">La cifra concordata sostituisce tutto il calcolo della giornata (per favori, accordi a parte, reperibilità).</small>
      <label class="check"><input type="checkbox" id="f-rep" ${d.tipo === 'reperibilita' ? 'checked' : ''}> Reperibilità</label>
      <label class="check"><input type="checkbox" id="f-escl" ${d.escluso ? 'checked' : ''}> Escludi questa giornata dai conti</label>
      <label class="field"><span>Nota personale</span><textarea id="f-nota">${esc(ov.nota || '')}</textarea></label>
    </div>
    <div class="sheet-actions btn-row">
      ${Object.keys(ov).length ? '<button class="btn" data-fix="reset">Ripristina</button>' : ''}
      ${d.issues.length ? '<button class="btn" data-fix="ok">Va bene così</button>' : ''}
      <button class="btn primary" data-fix="save">Salva</button>
    </div>`, sh => {
    const get = id => sh.querySelector('#' + id);
    sh.addEventListener('click', e => {
      const b = e.target.closest('[data-fix]');
      if (b) {
        const f = b.dataset.fix;
        if (f === 'ot') { updateDay(key, { otHours: Number(b.dataset.v) }); toast('Straordinario aggiornato'); return reopen(); }
        if (f === 'svc') { assignEvent(d.eventId, b.dataset.v); return reopen(); }
        if (f === 'compenso') {
          const v = sh.querySelector('[data-fixinput=compenso]').value;
          if (v === '') return toast('Scrivi la cifra');
          updateDay(key, { compenso: C.num(v) }); toast('Cifra salvata'); return reopen();
        }
        if (f === 'nodisp') { updateDay(key, { reperibilita: false }); return reopen(); }
        if (f === 'ok') { updateDay(key, { ok: true }); toast('Segnata come controllata'); closeSheet(); return; }
        if (f === 'reset') { resetDay(key); toast('Tornata come da calendario'); return reopen(); }
        if (f === 'rimb-add') {
          const desc = get('r-desc').value.trim() || 'rimborso spese';
          const amt = C.num(get('r-amt').value);
          if (!amt) return toast('Scrivi l\'importo');
          updateDay(key, { rimborsiManuali: [...(ov.rimborsiManuali || []), { id: C.uid(), desc, amount: amt }] });
          return reopen();
        }
        if (f === 'save') {
          const start = get('f-start').value, end = get('f-end').value;
          if ((start && !end) || (!start && end)) return toast('Servono sia inizio che fine');
          const patch = {
            serviceId: get('f-svc').value || undefined,
            start: start || undefined, end: end || undefined,
            otHours: get('f-ot').value === '' ? undefined : C.num(get('f-ot').value),
            compenso: get('f-comp').value === '' ? undefined : C.num(get('f-comp').value),
            escludi: get('f-escl').checked || undefined,
            nota: get('f-nota').value.trim() || undefined,
          };
          const repNow = get('f-rep').checked;
          const repCal = /\bdisp\b/i.test(C.norm(d.title));
          patch.reperibilita = repNow === repCal ? undefined : repNow;
          const next = { ...ov, ...patch };
          for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
          store.data.days[key] = { ...next, updatedAt: Date.now() };
          updateDay(key, {});
          toast('Salvato'); closeSheet();
        }
      }
      const del = e.target.closest('[data-rimb-del]');
      if (del) {
        updateDay(key, { rimborsiManuali: (ov.rimborsiManuali || []).filter(r => r.id !== del.dataset.rimbDel) });
        return reopen();
      }
    });
    sh.addEventListener('change', e => {
      const t = e.target.closest('[data-rimb-toggle]');
      if (t) {
        const stato = { ...(ov.rimborsiStato || {}) };
        if (t.checked) delete stato[t.dataset.rimbToggle]; else stato[t.dataset.rimbToggle] = 'no';
        updateDay(key, { rimborsiStato: Object.keys(stato).length ? stato : undefined });
        reopen();
      }
    });
  });
  function reopen() { render(); openDay(key); }
}

function assignEvent(eventId, serviceId) {
  const items = ui.events[ui.ym] || cachedMonthEvents(ui.ym)?.items || [];
  const ev = items.find(e => e.id === eventId);
  if (!ev) return;
  for (const d of C.expandEvent(ev).days) updateDay(`${ev.id}|${d}`, { serviceId });
  toast('Assegnato');
}

function openAssign(eventId) {
  const items = ui.events[ui.ym] || cachedMonthEvents(ui.ym)?.items || [];
  const ev = items.find(e => e.id === eventId);
  if (!ev) return;
  openSheet(`<h3>${esc(ev.summary || '(senza titolo)')}</h3>
    <div class="sub">Questo evento non è stato riconosciuto. A quale service appartiene?</div>
    <div class="card">${services().map(s => `<button class="list-row" data-pick="${esc(s.id)}"><span class="sw" style="background:${colorOf(s)}"></span><span class="grow">${esc(s.name)}</span></button>`).join('')}</div>
    <div class="note info">Per le prossime volte conviene iniziare il titolo con il nome del service (es. "${esc(services()[0]?.keywords?.[0] || 'Congress')} …").</div>
    <div class="sheet-actions btn-row"><button class="btn" data-close-btn>Chiudi</button></div>`, sh => {
    sh.addEventListener('click', e => {
      const p = e.target.closest('[data-pick]');
      if (p) { assignEvent(eventId, p.dataset.pick); closeSheet(); render(); }
    });
  });
}

// ---------- fatture ----------

function sumFor(serviceId) {
  return monthModel(ui.ym).sums.find(s => s.service.id === serviceId);
}

function openInvoiceText(serviceId) {
  const s = sumFor(serviceId);
  if (!s) return;
  const text = C.invoiceText(s, ui.ym);
  openSheet(`<h3>Riepilogo ${esc(s.service.name)}</h3><div class="sub" style="text-transform:capitalize">${esc(C.monthLabel(ui.ym))}</div>
    ${s.daControllare ? `<div class="issue">${s.daControllare === 1 ? '1 giornata è ancora da controllare' : s.daControllare + ' giornate sono ancora da controllare'}.</div>` : ''}
    <div class="textbox">${esc(text)}</div>
    <div class="sheet-actions btn-row">
      <button class="btn" data-x="csv">Tabella (CSV)</button>
      <button class="btn" data-x="copy">Copia</button>
      ${PLATFORM === 'android' ? '<button class="btn primary" data-x="share">Condividi</button>' : ''}
    </div>`, sh => {
    sh.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      try {
        if (b.dataset.x === 'copy') { await copyText(text); toast('Copiato: incollalo nella mail o su WhatsApp'); }
        if (b.dataset.x === 'share') await shareText(`Riepilogo ${s.service.name}`, text);
        if (b.dataset.x === 'csv') {
          const ok = await saveTextFile(`${ui.ym}-${s.service.name.replace(/\W+/g, '-')}.csv`, C.csvForSummary(s));
          if (ok) toast('Tabella salvata');
        }
      } catch (err) { if (!/cancel/i.test(String(err?.message))) toast('Non riuscito: ' + (err?.message || err)); }
    });
  });
}

function openInvoiceEdit(serviceId, mode) {
  const s = sumFor(serviceId);
  if (!s) return;
  const key = `${ui.ym}|${serviceId}`;
  const inv = s.invoice || {};
  const today = todayISO();
  openSheet(`<h3>Fattura ${esc(s.service.name)}</h3><div class="sub" style="text-transform:capitalize">${esc(C.monthLabel(ui.ym))} · ${esc(C.eur(s.totale))}</div>
    <label class="field"><span>Stato</span><select id="i-st">
      <option value="">Da chiedere</option>
      <option value="emessa" ${(mode === 'emessa' || (inv.stato === 'emessa' && mode !== 'pagata')) ? 'selected' : ''}>Emessa (non ancora pagata)</option>
      <option value="pagata" ${(mode === 'pagata' || (inv.stato === 'pagata' && !mode)) ? 'selected' : ''}>Pagata</option></select></label>
    <label class="field"><span>Numero fattura</span><input type="text" id="i-num" value="${esc(inv.numero || '')}" placeholder="es. 2833"></label>
    <div class="grid2">
      <label class="field"><span>Emessa il</span><input type="date" id="i-em" value="${esc(inv.dataEmissione || today)}"></label>
      <label class="field"><span>Pagata il</span><input type="date" id="i-pa" value="${esc(inv.dataPagamento || (mode === 'pagata' ? today : ''))}"></label>
    </div>
    <div class="note info">Quando segni la fattura, l'app si ricorda i totali di adesso: se poi cambia un orario di quel mese, te lo segnala.</div>
    <div class="sheet-actions btn-row"><button class="btn" data-close-btn>Annulla</button><button class="btn primary" data-i="save">Salva</button></div>`, sh => {
    sh.querySelector('[data-i=save]').addEventListener('click', () => {
      const stato = sh.querySelector('#i-st').value;
      if (!stato) { setInvoice(key, null); closeSheet(); render(); return; }
      setInvoice(key, {
        stato,
        numero: sh.querySelector('#i-num').value.trim(),
        dataEmissione: sh.querySelector('#i-em').value,
        dataPagamento: stato === 'pagata' ? sh.querySelector('#i-pa').value : '',
        snapshot: inv.snapshot && !s.cambiata ? inv.snapshot : { compensi: s.compensi, rimborsi: s.rimborsi, totale: s.totale, giornate: s.giornate },
      });
      toast('Fattura aggiornata'); closeSheet(); render();
    });
  });
}

// ---------- service ----------

function openService(id) {
  const s = id ? { ...svcById(id) } : { id: '', name: '', colorId: '', keywords: [], tipo: 'giornata', tariffa: 250, oreIncluse: 10, straordinario: 25, doppiaDa: 5, fatturazione: {} };
  const f = s.fatturazione || {};
  const sw = ['', ...Object.keys(C.GOOGLE_COLORS)].map(c => `<button type="button" class="swatch ${c ? '' : 'none'} ${String(s.colorId || '') === c ? 'on' : ''}" data-col="${c}" title="${c ? esc(C.GOOGLE_COLORS[c].name) : 'nessuno'}" style="${c ? `background:${C.GOOGLE_COLORS[c].hex}` : ''}"></button>`).join('');
  openSheet(`<h3>${id ? esc(s.name) : 'Nuovo service'}</h3><div class="sub">Regole di calcolo e dati per la fattura</div>
    <label class="field"><span>Nome</span><input type="text" id="s-name" value="${esc(s.name)}"></label>
    <label class="field"><span>Parole chiave del titolo</span><input type="text" id="s-kw" value="${esc((s.keywords || []).join(', '))}">
      <small>L'evento è di questo service se il titolo inizia con una di queste parole. Separale con una virgola.</small></label>
    <div class="field"><span>Colore su One Calendar</span><div class="swatches" id="s-col">${sw}</div></div>
    <label class="field"><span>Tipo di compenso</span><select id="s-tipo">
      <option value="giornata" ${s.tipo !== 'fissa' ? 'selected' : ''}>Giornata con straordinari</option>
      <option value="fissa" ${s.tipo === 'fissa' ? 'selected' : ''}>Giornata fissa (mai straordinari)</option>
      <option value="concerti" ${s.tipo === 'concerti' ? 'selected' : ''}>Concerti (cifra netta scritta nell'evento, conteggio a parte)</option></select></label>
    <div class="grid2">
      <label class="field g-svc"><span>Compenso giornata €</span><input type="number" inputmode="decimal" id="s-tar" value="${esc(s.tariffa ?? '')}"></label>
      <label class="field g-ot"><span>Ore incluse</span><input type="number" inputmode="decimal" id="s-ore" value="${esc(s.oreIncluse ?? '')}"></label>
      <label class="field g-ot"><span>Straordinario €/ora</span><input type="number" inputmode="decimal" id="s-str" value="${esc(s.straordinario ?? '')}"></label>
      <label class="field g-ot"><span>Doppia dalla ora extra n°</span><input type="number" inputmode="numeric" id="s-dop" value="${esc(s.doppiaDa ?? '')}" placeholder="vuoto = mai"></label>
    </div>
    <small class="muted g-ot">Ogni ora iniziata oltre le ore incluse conta come un'ora intera. Le ore incluse comprendono la pausa pranzo.</small>
    <label class="field g-svc"><span>Paga a giorni (dalla fine del mese di lavoro)</span><select id="s-pag">
      ${[30, 60, 90, 120].map(g => `<option value="${g}" ${C.num(s.pagamentoGiorni || 30) === g ? 'selected' : ''}>${g} giorni – fine mese</option>`).join('')}</select></label>
    <div class="g-svc"><h2>Dati per la fattura</h2>
    <label class="field"><span>Ragione sociale</span><input type="text" id="f-rs" value="${esc(f.ragioneSociale || '')}"></label>
    <label class="field"><span>Indirizzo</span><input type="text" id="f-ind" value="${esc(f.indirizzo || '')}"></label>
    <div class="grid2">
      <label class="field"><span>P.IVA</span><input type="text" id="f-piva" value="${esc(f.piva || '')}"></label>
      <label class="field"><span>Codice fiscale</span><input type="text" id="f-cf" value="${esc(f.cf || '')}"></label>
      <label class="field"><span>Codice SDI</span><input type="text" id="f-sdi" value="${esc(f.sdi || '')}"></label>
    </div>
    <label class="field"><span>Email per fatture</span><input type="text" id="f-mail" value="${esc(f.email || '')}"></label></div>
    <div class="sheet-actions btn-row">
      ${id ? '<button class="btn danger" data-s="del">Elimina</button>' : ''}
      <button class="btn" data-close-btn>Annulla</button>
      <button class="btn primary" data-s="save">Salva</button>
    </div>`, sh => {
    let colorId = s.colorId || '';
    const tipoSel = sh.querySelector('#s-tipo');
    const toggle = () => {
      sh.querySelectorAll('.g-ot').forEach(el => { el.style.display = tipoSel.value === 'giornata' ? '' : 'none'; });
      sh.querySelectorAll('.g-svc').forEach(el => { el.style.display = tipoSel.value === 'concerti' ? 'none' : ''; });
    };
    tipoSel.addEventListener('change', toggle); toggle();
    sh.querySelector('#s-col').addEventListener('click', e => {
      const b = e.target.closest('[data-col]');
      if (!b) return;
      colorId = b.dataset.col;
      sh.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b));
    });
    let delArmed = false;
    sh.addEventListener('click', e => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'del') {
        if (!delArmed) { delArmed = true; b.textContent = 'Conferma eliminazione'; return; }
        deleteService(id); closeSheet(); render(); toast('Service eliminato'); return;
      }
      const v = sel => sh.querySelector(sel).value.trim();
      if (!v('#s-name')) return toast('Scrivi il nome');
      saveService({
        ...s, name: v('#s-name'), colorId,
        keywords: v('#s-kw').split(',').map(x => x.trim()).filter(Boolean),
        tipo: tipoSel.value, tariffa: C.num(v('#s-tar')), pagamentoGiorni: C.num(v('#s-pag')),
        oreIncluse: v('#s-ore'), straordinario: v('#s-str'), doppiaDa: v('#s-dop'),
        fatturazione: { ragioneSociale: v('#f-rs'), indirizzo: v('#f-ind'), piva: v('#f-piva'), cf: v('#f-cf'), sdi: v('#f-sdi'), email: v('#f-mail') },
      });
      closeSheet(); render(); toast('Service salvato');
    });
  });
}

// ---------- eventi ----------

function bind() {
  $app.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'tab') { ui.tab = b.dataset.id; ui.page = null; render(); window.scrollTo(0, 0); return; }
    if (a === 'menu') return openMenu();
    if (a === 'page-close') { ui.page = null; render(); return; }
    if (a === 'coop-sync') { doCoopSync(true); return; }
    if (a === 'copy-enpals') {
      try { await copyText(b.dataset.text); toast('Elenco copiato: incollalo nella mail'); } catch (err) { toast('Non riuscito: ' + (err?.message || err)); }
      return;
    }
    if (a === 'prev' || a === 'next') { goMonth(a === 'prev' ? -1 : 1); return; }
    if (a === 'today') { ui.ym = thisMonth(); render(); loadMonth(ui.ym, { quiet: true }); return; }
    if (a === 'sync' || a === 'sync-all') { fullSync(); render(); return; }
    if (a === 'day') return openDay(b.dataset.key);
    if (a === 'cell') return openCell(b.dataset.date);
    if (a === 'day-any') { ui.ym = b.dataset.ym; return openDay(b.dataset.key); }
    if (a === 'view') { ui.view = b.dataset.id; lsSetStr('gf.view', ui.view); render(); return; }
    if (a === 'assign') return openAssign(b.dataset.ev);
    if (a === 'login') return doLogin();
    if (a === 'logout') {
      await signOut(); clearLocal(); ui.events = {}; render(); return;
    }
    if (a === 'svc') return openService(b.dataset.id);
    if (a === 'svc-new') return openService(null);
    if (a === 'inv-text') return openInvoiceText(b.dataset.id);
    if (a === 'inv-emit') return openInvoiceEdit(b.dataset.id, 'emessa');
    if (a === 'inv-paid') return openInvoiceEdit(b.dataset.id, 'pagata');
    if (a === 'inv-edit') return openInvoiceEdit(b.dataset.id, null);
    if (a === 'goto-month') { ui.ym = b.dataset.ym; render(); loadMonth(ui.ym, { quiet: true }); return; }
    if (a === 'backup') {
      try { if (await saveTextFile(`giornate-fonico-copia-${todayISO()}.json`, exportBackup())) toast('Copia salvata'); }
      catch (err) { toast('Non riuscito: ' + (err?.message || err)); }
      return;
    }
    if (a === 'check-update') { await doCheckUpdate(true); return; }
    if (a === 'get-update') {
      const u = ui.update;
      openExternal((PLATFORM === 'android' ? u.apk : PLATFORM === 'windows' ? u.exe : null) || u.page);
      return;
    }
  };
  $app.onchange = async e => {
    const inp = e.target.closest('[data-act=import]');
    if (inp && inp.files?.[0]) {
      try {
        const text = await inp.files[0].text();
        toast(importFile(JSON.parse(text)));
        render();
      } catch (err) { toast('File non valido: ' + (err?.message || err)); }
      return;
    }
    const th = e.target.closest('[data-theme-sel]');
    if (th) { lsSetStr('gf.theme', th.value); applyTheme(); return; }
    const set = e.target.closest('[data-set]');
    if (set) {
      if (set.dataset.set === 'iva') setSettings({ iva: C.num(set.value) });
      if (set.dataset.set === 'trattenutaCoop') setSettings({ trattenutaCoop: C.num(set.value) });
      if (set.dataset.set === 'ignora') setSettings({ ignora: set.value.split(',').map(x => x.trim()).filter(Boolean) });
      toast('Salvato');
    }
  };
  bindSwipe();
  const box = $app.querySelector('#coop-box');
  if (box && coop) renderCoopBox(box);
  const det = $app.querySelector('details[data-act=others]');
  if (det) det.ontoggle = () => { ui.showOthers = det.open; };
}

async function doLogin() {
  try {
    const r = await signIn();
    setMeta({ email: r.email || store.meta.email || 'account Google', needLogin: false });
    render();
    await fullSync();
  } catch (e) {
    toast('Accesso non riuscito: ' + (e?.message || e), 5000);
  }
}

async function doCheckUpdate(manual) {
  try {
    const u = await checkUpdate();
    if (u && C.isNewerVersion(u.version, APP_VERSION)) { ui.update = u; render(); if (manual) toast(`Disponibile la versione ${u.version}`); }
    else if (manual) toast('Hai già l\'ultima versione');
  } catch (e) { if (manual) toast('Controllo non riuscito: ' + (e?.message || e)); }
}

// ---------- tasto indietro (Android) ----------
onBackButton(() => {
  if ($sheet.innerHTML) { closeSheet(); render(); return true; }
  if (ui.page) { ui.page = null; render(); return true; }
  if (ui.tab !== 'giornate') { ui.tab = 'giornate'; render(); return true; }
  if (ui.ym !== thisMonth()) { ui.ym = thisMonth(); render(); return true; }
  return false; // nella schermata principale: l'app va in secondo piano
});

// ---------- avvio ----------

onChange(() => { if (!$sheet.innerHTML) render(); else { const top = $app.querySelector('.sync-line'); if (top) top.innerHTML = syncLine(); } });
render();
if (store.meta.email && isConfigured()) {
  fullSync();
}
doCheckUpdate(false);
if (coop && store.meta.email) {
  const at = store.data.coop?.aggiornatoIl || 0;
  if (Date.now() - at > 3 * 60 * 60 * 1000) setTimeout(() => doCoopSync(false), 4000);
}
// Rilegge il calendario quando torni sull'app (se è passato più di 1 minuto) e ogni 3 minuti mentre è aperta
function refreshIfOld(maxAgeMs) {
  if (!store.meta.email || ui.loading || document.visibilityState !== 'visible') return;
  const c = cachedMonthEvents(ui.ym);
  if (!c || Date.now() - c.at > maxAgeMs) fullSync();
}
document.addEventListener('visibilitychange', () => refreshIfOld(60 * 1000));
window.addEventListener('focus', () => refreshIfOld(60 * 1000));
setInterval(() => refreshIfOld(3 * 60 * 1000), 30 * 1000);
setInterval(() => { if (store.meta.dirty && !store.syncing && store.meta.email) syncData().catch(() => {}); }, 60 * 1000);
