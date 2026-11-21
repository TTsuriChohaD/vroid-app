// 動きの段取り：VRMA の再生と、コードの動き（待機・見回す・手を振る・なでられる）を混ぜる。表情・まばたき・目線
//
// 毎フレームの順番（CLAUDE.md「7.」）：
//   1. 姿勢を元に戻す
//   2. VRMA を進めて、動かした骨の角度を「下書き」として控え、もう一度元に戻す
//   3. コードの手が入らない骨（脚・背骨・首など）は、元の姿勢から VRMA の角度へ重み w で近づける
//   4. コードの動き：背骨・首は ① 足し込む、腕は IK で決める
//   5. 腕・肩・指（入れ替える骨）は、コードの姿勢から VRMA の角度へ重み w で近づける ＝ ② 切り替える
//   6. 表情・まばたき・目線（③ 見る先だけ決める）→ vrm.update()
import * as THREE from 'three';
import { applyPose, LOOK, WAVE, PAT, HAND_MOTIONS } from './pose.js';
import { createPlayer } from './vrma.js';

// 待機中のしぐさ
const IDLE = {
  firstAt: 10,            // 開いてから最初のしぐさまで（秒）
  gapMin: 10, gapMax: 20, // しぐさの間隔（秒）
  dur: { look: 4.0, wave: 5.0 },
  fade: { look: 0.2, wave: 0.32 },   // 始め・終わりのなめらかさ（手を使う動きは手を離す分ゆっくり）
  waveRate: 0.5,          // 手を振る割合（残りは見回す）
};
const PAT_DUR = 2.2;            // なでられて喜ぶ長さ（秒）。VRMA がないときのコードの動き
const PAT_MOTION = 'pat_happy'; // なでられたときの大きな動き（VRMA の名前）。なければコードの動き

