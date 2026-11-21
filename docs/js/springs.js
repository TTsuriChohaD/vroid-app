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
};

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
  return { added };
}
