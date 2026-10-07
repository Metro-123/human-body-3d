/* Application wiring: scene, renderer, lighting, camera rig, scene manager, interaction,
 * systems nav, dissection depth, x-ray, search, selection, info panel, labels, views,
 * quality, keyboard shortcuts, screenshot/fullscreen, learn/quiz, audio.
 * Vanilla JS + three via import map. No build step. */
import * as THREE from 'three';
import { createRenderer, setQuality } from './core/renderer.js';
import { createLighting, createEnvironment } from './core/lighting.js';
import { createCameraRig } from './core/camera.js';
import { createSceneManager, events } from './core/sceneManager.js';
import { createInteraction } from './core/interaction.js';
import { GROUPS, SYSTEMS, LAYERS, XRAY_GROUP_OPACITY, BODIES, BODY_OF, systemGroupsForBody } from './anatomy/systems.js';
import { searchStructures, getStructure } from './anatomy/anatomy.js';
import { createBodyAudio } from './audio.js';
import { clearCache, countParts } from './core/modelCache.js';

const $ = (id) => document.getElementById(id);
const hasActive = (e) => e && e.target && !e.target.closest('input,select,textarea,[data-cmd]');

const QUALITY = { low: { dprCap: 1, antialias: false, shadows: false, shadowSize: 512 }, balanced: { dprCap: 1.5, antialias: true, shadows: true, shadowSize: 1024 }, high: { dprCap: 2, antialias: true, shadows: true, shadowSize: 2048 }, ultra: { dprCap: 3, antialias: true, shadows: true, shadowSize: 4096 } };

function detectSoftwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const dbg = gl && gl.getExtension ? gl.getExtension('WEBGL_debug_renderer_info') : null;
    if (!dbg) return false;
    const r = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    return /swiftshader|llvmpipe|softpipe|software/.test(r);
  } catch (e) { return false; }
}

