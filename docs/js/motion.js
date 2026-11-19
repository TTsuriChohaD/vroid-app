// 動きの段取り：待機中のしぐさ（見回す・手を振る）、なでられる、表情、まばたき、目線
import * as THREE from 'three';
import { applyPose, LOOK, WAVE, PAT } from './pose.js';

// 待機中のしぐさ
const IDLE = {
  firstAt: 10,            // 開いてから最初のしぐさまで（秒）
  gapMin: 10, gapMax: 20, // しぐさの間隔（秒）
  dur: { look: 4.0, wave: 5.0 },
  fade: { look: 0.2, wave: 0.32 },   // 始め・終わりのなめらかさ（手を使う動きは手を離す分ゆっくり）
  waveRate: 0.5,          // 手を振る割合（残りは見回す）
};
const PAT_DUR = 2.2;      // なでられて喜ぶ長さ（秒）

const lerpK = (k, dt) => 1 - Math.pow(1 - k, dt * 60);   // 1/60 秒あたり k ずつ近づく

export function createMotion(vrm, camera) {
  let t = 0;
  let idleType = null, idleStart = 0, idleW = 0, idleP = 0;
  let nextIdleAt = IDLE.firstAt;
  let patAt = -99;
  let happy = 0;
  let nextBlink = 2, blinkStart = -1;
  const look = [0, 0];
  const lookTarget = new THREE.Object3D();
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  function startIdle(type) {
    idleType = type; idleStart = t; idleP = 0; idleW = 0;
    nextIdleAt = t + IDLE.dur[type] + IDLE.gapMin + Math.random() * (IDLE.gapMax - IDLE.gapMin);
  }

  function updateIdle() {
    if (idleType) {
      idleP = (t - idleStart) / IDLE.dur[idleType];
      if (idleP >= 1) { idleType = null; idleW = 0; return; }
      const f = IDLE.fade[idleType], e = (x) => x * x * (3 - 2 * x);
      idleW = idleP < f ? e(idleP / f) : idleP > 1 - f ? e((1 - idleP) / f) : 1;
    } else if (t > nextIdleAt) {
      startIdle(Math.random() < IDLE.waveRate ? 'wave' : 'look');
    }
  }

  function patW() {
    const p = (t - patAt) / PAT_DUR;
    return p < 0 || p > 1 ? 0 : Math.sin(Math.PI * p);
  }

  function blinkValue() {
    if (t > nextBlink && blinkStart < 0) blinkStart = t;
    if (blinkStart < 0) return 0;
    const p = (t - blinkStart) / 0.16;
    if (p >= 1) { blinkStart = -1; nextBlink = t + 2 + Math.random() * 4; return 0; }
    return p < 0.5 ? p * 2 : 2 - p * 2;
  }

  function update(dt) {
    t += dt;
    updateIdle();
    const pw = patW();
    const lookW = idleType === 'look' ? idleW : 0;
    const waveW = idleType === 'wave' ? idleW : 0;

    applyPose(vrm, t, { lookW, lookP: idleP, waveW, patW: pw, patT: t - patAt });

    // 表情：手を振る間と、なでられたときにっこり
    const em = vrm.expressionManager;
    if (em) {
      const target = Math.max(WAVE.happy * waveW, PAT.happy * pw);
      happy += (target - happy) * lerpK(0.1, dt);
      em.setValue('happy', happy);
      em.setValue('blink', blinkValue() * (1 - Math.min(1, happy * 1.5)));   // にっこり中はまばたきしない
    }

    // 目線：ふだんはこちら（カメラ）。見回す間は横へ
    const lx = lookW * LOOK.eyesX * Math.sin(idleP * Math.PI * 2), ly = lookW * LOOK.eyesY;
    look[0] += (lx - look[0]) * lerpK(0.12, dt);
    look[1] += (ly - look[1]) * lerpK(0.12, dt);
    lookTarget.position.copy(camera.position).add(new THREE.Vector3(look[0], look[1], 0));

    vrm.update(dt);
  }

  // 頭がタップされた（しぐさが終わるまでは続けて数えない）
  function pat() {
    if (t - patAt < 1.5) return;
    patAt = t;
  }

  return { update, pat, startIdle };
}

// 画面の点 (x, y) が頭に当たっているか（頭の骨を画面に写して判定）
export function headHit(vrm, camera, canvas, x, y) {
  const head = vrm && vrm.humanoid.getNormalizedBoneNode('head');
  if (!head) return false;
  const c = new THREE.Vector3(); head.getWorldPosition(c); c.y += 0.08;   // 頭の骨は首の付け根寄りなので、頭の真ん中へ
  const rect = canvas.getBoundingClientRect();
  const toScreen = (v) => { const p = v.clone().project(camera); return [rect.left + (p.x + 1) / 2 * rect.width, rect.top + (1 - p.y) / 2 * rect.height]; };
  const [cx, cy] = toScreen(c), [tx, ty] = toScreen(c.clone().add(new THREE.Vector3(0, 0.13, 0)));
  return Math.hypot(x - cx, y - cy) < Math.hypot(tx - cx, ty - cy) * 1.3;   // 頭の大きさに少し余裕を持たせる
}
