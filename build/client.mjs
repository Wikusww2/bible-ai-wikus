import { build } from 'esbuild';
await build({entryPoints:['build/client-entry.js'],bundle:true,minify:true,format:'iife',outfile:'js/vendor.js',legalComments:'eof'});
