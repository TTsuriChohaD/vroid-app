// 画面・描画・ファイルの読み込み
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { applyIdle } from './pose.js';
import { loadSavedModel, saveModel, deleteSavedModel } from './store.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const setStatus = (text, isErr) => {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('err', !!isErr);
};

// ---------- 画面 ----------
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);   // 縦の視野角 26 度
camera.position.set(0, 1.0, 4);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.screenSpacePanning = true;
controls.minDistance = 0.4;
controls.maxDistance = 8;

const light = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
light.position.set(0.6, 1.2, 1.5);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.6));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- カメラの見え方 ----------
// 頭の骨の高さを基準にする（背丈が変わっても同じ見え方）
let headY = 1.4;
let closeUp = false;
function frameView() {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  if (closeUp) {
    // 顔から胸まで
    const h = 0.55, cy = headY - 0.08;
    const dV = (h / 2) / tan;                       // 縦に収まる距離
    const dH = (0.42 / 2) / (tan * camera.aspect);  // 顔と髪の横幅 0.42 m が収まる距離
    controls.target.set(0, cy, 0);
    camera.position.set(0, cy + 0.02, Math.max(dV, dH));
  } else {
    // 全身（縦長の画面でも横幅がはみ出さないように）
    const h = (headY + 0.2) * 1.22, cy = (headY + 0.2) / 2 + 0.04;   // 上のボタンに髪がかからないよう余白を多めに
    const dV = (h / 2) / tan;                      // 縦に収まる距離
    const dH = (0.9 / 2) / (tan * camera.aspect);  // 横幅 0.9 m が収まる距離
    controls.target.set(0, cy, 0);
    camera.position.set(0, cy + 0.05, Math.max(dV, dH));
  }
  controls.update();
  $('view').textContent = closeUp ? '全身' : '顔に寄る';
}
$('view').addEventListener('click', () => { closeUp = !closeUp; frameView(); });

// 2 回タップ（ダブルクリック）で最初の見え方に戻す
let lastTap = 0;
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  const now = performance.now();
  if (now - lastTap < 300) { frameView(); lastTap = 0; } else lastTap = now;
});
canvas.addEventListener('dblclick', frameView);

// ---------- 読み込み ----------
let vrm = null;
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));

async function loadArrayBuffer(ab, name) {
  setStatus('読み込み中… ' + (name || ''));
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  const next = gltf.userData.vrm;
  if (!next) throw new Error('VRM ではないファイルのようです');

  if (vrm) {   // 前のモデルを片づける
    scene.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
  }
  vrm = next;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });   // 体の一部が消えるのを防ぐ
  scene.add(vrm.scene);
  if (vrm.lookAt) vrm.lookAt.target = camera;   // 目線はこちら（カメラ）を向く

  applyIdle(vrm, 0);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const hp = new THREE.Vector3();
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  if (head) { head.getWorldPosition(hp); headY = hp.y; }
  frameView();

  $('intro').hidden = true;
  $('view').hidden = false;
  setStatus('');
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';   // 同じファイルをもう一度選べるように
  if (!file) return;
  try {
    await loadArrayBuffer(await file.arrayBuffer(), file.name);
  } catch (err) {
    console.error(err);
    setStatus('読み込めませんでした：' + (err && err.message ? err.message : err), true);
    return;
  }
  // 表示できたものだけ保存する（次に開いたとき自動で表示）
  try {
    await saveModel(file);
  } catch (err) {
    console.warn(err);
    setStatus('表示はできましたが、保存できませんでした（次も選んでください）', true);
    setTimeout(() => setStatus(''), 5000);
  }
});

// ---------- このページについて（保存した VRM の確認・消す） ----------
const fmtMB = (n) => (n / 1048576).toFixed(1) + ' MB';
$('about').addEventListener('click', async () => {
  const rec = await loadSavedModel();
  $('savedInfo').textContent = rec ? '保存している VRM：' + rec.name + '（' + fmtMB(rec.size) + '）' : '保存している VRM はありません';
  $('forget').hidden = !rec;
  $('aboutDlg').showModal();
});
$('forget').addEventListener('click', async () => {
  try {
    await deleteSavedModel();
    $('savedInfo').textContent = '保存した VRM を消しました（表示中のキャラクターは、ページを閉じるまで残ります）';
    $('forget').hidden = true;
  } catch (err) {
    $('savedInfo').textContent = '消せませんでした：' + (err && err.message ? err.message : err);
  }
});

// ---------- 開いたとき：保存した VRM があれば自動で表示 ----------
(async () => {
  const rec = await loadSavedModel();
  if (!rec) { $('intro').hidden = false; return; }
  try {
    await loadArrayBuffer(await rec.blob.arrayBuffer(), rec.name);
  } catch (err) {
    console.error(err);
    $('intro').hidden = false;
    setStatus('保存した VRM を読めませんでした。もう一度選んでください', true);
  }
})();

// PC での確かめ用（内蔵ブラウザからモデルを渡す）
window.vroidApp = { loadArrayBuffer, frameView, camera, controls };

// ---------- まばたき ----------
let nextBlink = 2, blinkStart = -1;
function blinkValue(t) {
  if (t > nextBlink && blinkStart < 0) blinkStart = t;
  if (blinkStart < 0) return 0;
  const p = (t - blinkStart) / 0.16;
  if (p >= 1) { blinkStart = -1; nextBlink = t + 2 + Math.random() * 4; return 0; }
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

// ---------- 描画のくり返し ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (vrm) {
    applyIdle(vrm, t);
    if (vrm.expressionManager) vrm.expressionManager.setValue('blink', blinkValue(t));
    vrm.update(dt);
  }
  controls.update();
  renderer.render(scene, camera);
});
