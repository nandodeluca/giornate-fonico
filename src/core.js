// Logica pura dell'app: lettura degli orari dagli eventi, abbinamento ai service,
// calcolo dei compensi e unione dei dati tra dispositivi. Nessuna dipendenza esterna,
// così si può provare con i test (npm test) senza telefono né PC Windows.

export const GOOGLE_COLORS = {
  '1': { name: 'Lavanda', hex: '#7986cb' },
  '2': { name: 'Salvia (verde chiaro)', hex: '#33b679' },
  '3': { name: 'Vinaccia (viola)', hex: '#8e24aa' },
  '4': { name: 'Fenicottero', hex: '#e67c73' },
  '5': { name: 'Banana (giallo)', hex: '#f6bf26' },
  '6': { name: 'Mandarino (arancione)', hex: '#f4511e' },
  '7': { name: 'Pavone', hex: '#039be5' },
  '8': { name: 'Grafite', hex: '#616161' },
  '9': { name: 'Mirtillo', hex: '#3f51b5' },
  '10': { name: 'Basilico (verde scuro)', hex: '#0b8043' },
  '11': { name: 'Pomodoro', hex: '#d50000' },
};

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

// ---------- utilità ----------

export function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export function hasValue(v) {
  return v !== null && v !== undefined && v !== '';
}

