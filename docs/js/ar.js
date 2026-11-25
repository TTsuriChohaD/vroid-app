// AR（カメラの映像の上にキャラクターを置く。2026-11-24 先生：立体視より先に AR）
// ・WebXR の immersive-ar。床探し（hit-test）は必須、画面の上のボタン（dom-overlay、ページ全体）は使えれば使う
// ・キャラクターは原点に置いたまま動かさない。かわりにカメラを「台（rig）」に載せ、台をずらして
//   キャラクターが床の上に立って見えるようにする（姿勢の計算・揺れもの・タッチの部位分けをそのまま使えるように）。
//   three の WebXRManager は、カメラに親があれば XR のカメラにも親の位置・向きを掛ける
// ・床の白い輪をタップ → そこに実寸で置き、こちらを向かせる。キャラクターにふれたら部位の反応
// ・置き直しはモードで分ける（2026-11-25 先生）：ふだんは白い輪を出さず、外をタップしても何もしない。
//   「置き直す」を押すと白い輪が出て、タップした所へ移り、移ったら自動でふだんに戻る。始めた直後は置き直しの状態
import * as THREE from 'three';
import { regionFromSkin, regionAt } from './touch.js';

// 大きさ（2026-11-25 先生）：実寸・半分・机の上。キャラクターの大きさは変えず、台に倍率を掛けて見え方だけ小さくする
// （台＝置いた場所×倍率の逆。姿勢の計算・揺れもの・タッチはそのまま。奥行きも部屋の長さのままになる）
export const AR_SIZES = [[1, '実寸'], [0.5, '半分'], [0.25, '机の上']];
// 足元の影（2026-11-25 先生）：光から影を計算すると、スマホではキャラクターをもう一度描くほど重いので、
// 足元にうっすらした丸い影を敷く。腰と両足の位置から毎コマ形を決め、足が床から離れるほど薄くする（ジャンプ）
export const AR_SHADOW = { opacity: 0.38, margin: 0.14, minR: 0.22, baseY: 0.04, fadeH: 0.2 };

// 小さくしたときの触りやすさ（2026-11-25 先生：小さくすると触ったときの反応がしづらい）：
// 指の線がキャラクターに当たらなかったら、線のそばを通る骨を探し、その骨へ向けてもう一度線を出す。
// 届く範囲＝体の太さ reach（キャラクターの寸法 m）＋指のまわり slopPx（画面の点）。実寸のときは使わない（今まで通り）
export const AR_TOUCH = { reach: 0.08, slopPx: 24 };
const TOUCH_SEGS = [
  ['hips', 'spine'], ['spine', 'chest'], ['chest', 'upperChest'], ['upperChest', 'neck'], ['neck', 'head'], ['head', '@top'],
  ['upperChest', 'leftUpperArm'], ['leftUpperArm', 'leftLowerArm'], ['leftLowerArm', 'leftHand'], ['leftHand', '@leftFingers'],
  ['upperChest', 'rightUpperArm'], ['rightUpperArm', 'rightLowerArm'], ['rightLowerArm', 'rightHand'], ['rightHand', '@rightFingers'],
  ['hips', 'leftUpperLeg'], ['leftUpperLeg', 'leftLowerLeg'], ['leftLowerLeg', 'leftFoot'], ['leftFoot', 'leftToes'],
  ['hips', 'rightUpperLeg'], ['rightUpperLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot'], ['rightFoot', 'rightToes'],
];

