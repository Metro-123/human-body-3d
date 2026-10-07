/* Physically-plausible studio rig: IBL-based key with soft analytic accents. */
import * as THREE from 'three';

export function createLighting(scene, quality) {
  const hemi = new THREE.HemisphereLight(0xd8e4ee, 0x262b33, 0.42);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff3e8, 1.05);
  key.position.set(2.6, 4.2, 3.0);
  key.castShadow = quality.shadows;
  if (key.castShadow) {
    key.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -2.2;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbad4ea, 0.34);
  fill.position.set(-3.2, 1.8, -2.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.4);
  rim.position.set(0.8, 2.6, -3.4);
  scene.add(rim);

  const top = new THREE.DirectionalLight(0xffffff, 0.22);
  top.position.set(0, 6, 0.8);
  scene.add(top);

  // soft warm ground-contact glow on the platform
  const under = new THREE.PointLight(0xff8a5a, 0.5, 6, 2);
  under.position.set(0, -0.28, 0.6);
  scene.add(under);

  return { hemi, key, fill, rim, under };
}

/* Physically-plausible environment from a procedural studio room (IBL) */
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function createEnvironment(renderer, scene) {
  if (renderer._envLoading) return renderer._envLoading;
  renderer._envLoading = (async () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, 1024);
    scene.environment = tex;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
  })();
  return renderer._envLoading;
}