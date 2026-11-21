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

// 手をひざに置く（前かがみ。2026-11-20 先生）。値はキャラクターの左手側。右手側は X を反転する
export const KNEES = {
  // 手は「ひざの上の太もも」に、手のひらを太ももにくっつけて置く（2026-11-21 先生：多少食い込んでもよいので、くっついているほうがいい）。
  // 太ももの骨の線（ひざ → 脚の付け根）を基準に決める
  along: 0.1,                // ひざから太ももに沿って上へ（m）。腕がまっすぐになるよう、下の slide の範囲で自動でずらす
  surface: 0.045,            // 太ももの骨の線から手のひらまで（m）。パープルのひざ上の太さ約 0.047〜0.05 より少し小さく＝少し食い込む
  inward: 0.015,             // 体の内側へ（m）。両手が内側で軽く重なる（2026-11-21 先生：手が軽く重なるくらい腕は内側に）
  rightOnTop: 0.02,          // 右手を左手の上に重ねる（右手だけ太ももから少し浮かせる、m。0.012 では平らに置いた指どうしが食い込んだ）
                             // （前は手のひらの位置をひざから 外 0.03・上 0.1・前 0.06 m で決めていた。手が太ももから浮いて見えた）
  // 腕をまっすぐ伸ばして体を支える（2026-11-20 先生）：手を置く所を太ももに沿って上下にずらし、肩からの距離を腕の長さに合わせる
  straight: 0.998,           // 腕の伸ばし具合（1＝伸びきる）。0.998 で肘の曲がりは約 7 度（0.985 でも約 20 度曲がって見えた）
  slide: [-0.12, 0.15],      // ずらしてよい範囲（m、- でひざの下へ、+ で太ももの上へ）。体を回すと片方の肩がひざに近づくので、下へ広めに
  elbow: [-0.9, 0.0, 0.3],   // 肘を逃がす向き（右腕の値。外・少し前）
  fingerIn: 0.35,            // 指先を少し内向きに（0＝ひざの方へまっすぐ）
  forearmTwist: 0.75,        // 手のひらを返すねじれのうち、前腕が受け持つ割合（残りは手首）。手首だけだと細くなった
  curl: 0.12,                // 指の曲げ。手のひらを平らに置くので浅く（ひざを包んでいたときは 0.3）
  pull: 0.15,                // 重ねた手を離す長さ（手を置く時間のうちの割合。手を離しながら、すぐにひざへ伸ばす）
};
// 手をひざに置く動き（VRMA の名前 → 時刻、秒）：手を離し始め・置き終わり・ひざから離し始め・重ね終わり
export const HAND_MOTIONS = {
  // 手首の向きが大きく変わるので、ゆっくりめに（短いと手首がくるっと速く回った）
  // 動きは 12.3 秒（かがむ 1.1・揺れながら保つ 10・戻る 1.2）。手は体と同時に伸ばし、かがみ終わる少し前にひざに着く。
  // 起き上がるときは、体と同時にひざから離す（2026-11-20 先生：前は手が体より遅れていた）
  // 2026-11-21 ポーズにした：動きの中の時刻で決める（かがみ終わり 1.1 秒で止めて保つ。「止める」で 1.1〜2.3 秒の起き上がりを再生）
  lean_forward: { pose: 'knees', times: [0.0, 0.95, 1.1, 2.3] },
  // 前かがみのまま右手を挙げて手を振る（2026-11-21 先生）。両手をひざに置いたあと、wave.start 秒（再生を始めてからの時間）から
  // wave.rise 秒かけて右手を挙げる。止めると、体が起き上がるのに合わせて手を下ろす
  // 脇をしめて、軽く握った手を鎖骨のあたりでくっつける（2026-11-21 先生）。動きは 1.6 秒（寄せる 0.8・戻る 0.8）、0.8 秒で止めて保つ
  fists_chest: { pose: 'fists', times: [0.0, 0.75, 0.8, 1.6] },
  lean_wave: { pose: 'knees', times: [0.0, 0.95, 1.1, 2.3], wave: { side: 'right', start: 1.3, rise: 1.2 } },   // rise 0.7 では手が速く回った
};

