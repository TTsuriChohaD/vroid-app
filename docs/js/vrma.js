// VRMA（VRM アニメーション）を読み込んで再生する
// 再生した骨の角度は「下書き」として受け取り、motion.js がコードの動きと重みで混ぜる（CLAUDE.md「7.」）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const loader = new GLTFLoader();
loader.register((p) => new VRMAnimationLoaderPlugin(p));

// ファイル（Blob）→ VRMAnimation
export async function loadVRMA(blob) {
  const gltf = await new Promise(async (res, rej) => loader.parse(await blob.arrayBuffer(), '', res, rej));
  const anim = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
  if (!anim) throw new Error('VRMA ではないファイルのようです');
  return anim;
}

// 動きの種類を、ファイルの中身だけから決める（再生しなくても一覧で分けられるように。2026-11-21 先生：スマホで、
// 一度動かすまで種類が分からなかった）。決め方は再生のときの自動と同じ：長さ 0 → pose、始めと終わりが同じで 4 秒以下 → loop、ほか → once
export async function classifyVRMA(blob) {
  try {
    const buf = await blob.arrayBuffer(), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) return null;
    const jl = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
    const binStart = 20 + jl + 8;
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 };
    // 数値の並びの「最初」と「最後」だけ読む
    const read = (i, k) => {
      const a = json.accessors[i], bv = json.bufferViews[a.bufferView], c = n[a.type];
      if (a.componentType !== 5126) return null;   // 小数（float）以外は読まない
      const stride = bv.byteStride || c * 4, off = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0) + k * stride;
      return Array.from({ length: c }, (_, j) => dv.getFloat32(off + j * 4, true));
    };
    const anim = json.animations && json.animations[0];
    if (!anim) return null;
    const hips = json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones?.hips?.node;
    let dur = 0, diff = 0;
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler], inA = json.accessors[s.input], cnt = inA.count;
      dur = Math.max(dur, inA.max ? inA.max[0] : read(s.input, cnt - 1)[0]);
      if (ch.target.path !== 'rotation' && !(ch.target.path === 'translation' && ch.target.node === hips)) continue;
      const a = read(s.output, 0), b = read(s.output, cnt - 1);
      if (!a || !b) continue;
      if (a.length === 4) diff = Math.max(diff, 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))));
      else diff = Math.max(diff, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 10);
    }
    if (dur < 0.05) return 'pose';
    return diff < 0.1 && dur <= 4 ? 'loop' : 'once';
  } catch (_) { return null; }
}

export const FADE_SEC = 0.4;   // 始め・終わりに、コードの姿勢と混ぜる時間（0.3 → 0.4、2026-11-20 終わりの「カクッ」を和らげる）
export const POSE_FADE_SEC = 1.0;   // 長さ 0 秒のポーズに入る・戻る時間（0.4 では脚が 1 コマ 18 度動いた。2026-11-21）

