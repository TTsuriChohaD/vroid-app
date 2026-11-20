// 画面・描画・ファイルの読み込み
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createMotion } from './motion.js';
import { setupTouch, DEFAULT_TOUCH, EMOTIONS } from './touch.js';
import { setPoseOverrides } from './pose.js';
import { buildPack, outfitForToday } from './pack.js';
import { loadSavedPack, savePack, loadSavedModel, saveModel, deleteSaved } from './store.js';
import { loadVRMA } from './vrma.js';

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
// 最初は全身。寄る・引く・回すは指で（2026-11-20 先生：「顔に寄る」ボタンは要らない）
let headY = 1.4;
function frameView() {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // 全身（縦長の画面でも横幅がはみ出さないように）
  const h = (headY + 0.2) * 1.22, cy = (headY + 0.2) / 2 + 0.04;   // 上のボタンに髪がかからないよう余白を多めに
  const dV = (h / 2) / tan;                      // 縦に収まる距離
  const dH = (0.9 / 2) / (tan * camera.aspect);  // 横幅 0.9 m が収まる距離
  controls.target.set(0, cy, 0);
  camera.position.set(0, cy + 0.05, Math.max(dV, dH));
  controls.update();
}

// ---------- タッチ（touch.js）：部位としぐさ → touch.json（なければ標準）の反応 ----------
// キャラクターの外を 2 回タップすると、最初の見え方に戻す
const recent = [];   // くり返しを数える { region, at }
async function onTouch(region, gesture, side) {
  if (!motion) return;
  const ch = currentChar();
  const conf = (ch && ch.touch) || DEFAULT_TOUCH;
  let r = conf[region] && conf[region][gesture];
  if (!r && gesture === 'stroke') r = conf[region] && conf[region].tap;
  // 同じ部位に短い間に何度もふれたら、反応を変える
  const rep = conf.repeat;
  const now = performance.now() / 1000;
  let isRepeat = false;
  if (rep) {
    while (recent.length && now - recent[0].at > rep.withinSec) recent.shift();
    recent.push({ region, at: now });
    if (recent.filter((x) => x.region === region).length >= rep.count) { r = rep; recent.length = 0; isRepeat = true; }
  }
  if (!r) return;
  if (r.motion && r.motion.includes('{side}')) r = { ...r, motion: r.motion.replace('{side}', side || 'right') };
  lastTouch = { region, gesture, side, r };
  // ふだんは、今の動きが終わるまで次を始めない。くり返しの反応だけは、終わるのを待ってから出す（最大 4 秒）
  if (isRepeat) for (let i = 0; i < 40 && motion.busy; i++) await new Promise((res) => setTimeout(res, 100));
  await motion.react(r);
}
let lastTouch = null;
setupTouch({ canvas, camera, controls, getVrm: () => vrm, onTouch, onEmptyDoubleTap: frameView });

// ---------- 読み込み ----------
let vrm = null, motion = null;
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
  const ch = currentCharFor || null;
  motion = createMotion(vrm, camera, { getMotion, emotions: { ...EMOTIONS, ...((ch && ch.expressions) || {}) } });   // 姿勢・しぐさ・表情・目線・VRMA

  motion.update(0);
  vrm.scene.updateMatrixWorld(true);
  const hp = new THREE.Vector3();
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  if (head) { head.getWorldPosition(hp); headY = hp.y; }
  frameView();

  $('intro').hidden = true;
  setStatus('');
}

const errText = (err) => (err && err.message ? err.message : String(err));
const flash = (text, isErr) => { setStatus(text, isErr); setTimeout(() => { if (statusEl.textContent === text) setStatus(''); }, 5000); };

// ---------- フォルダ（VroidApp）：キャラクターと衣装 ----------
let pack = null;      // buildPack の結果
let currentCharFor = null;
let current = null;   // { charId, outfitId }
const PREF_KEY = 'vroid-app-pick';   // 前に選んだキャラクター・衣装（この端末だけの覚え書き）
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (_) { return null; } };
const savePref = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (_) {} };

