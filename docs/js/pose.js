// 姿勢の定数と、腕の IK。見た目は先生が実機で確かめ、言葉でもらって数値を直す。
// 角度は rad、位置は m。骨は正規化された骨（T ポーズが 0）。
// 向き：キャラクターは +Z（こちら）を向く。キャラクターの右手側はワールドの -X、左手側は +X。
import * as THREE from 'three';

// ---------- 直しやすい数値の表 ----------

// 内気な待機：お腹の前で両手を軽く重ねる（右手が手前）。2026-11-17 先生が決定（前のプロジェクト）
export const CLASP = {
  left:  [-0.008, -0.02, 0.13],   // 左手のひらの中心（腰の骨から。+X＝キャラの左、+Z＝前）
  right: [0.008, -0.015, 0.155],  // 右手のひらの中心（右手が手前）
  thumb: [0, 1, 0.35],            // 親指の向き（上・少し前）＝手のひらが体の側を向く
  elbow: [-0.35, -0.9, -0.25],    // 肘を逃がす向き（体のそば・少し後ろ）
  shoulderFwd: 0.07,              // 肩を前へすぼめる
  shoulderUp: 0.03,               // 肩を少し上げる
  head: [0.05, 0, 0.035],         // 首：うつむき・（左右）・かしげ
  curl: 0.18,                     // 指の曲げ（0＝開く、1＝握る）。握ると重ねた手に食い込む
  pull: 0.22,                     // 手を使う動きの前半：重ねた手を離す（肩から腕を外へ開く角度）
};

// 呼吸と、体のゆらぎ
export const BREATH = {
  speed: 1.7,      // 呼吸の速さ（sin の角速度）
  spine: 0.012,    // 背骨の前後
  chest: 0.015,    // 胸の前後
  sway: 0.015,     // 背骨の左右のゆらぎ
  handLift: 0.003, // 息に合わせて手がわずかに上下
};

// 見回す（左 → 右へゆっくり）
export const LOOK = {
  yaw: 0.55,     // 首を振る大きさ（首と頭で半分ずつ）
  pitch: -0.06,  // 少し顔を上げる
  eyesX: 1.1,    // 目線を横へ（m、カメラの位置から）
  eyesY: 0.12,   // 目線を上へ
};

// 手を振る（右手）：肘は体の横・やや前、手のひらを肩の高さでこちらに向ける
export const WAVE = {
  upperArm: [-0.35, 0, 1.2],   // 上腕（X 前後、Z 下ろす）
  fore: [0.05, 0.9, 0.42],     // 前腕の向き（上・やや前）
  wrist: 0.28,                 // 手首で振る大きさ
  wristSpeed: 8,               // 手首で振る速さ
  happy: 0.6,                  // 振っている間の笑顔
};

// 頭をなでられたとき
export const PAT = {
  tilt: 0.13,     // 首をかしげる
  nod: 0.05,      // うつむく
  nodAmp: 0.025,  // 小さくうなずく大きさ
  nodSpeed: 7,
  happy: 0.9,     // うれしそうに目を細める
};

// ---------- キャラクターごとの数値（character.json の "pose"）で上書きする ----------
// 例：{ "CLASP": { "curl": 0.2, "head": [0.06, 0, 0.03] } }。書いていない数値は標準の値のまま
const TABLES = { CLASP, BREATH, LOOK, WAVE, PAT };
const DEFAULTS = JSON.parse(JSON.stringify(TABLES));
export function setPoseOverrides(over) {
  for (const [name, table] of Object.entries(TABLES)) {
    Object.assign(table, JSON.parse(JSON.stringify(DEFAULTS[name])));   // まず標準に戻す
    const o = over && over[name];
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) if (k in table) table[k] = v;
    }
  }
  applyPose.wave = null;   // 手を振る姿勢を作り直す
}

