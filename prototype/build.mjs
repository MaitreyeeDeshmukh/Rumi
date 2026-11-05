import { build } from 'esbuild';
import fs from 'fs';

const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const r = await build({ entryPoints: ['src/app.tsx'], bundle: true, format: 'iife', write: false, minify: true, target: 'es2019', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', loader: { '.tsx': 'tsx' }, logLevel: 'warning' });
const js = safe(r.outputFiles[0].text);
// React is inlined from node_modules so the page works offline and under a strict CSP (no CDN).
const react = safe(fs.readFileSync('node_modules/react/umd/react.production.min.js', 'utf8'));
const reactDom = safe(fs.readFileSync('node_modules/react-dom/umd/react-dom.production.min.js', 'utf8'));
const tpl = fs.readFileSync('src/template.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', tpl
  .replace('/*__REACT__*/', () => react)
  .replace('/*__REACTDOM__*/', () => reactDom)
  .replace('/*__APP__*/', () => js));
console.log('built', (fs.statSync('dist/index.html').size / 1024).toFixed(1) + 'KB');