// 動き（VRMA）：今のキャラクターの motions/ と common/motions/ から名前で探す。読んだものは覚えておく
const motionCache = new Map();
function currentChar() { return pack && current ? pack.chars.find((c) => c.id === current.charId) : null; }
async function getMotion(name) {
  const ch = currentChar();
  const path = ch && ch.motions.get(name);
  if (!path) return null;
  if (!motionCache.has(path)) motionCache.set(path, loadVRMA(pack.byPath.get(path)));
  try { return await motionCache.get(path); }
  catch (err) { motionCache.delete(path); flash('動きを読めませんでした：' + name + '（' + errText(err) + '）', true); return null; }
}

// キャラクター・衣装を決めて表示する（指定がなければ、前に選んだもの → 今月の衣装 → 先頭）
async function showFromPack(charId, outfitId) {
  const pref = loadPref() || {};
  const ch = pack.chars.find((c) => c.id === (charId || pref.charId)) || pack.chars[0];
  const of = ch.outfits.find((o) => o.id === (outfitId || (ch.id === pref.charId ? pref.outfitId : null))) || outfitForToday(ch);
  setPoseOverrides(ch.pose);
  currentCharFor = ch;   // 読み込むモデルのキャラクター（表情の組み合わせを渡すため）
  await loadArrayBuffer(await pack.byPath.get(of.path).arrayBuffer(), ch.name + '・' + of.name);
  current = { charId: ch.id, outfitId: of.id };
  savePref(current);
  $('pick').hidden = false;
}

async function usePack(entries, { save }) {
  const next = await buildPack(entries);
  if (!next.chars.length) throw new Error('VRM が見つかりませんでした（<キャラクター>/models/ に .vrm を置いてください）');
  pack = next;
  motionCache.clear();
  await showFromPack();
  if (save) {
    setStatus('保存しています…（' + fmtMB(pack.total) + '）');
    await savePack(entries);
    flash('保存しました。次からは自動で表示します');
  }
}

$('folder').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const entries = files.map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }));
  try {
    await usePack(entries, { save: true });
  } catch (err) {
    console.error(err);
    setStatus('読み込めませんでした：' + errText(err), true);
  }
});

// 切替：キャラクターと衣装を選ぶ
function fillOutfits() {
  const ch = pack.chars.find((c) => c.id === $('charSel').value) || pack.chars[0];
  $('outfitSel').innerHTML = '';
  for (const o of ch.outfits) $('outfitSel').add(new Option(o.name, o.id));
  if (current && current.charId === ch.id) $('outfitSel').value = current.outfitId;
}
$('pick').addEventListener('click', () => {
  if (!pack) return;
  $('charSel').innerHTML = '';
  for (const c of pack.chars) $('charSel').add(new Option(c.name, c.id));
  if (current) $('charSel').value = current.charId;
  fillOutfits();
  // 動きを試す：今表示しているキャラクターで使える VRMA の一覧
  const ch = currentChar();
  const names = ch ? [...ch.motions.keys()].sort() : [];
  $('motionSel').innerHTML = '';
  for (const n of names) $('motionSel').add(new Option(n + '（VRMA）', n));
  for (const [v, label] of CODE_MOTIONS) $('motionSel').add(new Option(label, v));
  $('noMotion').hidden = !!names.length;
  $('pickDlg').showModal();
});
// コードの動きも試せるように（「code:」で始まる値）
const CODE_MOTIONS = [['code:wave', '手を振る（コード）'], ['code:look', '見回す（コード）'], ['code:pat', 'なでる（頭のタップと同じ）']];
$('motionGo').addEventListener('click', async () => {
  const name = $('motionSel').value;
  $('pickDlg').close();
  if (!motion || !name) return;
  if (name === 'code:wave' || name === 'code:look') { motion.startIdle(name.slice(5)); return; }
  if (name === 'code:pat') { motion.pat(); return; }
  if (!(await motion.playMotion(name))) flash('動きが見つかりませんでした：' + name, true);
});
$('charSel').addEventListener('change', fillOutfits);
$('pickGo').addEventListener('click', async () => {
  $('pickDlg').close();
  try { await showFromPack($('charSel').value, $('outfitSel').value); }
  catch (err) { console.error(err); setStatus('読み込めませんでした：' + errText(err), true); }
});

