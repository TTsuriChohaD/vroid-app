// タッチ：どこに（部位）どうふれたか（しぐさ）を見分けて、反応を決める（CLAUDE.md「7.」タッチ、2026-11-20 決定）
//   部位：head（頭）・cheek（ほお・顔）・hand（手）・shoulder（肩）・chest（胸）・skirt（スカート）・body（それ以外）
//   しぐさ：tap（軽くたたく）・stroke（指を置いて動かす＝なでる。頭だけ）
//   頭の上から指を動かし始めたらなでる（画面は回さない）。外からなら今まで通り回す
import * as THREE from 'three';

// 標準の設定（キャラクターの touch.json がなければこれ。書き方は同じ）
//   motion：VRMA の名前か "code:wave" / "code:look"。expression：表情（下の EMOTIONS の名前か {表情名: 重み}）
//   look："away"（目をそらす）/ "down"（目を伏せる）。line：セリフの id（声のステップで使う）
export const DEFAULT_TOUCH = {
  head:     { stroke: { motion: 'pat_happy', expression: 'happy' }, tap: { motion: 'pat_happy', expression: 'happy' } },
  cheek:    { tap: { motion: 'shy', expression: 'shy', look: 'away' } },
  hand:     { tap: { motion: 'code:wave', expression: 'happy' } },
  shoulder: { tap: { motion: 'turn_look_{side}', expression: 'surprised_small' } },   // {side}：たたいた側（left / right）
  chest:    { tap: { motion: 'shy', expression: 'shy', look: 'down' } },
  skirt:    { tap: { motion: 'shy', expression: 'shy', look: 'down' } },
  body:     { tap: { motion: 'tilt_head', expression: 'curious' } },
  // 同じ部位に短い間に何度もふれたら（例：頭を 3 回続けてなでる → 照れて少し離れようとする）
  repeat:   { count: 3, withinSec: 6, motion: 'shy_back', expression: 'shy', look: 'away' },
};

// 表情の組み合わせ（VRM のプリセット表情の重み）。キャラクターの character.json の "expressions" で上書き・追加できる
export const EMOTIONS = {
  happy: { happy: 0.8 },
  shy: { relaxed: 0.55, happy: 0.25 },            // 照れ：目を細め、少しほほえむ（ほおを赤らめる表情があれば character.json で足す）
  surprised_small: { surprised: 0.35 },
  curious: { relaxed: 0.15 },
};

const STROKE_PX = 40;   // なでたとみなす指の動きの長さ（画面の点）
// スカートの範囲（m）：腰の骨より above 上 〜 太ももの付け根（upperLeg の骨）より belowLegTop 下
const SKIRT = { above: 0.04, belowLegTop: 0.08 };
const TAP_PX = 10, TAP_MS = 500;
const FACE_TOP = 0.01;  // 顔（ほお）の上の端：目の骨より何 m 上まで（それより上のおでこ・前髪は頭）

