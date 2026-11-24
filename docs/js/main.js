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
import { loadVRMA, classifyVRMA } from './vrma.js';
import { setupSprings } from './springs.js';
import { createLook } from './look.js';
import { createLookPanel } from './lookpanel.js';
import { createSpringTouch } from './springtouch.js';
import { createAR } from './ar.js';

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

// 光・材質・画面全体の効果・立体視（確かめ用）・FPS は look.js（見た目のテスト。2026-11-24）
// 光は今までと同じ（斜め前からの光 π×0.9 と全体の明るさ 0.6）から始める
const look = createLook(renderer, scene, camera);
const lookPanel = createLookPanel($('lookBody'), look, { flash: (t, e) => flash(t, e) });
look.setFpsElement($('fps'));
lookPanel.onBuilt = (S) => { $('fps').hidden = !S.fps; };
lookPanel.build();

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
// touch.json の反応（部位 → しぐさ）。springTouch（揺れものの数値）だけを書いた touch.json なら、反応は標準のまま
const touchConf = (ch) => (ch && ch.touch && Object.keys(ch.touch).some((k) => k !== 'springTouch') ? ch.touch : DEFAULT_TOUCH);
async function onTouch(region, gesture, side) {
  if (!motion) return;
  const ch = currentChar();
  const conf = touchConf(ch);
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
setupTouch({ canvas, camera, controls, getVrm: () => vrm, onTouch, onEmptyDoubleTap: frameView,
  // 揺れものが触り方に応じて揺れる（springtouch.js）：触れた所に見えない手、なでる向きに一時的な力
  onPress: (h, x, y) => { if (springTouch) springTouch.press(h, x, y); },
  onStrokeMove: (x, y) => { if (springTouch) springTouch.move(x, y); },
  onRelease: () => { if (springTouch) springTouch.release(); },
  getMode: () => touchMode });
let springTouch = null;

// 触れるモード／視点モード（上のボタン 1 つで切り替える。2026-11-24 先生：上に並べ、説明は出さない）。前に選んだ方を覚える
const MODE_KEY = 'vroid-app-mode';
let touchMode = (() => { try { return localStorage.getItem(MODE_KEY) === 'view' ? 'view' : 'touch'; } catch (_) { return 'touch'; } })();
function showMode() {
  const b = $('modeBtn');
  b.dataset.mode = touchMode;
  const t = touchMode === 'touch' ? '触れるモード（押すと視点モード）' : '視点モード（押すと触れるモード）';
  b.title = t; b.setAttribute('aria-label', t);
}
$('modeBtn').addEventListener('click', () => {
  touchMode = touchMode === 'touch' ? 'view' : 'touch';
  try { localStorage.setItem(MODE_KEY, touchMode); } catch (_) {}
  if (springTouch) springTouch.release();
  controls.enabled = true;
  showMode();
});
showMode();

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
  setupSprings(vrm, ch && ch.springs);   // 揺れもの（胸・スカート）が腕・手に当たるように。元の姿勢のうちに呼ぶ
  look.attach(vrm);                       // 見た目のテスト：材質の元の値を覚え、今の設定をかける（VRM ファイルは変えない）
  if (springTouch) springTouch.setDebug(false, scene);
  springTouch = createSpringTouch(vrm, camera, canvas, ch && ch.touch && ch.touch.springTouch);   // 数値は touch.json の springTouch で上書き
  lookPanel.useCharacter(ch ? ch.id : 'default', ch && ch.look);
  motion = createMotion(vrm, camera, { getMotion, emotions: { ...EMOTIONS, ...((ch && ch.expressions) || {}) } });   // 姿勢・しぐさ・表情・目線・VRMA

  motion.update(0);
  vrm.scene.updateMatrixWorld(true);
  const hp = new THREE.Vector3();
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  if (head) { head.getWorldPosition(hp); headY = hp.y; }
  if (!ar.active) frameView();
  showArBtn();

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
  $('motionBtn').hidden = false;
}