// ---------- VRM を 1 つだけ選ぶ（試し用） ----------
$('file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';   // 同じファイルをもう一度選べるように
  if (!file) return;
  try {
    setPoseOverrides(null);
    currentCharFor = null;
    await loadArrayBuffer(await file.arrayBuffer(), file.name);
  } catch (err) {
    console.error(err);
    setStatus('読み込めませんでした：' + errText(err), true);
    return;
  }
  // 表示できたものだけ保存する。フォルダを保存していればそちらが優先されるので、VRM だけのときに使う
  try { if (!pack) await saveModel(file); }
  catch (err) { console.warn(err); flash('表示はできましたが、保存できませんでした（次も選んでください）', true); }
});

// ---------- このページについて（保存したものの確認・消す） ----------
function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }
$('about').addEventListener('click', async () => {
  const p = await loadSavedPack(), m = p ? null : await loadSavedModel();
  let info = '保存しているものはありません';
  if (p) {
    const total = p.files.reduce((s, f) => s + f.size, 0);
    const names = pack ? pack.chars.map((c) => c.name + '（衣装 ' + c.outfits.length + '）').join('、') : '';
    info = '保存しているフォルダ：' + p.files.length + ' ファイル（' + fmtMB(total) + '）' + (names ? '\nキャラクター：' + names : '');
  } else if (m) {
    info = '保存している VRM：' + m.name + '（' + fmtMB(m.size) + '）';
  }
  $('savedInfo').textContent = info;
  $('forget').hidden = !(p || m);
  $('aboutDlg').showModal();
});
$('forget').addEventListener('click', async () => {
  try {
    await deleteSaved();
    $('savedInfo').textContent = '保存したものを消しました（表示中のキャラクターは、ページを閉じるまで残ります）';
    $('forget').hidden = true;
  } catch (err) {
    $('savedInfo').textContent = '消せませんでした：' + errText(err);
  }
});

// ---------- PC で確かめるとき：tools/serve.ps1 が出す local/VroidApp をそのまま読む ----------
// （localhost で開いたときだけ。素材は PC の中のまま。保存はしない）
const onPC = ['localhost', '127.0.0.1'].includes(location.hostname);
async function loadFromPC() {
  const r = await fetch('/__pack/list', { cache: 'no-store' });
  if (!r.ok) return false;
  const list = await r.json();
  if (!list.length) return false;
  setStatus('PC の local/VroidApp を読み込み中…');
  const entries = await Promise.all(list.map(async (p) => {
    const res = await fetch('/__pack/' + p.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' });
    return { path: p, blob: await res.blob() };
  }));
  await usePack(entries, { save: false });
  flash('PC の local/VroidApp を表示しています（' + list.length + ' ファイル）');
  return true;
}

// ---------- 開いたとき：保存したフォルダ（なければ VRM）があれば自動で表示 ----------
(async () => {
  try {
    if (onPC && await loadFromPC().catch(() => false)) return;
    const p = await loadSavedPack();
    if (p) { await usePack(p.files, { save: false }); return; }
    const m = await loadSavedModel();
    if (m) { await loadArrayBuffer(await m.blob.arrayBuffer(), m.name); return; }
    $('intro').hidden = false;
  } catch (err) {
    console.error(err);
    $('intro').hidden = false;
    setStatus('保存したものを読めませんでした。もう一度フォルダを選んでください', true);
  }
})();

// PC での確かめ用（内蔵ブラウザからモデルやフォルダを渡す）
window.vroidApp = {
  loadArrayBuffer, frameView, camera, controls, usePack,
  get motion() { return motion; }, get pack() { return pack; }, get current() { return current; }, get vrm() { return vrm; },
  get lastTouch() { return lastTouch; }, onTouch,
};

// ---------- 描画のくり返し ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update();
  if (motion) motion.update(dt);   // 姿勢・しぐさ・表情・目線（カメラが動いたあとに）
  renderer.render(scene, camera);
});
