import * as THREE from 'three';
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere } from '@pixiv/three-vrm';

// 揺れもの（スプリングボーン）の当たり判定をページ側で足す（2026-11-21 先生：胸のところに当たり判定がなく、動きが不自然）
// VRoid Studio では、スカートや胸が「腕・手に当たる」ようには選べない。
// VRM に入っている当たり判定の玉（腕・手など）を、当たっていない揺れものにも当たるようにする。
// 揺れ方（かたさ・重力など）はモデルの設定のまま。character.json の "springs" で上書きできる（書き方は下と同じ）

export const SPRINGS = {
  // joints：揺れものの骨の名前に含まれる文字。parts：当たらせる体の部位（VRM の当たり判定の玉が付いている骨の名前の終わり）
  add: [
    { joints: 'Bust', parts: ['UpperArm', 'LowerArm', 'Hand'] },    // 胸：腕・手に当たる（前かがみで前腕に 2.4 cm 食い込んでいた）
    { joints: 'Skirt', parts: ['UpperArm', 'LowerArm', 'Hand'] },   // スカート：腕・手に当たる（前は太ももだけ）
  ],
  // 腕で胸を寄せる（2026-11-21 先生：かがんだとき、腕が胸に食い込むのを「胸が寄る」方で直したい）。
  // 胸の揺れものだけに、腕に沿って少し太めの当たり判定を足す（VRM の腕の玉は細く、胸の先が腕の中に入っていた）。
  // radius：腕の太さ（m）、at：骨の付け根から先までのどこに置くか（割合）。
  // 太くしすぎると左右の胸の先が交差した（上腕 0.055 のとき）。待機・手を振るときは腕が胸から離れているので変わらない
  squeeze: { joints: 'Bust', at: [0.2, 0.5, 0.8], arms: [['UpperArm', 'LowerArm', 0.045], ['LowerArm', 'Hand', 0.035]] },
};

// 胸を左右から寄せる（2026-11-21 先生：胸の前でグーで、脇をしめて胸を寄せる）。
// 胸のふくらみは腕より前にあるので、腕の当たり判定を太くしても届かなかった（胸の先の左右の間は 19 cm のまま）。
// そこで、胸の横に見えない玉（上胸の骨に付ける）を置き、ポーズの重み w に合わせて外から内へ動かして、胸の揺れものを内へ押す。
// amount：胸の先を内へ押す量（m）。w = 0 のときは胸から離れた所にあり、ふだんの揺れには触れない
const PAD = { radius: 0.05, clear: 0.06, back: 0.03, up: 0.0 };
export function setBustSqueeze(vrm, w, amount) {
  const pads = vrm.scene.userData.vroidBustPads;
  if (!pads) return;
  for (const p of pads) {
    const out = PAD.clear * (1 - w) - (amount || 0) * w;   // 胸の先の横から、どれだけ外に玉の表面を置くか
    p.c.shape.offset.copy(p.tip).addScaledVector(p.outward, PAD.radius + p.hit + out).addScaledVector(p.backDir, PAD.back);
  }
}

// どの骨に付いた当たり判定か（leftUpperArm など）
function partOf(vrm, obj) {
  const raw = new Map();
  for (const n of Object.keys(vrm.humanoid.humanBones)) { const b = vrm.humanoid.getRawBoneNode(n); if (b) raw.set(b, n); }
  for (let p = obj; p; p = p.parent) if (raw.has(p)) return raw.get(p);
  return '';
}

// 読み込んだあと 1 回呼ぶ。conf：character.json の "springs"（なければ標準）
export function setupSprings(vrm, conf) {
  const sbm = vrm.springBoneManager;
  if (!sbm) return { added: 0 };
  const rules = (conf && conf.add) || SPRINGS.add;
  const groups = [...sbm.colliderGroups];
  let added = 0;
  for (const rule of rules) {
    const gs = groups.filter((g) => g.colliders.length && g.colliders.every((c) => rule.parts.some((p) => partOf(vrm, c).endsWith(p))));
    for (const j of sbm.joints) {
      if (!j.bone.name.includes(rule.joints)) continue;
      const have = new Set(j.colliderGroups);
      const more = gs.filter((g) => !have.has(g));
      // 揺れものの骨ごとに新しい並びにする（同じ並びを、ほかの揺れものと共有していることがある）
      if (more.length) { j.colliderGroups = [...j.colliderGroups, ...more]; added += more.length; }
    }
  }
  // 腕で胸を寄せる当たり判定（元の姿勢のうちに、腕の骨に沿って玉を置く）
  const sq = conf && 'squeeze' in conf ? conf.squeeze : SPRINGS.squeeze;
  if (sq) {
    vrm.scene.updateMatrixWorld(true);
    const colliders = [];
    for (const side of ['left', 'right']) {
      for (const [from, to, radius] of sq.arms) {
        const b = vrm.humanoid.getRawBoneNode(side + from), c = vrm.humanoid.getRawBoneNode(side + to);
        if (!b || !c) continue;
        const P0 = b.getWorldPosition(new THREE.Vector3()), P1 = c.getWorldPosition(new THREE.Vector3());
        for (const t of sq.at) {
          const col = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ offset: b.worldToLocal(P0.clone().lerp(P1, t)), radius }));
          col.name = 'vroidApp_squeeze';
          b.add(col);
          colliders.push(col);
        }
      }
    }
    const group = { colliders, name: 'vroidApp_squeeze' };   // 当たり判定の組（VRM の決まりと同じ形）
    for (const j of sbm.joints) if (j.bone.name.includes(sq.joints)) { j.colliderGroups = [...j.colliderGroups, group]; added++; }
  }
  // 胸を左右から寄せる玉（setBustSqueeze で動かす）。元の姿勢のうちに、胸の先の位置と外向きを上胸の骨から見て覚える
  const chest = vrm.humanoid.getRawBoneNode('upperChest') || vrm.humanoid.getRawBoneNode('chest');
  if (chest) {
    vrm.scene.updateMatrixWorld(true);
    const pads = [];
    for (const j of sbm.joints) {
      if (!/Bust2/.test(j.bone.name) || !j.child) continue;
      const tipW = j.child.getWorldPosition(new THREE.Vector3());
      const side = Math.sign(tipW.x - chest.getWorldPosition(new THREE.Vector3()).x) || 1;
      const toLocalDir = (v) => chest.worldToLocal(chest.getWorldPosition(new THREE.Vector3()).add(v)).normalize();
      const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ offset: new THREE.Vector3(), radius: PAD.radius }));
      c.name = 'vroidApp_bustPad';
      chest.add(c);
      pads.push({ c, tip: chest.worldToLocal(tipW.clone()), outward: toLocalDir(new THREE.Vector3(side, 0, 0)), backDir: toLocalDir(new THREE.Vector3(0, 0, -1)), hit: j.settings.hitRadius || 0 });
    }
    if (pads.length) {
      vrm.scene.userData.vroidBustPads = pads;
      setBustSqueeze(vrm, 0, 0);
      const group = { colliders: pads.map((p) => p.c), name: 'vroidApp_bustPad' };
      for (const j of sbm.joints) if (/Bust/.test(j.bone.name)) { j.colliderGroups = [...j.colliderGroups, group]; added++; }
    }
  }
  return { added };
}
