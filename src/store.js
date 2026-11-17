// Dati dell'app: copia locale (funziona offline) + copia su Google Drive (cartella nascosta dell'app),
// e lettura degli eventi da Google Calendar.
import { http, getToken } from './platform.js';
import { mergeData, normalizeData, sameData, emptyData, uid } from './core.js';
import { CONFIG } from './config.js';

const LS = {
  data: 'gf.data',
  meta: 'gf.meta',
  events: ym => `gf.events.${ym}`,
};
const DRIVE_FILE = 'giornate-fonico-dati.json';

function lsGet(k, def) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* spazio pieno */ }
}

export const store = {
  data: normalizeData(lsGet(LS.data, emptyData())),
  meta: lsGet(LS.meta, { email: '', lastDataSync: 0, dirty: false, driveFileId: null, lastEventsSync: {} }),
  listeners: new Set(),
  syncing: false,
  lastError: null,
};

export function onChange(fn) { store.listeners.add(fn); }
function emit() { for (const fn of store.listeners) fn(); }

function saveLocal() {
  lsSet(LS.data, store.data);
  lsSet(LS.meta, store.meta);
}

export function setMeta(patch) {
  Object.assign(store.meta, patch);
  saveLocal();
  emit();
}

// ---------- richieste Google con token ----------