export function eur(n) {
  const v = round2(n);
  const s = v.toLocaleString('it-IT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return s + ' €';
}

export function fmtMin(min) {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export function hhmm(t) {
  if (!t) return '';
  return `${t.h}:${String(t.m).padStart(2, '0')}`;
}

export function parseHHMM(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return { h, m: mi };
}

export function dateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${GIORNI[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESI[m - 1]} ${y}`;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ---------- lettura orari ----------

// Un orario: "7:30", "7.30", "1500", "930", "9", con "h" o "h." davanti facoltativo.
const TOK = String.raw`(?:(h\.?\s*)|(?<![\d.,:/€]))(\d{1,2}[:.]\d{2}|\d{3,4}|\d{1,2})(?![\d,]|[.:]\d)`;
const RANGE_RE = new RegExp(
  TOK + String.raw`((?:\s+[a-zà-ù']+){0,2}\s*(?:[-–—]|\balle\b|\bfino alle\b)\s*(?:[a-zà-ù']+\s+){0,1})` + TOK,
  'gi'
);

function tokToTime(raw) {
  let h, m;
  if (/[:.]/.test(raw)) {
    [h, m] = raw.split(/[:.]/).map(Number);
  } else if (raw.length >= 3) {
    h = Number(raw.slice(0, raw.length - 2));
    m = Number(raw.slice(-2));
  } else {
    h = Number(raw); m = 0;
  }
  if (h > 24 || m > 59) return null;
  return { h, m };
}

function minutesBetween(a, b) {
  let d = (b.h * 60 + b.m) - (a.h * 60 + a.m);
  if (d <= 0) d += 24 * 60; // finisce dopo mezzanotte
  return d;
}

// Trova gli orari in un testo. Restituisce {shifts:[{start,end,min}], minutes, partialStart, score}
export function parseTimes(text) {
  const t = stripHtml(text || '');
  if (!t.trim()) return null;
  const found = [];
  RANGE_RE.lastIndex = 0;
  let mm;
  while ((mm = RANGE_RE.exec(t)) !== null) {
    const a = tokToTime(mm[2]);
    const b = tokToTime(mm[5]);
    if (!a || !b) { RANGE_RE.lastIndex = mm.index + 1; continue; }
    const score = (/[:.]/.test(mm[2]) ? 1 : 0) + (/[:.]/.test(mm[5]) ? 1 : 0) + (mm[1] ? 1 : 0) + (mm[4] ? 1 : 0);
    // scarta numeri che sembrano indirizzi ("Via Tortona 27 - 29"): servono almeno un ":" o un "h", oppure numeri piccoli
    found.push({ start: a, end: b, min: minutesBetween(a, b), index: mm.index, endIndex: mm.index + mm[0].length, score, raw: mm[0] });
  }
  if (found.length) {
    // raggruppa i turni spezzati: "8:00-11:00 + 16:00-17:30"
    const groups = [];
    let cur = [found[0]];
    for (let i = 1; i < found.length; i++) {
      const between = t.slice(found[i - 1].endIndex, found[i].index);
      if (/^\s*(\+|e|&|,|\/)\s*$/i.test(between)) cur.push(found[i]);
      else { groups.push(cur); cur = [found[i]]; }
    }
    groups.push(cur);
    // sceglie il gruppo più "sicuro" (orari con i due punti), a parità il primo
    let best = groups[0], bestScore = -1;
    for (const g of groups) {
      const s = g.reduce((acc, f) => acc + f.score, 0) / g.length;
      if (s > bestScore) { best = g; bestScore = s; }
    }
    return {
      shifts: best.map(f => ({ start: f.start, end: f.end, min: f.min })),
      minutes: best.reduce((acc, f) => acc + f.min, 0),
      partialStart: null,
      score: bestScore,
      ranges: found.length,
    };
  }
  // solo l'inizio: "h. 9", "h.15:00 -", "13:30-", oppure il testo è solo un numero ("9")
  let p = t.match(/(?:^|[\s(])h\.?\s*(\d{1,2}(?:[:.]\d{2})?)(?![\d,])/i)
    || t.match(/(?<![\d.,:/€])(\d{1,2}[:.]\d{2})(?![\d,])/)
    || t.match(/^\s*(\d{1,2})(?![\d,.:])(?:\s|-|$)/);
  if (p) {
    const st = tokToTime(p[1]);
    if (st) return { shifts: [], minutes: null, partialStart: st, score: 0, ranges: 0 };
  }
  return null;
}

// "+2 ore extra", "(+1 ora extra)", "+ 4 ore extra" -> 2 / 1 / 4
export function parseNotedOvertime(text) {
  const t = stripHtml(text || '');
  const m = t.match(/\+?\s*(\d+(?:[.,]5)?)\s*or[ae]\s*(?:di\s+)?(extra|straord\w*)(\s+non\s+mess[ae])?/i);
  if (!m) return null;
  if (m[3]) return null; // "+1 ora extra NON MESSA": nota per sé, non un accordo
  return num(m[1]);
}

// Rimborsi scritti nelle note: "+20 pranzo", "+ 7 euro Spontini", "+ 18 euro cena", "+25"
export function parseExpenses(text) {
  const t = stripHtml(text || '');
  const out = [];
  const re = /(?<![\d+])\+\s*(\d+(?:[.,]\d{1,2})?)(?![\d:])\s*(€|euro|eur\b)?\s*([a-zà-ù][a-zà-ù' ]{0,24})?/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const after = (m[3] || '').trim();
    if (/^or[ae]\b/i.test(after)) continue; // "+2 ore extra"
    const desc = after.split(/\s+/).slice(0, 3).join(' ');
    out.push({ amount: num(m[1]), desc: desc || 'rimborso spese' });
  }
  return out;
}

// ---------- service ----------

export function matchService(ev, services) {
  const title = norm(ev.summary);
  let best = null, bestLen = 0;
  for (const s of services) {
    if (s.deleted) continue;
    for (const k of s.keywords || []) {
      const kk = norm(k);
      if (!kk) continue;
      if (title === kk || (title.startsWith(kk) && !/[a-z0-9]/.test(title.charAt(kk.length)))) {
        if (kk.length > bestLen) { best = s; bestLen = kk.length; }
      }
    }
  }
  if (best) return { service: best, how: 'nome', keywordLen: bestLen };
  if (ev.colorId) {
    const byColor = services.filter(s => !s.deleted && s.colorId && String(s.colorId) === String(ev.colorId));
    if (byColor.length === 1) return { service: byColor[0], how: 'colore', keywordLen: 0 };
    if (byColor.length > 1) return { service: null, how: 'colore', candidates: byColor, keywordLen: 0 };
  }
  return null;
}

export function isIgnoredTitle(title, ignoreWords) {
  const t = norm(title);
  return (ignoreWords || []).some(w => {
    const ww = norm(w);
    if (!ww) return false;
    return new RegExp(`(^|[^a-z0-9])${ww.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t);
  });
}

// Il "luogo" dell'evento è il titolo senza il nome del service e senza orari: "Congress Magna Pars" -> "Magna Pars"
export function placeFromTitle(title, keywordLen) {
  let t = String(title || '').trim();
  if (keywordLen) t = t.slice(keywordLen).trim();
  t = t.replace(/\bdisp\b/gi, '').replace(/\b(h\.?\s*)?\d{1,2}([:.]\d{2})?\s*[-–]\s*(h\.?\s*)?\d{1,2}([:.]\d{2})?(\s*\+\s*\d{1,2}([:.]\d{2})?\s*[-–]\s*\d{1,2}([:.]\d{2})?)?/gi, '')
    .replace(/\s+/g, ' ').replace(/^[\s\-–:,]+|[\s\-–:,+]+$/g, '').trim();
  return t;
}