// 前かがみのまま手を振る（lean_wave）：手のひらの中心を顔の横へ（頭の骨から、キャラの外・上・前。m、世界の向き）。
// 指先は上、手のひらはこちら（カメラの方＝+Z）。手首で左右に振る。体が倒れていても世界の向きで決めるので、手はまっすぐ上を向く
export const LEAN_WAVE = {
  palm: [0.2, 0.0, 0.1],      // 振っていないときの手のひらの中心：頭の骨から 外・上・前（外は右手なら -X）
  elbow: [-0.6, -0.8, 0.1],   // 肘を逃がす向き（右腕の値。下・外）
  tilt: 0.25,                 // 手のひらを少し内へ向ける（顔の方へ）
  wrist: 0.32, wristSpeed: 8, // 手首で振る大きさ・速さ（ふだんの手を振ると同じくらい）
  armSway: 0.015,             // 手首も一緒に少し左右に動かす（m。前腕ごと揺れる感じ）
};

// 脇をしめて腕を曲げ、軽く握った手を鎖骨のあたりでくっつける（fists_chest。2026-11-21 先生）。値はキャラの左手側（右は X を反転）
// 位置は首の骨から（世界の向き、m）。手の向きは手のひらが胸の方・少し内向き、指（開いたとき）は上へ
export const FISTS = {
  at: [0.1, -0.005, 0.2],     // 手のひらの中心：首の骨から 外・上・前（前 0.14 → 0.2：前腕を前へ立てると、胸への食い込みが減った）。
                              // 2026-11-21 先生：脇はしめたまま、肘から先を立てて手の間隔をあける（こぶしは真ん中でくっつけない）。
                              // 前の 0.012（くっつける）では前腕が斜めに胸のふくらみの上を通り、約 2 cm 食い込んだ。0.1 でほぼ 0
                              // 高さはあごの下（2026-11-21 先生：あご下くらいまで上げてよい。前は -0.045＝鎖骨。-0.09 では胸に重なった）
  fingers: [-0.2, 1, 0.3],    // 開いた手なら指先が向く向き（左手。少し内・上・少し前）
  palm: [-0.8, 0.1, -0.6],    // 手のひらが向く向き（左手。内側＝向かい合わせ・胸の方）。こぶしの指の側どうしがくっつく
  elbow: [-0.1, -1, 0.5],     // 肘を逃がす向き（右腕の値。下・ほんの少し外・前＝肘を体に寄せて脇をしめる、前腕が胸から浮く）
                              // （2026-11-21 先生：脇をしめて胸を寄せる。外 -0.3 → -0.1）
                              // （少し後ろ -0.15 では、前腕が胸の上の肌に約 2.5 cm 食い込んだ。手を前 0.17・肘を前 0.5 で 0 に）
                              // （内向きにすると肘が体の中に入った）
  curl: 0.9,                  // 軽く握る（0.75 では指が開いて見えた）
  bustSqueeze: 0.07,          // このポーズの間だけ、胸の先を左右から内へ押す量（m。springs.js の setBustSqueeze）。
                              // 2026-11-21 先生：ぎりぎりまで寄せる → 0.07（胸の先の間 4.6 cm）。0.08 で 4.0 cm、0.09 では玉が胸の先を越えて逆に開いた
  pull: 0.25,                 // 重ねた手を離す長さ（割合）
};

// ---------- キャラクターごとの数値（character.json の "pose"）で上書きする ----------
// 例：{ "CLASP": { "curl": 0.2, "head": [0.06, 0, 0.03] } }。書いていない数値は標準の値のまま
const TABLES = { CLASP, BREATH, LOOK, WAVE, PAT, KNEES, HAND_MOTIONS, LEAN_WAVE, FISTS };
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

