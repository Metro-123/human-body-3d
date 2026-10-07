/* Camera rig, OrbitControls, anatomical views positioned by direction, smooth focus/framing tweens. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const HOME = new THREE.Vector3(0, 1.02, 3.4);
const HOME_TARGET = new THREE.Vector3(0, 1.05, 0);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createCameraRig(renderer) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.25;
  controls.maxDistance = 9;
  controls.target.copy(HOME_TARGET);
  camera.position.copy(HOME);
  controls.update();

  const _tweens = [];
  let animToken = 0;

  function animate({ pos, target, dur }) {
    const startP = camera.position.clone();
    const startT = controls.target.clone();
    const endP = (pos || new THREE.Vector3()).clone();
    const endT = (target || startT).clone();
    const token = ++animToken;
    const t0 = performance.now();
    const step = () => {
      if (token !== animToken) return;
      const t = Math.min(1, (performance.now() - t0) / (dur || 700));
      const e = easeInOut(t);
      camera.position.lerpVectors(startP, endP, e);
      controls.target.lerpVectors(startT, endT, e);
      controls.update();
      if (t < 1) requestAnimationFrame(step);
      else camera.position.copy(endP);
    };
    step();
  }

  function focusBox(box, opts = {}) {
    const target = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.001, box.getBoundingSphere(new THREE.Sphere()).radius);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.3;
    const camPos = camera.position.clone().sub(target).normalize().multiplyScalar(dist).add(target);
    animate({ pos: camPos, target, dur: opts.duration ?? 850 });
  }

  function fitBox(box) {
    const target = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.5;
    const dir = camera.position.clone().sub(controls.target).normalize();
    animate({ pos: new THREE.Vector3().copy(target).add(dir.normalize().multiplyScalar(dist < 1.6 ? 1.6 : dist)), target, dur: 800 });
  }

  function resetView() { animate({ pos: HOME, target: HOME_TARGET, dur: 750 }); }

  /* anatomical views: position = target +/- axis at current orbit distance */
  const dirs = {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    top: new THREE.Vector3(0, 1, 0.0001),
    bottom: new THREE.Vector3(0, -1, 0.0001),
  };
  function view(name) {
    const target = controls.target.clone();
    const d = camera.position.distanceTo(target) || 3.2;
    const dir = (dirs[name] || dirs.front).clone().normalize();
    let pos;
    if (name === 'top' || name === 'bottom') pos = target.clone().add(dir.multiplyScalar(d)).add(new THREE.Vector3(0, 0, Math.min(d * 0.35, 1.2)));
    else pos = target.clone().add(dir.multiplyScalar(d));
    animate({ pos, target, dur: 750 });
  }

  return { camera, controls, focusBox, fitBox, resetView, view, animate, _current: () => ({ pos: camera.position.clone(), target: controls.target.clone() }) };
}