// ---------- giornate ----------

// Da un evento del calendario alle giornate (una per ogni giorno coperto).
export function expandEvent(ev) {
  const days = [];
  if (ev.start?.date) {
    const endEx = ev.end?.date || addDays(ev.start.date, 1);
    let d = ev.start.date;
    let guard = 0;
    while (d < endEx && guard++ < 62) { days.push(d); d = addDays(d, 1); }
    return { days, timed: null };
  }
  if (ev.start?.dateTime) {
    const s = ev.start.dateTime, e = ev.end?.dateTime || s;
    const start = { h: +s.slice(11, 13), m: +s.slice(14, 16) };
    const end = { h: +e.slice(11, 13), m: +e.slice(14, 16) };
    return { days: [s.slice(0, 10)], timed: { start, end } };
  }
  return { days: [], timed: null };
}

export function sameShifts(a, b) {
  if (!a || !b) return true;
  if (a.minutes == null || b.minutes == null) return true;
  return a.minutes === b.minutes && hhmm(a.shifts[0]?.start) === hhmm(b.shifts[0]?.start);
}

/**
 * Calcola una giornata.
 * ctx: { ev, date, multi, services, override, today, settings }
 */
export function computeDay(ctx) {
  const { ev, date, multi, services, today } = ctx;
  const ov = ctx.override || {};
  const key = `${ev.id}|${date}`;
  const m = matchService(ev, services);
  const desc = stripHtml(ev.description || '');
  const issues = [];
  const info = [];

  let service = m?.service || null;
  if (ov.serviceId) service = services.find(s => s.id === ov.serviceId && !s.deleted) || service;
  if (!service && m?.candidates) issues.push({ code: 'servizio', text: `Service da scegliere (stesso colore: ${m.candidates.map(c => c.name).join(', ')})` });
  if (service && m?.how === 'colore' && !ov.serviceId) info.push('riconosciuto dal colore');

  // orari: modifica a mano > descrizione > titolo > evento con orario
  const fromDesc = parseTimes(desc);
  const titleNoKw = m?.keywordLen ? String(ev.summary || '').slice(m.keywordLen) : String(ev.summary || '');
  const fromTitle = parseTimes(titleNoKw);
  const exp = expandEvent(ev);
  let times = null, source = null;
  if (hasValue(ov.start) && hasValue(ov.end)) {
    const a = parseHHMM(ov.start), b = parseHHMM(ov.end);
    if (a && b) { times = { shifts: [{ start: a, end: b, min: minutesBetween(a, b) }], minutes: minutesBetween(a, b), partialStart: null }; source = 'manuale'; }
  }
  if (!times && fromDesc && fromDesc.minutes != null) { times = fromDesc; source = 'descrizione'; }
  if (!times && fromTitle && fromTitle.minutes != null) { times = fromTitle; source = 'titolo'; }
  if (!times && exp.timed) {
    const mn = minutesBetween(exp.timed.start, exp.timed.end);
    times = { shifts: [{ start: exp.timed.start, end: exp.timed.end, min: mn }], minutes: mn, partialStart: null }; source = 'evento';
  }
  if (!times) {
    const partial = (fromDesc && fromDesc.partialStart) || (fromTitle && fromTitle.partialStart);
    times = { shifts: [], minutes: null, partialStart: partial || null };
  }
  if (source === 'descrizione' && fromTitle && fromTitle.minutes != null && !sameShifts(fromDesc, fromTitle) && !ov.ok) {
    issues.push({ code: 'titolo', text: `Orario diverso tra descrizione (${shiftsText(fromDesc)}) e titolo (${shiftsText(fromTitle)}): uso la descrizione` });
  }

  const reperibilita = hasValue(ov.reperibilita) ? !!ov.reperibilita : /\bdisp\b/i.test(norm(ev.summary));
  const notedOt = parseNotedOvertime(desc) ?? parseNotedOvertime(ev.summary);
  const notedDoppia = /\bdoppia\b/i.test(desc) || /\bdoppia\b/i.test(ev.summary || '');

  let base = 0, otHours = 0, otCalc = null, otPay = 0, tipo = 'normale';
  if (service) {
    const tariffa = num(service.tariffa);
    if (service.tipo === 'fissa') {
      base = tariffa;
      if (notedOt) info.push(`nota "+${notedOt} ore extra": service a giornata fissa, non pagate`);
    } else if (reperibilita && num(service.reperibilita) > 0) {
      tipo = 'reperibilita';
      base = num(service.reperibilita);
    } else {
      if (reperibilita && !(num(service.reperibilita) > 0) && !hasValue(ov.compenso)) {
        tipo = 'reperibilita';
        issues.push({ code: 'disp', text: 'Reperibilità (DISP): inserisci la cifra concordata per questa giornata' });
      }
      base = tariffa;
      if (times.minutes != null) {
        const excess = times.minutes - num(service.oreIncluse) * 60;
        otCalc = excess > 0 ? Math.ceil(excess / 60 - 1e-9) : 0;
      }
      if (tipo === 'reperibilita') { /* cifra a mano: niente straordinari */ }
      else if (hasValue(ov.otHours)) otHours = num(ov.otHours);
      else if (otCalc != null) otHours = otCalc;
      else if (notedOt != null) otHours = notedOt;
      if (tipo !== 'reperibilita' && !hasValue(ov.otHours) && notedOt != null && otCalc != null && notedOt !== otCalc && !ov.ok) {
        issues.push({ code: 'straord', text: `Straordinario: hai segnato +${notedOt}, dall'orario risultano +${otCalc}`, noted: notedOt, calc: otCalc });
      }
      const doppiaDa = num(service.doppiaDa);
      if (tipo === 'reperibilita') {
        otPay = 0;
      } else if (doppiaDa > 0 && otHours >= doppiaDa) {
        tipo = 'doppia';
        base = tariffa * 2;
        otPay = 0;
      } else {
        otPay = otHours * num(service.straordinario);
      }
      if (notedDoppia && tipo !== 'doppia' && !ov.ok) {
        issues.push({ code: 'doppia', text: 'Nelle note c\'è "doppia" ma dall\'orario non risulta' });
      }
    }
  }

  let compenso = base + otPay;
  const compensoManuale = hasValue(ov.compenso);
  if (compensoManuale) compenso = num(ov.compenso);

  // rimborsi: quelli letti dalle note (solo sul primo giorno di un evento su più giorni) + quelli aggiunti a mano
  const rimborsi = [];
  const firstDay = exp.days[0] === date;
  if (firstDay) {
    const fromNotes = parseExpenses(desc);
    fromNotes.forEach((r, i) => {
      const id = `n${i}`;
      const st = (ov.rimborsiStato || {})[id];
      rimborsi.push({ id, desc: r.desc, amount: r.amount, origine: 'nota', incluso: st !== 'no' });
    });
  }
  for (const r of ov.rimborsiManuali || []) {
    rimborsi.push({ id: r.id, desc: r.desc, amount: num(r.amount), origine: 'manuale', incluso: true });
  }
  const rimborsiTot = rimborsi.filter(r => r.incluso).reduce((a, r) => a + r.amount, 0);

  const past = date <= today;
  if (service && past && !compensoManuale && tipo !== 'reperibilita' && service.tipo !== 'fissa') {
    if (times.minutes == null && !hasValue(ov.otHours)) {
      issues.push({ code: 'orario', text: times.partialStart ? `Orario incompleto: c'è solo l'inizio (${hhmm(times.partialStart)})` : 'Orario mancante: non riesco a leggere l\'orario' });
    }
  }
  if (multi && !ov.ok && !hasValue(ov.start)) {
    issues.push({ code: 'multi', text: 'Evento su più giorni: controlla gli orari di ogni giornata' });
  }

  const escluso = !!ov.escludi;
  let status = 'ok';
  if (escluso) status = 'esclusa';
  else if (!past) status = 'prevista';
  else if (issues.length && !ov.ok) status = 'controllare';

  return {
    key, date, eventId: ev.id, title: ev.summary || '', description: desc, colorId: ev.colorId || null,
    serviceId: service?.id || null, serviceName: service?.name || null,
    candidates: m?.candidates?.map(c => c.id) || null,
    how: ov.serviceId ? 'manuale' : (m?.how || null),
    place: placeFromTitle(ev.summary, m?.keywordLen || 0),
    shifts: times.shifts, minutes: times.minutes, partialStart: times.partialStart, source,
    tipo, otCalc, otHours: tipo === 'doppia' ? otHours : otHours, notedOt, base, otPay, compenso, compensoManuale,
    rimborsi, rimborsiTot, totale: escluso ? 0 : compenso + rimborsiTot,
    issues: ov.ok ? [] : issues, info, status, multi, escluso, nota: ov.nota || '',
  };
}