// 両手をひざに置く（w：0 重ねたまま → 1 置いた）。前半で重ねた手を離し、後半でひざへ。脚・背骨は VRMA が先に決めてある
// 回転 q のうち、軸 axis まわりのねじれだけを取り出し、その k 倍の回転を返す（ねじれと曲げに分ける）
function twistAbout(q, axis, k) {
  const p = V3(q.x, q.y, q.z).projectOnVector(axis);
  const t = new THREE.Quaternion(p.x, p.y, p.z, q.w);
  if (t.lengthSq() < 1e-9) return new THREE.Quaternion();
  t.normalize();
  return new THREE.Quaternion().slerp(t, k);
}

// 体を支えるために手を伸ばす動きなので、手を離すのはごく短く、すぐにひざへ向かう（2026-11-20 先生：腕が遅れている）
function placeOnKnees(B, root, w) {
  const pw = smooth01(w / KNEES.pull), aw = smooth01(w);
  const rq = new THREE.Quaternion(); root.getWorldQuaternion(rq);
  for (const side of ['left', 'right']) {
    const knee = B(side + 'LowerLeg'); if (!knee) continue;
    const m = side === 'left' ? 1 : -1;
    pullOut(B, side, pw);
    if (aw <= 0) continue;
    knee.updateWorldMatrix(true, false);
    const K = new THREE.Vector3(); knee.getWorldPosition(K);
    const ua = B(side + 'UpperArm'), la = B(side + 'LowerArm'), hd = B(side + 'Hand'), thighB = B(side + 'UpperLeg');
    const S = new THREE.Vector3(); ua.getWorldPosition(S);
    // 太ももの向き：up＝ひざから脚の付け根へ、n＝太ももの前の面（手を置く面）、lat＝体の外側
    const up = thighB.getWorldPosition(new THREE.Vector3()).sub(K).normalize();
    const n = V3(0, 0, 1).applyQuaternion(rq).projectOnPlane(up).normalize();
    const lat = V3(m, 0, 0).applyQuaternion(rq).projectOnPlane(up).projectOnPlane(n).normalize();
    const base = K.clone().add(up.clone().multiplyScalar(KNEES.along))
      .add(n.clone().multiplyScalar(KNEES.surface + (side === 'right' ? KNEES.rightOnTop : 0)))
      .add(lat.clone().multiplyScalar(-KNEES.inward));
    // 手のひらを太ももに平らに置く（2026-11-21 先生：そのほうが腕が体に寄って自然）：
    // 指先は太ももに沿ってひざの方へ（少し内向き）、手のひらは太ももの面へ。手首は腕に対して少し反る
    // （手の骨の決まり：右手は指先 -X・親指 +Z・手のひら -Y、左手は X が逆）
    const d = up.clone().negate().add(lat.clone().multiplyScalar(-KNEES.fingerIn)).projectOnPlane(n).normalize();
    const X = side === 'right' ? d.clone().negate() : d.clone(), Y = n.clone(), Z = X.clone().cross(Y);
    const handW = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const palmOff = V3(side === 'right' ? -PALM.along : PALM.along, -PALM.down, 0).applyQuaternion(handW);   // 手首 → 手のひらの中心
    // 腕がまっすぐになる所を、太ももに沿って探す（肩から手首までの距離＝腕の長さ×straight）
    const reach = (la.position.length() + hd.position.length()) * KNEES.straight;
    const at = (s) => base.clone().add(up.clone().multiplyScalar(s)).sub(palmOff);   // 手首の位置
    let [lo, hi] = KNEES.slide;   // 上へずらすほど肩に近づく
    if (at(lo).distanceTo(S) <= reach) hi = lo;        // ひざの下でも届く（体が起きている途中など）→ 肘は少し曲がる
    else if (at(hi).distanceTo(S) >= reach) lo = hi;   // 太ももの上でも届かない → 届く所まで手を伸ばす
    else for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (at(mid).distanceTo(S) > reach) lo = mid; else hi = mid; }
    const keep = hd.quaternion.clone();   // 重ねた手の向き（ここから置いた向きへ移る）
    armIK(B, side, at((lo + hi) / 2), aw, null, V3(...KNEES.elbow), 0);
    la.updateWorldMatrix(true, false);
    const handLocal = la.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handW);
    const hw = smooth01((aw - 0.1) / 0.9);   // 手首は腕より少し遅れて向きを変える（遅らせすぎると、終わりの方で手首がくるっと速く回った）
    // 手のひらを返すねじれ（約 110 度）を手首だけで受けると、皮ふがしぼられて手首が細くなる（2026-11-21 先生）。
    // 本物の腕と同じく、ねじれの大部分を前腕（ひじ〜手首）に受け持たせる。手首の向きは変わらない
    // 先に手首の向きを混ぜてから（手の見た目の動きは前と同じ）、そのねじれの一部を前腕へ移す
    const blended = keep.clone().slerp(handLocal, hw);
    const tw = twistAbout(blended, V3(1, 0, 0), KNEES.forearmTwist * hw);   // 前腕の骨の長さの向き＝X
    la.quaternion.multiply(tw);
    hd.quaternion.copy(tw.invert().multiply(blended));
  }
  return aw;
}