// VRM 1 体ぶんの再生係
// three の AnimationMixer は使わず、各トラックの値を自分で読んで骨に書く（2026-11-20）。
// AnimationMixer は「前のコマと値が同じなら骨に書かない」ので、毎フレーム姿勢を元に戻すこのページでは、
// 同じ角度を保つ間だけ骨が元の姿勢に戻り、保つ所の始めと終わりで跳ねた（前かがみの「ガクガク」の原因）
export function createPlayer(vrm) {
  // VRMA の目線を受け取る係（自動で作られると警告が出るので先に作る）
  if (vrm.lookAt && !vrm.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy)) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'VRMLookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }
  // 骨のノード名 → 骨の名前
  const nodeToBone = new Map();
  for (const name of Object.keys(vrm.humanoid.humanBones)) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (node) nodeToBone.set(node.name, name);
  }

  // 再生のしかた（2026-11-21 先生）：
  //   once：1 回再生して終わる。止める → その姿勢のまま FADE_SEC で待機に戻る
  //   loop：止めるまで繰り返す。止める → 今の 1 回を最後まで再生してから戻る（途中で切れない）
  //   pose：holdAt 秒（なければ最後）の姿勢で止まって保つ。止める → 残り（holdAt から最後まで＝起き上がるなど）を再生してから戻る
  //         長さ 0 秒の VRMA（1 つの姿勢だけ）もこれで使える
  let cur = null;   // { tracks, bones, name, mode, holdAt, t, clipT, dur, endAt, releaseAt, frozen }

  // 自動で決める：長さほぼ 0 → pose、始めと終わりの姿勢が同じで短い → loop、それ以外 → once
  function guessMode(clip) {
    if (clip.duration < 0.05) return 'pose';
    let diff = 0;
    for (const tr of clip.tracks) {
      if (!/\.(quaternion|position)$/.test(tr.name)) continue;
      const it = tr.createInterpolant();
      const a = Array.from(it.evaluate(0)), b = Array.from(it.evaluate(clip.duration));
      if (a.length === 4) diff = Math.max(diff, new THREE.Quaternion(...a).angleTo(new THREE.Quaternion(...b)));
      else diff = Math.max(diff, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 10);   // 腰の位置（1 cm ≒ 0.1）
    }
    return diff < 0.1 && clip.duration <= 4 ? 'loop' : 'once';
  }

  // fade：待機の姿勢と混ぜる時間（秒）。なければ FADE_SEC。長さ 0 秒のポーズは、姿勢が大きく変わるので POSE_FADE_SEC
  function play(vrmAnimation, name, { mode = 'auto', holdAt, fade } = {}) {
    stop();
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    const bones = new Set();
    for (const tr of clip.tracks) {
      const [node, prop] = tr.name.split('.');
      const b = nodeToBone.get(node);
      if (b && (prop === 'quaternion' || prop === 'position')) bones.add(b);
    }
    // トラックごとに「値を読む係」と「書き込む先」を用意する
    const tracks = clip.tracks.map((tr) => {
      const binding = new THREE.PropertyBinding(vrm.scene, tr.name);
      binding.bind();
      return { interp: tr.createInterpolant(), binding };
    }).filter((x) => x.binding.node);
    const dur = clip.duration;
    if (mode === 'auto' || !mode) mode = guessMode(clip);
    if (mode === 'loop' && dur < 0.05) mode = 'pose';
    cur = {
      tracks, bones, name, mode, dur, t: 0, clipT: 0,
      holdAt: mode === 'pose' ? Math.min(dur, holdAt ?? dur) : dur,
      endAt: mode === 'once' ? dur : Infinity,   // 最後の姿勢に着く時刻（ここから FADE_SEC で待機に戻る）
      releaseAt: null, frozen: null,
      fade: fade ?? (dur < 0.05 ? POSE_FADE_SEC : FADE_SEC),
      hasExpr: vrmAnimation.expressionTracks.preset.size + vrmAnimation.expressionTracks.custom.size > 0,
      hasLookAt: vrmAnimation.lookAtTrack != null,
    };
    return mode;
  }

  // すぐ片づける（次の動きを始めるとき）
  function stop() {
    if (!cur) return;
    for (const x of cur.tracks) x.binding.unbind();
    cur = null;
  }

  // 「止める」ボタン：動きに合わせて、なめらかに待機へ戻す
  function release() {
    if (!cur || cur.releaseAt != null) return;
    const c = cur;
    c.releaseAt = c.t;
    if (c.mode === 'once') { c.frozen = c.clipT; c.endAt = c.t; }                              // その姿勢のまま戻る
    else if (c.mode === 'loop') { c.endAt = (Math.floor(c.t / c.dur) + 1) * c.dur; }            // 今の 1 回を終えてから
    else { c.releaseClip = c.clipT; c.endAt = c.t + (c.dur - c.clipT); }                          // 今の所から最後まで（かがむ途中で止めても跳ばない）
  }

  // 時間を進め、骨に VRMA の角度を書き込む。戻り値：混ぜる重み（0〜1）と、動かした骨
  function update(dt) {
    if (!cur) return null;
    const c = cur;
    c.t += dt;
    if (c.t >= c.endAt + c.fade) { stop(); return null; }
    // 動きの中の時刻
    if (c.frozen != null) c.clipT = c.frozen;
    else if (c.mode === 'loop') c.clipT = c.t >= c.endAt ? c.dur : c.t % c.dur;
    else if (c.mode === 'pose') c.clipT = c.releaseAt == null ? Math.min(c.t, c.holdAt) : Math.min(c.dur, c.releaseClip + (c.t - c.releaseAt));
    else c.clipT = Math.min(c.t, c.dur);
    // 今の時刻の値を、毎フレーム必ず骨（と表情・目線）に書く
    for (const x of c.tracks) x.binding.setValue(x.interp.evaluate(c.clipT), 0);
    const fadeIn = Math.min(1, c.t / c.fade);
    const fadeOut = Math.min(1, Math.max(0, 1 - (c.t - c.endAt) / c.fade));   // 最後の姿勢に着いてから fade 秒で戻す
    const e = (x) => x * x * (3 - 2 * x);
    // finished：最後の姿勢に着いた（motion.js が最後の姿勢を持ち続ける）
    return { w: e(Math.min(fadeIn, fadeOut)), bones: c.bones, hasExpr: c.hasExpr, hasLookAt: c.hasLookAt, name: c.name,
      finished: c.t >= c.endAt };
  }

  return { play, stop, release, update,
    get playing() { return cur ? cur.name : null; }, get mode() { return cur ? cur.mode : null; },
    get releasing() { return !!(cur && cur.releaseAt != null); },
    get duration() { return cur ? cur.dur : 0; }, get time() { return cur ? cur.t : 0; }, get clipTime() { return cur ? cur.clipT : 0; } };
}
