// 揺れものが触り方に応じて揺れる（2026-11-24 先生：頭をなでたら、なでる動きに合わせて髪が揺れる など）
// CLAUDE.md「7.」揺れもの：触れている間だけ、見えない当たり判定（指の位置）と一時的な力（指の動く向き。揺れものの
// 重力の向き・強さに足し込む）を足してよい。離したら短い時間をかけて元に戻す。モデルの揺れの硬さ・強さの設定そのものは変えない
// ・見えない「手」：触れた点の近くの揺れものだけに当たる球。指に合わせて、触れた所のまわりの球面に沿って動かす
//   （体に当たる点を毎回探す計算はスマホでは重いので、触り始めの点と近くの骨から作った球面を使う）
// ・一時的な力：なでる指の向き・速さ（上限あり）。近くの揺れものほど強く。タップは押し込む向きに少しだけ
// ・数値の標準はここ。キャラクターの touch.json の "springTouch" で上書きできる（書いた数値だけ）
import * as THREE from 'three';
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere, VRMSpringBoneColliderHelper } from '@pixiv/three-vrm';

export const DEFAULT_SPRING_TOUCH = {
  targets: ['Hair', 'Bust', 'Skirt', 'Sleeve'],   // 反応させる揺れもの（骨の名前に含まれる文字。2026-11-24 先生：髪以外も入れる）
  radius: 0.035,     // 見えない手の球の大きさ（半径 m）
  depth: 0.02,       // 球の中心を、触れた点から体の内側へどれだけ沈めるか（m。半径より小さいと表面から少し出る）
  range: 0.12,       // 触れた点からこの距離（m）以内の揺れものだけ反応させる
  force: 1.2,        // なでる力：指の速さ（m/秒）あたりの強さ（揺れものの重力の強さに足し込む）
  maxForce: 1.2,     // 力の上限
  poke: 0.3,         // タップしたときに押し込む力（短い間だけ。0.6 では胸が 11 cm 揺れた）
  pokeSec: 0.15,     // 押し込む長さ（秒）
  releaseSec: 0.5,   // 離してから元に戻すまで（秒）
};

const ANCHORS = ['head', 'neck', 'upperChest', 'chest', 'spine', 'hips', 'leftUpperLeg', 'rightUpperLeg', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];