export function init(container, opts = {}) {
  let q = QUALITY[opts.quality || 'balanced'] || QUALITY.balanced;
  const sceneEl = container.querySelector('#scene') || container;

  const renderer = createRenderer(sceneEl, q);
  const softwareGL = detectSoftwareGL(renderer);
  if (softwareGL) { q = QUALITY.low; try { setQuality(renderer, q); } catch (e) { /* noop */ } }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1219);
  const lights = createLighting(scene, q);
  createEnvironment(renderer, scene).then(() => { scene.environmentIntensity = 0.85; }).catch((e) => console.warn('env', e));

  // grounding platform: soft shadow-catcher disc + machine-turned rim
  const groundDisc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x171b24, roughness: 0.92, metalness: 0.06, envMapIntensity: 0.6 }));
  groundDisc.position.y = -0.004;
  groundDisc.receiveShadow = true;
  scene.add(groundDisc);
  const groundRim = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.4, 80).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x33445e, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
  groundRim.position.y = 0.0006;
  scene.add(groundRim);
  // faint inner mat for depth
  const groundMat = new THREE.Mesh(new THREE.CircleGeometry(1.3, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x12151c, roughness: 0.95, transparent: true, opacity: 0.9 }));
  groundMat.position.y = -0.003;
  groundMat.receiveShadow = true;
  scene.add(groundMat);

  const cam = createCameraRig(renderer);
  const updateAspect = () => { cam.camera.aspect = (sceneEl.clientWidth || 1) / (sceneEl.clientHeight || 1); cam.camera.updateProjectionMatrix(); };
  renderer._onResizeCb = updateAspect;
  updateAspect();
  const sm = createSceneManager(scene);
  const sel = { hovered: null, selected: null };

  const meshByKey = new Map();
  function indexMeshes() {
    meshByKey.clear();
    for (const m of sm.getSelectables()) {
      const k = m.userData.structureKey;
      if (k && !meshByKey.has(k)) meshByKey.set(k, []);
      if (k) meshByKey.get(k).push(m);
    }
  }

  const state = {
    mode: 'normal',        // 'normal' | 'xray'
    depth: 0,              // number of surface layers faded out
    isolateSystem: null,   // system id engaged
    body: 'male',          // 'male' | 'female'
    loaded: new Set(),
    pending: false,
  };

  window.__ANATOMY = { boot: performance.now(), ready: false, frames: 0, loaded: [], selected: null, error: null, groups: {}, body: 'male' };
  const telemetry = window.__ANATOMY;
  telemetry.groups = Object.fromEntries([...Object.keys(GROUPS).map((k) => [k, 'pending'])]);
  telemetry.snapshot = () => {
    try {
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height;
      if (gl && w > 2 && h > 2) {
        const b = new Uint8Array(16);
        gl.readPixels(w >> 1, h >> 1, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, b);
        const c = new Uint8Array(4);
        gl.readPixels(Math.floor(w * 0.72), Math.floor(h * 0.42), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
        telemetry.px = Array.from(b).join(',') + ' | ' + Array.from(c).join(',');
      }
      const box = sm.getBounds();
      telemetry.bounds = box.isEmpty() ? 'EMPTY' : ['min', box.min.x.toFixed(2), box.min.y.toFixed(2), box.min.z.toFixed(2), 'max', box.max.x.toFixed(2), box.max.y.toFixed(2), box.max.z.toFixed(2)].join(' ');
      telemetry.cam = cam.camera.position.toArray().map((v) => v.toFixed(2)).join(',') + ' @ ' + cam.controls.target.toArray().map((v) => v.toFixed(2)).join(',');
      telemetry.meshes = sm.getSelectables().length;
      const sels = sm.getSelectables();
      if (sels[0]) telemetry.sampleNames = [sels[0].name, (sels[Math.floor(sels.length / 2)] || sels[0]).name].join(' | ');
      telemetry.size = renderer.domElement.width + 'x' + renderer.domElement.height;
      const cs = sm.cacheStats();
      telemetry.cache = JSON.stringify(cs);
    } catch (e) { telemetry.snapshotErr = String(e && e.message); }
  };
  let _f = 0;
  const cap = () => { if (_f++ % 30 === 0) telemetry.snapshot(); };

  async function refreshCacheInfo() {
    const el = $('cache-info');
    if (!el) return;
    const n = await countParts();
    const st = sm.cacheStats();
    el.textContent = n ? (n + ' parts cached (~' + Math.round(st.bytes / 1048576) + ' MB) — re-visits open instantly' ) : 'none cached yet — first full load saves it';
  }
  $('clear-cache')?.addEventListener('click', async () => {
    const ok = await clearCache();
    toast(ok ? 'Model cache cleared — next visit re-decodes' : 'No model cache to clear');
    refreshCacheInfo();
  });
  refreshCacheInfo();

  /* ---- loading + progress wiring ---- */
  const progress = { loaded: 0, total: 1 };
  events.on({
    'load:progress': (k, p) => { /* steady; total tracked manually */ },
    'group:error': (k, err) => { toast('Failed to load ' + (GROUPS[k]?.label || k) + ' model', 'error'); telemetry.groups[k] = 'error: ' + (err && err.message); },'group:loaded': (k, info) => { state.loaded.add(k); indexMeshes(); applyAppearance(); updateSystemsNav(); if (!learnPanelEl().classList.contains('hidden')) refreshLearn(); telemetry.groups[k] = 'ok count=' + (info && info.count) + ' dropped=' + (info && info.dropped) + ' meshesTotal=' + (info && info.selectables); telemetry.loaded = Array.from(state.loaded); refreshCacheInfo(); },
  });

  async function ensureLoaded(groupKey) {
    if (state.loaded.has(groupKey)) return true;
    const { count } = await sm.loadGroup(groupKey);
    state.loaded.add(groupKey);
    indexMeshes();
    applyAppearance(); updateSystemsNav();
    return count !== undefined || true;
  }

  function beginDefault() {
    const q = new URLSearchParams(location.search).get('boot');
    const batch = q ? q.split(',').map((s) => s.trim()).filter((k) => k && GROUPS[k]) : ['skin', 'skeleton', 'muscles', 'organs'];
    if (!batch.length) batch.push('skin');
    progress.total = batch.length; progress.loaded = 0;
    const mini = $('mini-load');
    let revealed = false, attempts = 0;
    const revealDeadline = Date.now() + 45000;
    const showMini = () => {
      const rest = batch.slice(progress.loaded).map((k) => ((GROUPS[k] || {}).label || k).toLowerCase());
      mini.textContent = 'Loading ' + rest.join(', ') + '… (' + progress.loaded + '/' + batch.length + ')';
      mini.classList.remove('hidden');
    };
    const reveal = (force) => {
      if (revealed) return;
      const firstDone = progress.loaded >= Math.min(1, batch.length);
      const exhausted = attempts >= batch.length && progress.loaded > 0;
      if (!(firstDone || exhausted || force)) return;
      revealed = true;
      if (progress.loaded < batch.length) { showMini(); toast(progress.loaded ? 'More systems loading in the background…' : 'First model still loading — it will appear here shortly.', 'ok'); }
      setLoading(100, true);
    };
    const refresh = () => { reveal(false); if (revealed && progress.loaded < batch.length) showMini(); if (progress.loaded >= batch.length) { mini?.classList.add('hidden'); if (!revealed) setLoading(100, true); } };
    setTimeout(() => reveal(true), 45000);
    setLoading(0);
    const one = (k) => (async () => {
      let ok = true;
      try { await ensureLoaded(k); } catch (e) { ok = false; }
      attempts++;
      if (ok) progress.loaded++;
      refresh();
    })();
    const batchStep = (i) => {
      if (i >= batch.length) return;
      one(batch[i]).then(() => batchStep(i + 1));
    };
    batchStep(0);
  }

  /* ---- dissection/x-ray appearance engine ---- */
  const LAYER_OF = {};
  LAYERS.forEach((L, i) => L.groups.forEach((g) => { LAYER_OF[g] = i; }));

  function applyAppearance() {
    for (const key of Object.keys(GROUPS)) {
      if (!state.loaded.has(key)) continue;
      // hide the opposite body entirely (opacity 0 hides the container)
      if (BODY_OF[key] && BODY_OF[key] !== state.body) { sm.groupOpacity(key, 0); continue; }
      let base = state.mode === 'xray' ? XRAY_GROUP_OPACITY[key] ?? 1 : 1;
      const layer = LAYER_OF[key] ?? 99;
      if (state.depth > layer && state.mode !== 'xray') base = Math.min(base, 0.06);
      if (state.isolateSystem) {
        const member = systemGroupsForBody(state.body, state.isolateSystem).includes(key);
        if (!member) base = Math.min(base, 0.1);
      }
      // keep selection legible in x-ray
      if (state.mode === 'xray' && sel.selected && sel.selected.userData.group === key) base = Math.max(base, 0.85);
      sm.groupOpacity(key, base);
    }
    sm.rebuildSelectables();
  }

  /* ---- interaction ---- */
  const inter = createInteraction(renderer, cam.camera, sm, {
    hover(mesh) {
      sel.hovered = mesh;
      const st = sm.structureForKey(mesh.userData.structureKey);
      setLabelTarget(mesh, st);
      if (state.mode === 'xray') { sel.selected ? setHighlightOnly(sel.selected, 'select') : 0; }
    },
    leave() { sel.hovered = null; setLabelTarget(null); },
    select(mesh) {
      sel.selected = mesh;
      const st = mesh ? sm.structureForKey(mesh.userData.structureKey) : null;
      if (st) {
        openInfo(st, mesh);
        if (state.mode === 'xray') applyAppearance();
        setLabelTarget(mesh, st, true);
      } else { closeInfo(); setLabelTarget(null); }
    },
    activate() { focusSelected(); },
  });
  function setHighlightOnly(mesh, lvl) { /* handled by materials; noop */ }

  /* ---- label overlay ---- */
  let labelTarget = null, labelMesh = null, labelSticky = false;
  const posTmp = new THREE.Vector3(), center = new THREE.Vector3();
  function setLabelTarget(mesh, st, sticky = false) {
    labelMesh = mesh; labelSticky = sticky;
    const el = $('label-name'); const el2 = $('label-meta');
    if (!mesh) { el.textContent = ''; el2.textContent = ''; el.classList.add('hidden'); return; }
    const name = st ? (st.side ? st.side + ' ' : '') + st.name : mesh.name.replace(/_/g, ' ');
    el.textContent = name;
    const meta = [];
    if (st && st.fma && st.fma.verified) meta.push(st.fma.id + ' ' + st.fma.name);
    if (st && st.verified) meta.push('✓ FMA verified'); else if (st && st.fma) meta.push('⚠ Mapping not verified');
    el2.textContent = meta.join(' · ');
    el.classList.remove('hidden');
  }

  /* ---- info panel ---- */
  function openInfo(st, mesh) {
    const p = $('info-panel');
    p.classList.remove('hidden');
    $('info-title').textContent = st.nameFull;
    $('info-subtitle').textContent = [st.system ? SYSTEM_NAME(st.system) : 'Unknown', st.region].filter(Boolean).join(' · ') || '—';
    const fmaSec = $('info-fma');
    if (st.fma) {
      const v = st.fma.verified;
      $('info-fma-id').textContent = st.fma.id;
      $('info-fma-name').textContent = st.fma.name;
      $('info-fma-status').textContent = v ? 'Verified' : 'Not verified';
      $('info-fma-status').className = 'pill ' + (v ? 'ok' : 'warn');
      $('info-fma-note').classList.toggle('hidden', v);
      fmaSec.classList.remove('hidden');
    } else fmaSec.classList.add('hidden');
    $('info-name').textContent = st.name;
    $('info-side').textContent = st.side || 'Unpaired (midline)';
    $('info-sys2').textContent = SYSTEM_NAME(st.system);
    $('info-region2').textContent = st.region;
    $('info-tissue').textContent = mesh.userData.tissue || '—';
    $('info-meshes').textContent = (meshByKey.get(st.key) || []).length + ' mesh segment(s)';
  }
  function closeInfo() { $('info-panel').classList.add('hidden'); }

  function focusSelected() {
    if (!sel.selected) return;
    cam.focusBox(new THREE.Box3().setFromObject(sel.selected));
  }

  function selectStructure(k) {
    const target = meshByKey.get(k);
    if (target && target.length) { inter.setSelected(target[0]); cam.focusBox(new THREE.Box3().setFromObject(target[0]), { duration: 850 }); return true; }
    const st = getStructure(k);
    if (st) {
      const grp = groupForKey(k);
      if (grp && !state.loaded.has(grp)) {
        ensureLoaded(grp).then(() => { const t = meshByKey.get(k); if (t && t[0]) { inter.setSelected(t[0]); cam.focusBox(new THREE.Box3().setFromObject(t[0])); } });
      }
    }
    return false;
  }

  /* ---- search ---- */
  const qEl = $('search');
  const listEl = $('search-results');
  function runSearch() {
    const q = qEl.value.trim();
    if (!q) { listEl.classList.add('hidden'); listEl.innerHTML = ''; return; }
    const res = searchStructures(q, 30);
    if (!res.length) { listEl.innerHTML = '<div class="sr-item sr-empty">No matching structures. Try an English term, e.g. <b>femur</b> or <b>artery</b>.</div>'; listEl.classList.remove('hidden'); return; }
    listEl.innerHTML = res.map((s) => {
      const ok = s.verified;
      return `<button class="sr-item" data-cmd="goto" data-key="${s.key}"><span class="sr-name">${esc(s.nameFull)}</span><span class="sr-sys">${esc(SYSTEM_NAME(s.system))}${s.fma && s.fma.verified ? ' · ' + esc(s.fma.id) : ''}</span>${ok ? '' : '<span class="sr-warn">unverified</span>'}</button>`;
    }).join('');
    listEl.classList.remove('hidden');
  }
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd="goto"]');
    if (!b) return;
    qEl.value = getStructure(b.dataset.key)?.nameFull || '';
    listEl.classList.add('hidden');
    selectStructure(b.dataset.key);
  });

  /* ---- systems nav ---- */
  function updateSystemsNav() {
    for (const sys of SYSTEMS) {
      const el = document.querySelector(`[data-system="${sys.id}"]`);
      if (!el) continue;
      const ready = systemGroupsForBody(state.body, sys.id).every((g) => state.loaded.has(g));
      el.classList.toggle('is-ready', ready);
    }
  }
  document.addEventListener('click', (e) => {
    const sysEl = e.target.closest('[data-system]');
    if (sysEl) { toggleSystem(sysEl.dataset.system); return; }
    const cmd = e.target.closest('[data-cmd]');
    if (cmd && cmd.dataset.cmd !== 'goto') handleCmd(cmd.dataset.cmd, cmd);
  });

  function isSystemLoaded(sysId) {
    const grps = systemGroupsForBody(state.body, sysId);
    return grps.length ? grps.every((g) => state.loaded.has(g)) : false;
  }
  async function toggleSystem(sysId) {
    const btn = document.querySelector(`[data-system="${sysId}"]`);
    const engaged = state.isolateSystem === sysId;
    if (engaged) { state.isolateSystem = null; btn?.classList.remove('active'); applyAppearance(); if (!learnPanelEl().classList.contains('hidden')) refreshLearn(); return; }
    const grps = systemGroupsForBody(state.body, sysId);
    if (!grps.length) { toast((state.body === 'female' ? 'Not present in the female model (no muscle / lymph layer in this open dataset).' : 'No parts in this model.'), 'warn'); return; }
    state.isolateSystem = sysId;
    sysBtns.forEach((b) => b.classList.remove('active'));
    btn?.classList.add('active');
    for (const g of grps) if (!state.loaded.has(g)) { try { await ensureLoaded(g); } catch {} }
    applyAppearance();
    if (!learnPanelEl().classList.contains('hidden')) refreshLearn();
    if (grps.length) {
      for (const g of grps) {
        const rec = sm.groupContainers.get(g);
        if (rec) { cam.focusBox(new THREE.Box3().setFromObject(rec), { duration: 900 }); break; }
      }
    }
  }
  const sysBtns = Array.from(document.querySelectorAll('[data-system]'));

  /* ---- education: verified-only Learn list + Terminology quiz ---- */
  function bodyVerified() {
    const found = new Map();
    for (const key of state.loaded) {
      if (BODY_OF[key] && BODY_OF[key] !== state.body) continue;
      const rec = sm.groupContainers.get(key);
      if (!rec) continue;
      rec.traverse((o) => {
        if (!o.isMesh) return;
        const k = o.userData.structureKey;
        if (!k || found.has(k)) return;
        const st = getStructure(k);
        if (st && st.verified && st.fma && st.fma.verified) found.set(k, st);
      });
    }
    return [...found.values()];
  }
  function groupBySystem(items) {
    const m = new Map();
    for (const it of items) {
      if (!m.has(it.system)) m.set(it.system, []);
      m.get(it.system).push(it);
    }
    return m;
  }
  function closeEducationPanels(keep) {
    for (const id of ['info-panel', 'help-panel', 'learn-panel', 'quiz-panel']) {
      const el = $(id);
      if (el && el !== keep) el.classList.add('hidden');
    }
  }
  const learnPanelEl = () => $('learn-panel');
  function openLearn() {
    closeEducationPanels(learnPanelEl());
    refreshLearn();
  }
  function refreshLearn() {
    const panel = learnPanelEl();
    if (!panel) return;
    const items = bodyVerified();
    const list = $('learn-list');
    const sub = $('learn-sub');
    let html = '';
    if (state.isolateSystem) {
      const arr = items.filter((it) => it.system === state.isolateSystem);
      sub.textContent = SYSTEM_NAME(state.isolateSystem) + ' · ' + arr.length + ' verified structure(s).';
      html = arr.map((it) => learnItem(it)).join('');
    } else {
      sub.textContent = 'All ' + items.length + ' FMA-verified structures in the current model. Click to focus.';
      const by = groupBySystem(items);
      html = SYSTEMS.map((sys) => {
        const arr = by.get(sys.id);
        if (!arr || !arr.length) return '';
        return `<div class="ln-sys">${esc(SYSTEM_NAME(sys.id))} (${arr.length})</div>` + arr.map((it) => learnItem(it)).join('');
      }).join('');
    }
    list.innerHTML = html || '<p class="quiz-meta">No verified structures loaded yet. Open more systems or switch models.</p>';
    panel.classList.remove('hidden');
  }
  function learnItem(it) {
    const name = it.side ? capSide(it.side) + ' ' + it.name : it.name;
    const s = quizHist().stat[it.fma.id];
    let badge = '';
    if (s) badge = s.ok >= 5 && s.ok === s.seen && s.last === 1 ? ' <small class="ln-mast ln-ok">mastered</small>' : s.last === 0 ? ' <small class="ln-mast ln-warn">review</small>' : '';
    return `<button class="ln-item" data-key="${esc(it.key)}">${esc(name)}${badge}<small>${esc(it.fma.id)} · ${esc(it.fma.name)}</small></button>`;
  }
  function capSide(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  $('learn-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const st = getStructure(b.dataset.key);
    if (!st) return;
    if (state.isolateSystem !== st.system) {
      state.isolateSystem = st.system;
      sysBtns.forEach((x) => x.classList.toggle('active', x.dataset.system === st.system));
      applyAppearance();
    }
    selectStructure(b.dataset.key);
    refreshLearn();
  });
  $('learn-close').addEventListener('click', () => learnPanelEl().classList.add('hidden'));

  /* quiz engine (verified-only, FMA terminology) + persistent progress */
  const QUIZ_N = 8;
  const QZ_KEY = 'anatomy3d.quiz';
  const QZ_DEFAULT = () => ({ stat: {}, meta: { runs: 0, q: 0, ok: 0, best: 0, last: 0, streak: 0, day: '' } });
  let _qh = null;
  function quizHist() {
    if (_qh) return _qh;
    let h = null;
    try { h = JSON.parse(localStorage.getItem(QZ_KEY)); } catch (e) { h = null; }
    if (!h || !h.meta) h = QZ_DEFAULT();
    _qh = h;
    return _qh;
  }
  function saveQuizHist() { try { localStorage.setItem(QZ_KEY, JSON.stringify(_qh)); } catch (e) {} }
  function dayNow() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
  function masterState(st) {
    const s = quizHist().stat[st.fma.id];
    return s ? { seen: s.seen, ok: s.ok, last: s.last, mastered: s.ok >= 5 && s.ok === s.seen && s.last === 1 } : { seen: 0, ok: 0, last: 0, mastered: false };
  }
  function quizWeight(st) {
    const s = masterState(st);
    if (!s.mastered && s.seen === 0) return 5;
    const wrong = Math.min(4, s.seen - s.ok);
    return (s.last === 0 ? 2 : 0) + wrong - (s.mastered ? 4 : 0);
  }
  let quizState = null;
  function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }
  function openQuiz() {
    const pool = bodyVerified().filter((s) => s.fma && s.fma.verified && s.fma.name && s.nameFull);
    if (pool.length < 4) { toast('Need at least 4 verified structures — open more systems first.', 'warn'); return; }
    const panel = $('quiz-panel');
    closeEducationPanels(panel);
    panel.classList.remove('hidden');
    const meta = quizHist().meta;
    $('quiz-sub').textContent = 'FMA terminology · verified only' + (meta.streak ? ' · streak ' + meta.streak + ' day' + (meta.streak === 1 ? '' : 's') : '') + (meta.best ? ' · best ' + meta.best : '');
    const questions = [];
    const used = new Set();
    // least-mastered structures first so the quiz drills what you miss
    for (const st of shuffle(pool).sort((a, b) => quizWeight(b) - quizWeight(a))) {
      if (questions.length >= QUIZ_N) break;
      if (used.has(st.fma.id)) continue;
      if (questions.some((x) => x.correct.fma.name === st.fma.name)) continue;
      used.add(st.fma.id);
      const opts = [];
      const seen = new Set([st.fma.id]);
      let tries = 0;
      while (opts.length < 3 && tries < 200) {
        tries++;
        const d = pool[Math.floor(Math.random() * pool.length)];
        if (seen.has(d.fma.id)) continue;
        seen.add(d.fma.id);
        opts.push(d);
      }
      questions.push({ correct: st, opts });
    }
    if (questions.length < 3) { toast('Not enough distinct verified structures available.', 'warn'); return; }
    quizState = { questions: shuffle(questions), idx: 0, score: 0, answered: new Set() };
    renderQuiz();
  }
  function renderQuiz() {
    const panel = $('quiz-panel');
    const q = quizState.questions[quizState.idx];
    const body = $('quiz-body');
    $('quiz-score').textContent = quizState.score + '/' + quizState.questions.length;
    const opts = shuffle([q.correct, ...q.opts]).map((o) => {
      const label = capSide(o.side ? o.side + ' ' : '') + (o.name || '');
      return `<button class="qopt" data-key="${esc(o.key)}">${esc(label)}</button>`;
    }).join('');
    body.innerHTML = `
      <div class="quiz-q">${esc(q.correct.fma.name)}</div>
      <div class="quiz-opts">${opts}</div>
      <div class="quiz-progress">Question ${quizState.idx + 1} of ${quizState.questions.length} · pick the structure that matches this FMA name</div>
      <div class="quiz-meta" id="quiz-meta"></div>`;
    body.querySelectorAll('.qopt').forEach((b) => {
      b.addEventListener('click', () => answer(b));
    });
    panel.classList.remove('hidden');
  }
  function answer(btn) {
    const body = $('quiz-body');
    const q = quizState.questions[quizState.idx];
    const chosen = getStructure(btn.dataset.key) || q.correct;
    const correct = btn.dataset.key === q.correct.key;
    if (correct) quizState.score++;
    // per-structure progress: record first judgement per question, persist immediately
    if (!quizState.answered.has(q.correct.key)) {
      quizState.answered.add(q.correct.key);
      const h = quizHist();
      const id = q.correct.fma.id;
      const rec = h.stat[id] || { seen: 0, ok: 0, last: 0 };
      rec.seen++;
      if (correct) rec.ok++;
      rec.last = correct ? 1 : 0;
      h.stat[id] = rec;
      saveQuizHist();
    }
    const meta = $('quiz-meta');
    const labelOf = (s) => capSide(s.side ? s.side + ' ' : '') + (s.name || '?');
    meta.innerHTML = `Answer: <b>${labelOf(q.correct)}</b> — ${esc(q.correct.fma.id)} ${esc(q.correct.fma.name)}${correct ? '' : ' (you picked ' + esc(labelOf(chosen)) + ')'}.`;
    body.querySelectorAll('.qopt').forEach((b) => { b.disabled = true; if (b.dataset.key === q.correct.key) b.classList.add('q-correct'); });
    btn.classList.add(correct ? 'q-correct' : 'q-wrong');
    if (correct) selectStructure(q.correct.key);
    const next = setTimeout(() => {
      quizState.idx++;
      $('quiz-body').innerHTML = ''; // ensure no stale handlers
      if (quizState.idx < quizState.questions.length) renderQuiz();
      else finishQuiz();
    }, 1400);
  }
  function finishQuiz() {
    const body = $('quiz-body');
    const total = quizState.questions.length, score = quizState.score;
    // run history: totals, best, daily streak
    const h = quizHist();
    const m = h.meta;
    m.runs++;
    m.q += quizState.answered.size;
    m.ok += score;
    m.last = score;
    m.best = Math.max(m.best, score);
    const today = dayNow();
    const g = m.day ? daysBetween(m.day, today) : -1;
    if (g === 1) m.streak++;
    else if (g === 0) { /* same day: keep streak */ }
    else m.streak = 1;
    m.day = today;
    saveQuizHist();
    $('quiz-score').textContent = score + '/' + total;
    body.innerHTML = `
      <div class="quiz-q">Done — ${score} of ${total} correct (${Math.round((score / total) * 100)}%).</div>
      <div class="quiz-meta">Run #${m.runs} · streak ${m.streak} day${m.streak === 1 ? '' : 's'} · best ${m.best}
      <br>All questions used verified FMA terms only. Review the Learn panel to study anything flagged “review”.</div>
      <div class="quiz-actions">
        <button class="btn" id="quiz-retry">Retry</button>
        <button class="btn ghost" id="quiz-see">See in Learn</button>
      </div>`;
    $('quiz-retry').addEventListener('click', () => openQuiz());
    $('quiz-see').addEventListener('click', () => { $('quiz-panel').classList.add('hidden'); openLearn(); });
  }
  $('quiz-close').addEventListener('click', () => $('quiz-panel').classList.add('hidden'));

  /* ---- generic commands ---- */
  function handleCmd(cmd, el) {
    switch (cmd) {
      case 'view-front': cam.view('front'); break;
      case 'view-back': cam.view('back'); break;
      case 'view-left': cam.view('left'); break;
      case 'view-right': cam.view('right'); break;
      case 'view-top': cam.view('top'); break;
      case 'view-bottom': cam.view('bottom'); break;
      case 'reset-view': cam.resetView(); break;
      case 'focus-selected': focusSelected(); break;
      case 'quality': if (el) { const v = el.dataset.value; state.quality = v; setQuality(renderer, QUALITY[v]); toast('Quality: ' + v); } break;
      case 'screenshot':
        renderer.render(scene, cam.camera);
        const a = document.createElement('a');
        a.href = renderer.domElement.toDataURL('image/png');
        a.download = 'anatomy-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
        a.click();
        toast('Screenshot saved');
        break;
      case 'fullscreen': if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); break;
      case 'labels': $('label-overlay').classList.toggle('pinned'); break;
      case 'audio': toggleAudio(); break;
      case 'learn': openLearn(); break;
      case 'quiz': openQuiz(); break;
      case 'help': closeEducationPanels(); $('help-panel').classList.toggle('hidden'); break;
      case 'body': switchBody(el?.dataset?.body === 'female' ? 'female' : 'male'); break;
    }
  }

  /* ---- depth / xray controls ---- */
  $('depth').addEventListener('input', (e) => { state.depth = +e.target.value; $('depth-label').textContent = LAYERS[Math.min(state.depth, LAYERS.length - 1)]?.label || 'Surface'; applyAppearance(); });
  $('xray-toggle').addEventListener('change', (e) => { state.mode = e.target.checked ? 'xray' : 'normal'; applyAppearance(); });
  $('labels-pin').addEventListener('change', (e) => { $('label-overlay').classList.toggle('pinned', e.target.checked); });
  $('quality').addEventListener('change', (e) => { setQuality(renderer, QUALITY[e.target.value]); toast('Quality: ' + e.target.value); });
  if (softwareGL) {
    const s = $('quality');
    if (s) { s.value = 'low'; s.dataset.softgl = '1'; }
    setTimeout(() => toast('Software graphics detected — quality set to Low (compatibility mode). You can raise it in Settings.', 'ok'), 1200);
  }
  $('clear-selection').addEventListener('click', () => { if (sel.selected) inter.setSelected(null); });
  $('info-close').addEventListener('click', closeInfo);
  $('info-focus').addEventListener('click', focusSelected);

  /* ---- keyboard shortcuts ---- */
  document.addEventListener('keydown', (e) => {
    if (!hasActive(e)) return;
    if (e.key === 'Escape') { inter.setSelected(null); state.isolateSystem = null; sysBtns.forEach((b) => b.classList.remove('active')); for (const id of ['learn-panel', 'quiz-panel', 'info-panel']) $(id)?.classList.add('hidden'); applyAppearance(); qEl.blur(); return; }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); qEl.focus(); return; }
    if (e.key === 'f') { e.preventDefault(); focusSelected(); return; }
    if (e.key === '1') { toggleSystem('skeletal'); return; }
    if (e.key === '2') { toggleSystem('muscular'); return; }
    if (e.key === '3') { toggleSystem('cardiovascular'); return; }
    if (e.key === '4') { toggleSystem('nervous'); return; }
    if (e.key === '5') { toggleSystem('respiratory'); return; }
    if (e.key === '6') { cam.view('top'); return; }
    if (e.key === 'r') { cam.resetView(); return; }
    if (e.key === 'x') { const t = $('xray-toggle'); t.checked = !t.checked; t.dispatchEvent(new Event('change')); return; }
    if (e.key === 'm' || e.key === 'a') { toggleAudio(); return; }
    if (e.key === 'l') { $('label-overlay').classList.toggle('pinned'); const p = $('labels-pin'); p.checked = !p.checked; }
    if (e.key === '?') { $('help-panel').classList.toggle('hidden'); }
  });

  /* ---- toast ---- */
  function toast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type || 'ok');
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---- audio (generative heartbeat + breathing; narration honest-unavailable) ---- */
  const audio = createBodyAudio();
  const audioBtn = document.querySelector('[data-cmd="audio"]');
  const SOUND_KEY = 'anatomy3d.sound';
  let soundOn = true;
  try { soundOn = (localStorage.getItem(SOUND_KEY) ?? 'on') !== 'off'; } catch {}
  if (!soundOn) audio.setEnabled(false); // honored by unlock() before first gesture
  function audioLabel() {
    if (!audioBtn) return;
    audioBtn.classList.toggle('active', soundOn);
    const span = audioBtn.querySelector('span');
    if (span) span.textContent = soundOn ? 'Sound: ON' : 'Sound: OFF';
    audioBtn.title = soundOn ? 'Heartbeat & breathing — click to mute' : 'Muted — click to enable';
  }
  function toggleAudio() {
    soundOn = !soundOn;
    audio.setEnabled(soundOn);
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch {}
    audioLabel();
    toast(soundOn ? 'Heartbeat & breathing — on' : 'Muted — heartbeat & breathing off');
  }
  const firstGesture = () => { audio.unlock(); window.removeEventListener('pointerdown', firstGesture); };
  window.addEventListener('pointerdown', firstGesture);
  audioLabel();

  /* ---- body selector (male / female) ---- */
  async function switchBody(body) {
    if (state.body === body) return;
    const prev = state.body;
    state.body = body;
    telemetry.body = body;
    document.querySelectorAll('.bswitch .seg').forEach((b) => b.classList.toggle('active', b.dataset.body === body));
    state.isolateSystem = null;
    sysBtns.forEach((b) => b.classList.remove('active'));
    if (sel.selected) inter.setSelected(null);
    applyAppearance();
    if (prev === 'male' && body === 'female') {
      const need = BODIES.female.filter((g) => !state.loaded.has(g));
      if (need.length) {
        telemetry.bodyLoad = 'start';
        setLoading(0);
        $('load-text').textContent = 'Loading female body…';
        let i = 0;
        for (const g of need) { try { await ensureLoaded(g); } catch {} setLoading(Math.round((++i / need.length) * 100)); }
        setLoading(100, true);
      }
      telemetry.bodyLoad = 'done';
      updateSystemsNav();
      applyAppearance();
      cam.focusBox(sm.getBounds(), { duration: 900 });
      toast('Female model loaded (Visible-Human via HuBMAP CCF)');
    } else if (prev === 'female' && body === 'male') {
      updateSystemsNav();
      applyAppearance();
      cam.focusBox(sm.getBounds(), { duration: 900 });
      toast('Male model (Z-Anatomy / BodyParts3D)');
    }
    if (!learnPanelEl().classList.contains('hidden')) refreshLearn();
  }

  /* ---- render loop ---- */
  let ready = false;
  function tick() {
    try {
      requestAnimationFrame(tick);
      cam.controls.update();
      if (labelMesh) {
        const box = new THREE.Box3().setFromObject(labelMesh);
        const c = box.getCenter(center);
        posTmp.copy(c).project(cam.camera);
        const el = $('label-name');
        if (posTmp.z < 1) { el.style.transform = `translate(-50%, -120%) translate(${posTmp.x * 0.5 * window.innerWidth}px, ${-posTmp.y * 0.5 * window.innerHeight}px)`; el.classList.remove('hidden'); }
      }
      renderer.render(scene, cam.camera);
      cap();
      telemetry.frames++;
      if (ready && !telemetry.ready) { telemetry.ready = true; telemetry.readyAt = performance.now() - telemetry.boot; }
    } catch (e) {
      telemetry.error = telemetry.error || String(e && e.stack || e);
      requestAnimationFrame(tick);
    }
  }

  /* ---- helpers ---- */
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function SYSTEM_NAME(id) { return SYSTEMS.find((s) => s.id === id)?.name || id; }
  function groupForKey(k) {
    for (const [g, rec] of sm.groupContainers) {
      let found = false;
      rec.traverse((o) => { if (o.isMesh && o.userData.structureKey === k) { found = true; return; } });
      if (found) return g;
    }
    return null;
  }
  function setLoading(pct, done) {
    const bar = $('load-bar'), ov = $('loading');
    if (done) { bar.style.width = '100%'; telemetry.ready = true; telemetry.readyAt = performance.now() - telemetry.boot; ov.classList.add('fade'); setTimeout(() => { ov.classList.add('hidden'); ov.classList.remove('fade'); ready = true; }, 450); return; }
    bar.style.width = pct + '%';
  }

  qEl.addEventListener('input', runSearch);
  qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && qEl.value) { const res = searchStructures(qEl.value, 1); if (res[0]) selectStructure(res[0].key); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('#search-wrap')) { listEl.classList.add('hidden'); } });

  beginDefault();
  tick();
  cam.resetView();

  return { scene, renderer, cam, sm, inter, system: state };
}