async function usePack(entries, { save }) {
  const next = await buildPack(entries);
  if (!next.chars.length) throw new Error('VRM が見つかりませんでした（<キャラクター>/models/ に .vrm を置いてください）');
  pack = next;
  motionCache.clear();
  seenMode.clear();
  classifying = classifyAll(next);   // 動きの種類を先に調べておく（一覧を開いたときに分けて出せるように）
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
// 上のボタンで開く画面：同じボタンをもう一度押すと閉じる。ほかの画面は閉じる（2026-11-21 先生）
// 画面は modal にしないので、開いたままでも上のボタンを押せる。キャラクターの所を触っても閉じる
const PANELS = [['pick', 'pickDlg'], ['motionBtn', 'motionDlg'], ['lookBtn', 'lookDlg'], ['about', 'aboutDlg']];
function closePanels(except) {
  for (const [btn, dlg] of PANELS) if (dlg !== except && $(dlg).open) $(dlg).close();
}
function togglePanel(dlg, fill) {
  if ($(dlg).open) { $(dlg).close(); return; }
  closePanels(dlg);
  fill();
  $(dlg).show();
}
for (const [btn, dlg] of PANELS) {
  $(dlg).addEventListener('close', () => $(btn).setAttribute('aria-expanded', 'false'));
  new MutationObserver(() => $(btn).setAttribute('aria-expanded', String($(dlg).open))).observe($(dlg), { attributes: true, attributeFilter: ['open'] });
}
// 見た目の調整パネルは、キャラクターを見ながら動かすので、画面を触っても閉じない
canvas.addEventListener('pointerdown', () => { for (const [, dlg] of PANELS) if (dlg !== 'lookDlg' && $(dlg).open) $(dlg).close(); });
$('lookBtn').addEventListener('click', () => togglePanel('lookDlg', () => lookPanel.build()));

$('pick').addEventListener('click', () => {
  if (!pack) return;
  togglePanel('pickDlg', fillPick);
});
function fillPick() {
  $('charSel').innerHTML = '';
  for (const c of pack.chars) $('charSel').add(new Option(c.name, c.id));
  if (current) $('charSel').value = current.charId;
  fillOutfits();
}

// ---------- 動き：一覧から選んで再生、「止める」で待機に戻る（2026-11-21 先生） ----------
// 種類（motions.json の type。なければ自動で決め、一度再生したら覚える）：once 1 回／loop 繰り返し／pose ポーズ
const MODE_LABEL = { pose: 'ポーズ', loop: '繰り返し', once: '一連の動き' };
const seenMode = new Map();   // 自動で決まった種類（道すじ → mode）。ファイルの中身から先に調べる（classifyAll）
let classifying = null;
async function classifyAll(p) {
  const paths = new Set();
  for (const c of p.chars) for (const path of c.motions.values()) paths.add(path);
  for (const path of paths) {
    const mode = await classifyVRMA(p.byPath.get(path));
    if (mode && pack === p) seenMode.set(path, mode);
  }
}
let menuMotion = null;        // 一覧から再生している動きの名前（止めるボタンを出す）
// 触ったときの反応に使う動き（自動で再生するので一覧に出さない）
function touchMotionNames(ch) {
  const conf = touchConf(ch), names = new Set();
  const add = (m) => { if (!m || m.startsWith('code:')) return; if (m.includes('{side}')) { names.add(m.replace('{side}', 'left')); names.add(m.replace('{side}', 'right')); } else names.add(m); };
  for (const [k, v] of Object.entries(conf)) { if (k === 'repeat') add(v.motion); else for (const r of Object.values(v || {})) add(r && r.motion); }
  return names;
}
// PC で確かめるときだけ、コードの動き（ふだんは自動で動く）も並べる
const CODE_MOTIONS = [['code:wave', '手を振る'], ['code:look', '見回す'], ['code:pat', 'なでる']];
function motionItems(ch) {
  const hide = touchMotionNames(ch), conf = ch.motionConf || {};
  return [...ch.motions.keys()]
    .filter((n) => !(conf[n] && conf[n].menu === false) && !(hide.has(n) && !(conf[n] && conf[n].menu === true)))
    .map((n) => ({ id: n, label: (conf[n] && conf[n].name) || n, mode: (conf[n] && conf[n].type) || seenMode.get(ch.motions.get(n)) || null }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}
$('motionBtn').addEventListener('click', () => {
  const ch = currentChar();
  if (!ch) return;
  // 一覧から選んだ動きの間は ■：押すと止める
  if ($('motionBtn').classList.contains('playing')) { if (motion) motion.releaseMotion(); return; }
  togglePanel('motionDlg', () => fillMotionList(ch));
  // 種類を調べ終わっていなければ、終わったら並べ直す
  if (classifying && $('motionDlg').open) classifying.then(() => { if ($('motionDlg').open) fillMotionList(ch); });
});
function fillMotionList(ch) {
  const list = $('motionList');
  list.innerHTML = '';
  const items = motionItems(ch);
  const groups = [['pose', 'ポーズ'], ['loop', '繰り返し'], ['once', '一連の動き'], [null, '動き']];
  for (const [mode, title] of groups) {
    const g = items.filter((it) => it.mode === mode);
    if (!g.length) continue;
    addGroup(title, g.map((it) => [it.id, it.label]));
  }
  if (onPC) addGroup('確かめ用（PC だけ。ふだんは自動で動く）', CODE_MOTIONS);
  $('noMotion').hidden = !!items.length;
  function addGroup(title, arr) {
    const h = document.createElement('h3'); h.textContent = title; list.append(h);
    const box = document.createElement('div'); box.className = 'items'; list.append(box);
    for (const [id, label] of arr) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label;
      b.addEventListener('click', () => { $('motionDlg').close(); startMotion(id, label); });
      box.append(b);
    }
  }
}
let menuLabel = '', menuExpr = false;
async function startMotion(id, label) {
  if (!motion) return;
  if (id === 'code:wave' || id === 'code:look') { motion.startIdle(id.slice(5)); return; }
  if (id === 'code:pat') { motion.pat(); return; }
  const c = (currentChar().motionConf || {})[id] || {};
  // ほかの動きの途中なら、先にその動きを終えて待機に戻ってから始める（いきなり切り替えると姿勢が跳ぶ）
  if (motion.playing) {
    motion.releaseMotion();
    menuMotion = null;
    for (let i = 0; i < 80 && motion.playing; i++) await new Promise((r) => setTimeout(r, 50));
  }
  const mode = await motion.playMotion(id, { mode: c.type || 'auto', holdAt: c.holdAt, fade: c.fade });
  if (!mode) { flash('動きが見つかりませんでした：' + id, true); return; }
  if (!c.type && typeof mode === 'string') seenMode.set(currentChar().motions.get(id), mode);
  // 動きの間の表情（motions.json の expression。例 { "ou": 0.7 }＝口を「う」、"happy"）。止めると戻す
  if (c.expression) motion.setEmotion(c.expression, Infinity);
  menuExpr = !!c.expression;
  menuMotion = id;
  menuLabel = label + (typeof mode === 'string' ? '（' + MODE_LABEL[mode] + '）' : '');
}
// 「動き」のボタンは、一覧から再生した動きが続いている間だけ ■（止める）にする（止め始めたら ▶ に戻す）
function updateStopButton() {
  const show = !!(motion && menuMotion && motion.playing === menuMotion && !motion.releasing);
  if (!show && menuExpr && motion) { motion.clearEmotion(); menuExpr = false; }   // 止め始めたら表情も戻す
  if (!show && menuMotion && !(motion && motion.playing === menuMotion)) menuMotion = null;
  const b = $('motionBtn');
  if (b.classList.contains('playing') !== show) {
    b.classList.toggle('playing', show);
    const t = show ? '止める：' + menuLabel : '動き';
    b.title = t; b.setAttribute('aria-label', t);
  }
}
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
  if ($('aboutDlg').open) { $('aboutDlg').close(); return; }
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
  togglePanel('aboutDlg', () => {});
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
  loadArrayBuffer, frameView, camera, controls, usePack, renderer, scene,
  get motion() { return motion; }, get pack() { return pack; }, get current() { return current; }, get vrm() { return vrm; },
  get lastTouch() { return lastTouch; }, onTouch, look, get springTouch() { return springTouch; }, get ar() { return ar; },
};

// ---------- AR（ar.js。2026-11-24 先生：立体視より先に AR） ----------
// 床の白い輪をタップ → そこに実寸で立つ（こちら向き）。キャラクターにふれたら部位の反応、外をタップしたら置き直す
// AR の間は、ページのボタンだけをカメラの映像の上に重ねる（指で回す・寄る操作と、画面の効果は止める）
const ar = createAR({
  renderer, scene, camera, getVrm: () => vrm,
  onTap: (region, side) => { if (region) onTouch(region, 'tap', side); },
  onAnyTap: () => closePanels(),
  onStart: () => {
    document.documentElement.classList.add('ar');
    $('arBtn').classList.add('on');
    controls.enabled = false;
    if (springTouch) springTouch.release();
  },
  onEnd: () => {
    document.documentElement.classList.remove('ar');
    $('arBtn').classList.remove('on');
    controls.enabled = true;
    resize();
    frameView();
    setStatus('');
  },
  hint: (t) => setStatus(t),
});
let arOk = false;
ar.supported().then((ok) => { arOk = ok; showArBtn(); });
function showArBtn() { $('arBtn').hidden = !(arOk && vrm); }
$('arBtn').addEventListener('click', async () => {
  if (ar.active) { ar.end(); return; }
  closePanels();
  try { await ar.start(); }
  catch (err) { console.error(err); flash('AR を始められませんでした：' + errText(err), true); }
});
// AR の間、ページのボタンを押したときは「タップ」（置く・触れる）にしない
document.addEventListener('beforexrselect', (e) => {
  if (e.target && e.target.closest && e.target.closest('button, label, select, input, dialog, .bar, #status')) e.preventDefault();
});

// ---------- 描画のくり返し ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (ar.active) ar.update(frame); else controls.update();
  if (springTouch && vrm) {
    springTouch.update(dt);   // 触れている間の力を揺れものに足し込む（vrm.update の前に）
    // 頭をなでている間の小さな反応：手が頭のどちら側か（キャラの左＝+1）
    let side = 0;
    const hp = springTouch.handPoint, head = vrm.humanoid.getNormalizedBoneNode('head');
    if (hp && head) side = Math.max(-1, Math.min(1, head.worldToLocal(hp.clone()).x / 0.06));
    if (motion) motion.setStroke(springTouch.stroking, side);
    springTouch.setDebug(!!look.settings.springDebug, scene);
  }
  if (motion) motion.update(dt);   // 姿勢・しぐさ・表情・目線（カメラが動いたあとに）
  if (springTouch) springTouch.updateDebug();
  updateStopButton();
  if (ar.active) renderer.render(scene, camera);   // AR は XR の画面にそのまま描く（画面の効果・立体視は使わない）
  else look.render();   // 立体視・画面全体の効果があればここで（なければ今までと同じ描き方）
});