export function shiftsText(t) {
  if (!t) return '';
  if (t.shifts && t.shifts.length) return t.shifts.map(s => `${hhmm(s.start)}–${hhmm(s.end)}`).join(' + ');
  if (t.partialStart) return `${hhmm(t.partialStart)}–?`;
  return '';
}

/**
 * Tutte le giornate di lavoro di un intervallo.
 * events: eventi Google; data: dati dell'app; range: {from:'YYYY-MM-DD', to:'YYYY-MM-DD'} (to escluso)
 */
export function buildDays(events, data, range, today) {
  const services = (data.services || []).filter(s => !s.deleted);
  const ignore = data.settings?.ignora || [];
  const out = [];
  const others = [];
  for (const ev of events) {
    if (ev.status === 'cancelled') continue;
    const exp = expandEvent(ev);
    const m = matchService(ev, services);
    const hasOverride = exp.days.some(d => data.days?.[`${ev.id}|${d}`]?.serviceId);
    const ignored = isIgnoredTitle(ev.summary, ignore) && !hasOverride;
    if ((!m && !hasOverride) || ignored) {
      for (const d of exp.days) if (d >= range.from && d < range.to) others.push({ ev, date: d, ignored });
      continue;
    }
    for (const d of exp.days) {
      if (d < range.from || d >= range.to) continue;
      const ov = data.days?.[`${ev.id}|${d}`];
      out.push(computeDay({ ev, date: d, multi: exp.days.length > 1, services, override: ov && !ov.deleted ? ov : null, today, settings: data.settings }));
    }
  }
  out.sort((a, b) => (a.date + (a.shifts[0] ? hhmm(a.shifts[0].start).padStart(5, '0') : '')).localeCompare(b.date + (b.shifts[0] ? hhmm(b.shifts[0].start).padStart(5, '0') : '')));
  others.sort((a, b) => a.date.localeCompare(b.date));
  return { days: out, others };
}