export function createAR({ renderer, scene, camera, getVrm, onTap, onAnyTap, onStart, onEnd, hint, onPress, onStrokeMove, onRelease, onStroke, onPlacingChange, size = 1 }) {
  const rig = new THREE.Group();   // カメラの台（キャラクターから見た、実際の部屋の置き方の逆）
  rig.name = 'vroidApp_arRig';
  const place = new THREE.Matrix4();      // 置いた場所（部屋の座標）：位置とこちら向きの回転
  const placeInv = new THREE.Matrix4();
  let placed = false, placing = false, session = null, hitSource = null, saved = null;
  const viewerRoom = new THREE.Vector3();   // スマホの位置（部屋の座標。置くときにこちらを向かせる）
  const anchor = new THREE.Vector3(), anchorQ = new THREE.Quaternion();   // 置いた場所と向き（部屋の座標）
  let scale = size;

  // 足元の影（キャラクターの座標の床 y 0 に敷く）
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: AR_SHADOW.opacity, toneMapped: false }));
  shadow.name = 'vroidApp_arShadow'; shadow.renderOrder = -1; shadow.visible = false;
  const _b = new THREE.Vector3();
  function updateShadow() {
    const vrm = getVrm();
    shadow.visible = !!(vrm && placed);
    if (!shadow.visible) return;
    const pts = [];
    for (const n of ['hips', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes', 'leftLowerLeg', 'rightLowerLeg']) {
      const b = vrm.humanoid.getNormalizedBoneNode(n); if (b) pts.push(b.getWorldPosition(new THREE.Vector3()));
    }
    if (!pts.length) return;
    // 床に近い点（足・ひざ・腰）だけで形を決める。立っていれば足、座れば腰・ひざも入る
    const low = pts.filter((p) => p.y < 0.35);
    const use = low.length ? low : pts;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
    for (const p of use) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    for (const p of pts) minY = Math.min(minY, p.y);
    const m = AR_SHADOW.margin;
    shadow.position.set((minX + maxX) / 2, 0.002, (minZ + maxZ) / 2);
    shadow.scale.set(Math.max(AR_SHADOW.minR, (maxX - minX) / 2 + m), 1, Math.max(AR_SHADOW.minR, (maxZ - minZ) / 2 + m));
    // いちばん低い骨（つま先）はふだん床から約 0.04 m（baseY）。それより上がった分だけ薄くする
    const lift = Math.max(0, minY - AR_SHADOW.baseY);
    shadow.material.opacity = AR_SHADOW.opacity * Math.max(0.25, 1 - lift / AR_SHADOW.fadeH);
  }
  // 台を、置いた場所×倍率の逆にする
  function applyPlace() {
    place.compose(anchor, anchorQ, new THREE.Vector3(scale, scale, scale)); placeInv.copy(place).invert();
    rig.matrix.copy(placeInv); rig.matrixWorld.copy(placeInv); rig.matrixWorldNeedsUpdate = true;
  }
  function setSize(s) {
    scale = s;
    if (session && placed) applyPlace();
  }

  // 床の印（白い輪）。キャラクターの座標で描く
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; reticle.renderOrder = 999;
  reticle.name = 'vroidApp_arReticle';
  const hitRoom = new THREE.Matrix4();    // 床の印の場所（部屋の座標）
  let hitOk = false;

  async function supported() {
    try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (_) { return false; }
  }

  async function start() {
    if (session) return;
    const s = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body },
    });
    session = s;
    // 戻すときのために、今の見え方を覚える
    saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, near: camera.near };
    placed = false; hitOk = false;
    rig.matrixAutoUpdate = false;
    park();   // 置くまでは床のずっと下（映らない所）で描き方を準備する
    scene.add(rig, reticle, shadow);
    rig.add(camera);
    camera.near = 0.03;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    s.addEventListener('end', ended);
    s.addEventListener('select', onSelect);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    await renderer.xr.setSession(s);
    const viewer = await s.requestReferenceSpace('viewer');
    hitSource = await s.requestHitTestSource({ space: viewer });
    onStart && onStart({ overlay: !!s.domOverlayState });
    setPlacing(true);
  }

  // 描き方の準備（2026-11-24 先生：白い輪をタップしても、すぐには出なかった）。
  // 「画面の効果」を入れていると、ふだんは別の画面に描いてから仕上げるので、AR（画面に直接描く）用の描き方（シェーダー）が別に要る。
  // 置くまで隠していると、タップした瞬間にその準備が始まり、スマホでは止まる（three の compileAsync で先に作っても、
  // 最初に描くときの待ちは PC で減らなかった）→ AR を始めてすぐの WARM_FRAMES コマだけ、置く前のキャラクターを
  // 床のずっと下（PARK_Y。カメラの遠さ 30 m より先なので映らない）に置いて実際に描き、準備を済ませておく
  const PARK_Y = -100, WARM_FRAMES = 20;
  let warm = 0;
  function park() {
    place.makeTranslation(0, PARK_Y, 0); placeInv.copy(place).invert();
    rig.matrix.copy(placeInv); rig.matrixWorld.copy(placeInv); rig.matrixWorldNeedsUpdate = true;
    warm = WARM_FRAMES;
  }
  function end() { if (session) session.end(); }
  function ended() {
    session = null; hitSource = null; placed = false;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    placing = false;
    if (down && down.hit) onRelease && onRelease();
    down = null;
    rig.remove(camera); scene.remove(rig, reticle, shadow);
    renderer.xr.enabled = false;
    if (saved) {
      camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat); camera.scale.set(1, 1, 1);
      camera.fov = saved.fov; camera.near = saved.near; camera.zoom = 1;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    }
    const vrm = getVrm(); if (vrm) vrm.scene.visible = true;
    onEnd && onEnd();
  }

  // 置く：床の印の場所に、こちら（スマホ）を向かせて立たせる
  function placeAtHit(viewerRoomPos) {
    anchor.setFromMatrixPosition(hitRoom);
    const yaw = Math.atan2(viewerRoomPos.x - anchor.x, viewerRoomPos.z - anchor.z);
    anchorQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    applyPlace();
    placed = true;
    setPlacing(false);   // 移ったら、ふだん（触れる）に戻る
  }
  // 置き直しのモード：白い輪を出し、タップで置く
  function setPlacing(on) {
    if (!session) return;
    placing = !!on;
    if (placing && down && down.hit) { onRelease && onRelease(); down = null; }
    hint && hint(placing ? '床を映してください。白い輪が出たら、タップするとそこに立ちます' : '');
    onPlacingChange && onPlacingChange(placing);
  }

  // タップ（画面のボタン以外）。置き直しの間は白い輪の所へ置く。ふだんは、指の線がキャラクターに当たれば部位の反応（外は何もしない）
  // 受け取り方は 2 つ（2026-11-24 先生：白い輪をタップしても出なかった）：WebXR のタップ（select）と、ふつうの指の操作（ページ全体を
  // 画面の上のボタンに使っているので、指の操作もページに届く）。同じタップを 2 回数えないよう、続けて来た方は捨てる
  const ray = new THREE.Raycaster();
  let handledAt = -1e9;
  // 線がキャラクターに当たった所（three の当たり）。小さくしているときは、線のそばを通る骨の方へもう一度線を出す
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function pickFrom(origin, dir) {
    const vrm = getVrm();
    if (!vrm || !origin) return null;
    ray.set(origin, dir);
    const meshHit = () => ray.intersectObject(vrm.scene, true).filter((h) => h.object.isMesh && h.object.visible)[0] || null;
    const h = meshHit();
    if (h || scale >= 1) return h;
    const wp = (n) => { const b = vrm.humanoid.getNormalizedBoneNode(n); return b ? b.getWorldPosition(new THREE.Vector3()) : null; };
    const end = (n) => {
      if (n === '@top') { const hd = wp('head'), nk = wp('neck'); return hd && nk ? hd.clone().add(hd.clone().sub(nk).setLength(0.17)) : null; }
      if (n === '@leftFingers' || n === '@rightFingers') { const side = n === '@leftFingers' ? 'left' : 'right'; const hd = wp(side + 'Hand'), la = wp(side + 'LowerArm'); return hd && la ? hd.clone().add(hd.clone().sub(la).setLength(0.09)) : null; }
      return wp(n);
    };
    const tanHalf = 1 / camera.projectionMatrix.elements[5];
    let best = null;
    for (const [a, b] of TOUCH_SEGS) {
      const A = end(a), B = end(b); if (!A || !B) continue;
      // 線（origin + t·dir）と骨の線分 A〜B のいちばん近い所
      const u = B.clone().sub(A), w = origin.clone().sub(A);
      const aa = dir.dot(dir), bb = dir.dot(u), cc = u.dot(u), dd = dir.dot(w), ee = u.dot(w);
      const den = aa * cc - bb * bb;
      let sc = den > 1e-9 ? (bb * ee - cc * dd) / den : 0, tc = den > 1e-9 ? (aa * ee - bb * dd) / den : 0;
      tc = Math.min(1, Math.max(0, tc));
      sc = Math.max(0, (u.clone().multiplyScalar(tc).sub(w)).dot(dir) / aa);
      const P = origin.clone().addScaledVector(dir, sc), Q = A.clone().addScaledVector(u, tc);
      const dist = P.distanceTo(Q);
      const limit = AR_TOUCH.reach + AR_TOUCH.slopPx * (2 * sc * tanHalf / innerHeight);
      if (dist < limit && (!best || dist / limit < best.k)) best = { k: dist / limit, Q };
    }
    if (!best) return null;
    ray.set(_o.copy(origin), _d.copy(best.Q).sub(origin).normalize());
    return meshHit();
  }
  function hitInfo(h) {
    const vrm = getVrm();
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    const local = hips ? hips.worldToLocal(h.point.clone()) : h.point;
    return { point: h.point.clone(), side: local.x > 0 ? 'left' : 'right', region: regionFromSkin(vrm, h) || regionAt(vrm, h.point) };
  }
  function handleTap(origin, dir, via) {
    const now = performance.now();
    if (now - handledAt < 400) return;   // もう一方の受け取り方で、同じタップを処理した
    handledAt = now;
    onAnyTap && onAnyTap();
    if (placing) {
      if (hitOk) placeAtHit(viewerRoom);
      else hint && hint('白い輪が見えているときにタップしてください');
      return;
    }
    if (placed && origin) {
      const h = pickFrom(origin, dir);
      if (h) { const i = hitInfo(h); onTap && onTap(i.region, i.side); }
    }
  }
  function onSelect(e) {
    // 指の操作の途中・直後に来た XR のタップは捨てる（なでた指を離したときに、タップや置き直しにならないように）
    if (down || performance.now() - lastUpAt < 400) return;
    const ref = renderer.xr.getReferenceSpace();
    const pose = e.frame && ref ? e.frame.getPose(e.inputSource.targetRaySpace, ref) : null;
    if (!pose) { handleTap(null, null, 'sel'); return; }
    // 部屋の座標の線 → キャラクターの座標へ
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(placeInv);
    handleTap(new THREE.Vector3().setFromMatrixPosition(m), new THREE.Vector3(0, 0, -1).transformDirection(m), 'sel');
  }
  // ふつうの指の操作：ほとんど動かさずに離したらタップ。線はカメラ（キャラクターの座標。AR のレンズの写し方）から
  // キャラクターに触れた指は、揺れものに見えない手を入れ（onPress）、動かせば揺れものが指についてくる（onStrokeMove）。
  // 頭の上で指を動かしたら「なでる」（onStroke）。いつもの画面（touch.js）と同じ決まり（2026-11-24 先生：AR で揺れものが反応しない）
  const UI = 'button, label, select, input, dialog, .bar, #status';
  const TAP_PX = 12, TAP_MS = 600, STROKE_PX = 40;
  let down = null, lastUpAt = -1e9;
  function screenRay(x, y) {
    ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    return ray;
  }
  function hitAt(x, y) {
    const vrm = getVrm();
    if (!placed || placing || !vrm) return null;
    const r = screenRay(x, y);
    const h = pickFrom(r.ray.origin.clone(), r.ray.direction.clone());
    return h ? hitInfo(h) : null;
  }
  const onDown = (e) => {
    if (down || (e.target.closest && e.target.closest(UI))) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, hit: hitAt(e.clientX, e.clientY) };
    if (down.hit) onPress && onPress(down.hit, e.clientX, e.clientY);
  };
  const onMove = (e) => {
    const d = down;
    if (!d || e.pointerId !== d.id) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
    if (!d.hit || d.moved <= TAP_PX) return;
    onStrokeMove && onStrokeMove(e.clientX, e.clientY);
    if (!d.fired && d.hit.region === 'head' && d.moved > STROKE_PX) { d.fired = true; onStroke && onStroke(d.hit.side); }
  };
  const onUp = (e) => {
    const d = down;
    if (!d || e.pointerId !== d.id) return;
    down = null; lastUpAt = performance.now();
    if (d.hit) onRelease && onRelease();
    if (d.moved > TAP_PX || performance.now() - d.t > TAP_MS) return;
    const r = screenRay(e.clientX, e.clientY);
    handleTap(r.ray.origin.clone(), r.ray.direction.clone(), 'ptr');
  };
  // 指の操作がブラウザに引き取られた（画面の移動など）：離した扱い。タップにはしない
  const onCancel = (e) => {
    const d = down;
    if (!d || e.pointerId !== d.id) return;
    down = null; lastUpAt = performance.now();
    if (d.hit) onRelease && onRelease();
  };

  // 毎フレーム（描く前に）：床の印を動かす。置く前はキャラクターを隠す
  function update(frame) {
    if (!session) return;
    const vrm = getVrm();
    if (vrm) vrm.scene.visible = placed || warm > 0;   // 置く前は、準備の間だけ（映らない所で）描く
    if (warm > 0) warm--;
    hitOk = false;
    if (frame) {
      const ref = renderer.xr.getReferenceSpace();
      const vp = ref ? frame.getViewerPose(ref) : null;
      if (vp) viewerRoom.set(vp.transform.position.x, vp.transform.position.y, vp.transform.position.z);
    }
    if (frame && hitSource) {
      const hits = frame.getHitTestResults(hitSource);
      const ref = renderer.xr.getReferenceSpace();
      const pose = hits.length ? hits[0].getPose(ref) : null;
      if (pose) {
        hitOk = true;
        hitRoom.fromArray(pose.transform.matrix);
        reticle.matrix.multiplyMatrices(placeInv, hitRoom);   // 部屋の座標 → キャラクターの座標
        reticle.matrixWorldNeedsUpdate = true;
      }
    }
    reticle.visible = hitOk && placing;
    updateShadow();
  }

  return {
    supported, start, end, update, setPlacing, setSize, get size() { return scale; },
    pick: pickFrom,   // PC で確かめる用（線がキャラクターに当たる所。小さいときは近くも）
    get active() { return !!session; }, get placed() { return placed; }, get placing() { return placing; },
  };
}