// 入れ替える骨（コードが IK や指で決める骨）。それ以外は足し込み
const REPLACE = /(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/;

const lerpK = (k, dt) => 1 - Math.pow(1 - k, dt * 60);   // 1/60 秒あたり k ずつ近づく

// 目線のずらし方（カメラの位置から、m）
const LOOK_AT = { away: [0.7, -0.15], down: [0.1, -0.6] };

// getMotion(name)：その名前の VRMA（VRMAnimation）を返す。なければ null
// emotions：表情の組み合わせ { 名前: { 表情名: 重み } }（touch.js の EMOTIONS ＋ character.json の "expressions"）
export function createMotion(vrm, camera, { getMotion = async () => null, emotions = {} } = {}) {
  let t = 0;
  let idleType = null, idleStart = 0, idleW = 0, idleP = 0;
  let nextIdleAt = IDLE.firstAt;
  let patAt = -99, patByVRMA = false;
  let emo = null;            // 今の感情の表情 { weights: {表情名: 重み}, until, fadeSec }
  const face = {};           // 表情名 → 今の重み（なめらかに動かす）
  let lookAway = null;       // { dir: [x, y], until }
  let nextBlink = 2, blinkStart = -1;
  const em = vrm.expressionManager;
  const hasExpr = (n) => !!(em && em.getExpression(n));
  const look = [0, 0];
  const lookTarget = new THREE.Object3D();
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;
  const player = createPlayer(vrm);

  const H = vrm.humanoid;
  const node = (n) => H.getNormalizedBoneNode(n);
  const restHips = node('hips') ? node('hips').position.clone() : new THREE.Vector3();
  function resetPose() {
    if (H.resetNormalizedPose) H.resetNormalizedPose();
    else for (const n of Object.keys(H.humanBones)) { const b = node(n); if (b) b.quaternion.identity(); }
    const hips = node('hips'); if (hips) hips.position.copy(restHips);
  }

  function startIdle(type) {
    idleType = type; idleStart = t; idleP = 0; idleW = 0;
    nextIdleAt = t + IDLE.dur[type] + IDLE.gapMin + Math.random() * (IDLE.gapMax - IDLE.gapMin);
  }

  function updateIdle(dt) {
    // VRMA が始まったら、待機のしぐさ（見回す・手を振る）は 0.35 秒でなめらかに消す
    // （前はすぐ消していたので、見回している途中に動きを始めると、頭が 1 コマで 20 度跳んだ。2026-11-21）
    if (player.playing) {
      if (idleType) { idleW = Math.max(0, idleW - dt / 0.35); if (idleW <= 0) idleType = null; }
      nextIdleAt = Math.max(nextIdleAt, t + IDLE.gapMin);
      return;
    }
    if (idleType) {
      idleP = (t - idleStart) / IDLE.dur[idleType];
      if (idleP >= 1) { idleType = null; idleW = 0; return; }
      const f = IDLE.fade[idleType], e = (x) => x * x * (3 - 2 * x);
      idleW = idleP < f ? e(idleP / f) : idleP > 1 - f ? e((1 - idleP) / f) : 1;
    } else if (t > nextIdleAt) {
      startIdle(Math.random() < IDLE.waveRate ? 'wave' : 'look');
    }
  }

  function patW() {
    const p = (t - patAt) / PAT_DUR;
    return p < 0 || p > 1 ? 0 : Math.sin(Math.PI * p);
  }

  function blinkValue() {
    if (t > nextBlink && blinkStart < 0) blinkStart = t;
    if (blinkStart < 0) return 0;
    const p = (t - blinkStart) / 0.16;
    if (p >= 1) { blinkStart = -1; nextBlink = t + 2 + Math.random() * 4; return 0; }
    return p < 0.5 ? p * 2 : 2 - p * 2;
  }

  const snap = new Map();
  const snapHips = new THREE.Vector3();
  const qId = new THREE.Quaternion();

  function update(dt) {
    t += dt;
    updateIdle(dt);

    // 1〜3. 元に戻す → VRMA の下書き → コードの入らない骨を重みで
    resetPose();
    const a = player.update(dt);
    const hips = node('hips');
    // 最後まで再生したあと（終わりに混ぜている間）は、最後の姿勢をそのまま使う
    // （three は終わったあと骨を書かないので、読み直すと「回転なし」から戻ることになり、肩などが一瞬跳ねた）
    if (a && !(a.finished && snap.size)) {
      snap.clear();
      for (const b of a.bones) { const n = node(b); if (n) snap.set(b, n.quaternion.clone()); }
      if (hips) snapHips.copy(hips.position);
    }
    // VRMA が終わったフレームは、three の再生係が「再生を始めたときの姿勢」を骨に書き戻す。
    // そのまま使うと 1 フレームだけ姿勢が飛ぶ（2026-11-20「カクッ」の原因）ので、毎回ここで戻し直す
    resetPose();
    if (a) {
      for (const [b, q] of snap) if (!REPLACE.test(b)) node(b).quaternion.copy(qId).slerp(q, a.w);
      if (a.bones.has('hips') && hips) hips.position.lerpVectors(restHips, snapHips, a.w);
    }
    const animW = a ? a.w : 0;

    // 4. コードの動き
    const pw = patW();
    const lookW = idleType === 'look' ? idleW : 0;
    const waveW = idleType === 'wave' ? idleW : 0;
    const isShoulder = (b) => /Shoulder$/.test(b);
    const blendShoulders = a ? () => { for (const [b, q] of snap) if (isShoulder(b)) { node(b).quaternion.slerp(q, a.w); node(b).updateMatrixWorld(true); } } : null;
    // 手をひざに置く動き（前かがみ）：VRMA の時刻に合わせて、手を置く重みを決める
    const hm = a && HAND_MOTIONS[a.name];
    let kneesW = 0;
    if (hm && hm.pose === 'knees') {
      const [t0, t1, t2, t3] = hm.times, pt = player.clipTime;   // 動きの中の時刻（ポーズで保っている間は止まっている）
      // 直線で渡す（pose.js の側で、手を離す・置く段取りがなめらかにつなぐ。ここでもなめらかにすると途中が速くなりすぎた）
      const lin = (x) => Math.min(1, Math.max(0, x));
      kneesW = Math.min(lin((pt - t0) / (t1 - t0)), 1 - lin((pt - t2) / (t3 - t2)));
    }
    applyPose(vrm, t, { lookW, lookP: idleP, waveW, patW: patByVRMA ? 0 : pw, patT: t - patAt, animW, blendShoulders, kneesW });

    // 5. 腕・指は、コードの姿勢から VRMA へ切り替える（肩は腕を解く前に混ぜてある）
    if (a) for (const [b, q] of snap) if (REPLACE.test(b) && !isShoulder(b)) node(b).quaternion.slerp(q, a.w);

    // 6. 表情：手を振る間はにっこり、感情の表情（タッチ・セリフ）は決めた時間だけ。VRMA に表情が入っていれば、そちらに任せる
    const vrmaFace = a && a.hasExpr && a.w > 0.5;
    if (em && !vrmaFace) {
      const target = {};
      const put = (n, w) => { if (hasExpr(n)) target[n] = Math.max(target[n] || 0, w); };
      put('happy', WAVE.happy * waveW);
      if (!patByVRMA && pw > 0 && !emo) put('happy', PAT.happy * pw);   // VRMA がないときの、なでられた表情
      if (emo && t < emo.until) for (const [n, w] of Object.entries(emo.weights)) put(n, w);
      // fadeSec でおよそ 95% まで移る速さ（感情の表情がないときは前と同じ速さ）
      const k = lerpK(emo ? 1 - Math.pow(0.05, 1 / (60 * Math.max(0.05, emo.fadeSec))) : 0.1, dt);
      for (const n of new Set([...Object.keys(face), ...Object.keys(target)])) {
        face[n] = (face[n] || 0) + ((target[n] || 0) - (face[n] || 0)) * k;
        em.setValue(n, face[n]);
      }
      if (emo && t >= emo.until + emo.fadeSec * 2) emo = null;
      // 目を細める表情の間はまばたきしない（モデルに overrideBlink があれば three-vrm がそちらも守る）
      const eyesClosed = Math.max(face.happy || 0, (face.relaxed || 0) * 0.8);
      em.setValue('blink', blinkValue() * (1 - Math.min(1, eyesClosed * 1.5)));
    }

    // 目線：ふだんはこちら（カメラ）。見回す間は横へ、照れたときはそらす・伏せる。VRMA に目線が入っていれば、そちらに任せる
    if (vrm.lookAt) vrm.lookAt.target = a && a.hasLookAt && a.w > 0.5 ? null : lookTarget;
    const away = lookAway && t < lookAway.until ? lookAway.dir : [0, 0];
    const lx = lookW * LOOK.eyesX * Math.sin(idleP * Math.PI * 2) + away[0], ly = lookW * LOOK.eyesY + away[1];
    look[0] += (lx - look[0]) * lerpK(0.12, dt);
    look[1] += (ly - look[1]) * lerpK(0.12, dt);
    lookTarget.position.copy(camera.position).add(new THREE.Vector3(look[0], look[1], 0));

    vrm.update(dt);
  }

  // VRMA を再生する（見つからなければ false）
  async function playMotion(name, opts) {
    const anim = await getMotion(name);
    if (!anim) return false;
    snap.clear();   // 待機のしぐさは updateIdle がなめらかに消す
    return player.play(anim, name, opts) || true;   // 再生のしかた（once / loop / pose）を返す
  }

  // 感情の表情を出す。spec：EMOTIONS の名前（"shy"）／{ name, weight, fadeSec }／{ 表情名: 重み }
  function setEmotion(spec, holdSec = 2.5) {
    if (!spec) return;
    let weights, fadeSec = 0.3;
    if (typeof spec === 'string') weights = emotions[spec] || { [spec]: 1 };
    else if (spec.name) { weights = Object.fromEntries(Object.entries(emotions[spec.name] || { [spec.name]: 1 }).map(([n, w]) => [n, w * (spec.weight ?? 1)])); fadeSec = spec.fadeSec ?? fadeSec; }
    else weights = spec;
    emo = { weights, until: t + holdSec, fadeSec };
  }

  // 反応する（タッチ・セリフから）。r：{ motion, expression, look, holdSec }
  // 今の動き（VRMA・手を振る）が終わるまでは、次を始めない（false を返す）
  async function react(r) {
    if (player.playing || idleType === 'wave') return false;
    const m = r.motion || '';
    let dur = 2.5;
    if (m === 'code:wave' || m === 'code:look') { startIdle(m.slice(5)); dur = IDLE.dur[m.slice(5)]; }
    else if (m) {
      const ok = await playMotion(m, { mode: 'once' });   // 触ったときの反応は 1 回だけ（始めと終わりが同じでも繰り返さない）
      if (!ok && m === PAT_MOTION) { patAt = t; patByVRMA = false; dur = PAT_DUR; }   // pat_happy がなければ前のコードの動き
      else if (ok) { patByVRMA = true; dur = player.duration || dur; }
      // ほかの動きが見つからなければ、表情と目線だけ（「8.」の決まり）
    }
    const hold = r.holdSec ?? dur;
    setEmotion(r.expression, hold);
    if (r.look && LOOK_AT[r.look]) lookAway = { dir: LOOK_AT[r.look], until: t + hold };
    return true;
  }

  // 頭がタップされた（前の呼び方。今は react を使う）
  function pat() { return react({ motion: PAT_MOTION, expression: 'happy' }); }

  return { update, pat, react, setEmotion, startIdle, playMotion, stopMotion: () => player.stop(), releaseMotion: () => player.release(),
    get playing() { return player.playing; }, get mode() { return player.mode; }, get releasing() { return player.releasing; },
    get busy() { return !!player.playing || idleType === 'wave'; } };
}

// 画面の点 (x, y) が頭に当たっているか（頭の骨を画面に写して判定）
export function headHit(vrm, camera, canvas, x, y) {
  const head = vrm && vrm.humanoid.getNormalizedBoneNode('head');
  if (!head) return false;
  const c = new THREE.Vector3(); head.getWorldPosition(c); c.y += 0.08;   // 頭の骨は首の付け根寄りなので、頭の真ん中へ
  const rect = canvas.getBoundingClientRect();
  const toScreen = (v) => { const p = v.clone().project(camera); return [rect.left + (p.x + 1) / 2 * rect.width, rect.top + (1 - p.y) / 2 * rect.height]; };
  const [cx, cy] = toScreen(c), [tx, ty] = toScreen(c.clone().add(new THREE.Vector3(0, 0.13, 0)));
  return Math.hypot(x - cx, y - cy) < Math.hypot(tx - cx, ty - cy) * 1.3;   // 頭の大きさに少し余裕を持たせる
}