// 胸の前でグーをくっつける（数値は上の FISTS）。重ねた手を離してから、こぶしを鎖骨の前へ
function placeFists(B, root, w) {
  const neck = B('neck'); if (!neck) return 0;
  const pw = smooth01(w / FISTS.pull), aw = smooth01(w);
  const rq = new THREE.Quaternion(); root.getWorldQuaternion(rq);
  neck.updateWorldMatrix(true, false);
  const Np = neck.getWorldPosition(new THREE.Vector3());
  for (const side of ['left', 'right']) {
    const la = B(side + 'LowerArm'), hd = B(side + 'Hand');
    if (!la || !hd) continue;
    const m = side === 'left' ? 1 : -1;
    pullOut(B, side, pw);
    if (aw <= 0) continue;
    const mir = ([x, y, z]) => V3(x * m, y, z).applyQuaternion(rq);
    const palmC = Np.clone().add(mir(FISTS.at));
    const palmDir = mir(FISTS.palm).normalize();
    const fingers = mir(FISTS.fingers).projectOnPlane(palmDir).normalize();
    // 手の骨の決まり：右手は指先 -X・親指 +Z・手のひら -Y、左手は X が逆
    const X = side === 'right' ? fingers.clone().negate() : fingers.clone(), Y = palmDir.clone().negate(), Z = X.clone().cross(Y);
    const handW = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const palmOff = V3(side === 'right' ? -PALM.along : PALM.along, -PALM.down, 0).applyQuaternion(handW);
    const keep = hd.quaternion.clone();
    armIK(B, side, palmC.sub(palmOff), aw, null, V3(...FISTS.elbow), 0);
    la.updateWorldMatrix(true, false);
    const handLocal = la.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handW);
    const blended = keep.clone().slerp(handLocal, aw);
    const tw = twistAbout(blended, V3(1, 0, 0), KNEES.forearmTwist * aw);   // ねじれは前腕に（手首が細くならないように）
    la.quaternion.multiply(tw);
    hd.quaternion.copy(tw.invert().multiply(blended));
  }
  return aw;
}

