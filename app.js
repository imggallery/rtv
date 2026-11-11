'use strict';
const $ = selector => document.querySelector(selector);
const gallery = $('#gallery');
const message = $('#message');
const search = $('#search');
const sort = $('#sort');
const collection = $('#collection');
const viewer = $('#viewer');
const pageSize = 24;
let collections = [];
let images = [];
let visible = [];
let page = 1;
let active = 0;
let opener;
let requestNumber = 0;
let loading = true;

function showMessage(title, detail) {
  const heading = document.createElement('strong');
  heading.textContent = title;
  message.replaceChildren(heading, document.createTextNode(detail));
  message.hidden = false;
}

function updateAddress() {
  const url = new URL(location.href);
  url.searchParams.set('gallery', collection.value);
  if (page > 1) url.searchParams.set('page', page); else url.searchParams.delete('page');
  history.replaceState(null, '', url);
}

function render() {
  const query = search.value.trim().toLocaleLowerCase('es');
  visible = images.filter(item => item.name.toLocaleLowerCase('es').includes(query));
  visible.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }) * (sort.value === 'reverse' ? -1 : 1));
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  page = Math.max(1, Math.min(page, pages));
  const start = (page - 1) * pageSize;
  gallery.replaceChildren();
  $('#count').textContent = visible.length ? `Mostrando ${start + 1}–${Math.min(start + pageSize, visible.length)} de ${visible.length} imágenes${query ? ` (${images.length} en la galería)` : ''}` : '0 imágenes';
  message.hidden = true;
  $('#pagination').hidden = pages <= 1;
  $('#page-status').textContent = `Página ${page} de ${pages}`;
  $('#page-previous').disabled = page === 1;
  $('#page-next').disabled = page === pages;
  if (!visible.length) {
    showMessage(images.length ? 'No encontramos esa imagen' : 'Esta galería está vacía', images.length ? 'Prueba con otro nombre.' : 'Añade imágenes a su carpeta dentro de img y vuelve a publicar.');
  }
  visible.slice(start, start + pageSize).forEach((item, index) => {
    const card = document.createElement('figure');
    card.className = 'card';
    const button = document.createElement('button');
    button.className = 'thumbnail';
    button.type = 'button';
    button.setAttribute('aria-label', `Ampliar ${item.name}`);
    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.alt = item.name;
    img.width = item.width;
    img.height = item.height;
    img.loading = 'lazy';
    img.decoding = 'async';
    button.append(img);
    button.addEventListener('click', () => { opener = button; openImage(start + index); });
    const caption = document.createElement('figcaption');
    const name = document.createElement('p');
    name.className = 'image-name';
    name.textContent = item.name;
    const type = document.createElement('span');
    type.className = 'image-type';
    type.textContent = item.extension.toUpperCase();
    caption.append(name, type);
    card.append(button, caption);
    gallery.append(card);
  });
  updateAddress();
}

function openImage(index) {
  if (!visible.length) return;
  active = (index + visible.length) % visible.length;
  const item = visible[active];
  $('#full-image').src = item.url;
  $('#full-image').alt = item.name;
  $('#viewer-title').textContent = item.name;
  $('#original').href = item.url;
  $('#position').textContent = `${active + 1} / ${visible.length}`;
  $('#previous').disabled = visible.length < 2;
  $('#next').disabled = visible.length < 2;
  if (!viewer.open) { viewer.showModal(); document.body.style.overflow = 'hidden'; }
}

$('#close').addEventListener('click', () => viewer.close());
$('#previous').addEventListener('click', () => openImage(active - 1));
$('#next').addEventListener('click', () => openImage(active + 1));
viewer.addEventListener('click', event => {
  if (event.target !== viewer) return;
  const rect = viewer.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
});
viewer.addEventListener('close', () => {
  document.body.style.overflow = '';
  $('#full-image').removeAttribute('src');
  const targetPage = Math.floor(active / pageSize) + 1;
  if (targetPage !== page) { page = targetPage; render(); }
  const target = gallery.children[active % pageSize]?.querySelector('button');
  (target || opener)?.focus();
});
viewer.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); openImage(active + (event.key === 'ArrowRight' ? 1 : -1)); }
});
for (const [element, event] of [[search, 'input'], [sort, 'change']]) {
  element.addEventListener(event, () => { if (!loading) { page = 1; render(); } });
}
for (const [selector, direction] of [['#page-previous', -1], ['#page-next', 1]]) {
  $(selector).addEventListener('click', () => {
    if (loading) return;
    page += direction;
    render();
    $('#count').scrollIntoView({ block: 'start', behavior: 'instant' });
    ($(selector).disabled ? $(direction > 0 ? '#page-previous' : '#page-next') : $(selector)).focus({ preventScroll: true });
  });
}

async function readJSON(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
  return response.json();
}

async function selectCollection(id, initialPage = 1) {
  const selected = collections.find(item => item.id === id) || collections[0];
  if (!selected) throw new Error('No hay galerías disponibles');
  const request = ++requestNumber;
  loading = true;
  search.disabled = sort.disabled = true;
  collection.value = selected.id;
  $('#collection-title').textContent = selected.name;
  $('#collection-description').textContent = selected.description;
  $('#collection-description').hidden = !selected.description;
  document.title = `${selected.name} · IMGgallery`;
  images = [];
  visible = [];
  gallery.replaceChildren();
  $('#pagination').hidden = true;
  message.hidden = true;
  $('#count').textContent = 'Cargando galería…';
  try {
    const data = await readJSON(selected.manifest);
    if (request !== requestNumber) return;
    if (!Array.isArray(data.images)) throw new Error('Listado no válido');
    images = data.images;
    page = initialPage;
    render();
  } catch (error) {
    if (request !== requestNumber) return;
    $('#count').textContent = 'Galería no disponible';
    showMessage('No pudimos cargar esta galería', 'Recarga la página o selecciona otra galería.');
    console.error(error);
  } finally {
    if (request === requestNumber) { loading = false; search.disabled = sort.disabled = false; }
  }
}
collection.addEventListener('change', () => { search.value = ''; selectCollection(collection.value); });

async function load() {
  try {
    search.disabled = sort.disabled = true;
    const catalog = await readJSON('galleries.json');
    if (!Array.isArray(catalog.galleries) || !catalog.galleries.length) throw new Error('Catálogo no válido');
    collections = catalog.galleries;
    collection.replaceChildren();
    for (const item of collections) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name} (${item.count})`;
      collection.append(option);
    }
    collection.disabled = false;
    const query = new URLSearchParams(location.search);
    const requestedPage = Number(query.get('page'));
    await selectCollection(query.get('gallery'), Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  } catch (error) {
    $('#count').textContent = 'Colección no disponible';
    collection.replaceChildren();
    const option = document.createElement('option');
    option.textContent = 'No se pudieron cargar las galerías';
    collection.append(option);
    showMessage('No pudimos cargar las galerías', location.protocol === 'file:' ? 'Abre la galería desde un servidor local. Consulta las instrucciones del proyecto.' : 'Recarga la página. Si acabas de publicar, espera a que termine la acción de GitHub.');
    console.error(error);
  }
}
load();
