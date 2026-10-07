/* Scene manager: owned scene, per-system lazy GLB loading, mesh tagging (tissue + structure),
 * selectable-list maintenance, group visibility/opacity engine, disposal. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GROUPS, hintForGroup } from '../anatomy/systems.js';
import { applyTissue } from './materials.js';
import { structureFromName, registerStructures, getStructure, primeSideMarkers } from '../anatomy/anatomy.js';
import { serializeScene, restoreScene, savePart, loadPart } from './modelCache.js';

const BASE = 'assets/models/real/';
const FEMALE_BASE = 'assets/models/female/';

export const events = { on: (map) => { Object.assign(_events, map); } };
const _events = {};

function emit(name, ...args) { if (_events[name]) _events[name](...args); }

export function createSceneManager(scene, harness) {
  const loader = new GLTFLoader();
  const groupContainers = new Map();   // key -> Group
  const loaded = new Map();            // key -> { status, group, meshes, loadedAt }
  const selectables = [];              // flat list for raycasting
  const uniqueNames = new Map();       // name -> { group, key } dedupe for structure registration
  const rawNamesSeen = new Set();      // for twin-based side-marker priming
  const cacheStats = { saved: 0, restored: 0, bytes: 0 };

  function primeWithCorpus(names) {
    let added = false;
    for (const n of names || []) if (!rawNamesSeen.has(n)) { rawNamesSeen.add(n); added = true; }
    if (added) primeSideMarkers([...rawNamesSeen]);
  }

  function ensureContainer(key) {
    if (!groupContainers.has(key)) {
      const g = new THREE.Group();
      g.name = 'sys:' + key;
      scene.add(g);
      groupContainers.set(key, g);
    }
    return groupContainers.get(key);
  }

  const SHADOW_GROUPS = new Set(['skin', 'skeleton', 'muscles']);
  const isMarker = (mesh) => {
    const g = mesh.geometry;
    const tris = ((g.index ? g.index.count : g.attributes.position.count) || 0) / 3;
    return mesh.name.length > 0 && /[ijs]$/.test(mesh.name) && tris <= 24;
  };

  function ingestPart(groupKey, schema, container, stats, nameRegister, gltf) {
    const raws = [];
    container.traverse((o) => {
      if (!o.isMesh) { if (o.isGroup && !o.userData.__rg) { o.userData.__rg = o.name.replace(/g$/, '').replace(/_/g, ' '); } return; }
      raws.push(o.name);
    });
    primeWithCorpus(raws);
    const meshes = [];
    container.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.__partTagged) return;
      o.userData.__partTagged = true;
      if (isMarker(o)) { o.visible = false; o.userData.selectable = false; stats.dropped++; return; }
      o.castShadow = SHADOW_GROUPS.has(groupKey);
      o.receiveShadow = false;
      o.userData.selectable = true;
      o.userData.group = groupKey;
      o.userData.groupLabel = schema ? schema.label : groupKey;
      applyTissue(o, groupKey);
      const chain = [];
      let p = o.parent;
      while (p && p !== container.parent) { if (p.userData.__rg) chain.unshift(p.userData.__rg); p = p.parent; }
      o.userData.regionChain = chain;
      const st = structureFromName(o.name, { groupChain: chain, systemHint: hintForGroup(groupKey) });
      o.userData.structureKey = st.key;
      if (!uniqueNames.has(st.key)) { uniqueNames.set(st.key, st); nameRegister.push(st); }
      selectables.push(o);
      meshes.push(o);
      stats.count++;
    });
    return meshes;
  }

  function loadGroup(key, cb) {
    const rec = loaded.get(key);
    if (rec) { cb && cb('ready'); return Promise.resolve(rec.group); }
    if (rec && rec.status === 'loading') return Promise.resolve(null);
    const f = GROUPS[key] && GROUPS[key].group ? GROUPS[key].group : key + '.glb';
    const files = Array.isArray(f) ? f : [f];
    const base = String(key).startsWith('female-') ? FEMALE_BASE : BASE;
    const totalParts = files.length;
    const stats = { count: 0, dropped: 0 };
    const nameRegister = [];
    let partIndex = 0;
    loaded.set(key, { status: 'loading' });
    const reveal = (meshes, i, done) => {
      meshes.forEach((m) => { m.visible = false; });
      // staggered reveal via allow-few-ms batch stepping. rAF is PAUSED in
      // hidden/backgrounded tabs, so drive with throttled-safe timers instead
      // of requestAnimationFrame to guarantee multi-part loading always advances.
      if (meshes.length === 0) { partIndex = i + 1; done(); return; }
      (function thaw(n = 0) {
        const t0 = performance.now();
        while (n < meshes.length && performance.now() - t0 < 14) meshes[n++].visible = true;
        if (n < meshes.length) { setTimeout(() => thaw(n), 33); return; }
        partIndex = i + 1;
        emit('load:progress', key, Math.round((partIndex / totalParts) * 100));
        if (cb) cb('progress', { part: i + 1, parts: totalParts });
        done();
      })();
    };
    return new Promise((resolve, reject) => {
      const container = ensureContainer(key);
      const schema = GROUPS[key];
      const nextPart = async () => {
        if (partIndex >= totalParts) {
          registerStructures(nameRegister);
          loaded.set(key, { status: 'ready', group: container, meshes: stats.count, dropped: stats.dropped });
          emit('group:loaded', key, { count: stats.count, dropped: stats.dropped, selectables: selectables.length, structures: uniqueNames.size });
          if (cb) cb('ready');
          resolve(container);
          return;
        }
        const i = partIndex;
        const file = files[i];
        // decode-free fast path: restore this part from the local geometry cache
        let cached = null;
        try { cached = await loadPart(key, file); } catch (e) { cached = null; }
        if (cached && Array.isArray(cached.bufs)) {
          let scene = null;
          try { scene = restoreScene(cached); } catch (e) { console.error('[cache] restore failed', key, file, e); scene = null; }
          if (scene) {
            console.debug('[cache] restored', key, file, 'len=' + cached.json.length, 'bufs=' + (cached.bufs || []).length);
            container.add(scene);
            try { scene.updateMatrixWorld(true); } catch (e) {}
            cacheStats.restored++;
            cacheStats.bytes += cached.size || 0;
            const meshes = ingestPart(key, schema, container, stats, nameRegister, scene);
            console.debug('[cache] restored ingest', file, 'meshes=' + meshes.length, 'markers dropped=' + (stats.dropped));
            reveal(meshes, i, nextPart);
            return;
          }
        }
        loader.load(
          base + file,
          (gltf) => {
            container.add(gltf.scene);
            const meshes = ingestPart(key, schema, container, stats, nameRegister, gltf.scene);
            console.debug('[cache] decoded ingest', file, 'meshes=' + meshes.length, 'markers dropped=' + (stats.dropped));
            // persist this part for the next visit (never blocks the reveal)
            try {
              const ser = serializeScene(gltf.scene);
              const size = ser.bufs.reduce((a, b) => a + b.byteLength, 0) + ser.json.length;
              savePart(key, file, size, ser.json, ser.bufs).then((ok) => { if (ok) { cacheStats.saved++; cacheStats.bytes += size; console.debug('[cache] saved', key, file, Math.round(size / 1048576) + 'MB'); } else { console.debug('[cache] save failed', key, file); } });
            } catch (e) { /* cache is best-effort */ }
            reveal(meshes, i, nextPart);
          },
          (x) => { emit('load:progress', key, Math.round(((i + x.loaded / (x.total || 1)) / totalParts) * 100)); if (cb) cb('progress', x); },
          (err) => { loaded.set(key, { status: 'error', error: err }); emit('group:error', key, err); if (cb) cb('error', err); reject(err); }
        );
      };
      nextPart();
    });
  }

  function groupReady(key) { const r = loaded.get(key); return r && r.status === 'ready'; }

  /* visibility + group opacity engine (safe per-mesh cloning) */
  function setGroupVisibility(key, visible) {
    const rec = loaded.get(key); if (!rec || !rec.group) return;
    rec.group.visible = visible;
    if (visible) {
      rec.group.traverse((o) => { if (o.isMesh) o.userData._wasHidden = false; });
    }
  }

  function groupOpacity(key, opacity) {
    const rec = loaded.get(key); if (!rec || !rec.group) return;
    rec.group.visible = opacity > 0.003;
    if (opacity <= 0.003) return;   // fully hidden: nothing to clone/compile
    rec.group.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      const want = Math.max(0.01, Math.min(1, opacity));
      if (Math.abs(m.opacity - want) < 0.001 && (m.transparent === (want < 0.999))) return;
      // per-mesh clone to avoid mutating shared palette material
      let mat = o.userData.__opacityMat;
      if (!mat) {
        mat = m.clone();
        o.userData.__opacityMat = mat;
        o.material = mat;
      }
      mat.transparent = want < 0.999;
      mat.opacity = want;
      mat.depthWrite = want >= 0.999;
      mat.needsUpdate = true;
    });
  }

  function resetGroupOpacity(key) {
    const rec = loaded.get(key); if (!rec || !rec.group) return;
    rec.group.traverse((o) => {
      if (!o.isMesh || !o.userData.__opacityMat) return;
      o.material = o.userData.__opacityMat; // falls back to palette clone; keep as-is (opacity mu)
      o.userData.__opacityMat = null;
    });
  }

  function disposeGroup(key) {
    const rec = loaded.get(key);
    if (!rec || !rec.group) return;
    rec.group.traverse((o) => {
      if (!o.isMesh) return;
      const i = selectables.indexOf(o);
      if (i >= 0) selectables.splice(i, 1);
      o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else if (o.material) o.material.dispose();
      o.userData.__opacityMat?.dispose();
    });
    scene.remove(rec.group);
    loaded.delete(key);
    emit('group:unloaded', key);
  }

  function rebuildSelectables() {
    selectables.length = 0;
    for (const rec of loaded.values()) {
      if (!rec.group || !rec.group.visible) continue;
      rec.group.traverse((o) => { if (o.isMesh && o.userData.selectable) selectables.push(o); });
    }
    return selectables;
  }

  function structureForKey(key) { return getStructure(key); }

  function getBounds() {
    const box = new THREE.Box3();
    for (const rec of loaded.values()) if (rec.group && rec.group.visible) box.expandByObject(rec.group);
    if (box.isEmpty()) { box.min.set(-0.3, 0, -0.3); box.max.set(0.3, 1.7, 0.3); }
    return box;
  }

  return { loadGroup, groupReady, setGroupVisibility, groupOpacity, resetGroupOpacity, disposeGroup, rebuildSelectables, getSelectables: () => selectables, getBounds, structureForKey, groupContainers, loaded, cacheStats: () => ({ ...cacheStats }) };
}