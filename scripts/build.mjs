import { readdir, mkdir, copyFile, writeFile, readFile, appendFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Release image files between builds, including on Windows.
sharp.cache(false);

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const supported = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']);
const urlFor = (...parts) => parts.flatMap(part => part.split(path.sep)).map(encodeURIComponent).join('/');
const keyFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

async function configuration(folder, fallbackName) {
  const filename = path.join(folder, 'gallery.json');
  let config;
  try { config = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { name: fallbackName, description: '', order: 1000 };
    throw new Error(`No se puede leer ${filename}: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`Configuración no válida: ${filename}`);
  for (const field of Object.keys(config)) {
    if (!['name', 'description', 'order'].includes(field)) throw new Error(`Campo desconocido «${field}» en ${filename}. Usa name, description u order.`);
  }
  if (config.name !== undefined && (typeof config.name !== 'string' || !config.name.trim())) throw new Error(`«name» debe ser un texto no vacío: ${filename}`);
  if (config.description !== undefined && typeof config.description !== 'string') throw new Error(`«description» debe ser un texto: ${filename}`);
  if (config.order !== undefined && (typeof config.order !== 'number' || !Number.isFinite(config.order))) throw new Error(`«order» debe ser un número: ${filename}`);
  return { name: config.name?.trim() ?? fallbackName, description: config.description ?? '', order: config.order ?? 1000 };
}

export async function buildSite(root = projectRoot) {
  root = path.resolve(root);
  const source = path.join(root, 'img');
  const output = path.resolve(root, 'dist');
  await mkdir(source, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  const folders = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  const collections = [];

  async function collect(relative, recursive) {
    const files = [];
    for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(relative, entry.name);
      if (recursive && entry.isDirectory()) files.push(...await collect(file, true));
      if (entry.isFile() && supported.has(path.extname(entry.name).slice(1).toLowerCase())) files.push(file);
    }
    return files.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  const looseImages = await collect('', false);
  if (looseImages.length || !folders.length || entries.some(entry => entry.name === 'gallery.json' && entry.isFile())) {
    collections.push({ id: '.', ...await configuration(source, 'General'), files: looseImages });
  }
  for (const folder of folders) {
    collections.push({ id: folder.name, ...await configuration(path.join(source, folder.name), folder.name), files: await collect(folder.name, true) });
  }
  collections.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es', { numeric: true }) || a.id.localeCompare(b.id));

  // Only generated output is removed. Originals and configuration stay in img.
  if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Carpeta de salida no válida');
  try { if ((await lstat(output)).isSymbolicLink()) throw new Error('dist no puede ser un enlace simbólico'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(path.join(output, 'data'), { recursive: true });
  await mkdir(path.join(output, 'thumbnails'), { recursive: true });
  const galleries = [];
  let total = 0;
  for (const collection of collections) {
    const images = [];
    for (const file of collection.files) {
      const original = path.join(source, file);
      const thumbnailName = `${keyFor(file)}.webp`;
      let info;
      try {
        info = await sharp(original).rotate().resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toFile(path.join(output, 'thumbnails', thumbnailName));
      } catch (error) { throw new Error(`No se pudo crear la miniatura de img/${file}: ${error.message}`); }
      const destination = path.join(output, 'img', file);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(original, destination);
      images.push({ name: path.basename(file), extension: path.extname(file).slice(1).toLowerCase(), url: urlFor('img', file), thumbnail: urlFor('thumbnails', thumbnailName), width: info.width, height: info.height });
    }
    const manifest = `data/${keyFor(collection.id)}.json`;
    await writeFile(path.join(output, manifest), JSON.stringify({ images }) + '\n');
    galleries.push({ id: collection.id, name: collection.name, description: collection.description, count: images.length, manifest });
    total += images.length;
  }
  for (const filename of ['index.html', 'styles.css', 'app.js']) await copyFile(path.join(root, filename), path.join(output, filename));
  await writeFile(path.join(output, 'galleries.json'), JSON.stringify({ pageSize: 24, galleries }, null, 2) + '\n');
  await writeFile(path.join(output, '.nojekyll'), '');
  return { output, total, galleries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite();
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `path=${result.output}\n`);
  console.log(`Preparadas ${result.galleries.length} galerías, ${result.total} imágenes y sus miniaturas. Carpeta: ${result.output}`);
}