export function createSpringTouch(vrm, camera, canvas, conf) {
  const C = { ...DEFAULT_SPRING_TOUCH, ...(conf || {}) };
  const sbm = vrm.springBoneManager;
  const joints = sbm ? [...sbm.joints].filter((j) => !C.targets || C.targets.some((t) => j.bone.name.includes(t))) : [];
  // 見えない手（触っていない間は、どの揺れものにも入れない）
  const hand = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ offset: new THREE.Vector3(), radius: C.radius }));
  hand.name = 'vroidApp_touchHand';
  const handGroup = { colliders: [hand], name: 'vroidApp_touchHand' };
  // 触れている間の様子
  let anchor = null;               // 球を付けた骨（raw）
  let center = new THREE.Vector3(), R = 0;   // 触れた所のまわりの球面（中心・半径、世界の座標）
  let point = new THREE.Vector3();          // 今の指の位置（球面の上）
  let lastT = 0, lastP = new THREE.Vector3();
  let pressing = false, stroking = false, pokeUntil = 0;
  const touched = new Map();       // joint → { dir0, power0 }（元の値）
  const target = new THREE.Vector3(), cur = new THREE.Vector3();   // 足す力（向き×強さ、世界の座標）
  const tmp = new THREE.Vector3(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let side = 'right';

  const tailOf = (j) => (j.child || j.bone).getWorldPosition(new THREE.Vector3());

  // 触れた点の近くの揺れものに、見えない手を入れる（元の重力も覚える）
  function grab(p) {
    for (const j of joints) {
      if (tailOf(j).distanceTo(p) > C.range) continue;
      // 元の重力は最初に触れたときだけ覚える（戻している途中でまた触れても、元の値を上書きしない）
      if (!touched.has(j)) touched.set(j, { dir0: j.settings.gravityDir.clone(), power0: j.settings.gravityPower });
      if (!j.colliderGroups.includes(handGroup)) j.colliderGroups = [...j.colliderGroups, handGroup];
    }
  }
  function placeHand() {
    const n = tmp.copy(point).sub(center).normalize();
    const c = point.clone().addScaledVector(n, -C.depth);
    hand.shape.offset.copy(anchor.worldToLocal(c));
  }

  function press(hit, x, y) {
    if (!sbm || !hit) return;
    // いちばん近い骨に球を付ける（体と一緒に動くように）
    let best = Infinity;
    for (const name of ANCHORS) {
      const b = vrm.humanoid.getRawBoneNode(name); if (!b) continue;
      const d = b.getWorldPosition(tmp).distanceTo(hit.point);
      if (d < best) { best = d; anchor = b; }
    }
    if (!anchor) return;
    anchor.add(hand);
    center.copy(anchor.getWorldPosition(new THREE.Vector3()));
    point.copy(hit.point); R = Math.max(0.02, point.distanceTo(center));
    side = hit.side || 'right';
    pressing = true; stroking = false;
    lastT = performance.now(); lastP.copy(point);
    placeHand();
    grab(point);
    // タップ：押し込む向き（体の内側へ）に少しだけ
    target.copy(point).sub(center).normalize().multiplyScalar(-C.poke);
    pokeUntil = performance.now() + C.pokeSec * 1000;
  }

  // なでている指が動いた：画面の点から球面の上の点を求め、指の向き・速さで力を決める
  function move(x, y) {
    if (!pressing || !anchor) return;
    stroking = true;
    center.copy(anchor.getWorldPosition(new THREE.Vector3()));
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const sphere = new THREE.Sphere(center, R);
    const p = ray.ray.intersectSphere(sphere, new THREE.Vector3());
    if (!p) return;
    const now = performance.now(), dt = Math.max(0.008, (now - lastT) / 1000);
    const d = p.clone().sub(lastP);
    const n = p.clone().sub(center).normalize();
    d.addScaledVector(n, -d.dot(n));   // 表面に沿った向きだけ
    const speed = d.length() / dt;
    const power = Math.min(C.maxForce, C.force * speed);
    if (d.lengthSq() > 1e-10) target.copy(d.normalize()).multiplyScalar(power);
    point.copy(p); lastP.copy(p); lastT = now;
    placeHand();
    grab(point);
  }

  function release() {
    if (!pressing) return;
    pressing = false; stroking = false;
    target.set(0, 0, 0);
    if (hand.parent) hand.parent.remove(hand);
    for (const j of touched.keys()) j.colliderGroups = j.colliderGroups.filter((g) => g !== handGroup);
  }

  // 毎フレーム（vrm.update の前に）。足す力をなめらかに動かし、揺れものの重力に足し込む。離したら元に戻す
  function update(dt) {
    if (!touched.size) return;
    const now = performance.now();
    // なでる力は、指が止まると早めに弱める。タップの押し込みは pokeSec だけ
    if (pressing && !stroking && now > pokeUntil) target.set(0, 0, 0);
    if (pressing && stroking && now - lastT > 80) target.multiplyScalar(Math.exp(-dt / 0.1));
    const k = 1 - Math.exp(-dt / (pressing ? 0.06 : C.releaseSec / 3));
    cur.lerp(target, k);
    const mag = cur.length();
    for (const [j, o] of touched) {
      const w = pressing ? Math.max(0, 1 - tailOf(j).distanceTo(point) / C.range) : 1;   // 近いほど強く（離したあとは同じ割合で戻る）
      const v = o.dir0.clone().multiplyScalar(o.power0).addScaledVector(cur, w);
      const p = v.length();
      if (p > 1e-6) { j.settings.gravityDir.copy(v).divideScalar(p); j.settings.gravityPower = p; }
      else { j.settings.gravityDir.copy(o.dir0); j.settings.gravityPower = o.power0; }
    }
    // 離して力がほぼ 0 になったら、元の値にきっちり戻して手放す
    if (!pressing && mag < 1e-3) {
      for (const [j, o] of touched) { j.settings.gravityDir.copy(o.dir0); j.settings.gravityPower = o.power0; }
      touched.clear(); cur.set(0, 0, 0);
    }
  }

  // 補助表示：揺れものの点（反応させる対象。触れている所は橙）と、当たり判定の球（見えない手は橙）
  let debug = null;
  function setDebug(on, scene) {
    if (!!debug === !!on) return;
    if (!on) { scene.remove(debug.group); debug.helpers.forEach((h) => h.dispose && h.dispose()); debug = null; return; }
    const group = new THREE.Group(); group.name = 'vroidApp_springDebug';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(joints.length * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(joints.length * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    pts.renderOrder = 999; pts.frustumCulled = false;
    group.add(pts);
    const helpers = [];
    for (const c of [...new Set([...sbm.colliders, hand])]) {
      const h = new VRMSpringBoneColliderHelper(c);
      if (c === hand) h.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.color && o.material.color.set(0xff8800); } });
      helpers.push(h); group.add(h);
    }
    scene.add(group);
    debug = { group, pts, helpers };
  }
  function updateDebug() {
    if (!debug) return;
    const pos = debug.pts.geometry.attributes.position, col = debug.pts.geometry.attributes.color;
    joints.forEach((j, i) => {
      const p = tailOf(j); pos.setXYZ(i, p.x, p.y, p.z);
      const hot = touched.has(j);
      col.setXYZ(i, hot ? 1 : 0.2, hot ? 0.55 : 0.75, hot ? 0 : 1);
    });
    pos.needsUpdate = true; col.needsUpdate = true;
    for (const h of debug.helpers) h.visible = h.collider !== hand || !!hand.parent;
  }

  return {
    press, move, release, update, setDebug, updateDebug,
    get stroking() { return pressing && stroking; }, get side() { return side; },
    get handPoint() { return pressing ? point : null; },
    get config() { return C; },
  };
}