// 前かがみのまま手を振る（数値は上の LEAN_WAVE）
function leanWave(B, root, w, t, side) {
  const ua = B(side + 'UpperArm'), la = B(side + 'LowerArm'), hd = B(side + 'Hand'), head = B('head');
  if (!ua || !la || !hd || !head) return 0;
  const m = side === 'right' ? -1 : 1;   // 外の向き（右手は -X）
  const rq = new THREE.Quaternion(); root.getWorldQuaternion(rq);
  head.updateWorldMatrix(true, false);
  const Hp = head.getWorldPosition(new THREE.Vector3());
  const palmC = Hp.add(V3(LEAN_WAVE.palm[0] * m, LEAN_WAVE.palm[1], LEAN_WAVE.palm[2]).applyQuaternion(rq));
  // 手の向き：指先＝上、手のひら＝前（こちら）を少し内へ
  const up = V3(0, 1, 0).applyQuaternion(rq);
  const palmDir = V3(-m * LEAN_WAVE.tilt, 0, 1).normalize().applyQuaternion(rq);   // 手のひらが向く方向
  const fingers0 = up.clone().projectOnPlane(palmDir).normalize();
  // 手の骨の決まり：右手は指先 -X・親指 +Z・手のひら -Y、左手は X が逆
  const basis = (f) => {
    const X = side === 'right' ? f.clone().negate() : f.clone(), Y = palmDir.clone().negate(), Z = X.clone().cross(Y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  };
  // 手首の位置は、振っていない手の向きで決めて動かさない（手首が支点。指先が左右に大きく動く）。
  // 前は手のひらの中心を止めて回していたので、指先がほとんど動かず手首が揺れて見えた（2026-11-21 先生）
  const palmOff0 = V3(side === 'right' ? -PALM.along : PALM.along, -PALM.down, 0).applyQuaternion(basis(fingers0));
  const phase = Math.sin(t * LEAN_WAVE.wristSpeed);
  const sway = palmDir.clone().cross(fingers0).normalize();   // 指先が振れる向き（手首も同じ向きに少し動かす＝前腕ごと揺れる）
  const wristT = palmC.sub(palmOff0).add(sway.multiplyScalar(LEAN_WAVE.armSway * phase));
  // 手首で左右に振る（手のひらの向きの軸で回す）
  const swing = new THREE.Quaternion().setFromAxisAngle(palmDir, LEAN_WAVE.wrist * phase);
  const handW = basis(fingers0.clone().applyQuaternion(swing));
  const aw = smooth01(w);
  const keep = hd.quaternion.clone();
  armIK(B, side, wristT, aw, null, V3(...LEAN_WAVE.elbow), 0);
  la.updateWorldMatrix(true, false);
  const handLocal = la.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handW);
  // 手の向きは腕と同じ速さで変える（遅らせると、ひざの手のひら → こちら向きの大きな返しが短い間に集まり、1 コマ 10 度回った）
  const hw = aw;
  const blended = keep.clone().slerp(handLocal, hw);
  const tw = twistAbout(blended, V3(1, 0, 0), KNEES.forearmTwist * hw);   // ねじれは前腕に（手首が細くならないように）
  la.quaternion.multiply(tw);
  hd.quaternion.copy(tw.invert().multiply(blended));
  return aw;
}

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
  // 手をひざに置く（前かがみ）
  const kneeAct = s.kneesW > 0 ? placeOnKnees(B, vrm.scene, s.kneesW) : 0;
  // 脇をしめて、軽く握った手を鎖骨のあたりでくっつける（fists_chest）
  const fistAct = s.fistsW > 0 ? placeFists(B, vrm.scene, s.fistsW) : 0;

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

  // 前かがみのまま、ひざの手を挙げて手を振る（lean_wave。2026-11-21 先生）
  if (s.leanWaveW > 0) waveAct = Math.max(waveAct, leanWave(B, vrm.scene, s.leanWaveW, t, s.leanWaveSide || 'right'));

  // 指：ふだんはほとんど伸ばす。手を振るときは開く
  let curl = CLASP.curl + (KNEES.curl - CLASP.curl) * kneeAct;
  curl += (FISTS.curl - curl) * fistAct;
  curlHand(B, 'right', curl * (1 - waveAct));
  curlHand(B, 'left', curl);
}
