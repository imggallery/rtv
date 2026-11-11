import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, unlink, rm, rmdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildSite } from '../scripts/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, '.cache');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="green"/></svg>';
async function fixture(t) {
  await mkdir(cache, { recursive: true });
  const folder = await mkdtemp(path.join(cache, 'test-'));
  t.after(async () => {
    const target = path.resolve(folder);
    if (path.dirname(target) !== cache || !path.basename(target).startsWith('test-')) throw new Error('Ruta temporal no válida');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  for (const file of ['index.html', 'styles.css', 'app.js']) await copyFile(path.join(root, file), path.join(folder, file));
  await mkdir(path.join(folder, 'img'));
  return folder;
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));

test('una instalación vacía muestra General y no contiene el listado antiguo', async t => {
  const folder = await fixture(t);
  const { output, galleries } = await buildSite(folder);
  assert.equal(galleries.length, 1);
  assert.equal(galleries[0].name, 'General');
  assert.equal(galleries[0].count, 0);
  assert.equal((await json(path.join(output, 'galleries.json'))).pageSize, 24);
  await assert.rejects(access(path.join(output, 'images.json')), { code: 'ENOENT' });
});

test('carpetas, configuración opcional, nombres especiales, imágenes anidadas y miniaturas reales', async t => {
  const folder = await fixture(t);
  await mkdir(path.join(folder, 'img', 'Eurovisión 2026', 'Ensayos'), { recursive: true });
  await mkdir(path.join(folder, 'img', 'Sin configurar'));
  await writeFile(path.join(folder, 'img', 'Eurovisión 2026', 'gallery.json'), JSON.stringify({ name: 'Festival · Viena', description: 'Primeros ensayos', order: 1 }));
  await writeFile(path.join(folder, 'img', 'Eurovisión 2026', 'Ensayos', 'Foto #á.SVG'), svg);
  await writeFile(path.join(folder, 'img', 'Sin configurar', 'Foto #á.SVG'), svg);
  await writeFile(path.join(folder, 'img', '.oculta.svg'), svg);
  await writeFile(path.join(folder, 'img', 'ignorar.txt'), 'texto');
  await writeFile(path.join(folder, 'img', 'existente.svg'), svg);
  const { galleries, output, total } = await buildSite(folder);
  assert.equal(total, 3);
  assert.equal(galleries[0].name, 'Festival · Viena');
  assert.equal(galleries[0].description, 'Primeros ensayos');
  assert.equal(galleries.find(g => g.id === 'Sin configurar').name, 'Sin configurar');
  assert.equal(galleries.find(g => g.id === '.').count, 1);
  const image = (await json(path.join(output, galleries[0].manifest))).images[0];
  assert.equal(image.url, 'img/Eurovisi%C3%B3n%202026/Ensayos/Foto%20%23%C3%A1.SVG');
  assert.equal(await readFile(path.join(output, decodeURIComponent(image.url)), 'utf8'), svg);
  const metadata = await sharp(path.join(output, image.thumbnail)).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(metadata.width <= 480 && metadata.height <= 360);
  assert.equal((await readdir(path.join(output, 'thumbnails'))).length, 3);
});

test('al borrar una galería desaparecen sus miniaturas, originales publicados y listados antiguos', async t => {
  const folder = await fixture(t);
  const collection = path.join(folder, 'img', 'Borrar');
  await mkdir(collection);
  await writeFile(path.join(collection, 'foto.svg'), svg);
  await writeFile(path.join(folder, 'img', 'conservar.svg'), svg);
  const before = await buildSite(folder);
  const oldGallery = before.galleries.find(g => g.id === 'Borrar');
  const oldImage = (await json(path.join(before.output, oldGallery.manifest))).images[0];
  await unlink(path.join(collection, 'foto.svg'));
  await rmdir(collection);
  const after = await buildSite(folder);
  assert.equal(after.total, 1);
  for (const file of [oldGallery.manifest, oldImage.url, oldImage.thumbnail]) await assert.rejects(access(path.join(after.output, file)), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(folder, 'img', 'conservar.svg'), 'utf8'), svg);
});

test('rechaza configuraciones inválidas sin borrar la publicación anterior', async t => {
  const folder = await fixture(t);
  const { output } = await buildSite(folder);
  for (const config of ['{', '{"name": ""}', '{"order": "primero"}', '{"nombre": "Error"}']) {
    await writeFile(path.join(folder, 'img', 'gallery.json'), config);
    await assert.rejects(buildSite(folder), /gallery.json/);
    await access(path.join(output, 'galleries.json'));
  }
});

test('una imagen dañada señala el archivo que impide publicar', async t => {
  const folder = await fixture(t);
  await writeFile(path.join(folder, 'img', 'rota.jpg'), 'no es una imagen');
  await assert.rejects(buildSite(folder), /miniatura de img\/rota.jpg/);
});