// ---------- riepiloghi e fatture ----------

export function summarize(days, services, ym, data) {
  const by = new Map();
  for (const d of days) {
    if (!d.date.startsWith(ym) || d.escluso || !d.serviceId) continue;
    if (!by.has(d.serviceId)) by.set(d.serviceId, []);
    by.get(d.serviceId).push(d);
  }
  const iva = hasValue(data?.settings?.iva) ? num(data.settings.iva) : 22;
  const res = [];
  for (const s of services) {
    const list = by.get(s.id);
    if (!list) continue;
    const compensi = round2(list.reduce((a, d) => a + d.compenso, 0));
    const rimborsi = round2(list.reduce((a, d) => a + d.rimborsiTot, 0));
    const ivaImp = round2(compensi * iva / 100);
    const inv = data?.invoices?.[`${ym}|${s.id}`];
    const invoice = inv && !inv.deleted ? inv : null;
    res.push({
      service: s, days: list,
      giornate: list.length,
      ore: list.reduce((a, d) => a + (d.minutes || 0), 0),
      straord: list.reduce((a, d) => a + (d.tipo === 'normale' ? d.otHours : 0), 0),
      doppie: list.filter(d => d.tipo === 'doppia').length,
      reperibilita: list.filter(d => d.tipo === 'reperibilita').length,
      compensi, rimborsi, iva, ivaImp, totale: round2(compensi + ivaImp + rimborsi),
      daControllare: list.filter(d => d.status === 'controllare').length,
      previste: list.filter(d => d.status === 'prevista').length,
      invoice,
      cambiata: invoice?.snapshot ? Math.abs(invoice.snapshot.compensi + invoice.snapshot.rimborsi - compensi - rimborsi) > 0.005 : false,
    });
  }
  return res;
}

