// 姿勢の定数。見た目は先生が実機で確かめ、言葉でもらって数値を直す。
// 角度は rad。骨は正規化された骨（T ポーズが 0）。キャラクターの右手側はワールドの -X。

export const POSE = {
  // 腕を下ろす（T ポーズのままにしない）。右腕は +Z 回りで下がる、左腕は -Z 回り
  upperArmDown: 1.2,     // 上腕を下ろす角度
  upperArmForward: 0.1,  // 上腕を少し前へ
  lowerArmBend: 0.15,    // 肘を少し曲げる
  // 呼吸：胸をわずかに前後へ
  breathAmp: 0.012,      // 振れ幅
  breathSec: 4.0,        // 1 回の長さ（秒）
};

// 待機の姿勢をつける（毎フレーム呼ぶ。t は経過秒）
export function applyIdle(vrm, t) {
  const h = vrm.humanoid;
  const bone = (name) => h.getNormalizedBoneNode(name);

  const rUp = bone('rightUpperArm'), lUp = bone('leftUpperArm');
  // 前へ出すのは、右腕は +Y 回り、左腕は -Y 回り（2026-11-19 横から見て確かめた）
  if (rUp) rUp.rotation.set(0, POSE.upperArmForward, POSE.upperArmDown);
  if (lUp) lUp.rotation.set(0, -POSE.upperArmForward, -POSE.upperArmDown);

  const rLo = bone('rightLowerArm'), lLo = bone('leftLowerArm');
  if (rLo) rLo.rotation.set(0, POSE.lowerArmBend, 0);
  if (lLo) lLo.rotation.set(0, -POSE.lowerArmBend, 0);

  const chest = bone('chest') || bone('spine');
  if (chest) chest.rotation.x = Math.sin(t * 2 * Math.PI / POSE.breathSec) * POSE.breathAmp;
}
