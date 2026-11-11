import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build.mjs';

const root = process.env.GALLERY_PREVIEW_ROOT ? path.resolve(process.env.GALLERY_PREVIEW_ROOT) : fileURLToPath(new URL('../', import.meta.url));
const { output } = await buildSite(root);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const filename = path.resolve(output, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
    const data = await readFile(filename);
    response.writeHead(200, { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404).end('Archivo no encontrado'); }
});
server.on('error', error => { console.error(`No se pudo abrir la vista local: ${error.message}`); process.exitCode = 1; });
server.listen(4173, '127.0.0.1', () => console.log('Galerías listas en http://127.0.0.1:4173 · Ctrl+C para cerrar.'));