// ---------- 道具 ----------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const smooth01 = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// 二関節の簡単な IK で手首を目標 T へ（side: 'right' / 'left'）
// gripDir：手の親指側（手の +Z）を向ける向き。elbowHint：肘を逃がす向き（右腕の値。左腕は X を反転）
function armIK(B, side, T, w, gripDir, elbowHint, handW) {
  const ua = B(side + 'UpperArm'), la = B(side + 'LowerArm'), hd = B(side + 'Hand');
  if (!ua || !la || !hd) return;
  const m = side === 'right' ? 1 : -1;
  ua.parent.updateWorldMatrix(true, false);
  const pq = new THREE.Quaternion(); ua.parent.getWorldQuaternion(pq);
  const S = new THREE.Vector3(); ua.getWorldPosition(S);
  const a = la.position.length(), b = hd.position.length();
  const dv = T.clone().sub(S);
  const d = Math.min(Math.max(dv.length(), 0.05), a + b - 0.001);
  const u = dv.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const hint = elbowHint ? V3(elbowHint.x * m, elbowHint.y, elbowHint.z) : V3(-0.9 * m, -0.6, -0.1);
  const v = hint.sub(u.clone().multiplyScalar(hint.dot(u))).normalize();
  const E = S.clone().add(u.clone().multiplyScalar(a * cosA)).add(v.multiplyScalar(a * sinA));
  const upDir = E.clone().sub(S).normalize();
  const foreDir = S.clone().add(u.multiplyScalar(d)).sub(E).normalize();
  const wUa = new THREE.Quaternion().setFromUnitVectors(V3(-m, 0, 0), upDir);
  const qUa = pq.clone().invert().multiply(wUa);
  const wLa = new THREE.Quaternion().setFromUnitVectors(upDir, foreDir).multiply(wUa);
  const qLa = wUa.clone().invert().multiply(wLa);
  let qHd = new THREE.Quaternion();
  if (gripDir) {
    const z = gripDir.clone().normalize();
    const f = foreDir.clone().sub(z.clone().multiplyScalar(foreDir.dot(z))).normalize();
    const x = side === 'right' ? f.negate() : f;   // 右手の指は -X、左手の指は +X
    const y = new THREE.Vector3().crossVectors(z, x);
    const wHd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    qHd = wLa.clone().invert().multiply(wHd);
  }
  // 手首は腕より遅れて向きを変える
  const hw = handW ?? (gripDir ? smooth01((w - 0.35) / 0.65) : w);
  ua.quaternion.slerp(qUa, w); la.quaternion.slerp(qLa, w); hd.quaternion.slerp(qHd, hw);
  ua.updateMatrixWorld(true);
}

// 手のひらの中心までのずれ（手首から指の付け根の方へ、手のひら側へ）
const PALM = { along: 0.06, down: 0.03 };
function palmOffset(B, side) {
  const hd = B(side + 'Hand');
  hd.updateWorldMatrix(true, false);
  const hq = new THREE.Quaternion(); hd.getWorldQuaternion(hq);
  return V3(side === 'right' ? -PALM.along : PALM.along, -PALM.down, 0).applyQuaternion(hq);
}
// 手のひらの中心が want に来るよう、手首の目標を補正して解く
function reachPalm(B, side, want, w, dir, elbowHint, handW) {
  const names = [side + 'UpperArm', side + 'LowerArm', side + 'Hand'];
  const keep = names.map((n) => [B(n), B(n)?.quaternion.clone()]);
  let T = want.clone();
  for (let i = 0; i < 2; i++) { armIK(B, side, T, 1, dir, elbowHint); T = want.clone().sub(palmOffset(B, side)); }
  for (const [b, q] of keep) if (b && q) b.quaternion.copy(q);   // 下書きを戻してから本番
  armIK(B, side, T, w, dir, elbowHint, handW);
}

// 指の曲げ（g=0 で開いた手、1 で握った手）。左手は左右反転
const CURL = { Proximal: 1.15, Intermediate: 1.35, Distal: 0.9 };
function curlHand(B, side, g) {
  const m = side === 'right' ? 1 : -1;
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
    for (const [seg, ang] of Object.entries(CURL)) {
      const b = B(side + f + seg); if (b) b.rotation.set(0, 0, m * ang * g);
    }
  }
  const t1 = B(side + 'ThumbMetacarpal'), t2 = B(side + 'ThumbProximal'), t3 = B(side + 'ThumbDistal');
  if (t1) t1.rotation.set(0, -m * 0.45 * g, m * 0.25 * g);
  if (t2) t2.rotation.set(0, -m * 0.35 * g, m * 0.2 * g);
  if (t3) t3.rotation.set(0, -m * 0.3 * g, 0);
}

// 待機：手のひらの中心をお腹の前へ（右手が手前に重なる）。肩を少しすぼめる
// blendShoulders：VRMA が肩を動かすとき、肩を混ぜてから腕を解く（解いたあとに肩が動くと重ねた手がずれるため）
function clasp(B, breath, blendShoulders) {
  const hips = B('hips'); if (!hips) return;
  const sR = B('rightShoulder'), sL = B('leftShoulder');
  if (sR) sR.rotation.set(0, CLASP.shoulderFwd, -CLASP.shoulderUp);
  if (sL) sL.rotation.set(0, -CLASP.shoulderFwd, CLASP.shoulderUp);
  if (blendShoulders) blendShoulders();
  hips.updateWorldMatrix(true, true);
  const H = new THREE.Vector3(); hips.getWorldPosition(H);
  const thumb = V3(...CLASP.thumb).normalize(), elbow = V3(...CLASP.elbow);
  for (const side of ['left', 'right']) {
    reachPalm(B, side, H.clone().add(V3(...CLASP[side])).add(V3(0, breath * BREATH.handLift, 0)), 1, thumb, elbow);
  }
}

