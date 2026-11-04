import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/app.tsx'], bundle: true, format: 'iife', write: false, minify: true, target: 'es2019', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', loader: { '.tsx': 'tsx' }, logLevel: 'warning' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/template.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', tpl.replace('/*__APP__*/', () => js));
console.log('built', (fs.statSync('dist/index.html').size/1024).toFixed(1)+'KB');
