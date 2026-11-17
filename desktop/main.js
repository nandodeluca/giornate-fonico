// App Windows: finestra + accesso Google con il browser predefinito (anche DuckDuckGo).
const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const GOOGLE = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'google.json'), 'utf8')); } catch { return {}; }
})();
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');
const AUTH_FILE = () => path.join(app.getPath('userData'), 'accesso.bin');

let win = null;
let access = null; // {token, exp}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function saveRefresh(obj) {
  const raw = JSON.stringify(obj);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(raw) : Buffer.from(raw, 'utf8');
  fs.writeFileSync(AUTH_FILE(), data);
}
function loadRefresh() {
  try {
    const data = fs.readFileSync(AUTH_FILE());
    const raw = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: GOOGLE.clientId, client_secret: GOOGLE.clientSecret, ...params }).toString();
  const r = await net.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || `errore ${r.status}`);
    e.code = j.error;
    throw e;
  }
  return j;
}

function emailFromIdToken(idt) {
  try { return JSON.parse(Buffer.from(idt.split('.')[1], 'base64').toString('utf8')).email || ''; } catch { return ''; }
}

function signIn() {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const done = (ok, msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Giornate Fonico</title><body style="font-family:system-ui;text-align:center;padding:60px">
          <h2>${ok ? 'Accesso fatto ✓' : 'Accesso non riuscito'}</h2><p>${msg}</p></body>`);
        server.close();
        if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
      };
      if (u.searchParams.get('state') !== state) { done(false, 'Richiesta non valida.'); return reject(new Error('stato non valido')); }
      const err = u.searchParams.get('error');
      if (err) { done(false, 'Hai annullato o Google ha rifiutato.'); return reject(new Error(err)); }
      try {
        const port = server.address().port;
        const j = await tokenRequest({
          code: u.searchParams.get('code'), grant_type: 'authorization_code',
          redirect_uri: `http://127.0.0.1:${port}`, code_verifier: verifier,
        });
        const email = emailFromIdToken(j.id_token);
        const prev = loadRefresh() || {};
        saveRefresh({ refresh_token: j.refresh_token || prev.refresh_token, email });
        access = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
        done(true, 'Puoi chiudere questa scheda e tornare all\'app.');
        resolve({ accessToken: j.access_token, expiresIn: j.expires_in, email });
      } catch (e) {
        done(false, e.message);
        reject(e);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const q = new URLSearchParams({
        client_id: GOOGLE.clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code',
        scope: SCOPES, code_challenge: challenge, code_challenge_method: 'S256',
        access_type: 'offline', prompt: 'consent', state,
      });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
    });
    setTimeout(() => { try { server.close(); } catch { /* chiuso */ } reject(new Error('Tempo scaduto: riprova')); }, 5 * 60 * 1000);
  });
}

async function getToken() {
  if (access && access.exp > Date.now()) return { accessToken: access.token, expiresIn: Math.round((access.exp - Date.now()) / 1000) + 120 };
  const saved = loadRefresh();
  if (!saved?.refresh_token) return null;
  try {
    const j = await tokenRequest({ refresh_token: saved.refresh_token, grant_type: 'refresh_token' });
    access = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
    return { accessToken: j.access_token, expiresIn: j.expires_in };
  } catch (e) {
    if (e.code === 'invalid_grant') { try { fs.unlinkSync(AUTH_FILE()); } catch { /* già tolto */ } return null; }
    throw e;
  }
}

ipcMain.on('configured', e => { e.returnValue = !!(GOOGLE.clientId && GOOGLE.clientSecret); });
ipcMain.handle('signIn', () => signIn());
ipcMain.handle('getToken', () => getToken());
ipcMain.handle('signOut', () => { access = null; try { fs.unlinkSync(AUTH_FILE()); } catch { /* già tolto */ } return true; });
ipcMain.handle('openExternal', (_e, url) => {
  if (/^https:\/\//.test(url)) return shell.openExternal(url);
  return false;
});
ipcMain.handle('http', async (_e, req) => {
  const allowed = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|api\.github\.com)\//i;
  if (!allowed.test(req.url)) throw new Error('indirizzo non permesso');
  const r = await net.fetch(req.url, { method: req.method || 'GET', headers: req.headers || {}, body: req.body });
  return { status: r.status, text: await r.text() };
});
ipcMain.handle('saveFile', async (_e, name, content) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name) });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, content, 'utf8');
  return true;
});

function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 820, minWidth: 380, minHeight: 500,
    title: 'Giornate Fonico', backgroundColor: '#f4f2ee', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
