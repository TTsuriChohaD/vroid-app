// VRMA（VRM アニメーション）を読み込んで再生する
// 再生した骨の角度は「下書き」として受け取り、motion.js がコードの動きと重みで混ぜる（CLAUDE.md「7.」）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const loader = new GLTFLoader();
loader.register((p) => new VRMAnimationLoaderPlugin(p));

// ファイル（Blob）→ VRMAnimation
export async function loadVRMA(blob) {
  const gltf = await new Promise(async (res, rej) => loader.parse(await blob.arrayBuffer(), '', res, rej));
  const anim = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
  if (!anim) throw new Error('VRMA ではないファイルのようです');
  return anim;
}

export const FADE_SEC = 0.4;   // 始め・終わりに、コードの姿勢と混ぜる時間（0.3 → 0.4、2026-11-20 終わりの「カクッ」を和らげる）

// VRM 1 体ぶんの再生係
export function createPlayer(vrm) {
  const mixer = new THREE.AnimationMixer(vrm.scene);
  // VRMA の目線を受け取る係（自動で作られると警告が出るので先に作る）
  if (vrm.lookAt && !vrm.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy)) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'VRMLookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }
  // 骨のノード名 → 骨の名前
  const nodeToBone = new Map();
  for (const name of Object.keys(vrm.humanoid.humanBones)) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (node) nodeToBone.set(node.name, name);
  }

  let cur = null;   // { action, bones, hasExpr, hasLookAt, name, t, dur, loop }

  function play(vrmAnimation, name, { loop = false } = {}) {
    stop();
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    const bones = new Set();
    for (const tr of clip.tracks) {
      const [node, prop] = tr.name.split('.');
      const b = nodeToBone.get(node);
      if (b && (prop === 'quaternion' || prop === 'position')) bones.add(b);
    }
    const action = mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = true;
    action.play();
    cur = {
      action, clip, bones, name, t: 0, dur: clip.duration, loop,
      hasExpr: vrmAnimation.expressionTracks.preset.size + vrmAnimation.expressionTracks.custom.size > 0,
      hasLookAt: vrmAnimation.lookAtTrack != null,
    };
  }

  function stop() {
    if (!cur) return;
    cur.action.stop();
    mixer.uncacheClip(cur.clip);
    cur = null;
  }

  // 時間を進め、骨に VRMA の角度を書き込む。戻り値：混ぜる重み（0〜1）と、動かした骨
  function update(dt) {
    if (!cur) return null;
    cur.t += dt;
    if (!cur.loop && cur.t >= cur.dur + FADE_SEC) { stop(); return null; }
    mixer.update(dt);
    const fadeIn = Math.min(1, cur.t / FADE_SEC);
    const fadeOut = cur.loop ? 1 : Math.min(1, Math.max(0, (cur.dur - cur.t) / FADE_SEC + 1));   // 終わってから FADE_SEC で戻す
    const e = (x) => x * x * (3 - 2 * x);
    // finished：最後まで再生した（three はこのあと骨を書かなくなるので、motion.js が最後の姿勢を持ち続ける）
    return { w: e(Math.min(fadeIn, fadeOut)), bones: cur.bones, hasExpr: cur.hasExpr, hasLookAt: cur.hasLookAt, name: cur.name,
      finished: !cur.loop && cur.t >= cur.dur };
  }

  return { play, stop, update, get playing() { return cur ? cur.name : null; } };
}
