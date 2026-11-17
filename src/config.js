// Identificativi pubblici dell'app su Google Cloud (non sono segreti).
// Si compilano dopo aver creato il progetto Google Cloud.
export const CONFIG = {
  googleWebClientId: typeof __GOOGLE_WEB_CLIENT_ID__ !== 'undefined' ? __GOOGLE_WEB_CLIENT_ID__ : '385440617914-r7huorh53k57lrkvfi7jimvbbfc0d1f4.apps.googleusercontent.com',
  githubRepo: 'nandodeluca/giornate-fonico',
};

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
];
