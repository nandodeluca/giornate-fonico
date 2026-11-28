# Cachet

App per Windows e Android che legge le giornate di lavoro dal calendario Google
(colori e titoli di One Calendar), calcola compensi, straordinari, doppie e rimborsi
secondo le regole di ogni service e prepara il riepilogo mensile per la fattura.

## Come funziona

- **Il calendario resta la fonte.** Si continua a segnare il lavoro su One Calendar:
  titolo che inizia con il nome del service (es. `Congress Magna Pars`), colore del
  service, orario nella descrizione (es. `7:30 - 19:30`) o nel titolo.
- **Regole per service:** compenso a giornata, ore incluse (pausa compresa),
  straordinario per ogni ora iniziata, doppia dalla N-esima ora extra, giornata fissa.
- **Da controllare:** l'app segnala orari mancanti, eventi su più giorni, note
  "+N ore extra" diverse dal calcolo, reperibilità ("DISP") senza cifra.
- **Fatture:** riepilogo da copiare o condividere, tabella CSV, stato
  *da chiedere → emessa → pagata* e totale da incassare.

## Dati e privacy

- Il calendario viene letto in **sola lettura**.
- Service, tariffe, correzioni e stato fatture sono salvati nella **cartella
  nascosta dell'app sul Google Drive dell'utente** (non visibile in Drive, non
  condivisa) e in una copia locale per l'uso offline.
- In questo repository c'è solo il codice: **nessun dato** di clienti, tariffe o giornate.

## Installare e aggiornare

Le versioni sono nella pagina **Releases** del repository:

- **Android:** scarica `Cachet-x.y.z.apk` dal telefono e aprilo.
- **Windows:** scarica `Cachet-Setup-x.y.z.exe` e avvialo
  (se compare "Windows ha protetto il PC": *Ulteriori informazioni* → *Esegui comunque*).

All'apertura l'app avvisa quando c'è una versione nuova.

## Sviluppo

```
npm install
npm test          # prova i calcoli
npm run build     # crea www/
```

- `src/core.js` – lettura orari, regole, calcoli (con test in `test/`)
- `src/app.js` – interfaccia
- `src/store.js` – Google Calendar, Google Drive, sincronizzazione
- `desktop/` – app Windows (Electron)
- `android/` – app Android (Capacitor)
- `.github/workflows/build.yml` – crea `.apk` ed `.exe` a ogni versione (`git tag vX.Y.Z`)