export function dayLine(d) {
  const parts = [dateLabel(d.date)];
  if (d.place) parts.push(d.place);
  const orario = d.shifts.length ? d.shifts.map(s => `${hhmm(s.start)}–${hhmm(s.end)}`).join(' + ') : '';
  if (orario) parts.push(orario);
  let comp;
  if (d.compensoManuale) comp = `${eur(d.compenso)} (concordato)`;
  else if (d.tipo === 'doppia') comp = `${eur(d.compenso)} (doppia)`;
  else if (d.tipo === 'reperibilita') comp = `${eur(d.compenso)} (reperibilità)`;
  else if (d.otHours > 0) comp = `${eur(d.base)} + ${d.otHours} ${d.otHours === 1 ? 'ora' : 'ore'} extra (${eur(d.otPay)}) = ${eur(d.compenso)}`;
  else comp = eur(d.compenso);
  parts.push(comp);
  let line = parts.join(' – ');
  const rim = d.rimborsi.filter(r => r.incluso);
  if (rim.length) line += ` + rimborsi: ${rim.map(r => `${r.desc} ${eur(r.amount)}`).join(', ')}`;
  return line;
}

export function invoiceText(sum, ym) {
  const s = sum.service;
  const f = s.fatturazione || {};
  const L = [];
  L.push(`RIEPILOGO PRESTAZIONI – ${monthLabel(ym).toUpperCase()}`);
  L.push('');
  L.push(`Committente: ${f.ragioneSociale || s.name}`);
  if (f.indirizzo) L.push(f.indirizzo);
  const ids = [];
  if (f.piva) ids.push(`P.IVA ${f.piva}`);
  if (f.cf) ids.push(`C.F. ${f.cf}`);
  if (f.sdi) ids.push(`SDI ${f.sdi}`);
  if (ids.length) L.push(ids.join(' – '));
  if (f.email) L.push(`Email: ${f.email}`);
  L.push('');
  for (const d of sum.days) L.push(dayLine(d));
  L.push('');
  const det = [`${sum.giornate} ${sum.giornate === 1 ? 'giornata' : 'giornate'}`];
  if (sum.straord) det.push(`${sum.straord} ${sum.straord === 1 ? 'ora' : 'ore'} di straordinario`);
  if (sum.doppie) det.push(`${sum.doppie} ${sum.doppie === 1 ? 'doppia' : 'doppie'}`);
  if (sum.reperibilita) det.push(`${sum.reperibilita} reperibilità`);
  L.push(det.join(', '));
  L.push(`Compensi: ${eur(sum.compensi)} + IVA ${sum.iva}% (${eur(sum.ivaImp)})`);
  if (sum.rimborsi) L.push(`Rimborsi spese: ${eur(sum.rimborsi)}`);
  L.push(`Totale: ${eur(sum.totale)}`);
  return L.join('\n');
}

export function csvForSummary(sum) {
  const rows = [['Data', 'Luogo', 'Orario', 'Ore', 'Tipo', 'Ore extra', 'Compenso', 'Rimborsi', 'Totale']];
  for (const d of sum.days) {
    rows.push([
      d.date.split('-').reverse().join('/'), d.place,
      d.shifts.map(s => `${hhmm(s.start)}-${hhmm(s.end)}`).join(' + '),
      d.minutes != null ? String(round2(d.minutes / 60)).replace('.', ',') : '',
      d.tipo, d.tipo === 'normale' ? d.otHours : '',
      String(round2(d.compenso)).replace('.', ','), String(round2(d.rimborsiTot)).replace('.', ','),
      String(round2(d.compenso + d.rimborsiTot)).replace('.', ','),
    ]);
  }
  return '﻿' + rows.map(r => r.map(c => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\r\n');
}

// ---------- dati e sincronizzazione ----------

export function emptyData() {
  return {
    schema: 1,
    services: [],
    days: {},
    invoices: {},
    settings: { iva: 22, ignora: ['sost'], migr1: true, trattenutaCoop: 30, updatedAt: 0 },
    coop: null,
  };
}

export function normalizeData(d) {
  const e = emptyData();
  if (!d || typeof d !== 'object') return e;
  return {
    schema: 1,
    services: Array.isArray(d.services) ? d.services : [],
    days: d.days && typeof d.days === 'object' ? d.days : {},
    invoices: d.invoices && typeof d.invoices === 'object' ? d.invoices : {},
    settings: Object.assign(e.settings, d.settings || {}),
    coop: d.coop && typeof d.coop === 'object' ? d.coop : null,
  };
}

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
}

// Unisce i dati di due dispositivi: per ogni elemento vince la modifica più recente.
export function mergeData(local, remote) {
  const L = normalizeData(local), R = normalizeData(remote);
  const out = emptyData();
  const sv = new Map();
  for (const s of L.services) sv.set(s.id, s);
  for (const s of R.services) sv.set(s.id, newer(sv.get(s.id), s));
  out.services = [...sv.values()].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name)));
  for (const k of new Set([...Object.keys(L.days), ...Object.keys(R.days)])) out.days[k] = newer(L.days[k], R.days[k]);
  for (const k of new Set([...Object.keys(L.invoices), ...Object.keys(R.invoices)])) out.invoices[k] = newer(L.invoices[k], R.invoices[k]);
  out.settings = newer(L.settings, R.settings);
  out.coop = newer(L.coop, R.coop) || null;
  return out;
}

