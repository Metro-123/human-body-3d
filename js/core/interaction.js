/* Raycast hover/select on bodies. Dispatch via event callbacks. */
import * as THREE from 'three';
import { storeBaseEmissive, setHighlight } from './materials.js';

export function createInteraction(renderer, camera, sm, callbacks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 18;
  const pointer = new THREE.Vector2(-2, -2);
  let hovered = null;
  let selected = null;
  let lastMove = 0;
  let downPos = null;
  let movedBeyond = false;
  let enabled = true;

  function pick(clients) {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((pointer.x - rect.left) / rect.width) * 2 - 1;
    const ny = -(((pointer.y - rect.top) / rect.height) * 2 - 1);
    pointer.x = nx; pointer.y = ny;
    raycaster.setFromCamera(pointer, camera);
    const list = clients && clients.length ? clients : sm.getSelectables();
    return raycaster.intersectObjects(list, false)[0] || null;
  }

  function onMove(e) {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastMove < 48) return;
    lastMove = now;
    pointer.set(e.clientX, e.clientY);
    const hit = pick();
    if (hit && hit.object.userData.selectable === false) { return; }
    const m = hit ? hit.object : null;
    if (m === hovered) return;
    if (hovered) setHighlight(hovered, 'none');
    hovered = m;
    storeBaseEmissive(m);
    if (hovered) { setHighlight(hovered, 'hover'); callbacks.hover?.(hovered); } else callbacks.leave?.();
    if (renderer.domElement.style) renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
  }

  function onDown(e) { downPos = { x: e.clientX, y: e.clientY }; movedBeyond = false; }
  function onUp(e) {
    if (!enabled || !downPos) return;
    const dx = e.clientX - downPos.x, dy = e.clientY - downPos.y;
    downPos = null;
    if (Math.hypot(dx, dy) > 6) return; // drag; no select
    const hit = pick();
    if (hit && hit.object.userData.selectable === false) { return; }
    setSelected(hit ? hit.object : null);
  }

  function setSelected(mesh) {
    if (selected === mesh) { callbacks.activate?.(); return; }
    if (selected) setHighlight(selected, 'none');
    selected = mesh;
    if (selected) { storeBaseEmissive(selected); setHighlight(selected, 'select'); }
    callbacks.select?.(mesh);
  }

  function clearHover() { if (hovered) { setHighlight(hovered, 'none'); hovered = null; } }

  const el = renderer.domElement;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  return {
    setEnabled: (v) => { enabled = v; if (!v) clearHover(); },
    get hovered() { return hovered; },
    get selected() { return selected; },
    setSelected,
    clearHover,
    dispose: () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); },
  };
}