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
  // Vercel's Node.js runtime loads the handler with require(), as CommonJS
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // pg's optional native driver is never installed
  external: ['pg-native'],
  // The app finds its own folder with import.meta.url, which CommonJS does not have
  define: { 'import.meta.url': '__wdImportMetaUrl' },
  banner: { js: "const __wdImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  // require() returns the Express app itself (with .default and .createApp still available)
  footer: { js: 'if (module.exports && module.exports.default) module.exports = Object.assign(module.exports.default, module.exports);' },
  logLevel: 'warning',
});
console.log('bundled dist/app.js for Vercel');
