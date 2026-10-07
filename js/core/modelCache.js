/* modelCache: persists decoded GLB parts in IndexedDB so repeat visits skip
 * GLTF download+decode entirely. Serialized = node tree (names/transforms) +
 * raw attribute/index typed-array buffers. Bump VERSION whenever model files
 * change; users can also clear explicitly. Fails open (no IDB -> no caching). */
import * as THREE from 'three';

const VERSION = 1;
const DB = 'anatomy-geo';
const STORE = 'parts';

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') { dbPromise = Promise.resolve(null); return dbPromise; }
  dbPromise = new Promise((res) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { res(null); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });
  return dbPromise;
}
async function storeObj(rw) {
  const db = await open();
  if (!db) return null;
  try { return db.transaction(STORE, rw ? 'readwrite' : 'readonly').objectStore(STORE); } catch (e) { return null; }
}
const txReq = (req) => new Promise((res) => { req.onsuccess = () => res(req.result); req.onerror = () => res(req.error); });
const txDone = (tx) => new Promise((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false); });
const withTO = (p, ms = 15000) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

export function cacheKey(key, file) { return key + '::' + file; }

export async function savePart(key, file, size, json, bufs) {
  const s = await storeObj(true);
  if (!s || typeof structuredClone === 'undefined') return false;
  const rec = { id: cacheKey(key, file), key, file, size, version: VERSION, json, bufs };
  try { return (await withTO(txReq(s.put(rec)), 30000)) !== null; } catch (e) { return false; }
}

export async function loadPart(key, file) {
  const s = await storeObj(false);
  if (!s) return null;
  const id = cacheKey(key, file);
  try {
    const rec = await withTO(txReq(s.get(id)), 15000);
    if (!rec) return null;
    if (rec.version !== VERSION || rec.key !== key || rec.file !== file) return null;
    if (!rec.json || !Array.isArray(rec.bufs)) return null;
    return rec;
  } catch (e) { return null; }
}

export async function clearCache() {
  const s = await storeObj(true);
  if (!s) return false;
  try { s.clear(); return await withTO(txDone(s.transaction), 15000) === true; } catch (e) { return false; }
}

export async function countParts() {
  const s = await storeObj(false);
  if (!s) return 0;
  try { const n = await withTO(txReq(s.count()), 15000); return typeof n === 'number' ? n : 0; } catch (e) { return 0; }
}

/* ---- serialization ---- */

/** Walk gltf.scene; return { json, bufs } where json is a node tree and
 *  bufs holds each unique attribute/index ArrayBuffer exactly once (GLB meshes
 *  share buffers, so slices are deduped by source ArrayBuffer identity). */
export function serializeScene(scene) {
  const bufs = [];
  const bufIdx = new Map();
  const ET = { f32: 4, u32: 4, u16: 2 };
  const refFor = (attr) => {
    if (!attr) return null;
    const byteLen = attr.array.byteLength;
    let id = bufIdx.get(attr.array.buffer);
    if (id === undefined) {
      id = bufs.push(attr.array.buffer) - 1;
      bufIdx.set(attr.array.buffer, id);
    }
    const ctor = attr.array instanceof Uint32Array ? 'u32' : attr.array instanceof Uint16Array ? 'u16' : attr.array instanceof Uint8Array ? 'u8' : 'f32';
    return {
      b: id,
      offset: attr.array.byteOffset,
      len: byteLen,
      count: byteLen / attr.itemSize / ET[ctor],
      itemSize: attr.itemSize,
      ctor,
      normalized: attr.normalized ? 1 : 0,
    };
  };
  const meshRec = (m) => {
    const attrs = {};
    for (const [k, attr] of Object.entries(m.geometry.attributes || {})) attrs[k] = refFor(attr);
    const index = refFor(m.geometry.index);
    return { name: m.name, matrix: Array.from(m.matrix.elements), attrs, index, visible: m.visible !== false };
  };
  const nodeRec = (n) => {
    // GLB sometimes nests mesh nodes under other mesh nodes — always recurse into
    // every child so no mesh is ever dropped.
    const out = { name: n.name, matrix: Array.from(n.matrix.elements), mesh: n.isMesh ? meshRec(n) : null, children: [] };
    for (const c of n.children || []) out.children.push(nodeRec(c));
    return out;
  };
  return { json: JSON.stringify(nodeRec(scene)), bufs };
}

/** Rebuild a Group exactly like the original gltf.scene part. */
export function restoreScene(rec) {
  const B = rec.bufs || [];
  const CTOR = { f32: Float32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array };
  const view = (ref) => ref ? new CTOR[ref.ctor](B[ref.b], ref.offset, ref.count) : null;
  const buildMesh = (d) => {
    const geo = new THREE.BufferGeometry();
    for (const [k, ref] of Object.entries(d.attrs || {})) {
      const v = view(ref);
      if (v) geo.setAttribute(k, new THREE.BufferAttribute(v, ref.itemSize, !!ref.normalized));
    }
    let indexArr = null;
    if (d.index) {
      const v = view(d.index);
      if (v) indexArr = v instanceof Uint8Array ? new Uint16Array(v) : v;
    }
    if (indexArr) geo.setIndex(new THREE.BufferAttribute(indexArr, 1));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    m.name = d.name;
    m.matrix.fromArray(d.matrix);
    m.matrixAutoUpdate = false;
    m.visible = d.visible !== false;
    return m;
  };
  const node = (d, parent) => {
    const holder = d.mesh ? buildMesh(d.mesh) : new THREE.Group();
    holder.name = d.name;
    holder.matrix.fromArray(d.matrix);
    holder.matrixAutoUpdate = false;
    parent.add(holder);
    for (const c of (d.children || [])) node(c, holder);
    return holder;
  };
  const root = new THREE.Group();
  root.name = 'restored';
  node(JSON.parse(rec.json), root);
  return root;
}