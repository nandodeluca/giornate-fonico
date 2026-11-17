// Crea la cartella www/ (usata sia da Android sia da Windows) partendo da src/.
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const version = process.env.APP_VERSION || pkg.version;
const webClientId = process.env.GOOGLE_WEB_CLIENT_ID || '';

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome90'],
  outfile: 'www/app.js',
  minify: true,
  sourcemap: false,
  define: {
    __APP_VERSION__: JSON.stringify(version),
    ...(webClientId ? { __GOOGLE_WEB_CLIENT_ID__: JSON.stringify(webClientId) } : {}),
  },
  logLevel: 'info',
});
copyFileSync('src/index.html', 'www/index.html');
copyFileSync('src/styles.css', 'www/styles.css');
console.log(`www/ pronta (versione ${version})`);