// 手を使う動きの前半：肘から先の形を保ったまま、肩から腕を外へ開いて重ねた手を離す（p=0 重ねたまま、1 離れた）
function pullOut(B, side, p) {
  const ua = B(side + 'UpperArm'); if (!ua || p <= 0) return;
  const m = side === 'right' ? -1 : 1;
  ua.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, m * CLASP.pull * p, 'XYZ')));
  ua.updateMatrixWorld(true);
}
// 手を使う動きの段取り：前半（0〜OUT）で手を離し、後半で目的の姿勢へ。戻すときは逆順
const OUT = 0.4;
export const pullPart = (w) => smooth01(w / OUT);
export const actPart = (w) => smooth01((w - OUT) / (1 - OUT));

// 手を振る姿勢（右腕の上腕・前腕の回転）。数値の表 WAVE から作る
function wavePose() {
  const ua = new THREE.Quaternion().setFromEuler(new THREE.Euler(...WAVE.upperArm, 'XYZ'));
  const d = V3(...WAVE.fore).normalize();
  const qWorld = new THREE.Quaternion().setFromUnitVectors(V3(-1, 0, 0), d);
  // 手のひら（はじめは下向き -Y）がこちら（+Z）を向くよう、前腕の軸まわりにひねる
  const n = V3(0, -1, 0).applyQuaternion(qWorld);
  const want = V3(0, 0, 1).projectOnPlane(d).normalize();
  const nP = n.clone().projectOnPlane(d).normalize();
  let ang = Math.acos(Math.max(-1, Math.min(1, nP.dot(want))));
  if (new THREE.Vector3().crossVectors(nP, want).dot(d) < 0) ang = -ang;
  qWorld.premultiply(new THREE.Quaternion().setFromAxisAngle(d, ang));
  return { ua, la: ua.clone().invert().multiply(qWorld) };
}

// ---------- 毎フレームの姿勢 ----------
// s：{ lookW, lookP, waveW, patW, patT, animW }（motion.js が渡す。animW＝VRMA を混ぜている重み）
// 背骨・首・頭は、今の角度（VRMA の角度、なければ元の姿勢）に小さな回転を「足し込む」。腕は IK で決める
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function applyPose(vrm, t, s) {
  const B = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const add = (b, x, y, z) => { if (b) b.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z))); };
  const breath = Math.sin(t * BREATH.speed);
  // 待機の構え（うつむき・かしげ）は VRMA の間も足し込んだまま。
  // 以前は VRMA の間だけ控えていたが、終わるときに 0.3 秒でうつむきに戻って「カクッ」とした（2026-11-20 先生）
  const stance = 1;

  // 体：呼吸とゆらぎ
  add(B('spine'), breath * BREATH.spine, 0, Math.sin(t * 0.7) * BREATH.sway);
  add(B('chest') || B('upperChest'), breath * BREATH.chest, 0, 0);

  // 腕：お腹の前で手を重ねる
  for (const side of ['left', 'right']) {
    for (const part of ['UpperArm', 'LowerArm', 'Hand']) { const b = B(side + part); if (b) b.quaternion.identity(); }
  }
  clasp(B, breath, s.blendShoulders);

  // 首と頭：少しうつむき・かしげる。見回す
  const lookYaw = s.lookW * LOOK.yaw * Math.sin(s.lookP * Math.PI * 2);
  const lookPitch = s.lookW * LOOK.pitch;
  const h = CLASP.head.map((v) => v * stance);
  add(B('neck'), h[0] * 0.5 + lookPitch, h[1] * 0.5 + Math.sin(t * 0.5) * 0.03 + lookYaw * 0.5, h[2] * 0.5);
  add(B('head'), h[0] * 0.5 + lookPitch, h[1] * 0.5 + lookYaw * 0.5, h[2] * 0.5);

  // なでられているとき（VRMA がないとき）：首を少しかしげ、小さくうなずく
  if (s.patW > 0) {
    add(B('head'), s.patW * (PAT.nod + PAT.nodAmp * Math.sin(s.patT * PAT.nodSpeed)), 0, PAT.tilt * s.patW);
  }

  // 手を振る：重ねた右手を離してから、手のひらを向けて手首で振る
  let waveAct = 0;
  if (s.waveW > 0) {
    const ua = B('rightUpperArm'), la = B('rightLowerArm'), hd = B('rightHand');
    if (ua && la) {
      if (!applyPose.wave) applyPose.wave = wavePose();
      const W = applyPose.wave;
      pullOut(B, 'right', pullPart(s.waveW));
      waveAct = actPart(s.waveW);
      ua.quaternion.slerp(W.ua, waveAct);
      la.quaternion.slerp(W.la, waveAct);
      if (hd) {
        const qHand = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), WAVE.wrist * Math.sin(t * WAVE.wristSpeed));
        hd.quaternion.slerp(qHand, waveAct);
      }
    }
  }

  // 指：ふだんはほとんど伸ばす。手を振るときは開く
  curlHand(B, 'right', CLASP.curl * (1 - waveAct));
  curlHand(B, 'left', CLASP.curl);
}