export function sameData(a, b) {
  return JSON.stringify(normalizeData(a)) === JSON.stringify(normalizeData(b));
}

// Versioni: "1.2.3" > "1.2.0"
export function isNewerVersion(remote, local) {
  const p = v => String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const a = p(remote), b = p(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

// ---------- incassi, cooperativa, giornate ENPALS ----------

export function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return toISODate(new Date(y, m, 0));
}

export function addMonthsYM(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Mese in cui il cliente paga: fine mese del lavoro + N giorni, sempre all'ultimo giorno del mese. */
export function paymentMonth(workYM, giorni) {
  const months = Math.max(0, Math.round(num(giorni || 30) / 30));
  return addMonthsYM(workYM, months);
}

function compact(s) {
  return norm(s).replace(/[^a-z0-9]/g, '');
}

/** A quale service appartiene un cliente della cooperativa ("ON AIR MULTIMEDIA SRL" -> ONAIR) */
export function serviceForClient(cliente, services) {
  const c = compact(cliente);
  if (!c) return null;
  let best = null, bestLen = 0;
  for (const s of services) {
    if (s.deleted) continue;
    const cands = [...(s.keywords || []), s.name, s.fatturazione?.ragioneSociale, ...(s.clientiCoop || [])];
    for (const k of cands) {
      const kk = compact(k);
      if (kk.length < 3) continue;
      if (c.startsWith(kk) || (kk.length >= 6 && c.includes(kk))) {
        if (kk.length > bestLen) { best = s; bestLen = kk.length; }
      }
    }
  }
  return best;
}

function itNum(s) {
  const t = String(s || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function itDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Righe della pagina "Le mie fatture" di Crew Logic.
 * rows: [{cls, cells:[testo...], eventiHtml}]
 */
export function parseCoopInvoices(rows) {
  const out = [];
  for (const r of rows) {
    const c = r.cells;
    if (!c || c.length < 7) continue;
    const data = itDate(c[3]);
    const numero = String(c[4] || '').trim();
    if (!data || !numero) continue;
    const anno = data.slice(0, 4);
    const eventi = [];
    const re = /([^\[\n]+?)\s*\[(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})([^\]]*)\]/g;
    let m;
    const txt = String(r.eventiText || c[2] || '');
    while ((m = re.exec(txt)) !== null) {
      // l'anno dell'evento: quello della fattura, o il precedente se il mese è dopo quello della fattura
      let y = Number(anno);
      if (Number(m[3]) > Number(data.slice(5, 7)) + 1) y -= 1;
      const da = `${y}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      eventi.push({ nome: m[1].trim(), data: da, note: m[6].trim() });
    }
    eventi.sort((a, b) => a.data.localeCompare(b.data));
    const tipo = /nc/i.test(c[0]) ? 'NC' : 'F';
    out.push({
      numero, data, cliente: String(c[1] || '').trim(), tipo,
      imponibile: itNum(c[5]), netto: itNum(c[6]),
      pagata: /success/.test(r.cls || ''),
      eventi,
      meseLavoro: mostCommonMonth(eventi.map(e => e.data)) || data.slice(0, 7),
    });
  }
  return out;
}

function mostCommonMonth(dates) {
  const cnt = new Map();
  for (const d of dates) cnt.set(d.slice(0, 7), (cnt.get(d.slice(0, 7)) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of cnt) if (v > n || (v === n && k > best)) { best = k; n = v; }
  return best;
}

/** Righe della pagina "I miei eventi": giornate aperte */
export function parseCoopEvents(rows) {
  const out = [];
  for (const r of rows) {
    const c = r.cells;
    if (!c) continue;
    const di = c.findIndex(x => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(x).trim()));
    if (di < 0) continue;
    const data = itDate(c[di]);
    out.push({ data, luogo: String(c[di + 1] || '').trim() });
  }
  out.sort((a, b) => a.data.localeCompare(b.data));
  return out;
}

/** Fattura della cooperativa per un service e un mese di lavoro */
export function coopInvoiceFor(coop, services, serviceId, ym) {
  if (!coop?.fatture) return null;
  const list = coop.fatture.filter(f => f.tipo !== 'NC' && f.meseLavoro === ym && serviceForClient(f.cliente, services)?.id === serviceId);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return {
    ...list[0],
    numero: list.map(f => f.numero).join(' + '),
    imponibile: list.reduce((a, f) => a + (f.imponibile || 0), 0),
    netto: list.every(f => f.netto != null) ? list.reduce((a, f) => a + f.netto, 0) : null,
    pagata: list.every(f => f.pagata),
  };
}

/**
 * Prospetto incassi: per ogni mese di lavoro e service, quanto entra e in che mese.
 * sumsByMonth: { 'YYYY-MM': [summarize(...)] }
 */
export function buildForecast(sumsByMonth, services, data) {
  const trattenuta = hasValue(data?.settings?.trattenutaCoop) ? num(data.settings.trattenutaCoop) : 30;
  const rows = [];
  for (const [ym, sums] of Object.entries(sumsByMonth)) {
    for (const s of sums) {
      const giorni = hasValue(s.service.pagamentoGiorni) ? num(s.service.pagamentoGiorni) : 30;
      const pm = paymentMonth(ym, giorni);
      const inv = coopInvoiceFor(data?.coop, services, s.service.id, ym);
      const stimato = round2(s.compensi * (1 - trattenuta / 100));
      const reale = inv && inv.netto != null ? round2(inv.netto) : null;
      rows.push({
        ym, service: s.service, giorni, pagamento: pm, scadenza: lastDayOfMonth(pm),
        compensi: s.compensi, rimborsi: s.rimborsi,
        netto: reale ?? stimato, nettoReale: reale != null, nettoStimato: stimato,
        // se il netto è quello vero della cooperativa, i rimborsi sono già dentro
        rimborsiSeparati: reale != null ? 0 : s.rimborsi,
        previste: s.previste, giornate: s.giornate,
        coop: inv,
      });
    }
  }
  const byPay = new Map();
  for (const r of rows) {
    if (!byPay.has(r.pagamento)) byPay.set(r.pagamento, []);
    byPay.get(r.pagamento).push(r);
  }
  return [...byPay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([pm, list]) => ({
    mese: pm,
    righe: list.sort((a, b) => a.ym.localeCompare(b.ym) || String(a.service.name).localeCompare(String(b.service.name))),
    netto: round2(list.reduce((a, r) => a + r.netto, 0)),
    rimborsi: round2(list.reduce((a, r) => a + r.rimborsiSeparati, 0)),
    pagato: list.every(r => r.coop?.pagata),
  }));
}

/** Stato di ogni fattura della cooperativa rispetto alla scadenza */
export function paymentsStatus(coop, services, today) {
  return (coop?.fatture || []).map(f => {
    const s = serviceForClient(f.cliente, services);
    const giorni = s && hasValue(s.pagamentoGiorni) ? num(s.pagamentoGiorni) : 30;
    const scadenza = lastDayOfMonth(paymentMonth(f.meseLavoro, giorni));
    const ritardo = !f.pagata && today > scadenza ? Math.round((new Date(today + 'T12:00:00') - new Date(scadenza + 'T12:00:00')) / 86400000) : 0;
    return { ...f, service: s, giorni, scadenza, ritardo, stato: f.pagata ? 'pagata' : ritardo > 0 ? 'scaduta' : 'attesa' };
  }).sort((a, b) => b.data.localeCompare(a.data) || String(b.numero).localeCompare(String(a.numero)));
}

/** Confronto giornate di lavoro (calendario) e giornate aperte dalla cooperativa */
export function enpalsCompare(workDays, coopEvents, fromDate) {
  const opened = new Map();
  for (const e of coopEvents || []) if (e.data >= fromDate) opened.set(e.data, e);
  const work = new Map();
  for (const d of workDays) if (!d.escluso && d.date >= fromDate && !work.has(d.date)) work.set(d.date, d);
  const mancanti = [...work.values()].filter(d => !opened.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const inPiu = [...opened.values()].filter(e => !work.has(e.data));
  const ok = [...work.values()].filter(d => opened.has(d.date)).length;
  return { mancanti, inPiu, ok, lavorate: work.size, aperte: opened.size };
}
