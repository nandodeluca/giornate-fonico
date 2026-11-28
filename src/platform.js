// Tutto ciò che cambia tra Windows (Electron) e Android (Capacitor):
// accesso a Google, richieste di rete, condivisione, apertura di link e file.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { CONFIG, SCOPES } from './config.js';

const desktop = typeof window !== 'undefined' ? window.desktop : null;
export const PLATFORM = desktop ? 'windows' : (Capacitor.isNativePlatform() ? 'android' : 'web');

// ---------- rete ----------

/** req: {url, method, headers, json, text}. Restituisce {status, text, json} */
export async function http(req) {
  const method = req.method || 'GET';
  const headers = { ...(req.headers || {}) };
  if (PLATFORM === 'windows') {
    const body = req.json !== undefined ? JSON.stringify(req.json) : req.text;
    if (req.json !== undefined) headers['Content-Type'] = 'application/json';
    const r = await desktop.http({ url: req.url, method, headers, body });
    return withJson(r.status, r.text);
  }
  if (PLATFORM === 'android') {
    const opts = { url: req.url, method, headers, responseType: 'text' };
    if (req.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.data = req.json; }
    else if (req.text !== undefined) { opts.data = req.text; }
    const r = await CapacitorHttp.request(opts);
    const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    return withJson(r.status, text);
  }
  const r = await fetch(req.url, {
    method, headers: req.json !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: req.json !== undefined ? JSON.stringify(req.json) : req.text,
  });
  return withJson(r.status, await r.text());
}

function withJson(status, text) {
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status, text, json };
}

// ---------- accesso a Google ----------

let androidReady = null;
let tokenCache = null; // {token, exp}

async function androidInit() {
  if (!androidReady) {
    androidReady = SocialLogin.initialize({ google: { webClientId: CONFIG.googleWebClientId, mode: 'online' } });
  }
  return androidReady;
}

export function isConfigured() {
  if (PLATFORM === 'windows') return !!desktop.configured;
  if (PLATFORM === 'android') return !!CONFIG.googleWebClientId;
  return true;
}

/** Accesso interattivo. Restituisce {email} */
export async function signIn() {
  if (PLATFORM === 'windows') {
    const r = await desktop.signIn();
    tokenCache = { token: r.accessToken, exp: Date.now() + (r.expiresIn - 120) * 1000 };
    return { email: r.email };
  }
  if (PLATFORM === 'android') {
    await androidInit();
    const r = await SocialLogin.login({ provider: 'google', options: { scopes: SCOPES } });
    const res = r.result || {};
    const token = res.accessToken?.token;
    if (!token) throw new Error('Google non ha concesso l\'accesso al calendario');
    tokenCache = { token, exp: Date.now() + 50 * 60 * 1000 };
    return { email: res.profile?.email || '' };
  }
  const token = window.prompt('Modalità prova nel browser: incolla un token di accesso Google');
  if (!token) throw new Error('annullato');
  tokenCache = { token, exp: Date.now() + 50 * 60 * 1000 };
  return { email: 'prova' };
}

/** Token valido, rinnovato in silenzio se serve. Lancia 'login_required' se bisogna rifare l'accesso. */
export async function getToken(force = false) {
  if (!force && tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  if (PLATFORM === 'windows') {
    const r = await desktop.getToken();
    if (!r) throw new Error('login_required');
    tokenCache = { token: r.accessToken, exp: Date.now() + (r.expiresIn - 120) * 1000 };
    return tokenCache.token;
  }
  if (PLATFORM === 'android') {
    await androidInit();
    try {
      const r = await SocialLogin.getAuthorizationCode({ provider: 'google' });
      if (r?.accessToken) {
        tokenCache = { token: r.accessToken, exp: Date.now() + 50 * 60 * 1000 };
        return tokenCache.token;
      }
    } catch { /* passa al nuovo accesso */ }
    try {
      const r = await SocialLogin.login({ provider: 'google', options: { scopes: SCOPES } });
      const token = r.result?.accessToken?.token;
      if (token) {
        tokenCache = { token, exp: Date.now() + 50 * 60 * 1000 };
        return token;
      }
    } catch { /* sotto */ }
    throw new Error('login_required');
  }
  if (tokenCache) return tokenCache.token;
  throw new Error('login_required');
}

export async function signOut() {
  tokenCache = null;
  if (PLATFORM === 'windows') return desktop.signOut();
  if (PLATFORM === 'android') {
    await androidInit();
    try { await SocialLogin.logout({ provider: 'google' }); } catch { /* già uscito */ }
  }
}

// ---------- condivisione, link, file ----------

export async function copyText(text) {
  if (PLATFORM === 'android') { await Clipboard.write({ string: text }); return; }
  await navigator.clipboard.writeText(text);
}

export async function shareText(title, text) {
  if (PLATFORM === 'android') { await Share.share({ title, text, dialogTitle: title }); return 'shared'; }
  await copyText(text);
  return 'copied';
}

export async function openExternal(url) {
  if (PLATFORM === 'windows') return desktop.openExternal(url);
  if (PLATFORM === 'android') return Browser.open({ url });
  window.open(url, '_blank');
}

/** Salva un file di testo: su Windows chiede dove, su Android lo condivide (Drive, email, Download...) */
export async function saveTextFile(filename, content) {
  if (PLATFORM === 'windows') return desktop.saveFile(filename, content);
  if (PLATFORM === 'android') {
    const w = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [w.uri], dialogTitle: filename });
    return true;
  }
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  return true;
}

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

// ---------- cooperativa (solo Windows) ----------
export const coop = PLATFORM === 'windows' ? {
  status: () => desktop.coopStatus(),
  save: (user, pass) => desktop.coopSave(user, pass),
  forget: () => desktop.coopForget(),
  fetchPage: (which, da, a) => desktop.coopFetch(which, da, a),
} : null;