async function gapi(req, retry = true) {
  const token = await getToken();
  const r = await http({ ...req, headers: { ...(req.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retry) {
    await getToken(true);
    return gapi(req, false);
  }
  if (r.status >= 400) {
    const msg = r.json?.error?.message || r.text?.slice(0, 200) || `errore ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r;
}

// ---------- calendario ----------

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = new Date(y, m - 1, 1, 0, 0, 0);
  const to = new Date(y, m, 1, 0, 0, 0);
  return { from, to };
}

export async function fetchMonthEvents(ym) {
  const { from, to } = monthRange(ym);
  const items = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
      timeMin: from.toISOString(), timeMax: to.toISOString(),
      fields: 'items(id,summary,description,colorId,start,end,status,updated),nextPageToken',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gapi({ url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}` });
    items.push(...(r.json?.items || []));
    pageToken = r.json?.nextPageToken;
    if (!pageToken) break;
  }
  lsSet(LS.events(ym), { at: Date.now(), items });
  store.meta.lastEventsSync[ym] = Date.now();
  saveLocal();
  return items;
}

export function cachedMonthEvents(ym) {
  return lsGet(LS.events(ym), null);
}

// ---------- Drive ----------

async function findDriveFile() {
  if (store.meta.driveFileId) return store.meta.driveFileId;
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name='${DRIVE_FILE}'`, fields: 'files(id,modifiedTime)', pageSize: '10' });
  const r = await gapi({ url: `https://www.googleapis.com/drive/v3/files?${q}` });
  const f = r.json?.files?.[0];
  if (f) { store.meta.driveFileId = f.id; saveLocal(); return f.id; }
  return null;
}

async function readDrive() {
  const id = await findDriveFile();
  if (!id) return null;
  try {
    const r = await gapi({ url: `https://www.googleapis.com/drive/v3/files/${id}?alt=media` });
    return r.json || (r.text ? JSON.parse(r.text) : null);
  } catch (e) {
    if (e.status === 404) { store.meta.driveFileId = null; saveLocal(); return null; }
    throw e;
  }
}

async function writeDrive(data) {
  let id = await findDriveFile();
  if (!id) {
    const r = await gapi({
      url: 'https://www.googleapis.com/drive/v3/files?fields=id', method: 'POST',
      json: { name: DRIVE_FILE, parents: ['appDataFolder'], mimeType: 'text/plain' },
    });
    id = r.json.id;
    store.meta.driveFileId = id;
  }
  await gapi({
    url: `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, method: 'PATCH',
    headers: { 'Content-Type': 'text/plain' }, text: JSON.stringify(data),
  });
}

/** Scarica i dati da Drive, li unisce ai locali e ricarica il risultato se serve. */
export async function syncData() {
  if (store.syncing) return;
  store.syncing = true;
  emit();
  try {
    const remote = await readDrive();
    const merged = remote ? mergeData(store.data, remote) : normalizeData(store.data);
    const needsUpload = !remote || !sameData(merged, remote);
    store.data = merged;
    if (needsUpload) await writeDrive(merged);
    store.meta.dirty = false;
    store.meta.lastDataSync = Date.now();
    store.lastError = null;
    saveLocal();
  } catch (e) {
    store.lastError = e;
    throw e;
  } finally {
    store.syncing = false;
    emit();
  }
}

let syncTimer = null;
function scheduleSync() {
  store.meta.dirty = true;
  saveLocal();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncData().catch(() => { /* resta "da sincronizzare" */ }); }, 1500);
}

// ---------- modifiche ----------

export function updateDay(key, patch) {
  const old = store.data.days[key] && !store.data.days[key].deleted ? store.data.days[key] : {};
  const next = { ...old, ...patch, updatedAt: Date.now() };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === null) delete next[k];
  next.updatedAt = Date.now();
  store.data.days[key] = next;
  saveLocal(); emit(); scheduleSync();
}

export function resetDay(key) {
  store.data.days[key] = { deleted: true, updatedAt: Date.now() };
  saveLocal(); emit(); scheduleSync();
}

export function saveService(s) {
  const list = store.data.services;
  const rec = { ...s, id: s.id || uid(), updatedAt: Date.now() };
  const i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push({ ...rec, order: list.length + 1 });
  saveLocal(); emit(); scheduleSync();
  return rec;
}

export function deleteService(id) {
  const s = store.data.services.find(x => x.id === id);
  if (s) { s.deleted = true; s.updatedAt = Date.now(); }
  saveLocal(); emit(); scheduleSync();
}

export function setInvoice(key, rec) {
  store.data.invoices[key] = rec ? { ...rec, updatedAt: Date.now() } : { deleted: true, updatedAt: Date.now() };
  saveLocal(); emit(); scheduleSync();
}

export function setSettings(patch) {
  store.data.settings = { ...store.data.settings, ...patch, updatedAt: Date.now() };
  saveLocal(); emit(); scheduleSync();
}

/** Importa un file: elenco service iniziali o backup completo. Restituisce un testo per l'utente. */
export function importFile(obj) {
  if (obj && obj.tipoFile === 'giornate-fonico-servizi' && Array.isArray(obj.services)) {
    const now = Date.now();
    let n = 0;
    for (const s of obj.services) {
      const i = store.data.services.findIndex(x => x.id === s.id);
      const rec = { ...s, updatedAt: now };
      if (i >= 0) store.data.services[i] = rec; else store.data.services.push(rec);
      n++;
    }
    saveLocal(); emit(); scheduleSync();
    return `Importati ${n} service`;
  }
  if (obj && obj.schema === 1 && Array.isArray(obj.services)) {
    store.data = mergeData(store.data, obj);
    saveLocal(); emit(); scheduleSync();
    return 'Backup importato e unito ai dati attuali';
  }
  throw new Error('File non riconosciuto');
}

export function exportBackup() {
  return JSON.stringify({ ...store.data, esportatoIl: new Date().toISOString() }, null, 1);
}

export function clearLocal() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('gf.')) localStorage.removeItem(k);
  } catch { /* niente */ }
  store.data = emptyData();
  store.meta = { email: '', lastDataSync: 0, dirty: false, driveFileId: null, lastEventsSync: {} };
  emit();
}

// ---------- aggiornamenti dell'app ----------

export async function checkUpdate() {
  const r = await http({ url: `https://api.github.com/repos/${CONFIG.githubRepo}/releases/latest`, headers: { Accept: 'application/vnd.github+json' } });
  if (r.status !== 200 || !r.json) return null;
  const assets = r.json.assets || [];
  return {
    version: String(r.json.tag_name || '').replace(/^v/, ''),
    notes: r.json.body || '',
    page: r.json.html_url,
    apk: assets.find(a => /\.apk$/i.test(a.name))?.browser_download_url,
    exe: assets.find(a => /\.exe$/i.test(a.name))?.browser_download_url,
  };
}
