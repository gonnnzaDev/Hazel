// Compila el cliente a dist/ con esbuild.
//
//   dist/main.js            proceso principal
//   dist/preload.js         puente entre la ventana y el proceso principal
//   dist/renderer/          la ventana: index.html, styles.css, app.js y fonts/
//
// esbuild solo traduce TypeScript a JavaScript, no revisa tipos: para eso está
// `npm run typecheck`. Separarlos hace que compilar tarde milisegundos.

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const common = { bundle: true, sourcemap: true, logLevel: 'warning' };

// Node dentro de Electron: CommonJS, con `electron` provisto por el runtime.
const node = { ...common, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] };

// Las tipografías van dentro de la app: así se ve igual sin internet.
const FONTS = [
  ['@fontsource/jetbrains-mono', 'jetbrains-mono', [400, 500, 700]],
  ['@fontsource/inter', 'inter', [400, 500, 600, 700]],
];

await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer/fonts', { recursive: true });

await Promise.all([
  build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' }),
  build({ ...node, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js' }),
  // Un solo archivo clásico (IIFE): la ventana se carga desde file:// y así
  // no depende de que el navegador permita módulos ES desde ahí.
  build({
    ...common,
    entryPoints: ['src/renderer/main.tsx'],
    outfile: 'dist/renderer/app.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minifySyntax: true,
  }),
  cp('src/renderer/index.html', 'dist/renderer/index.html'),
  cp('src/renderer/styles.css', 'dist/renderer/styles.css'),
  ...FONTS.flatMap(([pkg, name, weights]) =>
    weights.map((weight) =>
      cp(
        `node_modules/${pkg}/files/${name}-latin-${weight}-normal.woff2`,
        `dist/renderer/fonts/${name}-${weight}.woff2`,
      ),
    ),
  ),
]);

console.log('Compilado en dist/');
