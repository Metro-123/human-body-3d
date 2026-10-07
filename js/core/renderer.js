/* Renderer factory: color-managed, DPR-capped, resize-aware, quality-driven. */
import * as THREE from 'three';

export function createRenderer(container, quality) {
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dprCap));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const onResize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dprCap));
    if (renderer._onResizeCb) renderer._onResizeCb(w, h);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  renderer._onResizeCb = null;
  renderer._dispose = () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    renderer.dispose();
  };
  return renderer;
}

export function setQuality(renderer, quality) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dprCap));
  renderer.shadowMap.enabled = quality.shadows;
}