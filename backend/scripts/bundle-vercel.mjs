// On Vercel only: bundles dist/app.js with all its packages into one file. Vercel's backend builder places
// the compiled app and node_modules in different folders of the function, so the app must not rely on
// finding packages next to it. The office-server build (no VERCEL variable) is left as compiled by tsc.
import { build } from 'esbuild';

if (!process.env.VERCEL) process.exit(0);

await build({
  entryPoints: ['dist/app.js'],
  outfile: 'dist/app.js',
  allowOverwrite: true,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // pg's optional native driver is never installed
  external: ['pg-native'],
  // Bundled CommonJS packages (express, pg) call require() for Node built-ins
  banner: { js: "import { createRequire as __wdCreateRequire } from 'node:module'; const require = __wdCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log('bundled dist/app.js for Vercel');
