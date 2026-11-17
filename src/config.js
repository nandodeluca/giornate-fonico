// Identificativi pubblici dell'app su Google Cloud (non sono segreti).
// Si compilano dopo aver creato il progetto Google Cloud.
export const CONFIG = {
  googleWebClientId: typeof __GOOGLE_WEB_CLIENT_ID__ !== 'undefined' ? __GOOGLE_WEB_CLIENT_ID__ : '',
  githubRepo: 'nandodeluca/giornate-fonico',
};

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
];
