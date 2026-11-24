// AR（カメラの映像の上にキャラクターを置く。2026-11-24 先生：立体視より先に AR）
// ・WebXR の immersive-ar。床探し（hit-test）は必須、画面の上のボタン（dom-overlay、ページ全体）は使えれば使う
// ・キャラクターは原点に置いたまま動かさない。かわりにカメラを「台（rig）」に載せ、台をずらして
//   キャラクターが床の上に立って見えるようにする（姿勢の計算・揺れもの・タッチの部位分けをそのまま使えるように）。
//   three の WebXRManager は、カメラに親があれば XR のカメラにも親の位置・向きを掛ける
// ・床の白い輪をタップ → そこに実寸で置き、こちらを向かせる。キャラクターにふれたら部位の反応、外をタップしたら置き直す
import * as THREE from 'three';
import { regionFromSkin, regionAt } from './touch.js';

export function createAR({ renderer, scene, camera, getVrm, onTap, onAnyTap, onStart, onEnd, hint }) {
  const rig = new THREE.Group();   // カメラの台（キャラクターから見た、実際の部屋の置き方の逆）
  rig.name = 'vroidApp_arRig';
  const place = new THREE.Matrix4();      // 置いた場所（部屋の座標）：位置とこちら向きの回転
  const placeInv = new THREE.Matrix4();
  let placed = false, session = null, hitSource = null, saved = null;

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
    scene.add(rig, reticle);
    rig.add(camera);
    camera.near = 0.03;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    s.addEventListener('end', ended);
    s.addEventListener('select', onSelect);
    await renderer.xr.setSession(s);
    const viewer = await s.requestReferenceSpace('viewer');
    hitSource = await s.requestHitTestSource({ space: viewer });
    onStart && onStart({ overlay: !!s.domOverlayState });
    hint && hint('床を映してください。白い輪が出たら、タップするとそこに立ちます');
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
    rig.remove(camera); scene.remove(rig, reticle);
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
  const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
  function placeAtHit(viewerRoomPos) {
    _p.setFromMatrixPosition(hitRoom);
    const yaw = Math.atan2(viewerRoomPos.x - _p.x, viewerRoomPos.z - _p.z);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    place.compose(_p, _q, _s); placeInv.copy(place).invert();
    rig.matrix.copy(placeInv); rig.matrixWorld.copy(placeInv); rig.matrixWorldNeedsUpdate = true;
    placed = true;
    hint && hint('');
  }

  // タップ（画面のボタン以外）。指の線がキャラクターに当たれば部位の反応、外なら床の印の所へ置き直す
  const ray = new THREE.Raycaster();
  function onSelect(e) {
    onAnyTap && onAnyTap();
    const vrm = getVrm();
    const ref = renderer.xr.getReferenceSpace();
    const pose = e.frame && ref ? e.frame.getPose(e.inputSource.targetRaySpace, ref) : null;
    if (placed && vrm && pose) {
      // 部屋の座標の線 → キャラクターの座標へ
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(placeInv);
      const o = new THREE.Vector3().setFromMatrixPosition(m);
      const d = new THREE.Vector3(0, 0, -1).transformDirection(m);
      ray.set(o, d);
      const hits = ray.intersectObject(vrm.scene, true).filter((h) => h.object.isMesh && h.object.visible);
      if (hits.length) {
        const h = hits[0];
        const hips = vrm.humanoid.getNormalizedBoneNode('hips');
        const local = hips ? hips.worldToLocal(h.point.clone()) : h.point;
        onTap && onTap(regionFromSkin(vrm, h) || regionAt(vrm, h.point), local.x > 0 ? 'left' : 'right');
        return;
      }
    }
    if (hitOk) {
      const vp = e.frame && ref ? e.frame.getViewerPose(ref) : null;
      const v = vp ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(vp.transform.matrix)) : new THREE.Vector3();
      placeAtHit(v);
    }
  }

  // 毎フレーム（描く前に）：床の印を動かす。置く前はキャラクターを隠す
  function update(frame) {
    if (!session) return;
    const vrm = getVrm();
    if (vrm) vrm.scene.visible = placed || warm > 0;   // 置く前は、準備の間だけ（映らない所で）描く
    if (warm > 0) warm--;
    hitOk = false;
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
    reticle.visible = hitOk;
  }

  return {
    supported, start, end, update,
    get active() { return !!session; }, get placed() { return placed; },
  };
}