// 当たった点が体のどこか
export function regionAt(vrm, point) {
  const B = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const P = point;
  const wp = (n) => { const b = B(n); return b ? b.getWorldPosition(new THREE.Vector3()) : null; };
  const segDist = (a, b) => {
    if (!a || !b) return Infinity;
    const ab = b.clone().sub(a), t = Math.min(1, Math.max(0, P.clone().sub(a).dot(ab) / ab.lengthSq()));
    return a.clone().add(ab.multiplyScalar(t)).distanceTo(P);
  };
  // 手（手首から指先の方へ 0.18 m まで、前腕の先の方も少し）
  for (const s of ['left', 'right']) {
    const h = wp(s + 'Hand'), lo = wp(s + 'LowerArm');
    if (h && lo) {
      const tip = h.clone().add(h.clone().sub(lo).setLength(0.18));
      const near = lo.clone().lerp(h, 0.7);
      if (segDist(near, tip) < 0.07) return 'hand';
    }
  }
  // 頭と顔：首より上。頭の骨から見て前で、目の高さより下が顔（ほお）。おでこ・前髪は頭
  // （2026-11-20 先生：おでこにふれても照れていた → 境目を目の高さに下げた）
  const head = B('head'), neck = wp('neck');
  if (head && neck && P.y > neck.y + 0.03) {
    const local = head.worldToLocal(P.clone());
    const eye = wp('leftEye') || wp('rightEye');
    const faceTop = (eye ? head.worldToLocal(eye.clone()).y : 0.06) + FACE_TOP;
    return local.z > 0.04 && local.y < faceTop ? 'cheek' : 'head';
  }
  // 肩：上腕の付け根の高さのあたりで、体の真ん中から横へ離れたところ（服が厚くても当たるように、骨からの距離ではなく位置で見る）
  const hipsNode = B('hips');
  for (const s of ['left', 'right']) {
    const ua = wp(s + 'UpperArm'), lo = wp(s + 'LowerArm');
    if (!ua || !lo || !hipsNode) continue;
    const lp = hipsNode.worldToLocal(P.clone()), lua = hipsNode.worldToLocal(ua.clone());
    const side = Math.sign(lua.x);
    if (Math.sign(lp.x) === side && Math.abs(lp.x) > Math.abs(lua.x) * 0.6 && lp.y > lua.y - 0.12 && lp.y < lua.y + 0.1) return 'shoulder';
  }
  // 胸（胸の骨の高さで、体の前側）・スカート（腰から太ももの上の方）
  // 胸の高さは「chest の骨の少し上 〜 首の少し下」（お腹は含めない）
  const hips = wp('hips'), chestB = wp('chest'), top = wp('upperChest') || chestB;
  if (chestB && top && P.y > chestB.y + 0.03 && P.y < (neck ? neck.y - 0.03 : top.y + 0.1) && P.z > top.z) return 'chest';
  // スカート：下腹から太ももの付け根まで（2026-11-20 先生：脚にふれても照れていたので狭めた）
  const legTop = wp('leftUpperLeg') || wp('rightUpperLeg');
  if (hips && legTop && P.y < hips.y + SKIRT.above && P.y > legTop.y - SKIRT.belowLegTop) return 'skirt';
  return 'body';
}

// 指の操作を見分ける。onTouch(region, gesture) を呼ぶ
// controls：OrbitControls（なでている間は止める）
export function setupTouch({ canvas, camera, controls, getVrm, onTouch, onEmptyDoubleTap }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pointers = new Map();
  let g = null;   // 今の指 { id, x, y, t, region, moved, stroking, camPos, camTarget }
  let lastTap = 0;

  function hit(x, y) {
    const vrm = getVrm(); if (!vrm) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(vrm.scene, true).filter((h) => h.object.isMesh && h.object.visible);
    if (!hits.length) return null;
    // キャラクターの左右（左手側がワールドの +X。腰からの向きで決める）
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    const local = hips ? hips.worldToLocal(hits[0].point.clone()) : hits[0].point;
    return { region: regionAt(vrm, hits[0].point), side: local.x > 0 ? 'left' : 'right' };
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, true);
    if (pointers.size > 1) { endStroke(); g = null; return; }   // 2 本指は寄る・引く（今まで通り）
    const h = hit(e.clientX, e.clientY);
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), region: h && h.region, side: h && h.side, moved: 0, stroking: false,
          camPos: camera.position.clone(), camTarget: controls.target.clone() };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x, e.clientY - g.y));
    // 頭の上から動かし始めた → なでる。画面は回さない（動き始めに少し回った分は戻す）
    if (!g.stroking && g.region === 'head' && g.moved > TAP_PX) {
      g.stroking = true;
      controls.enabled = false;
      camera.position.copy(g.camPos); controls.target.copy(g.camTarget); controls.update();
    }
    if (g.stroking) {
      g.path = (g.path || 0) + Math.hypot(e.movementX || 0, e.movementY || 0);
      if (!g.fired && g.moved > STROKE_PX) { g.fired = true; onTouch('head', 'stroke', g.side); }
    }
  });
  function endStroke(s = g) { if (s && s.stroking) controls.enabled = true; }
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!g || e.pointerId !== g.id) return;
    const s = g; g = null;
    endStroke(s);   // なでていたら、画面を回す操作を戻す
    if (s.stroking || s.moved > TAP_PX || performance.now() - s.t > TAP_MS) return;
    if (s.region) { onTouch(s.region, 'tap', s.side); lastTap = 0; return; }
    // キャラクターの外を 2 回タップ → 最初の見え方に戻す
    const now = performance.now();
    if (now - lastTap < 300) { onEmptyDoubleTap(); lastTap = 0; } else lastTap = now;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); if (g && e.pointerId === g.id) { endStroke(); g = null; } });
  // 念のため：指が 1 本も触れていないのに回す操作が止まったままなら戻す
  window.addEventListener('pointerup', () => { if (!g && !controls.enabled) controls.enabled = true; });

  return { hit };
}
