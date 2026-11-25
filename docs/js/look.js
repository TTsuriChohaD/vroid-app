// 見た目のテスト（2026-11-24 先生）：VRoid のアニメ調を残したまま、光と色の仕上げを近づける
// ・光：メインの光・逆光・環境光　・材質（MToon）：影・リムライト・輪郭線（全体と、肌・髪・服・目のグループ）
// ・画面全体の効果：ブルーム（光のにじみ）・露出・色の仕上げ（トーンマッピング）・彩度・コントラスト
// ・立体視（確かめ用）：画面を左右に分け、後処理も左右それぞれにかける　・FPS の表示
// VRM ファイルは変えない（読み込んだあと、ページの中で材質の数値を変えるだけ）。揺れもの・背景は変えない。
// 背景はページの後ろの色（CSS）のまま：3D の絵は透明な所を残して描き、キャラクターとそのにじみだけに効果をかける
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

// 読み込んだときの見た目（今までと同じ。光の向きは 度：az 0＝正面（こちら）・90＝キャラの左・180＝後ろ、el＝高さ）
export const LOOK_BASE = {
  light: { on: true,
    main: { az: 22, el: 36, intensity: 2.83, color: '#ffffff' },
    back: { az: 200, el: 35, intensity: 0, color: '#ffe2b8' },
    ambient: { intensity: 0.6, color: '#ffffff' } },
  // 材質：書いた数値だけ変える（書いていない数値はモデルのまま）。all＝全体、ほかはグループ（全体より優先）
  mtoon: { on: false, all: {}, skin: {}, hair: {}, cloth: {}, eye: {} },
  post: { on: false,
    bloom: { on: true, strength: 0.4, radius: 0.5, threshold: 0.8 },
    grade: { on: true, exposure: 1, tone: 'linear', saturation: 1, contrast: 1 } },
  stereo: { on: false, lite: true, eyeSep: 0.064 },   // lite：立体視のときは効果を軽く（ブルームを切る）
  // AR（2026-11-25）：post＝AR でも画面の効果をかける（post.on のときだけ）、lite＝にじみを半分の細かさで、
  // res＝AR の画面の細かさ（1・0.75・0.5。次に AR を始めたときから効く。three の setFramebufferScaleFactor）
  ar: { post: true, lite: true, res: 1 },
  fps: false,
  springDebug: false,   // 揺れものの補助表示（当たり判定の球と揺れものの点。springtouch.js）
};

// 最初の目安のプリセット（先生：逆光＋リムライト＋ブルーム＋やわらかい影）
export const LOOK_PRESETS = {
  // MToon は影の側にも光の色をそのまま足すので、逆光を強くしたら正面の光を弱め、光の合計を元（約 2.8）に近づける
  // （逆光 3.2＋正面 2.2 では全身が白く飛んだ。リムライトを広げすぎると紫の髪が薄茶色になった）
  '逆光・リム・ブルーム・やわらかい影': {
    light: { on: true,
      main: { az: 35, el: 30, intensity: 1.1, color: '#fff8f0' },
      back: { az: 200, el: 40, intensity: 1.6, color: '#ffe8cc' },
      ambient: { intensity: 0.4, color: '#f0f3ff' } },
    mtoon: { on: true,
      all: { shadingToonyFactor: 0.6, parametricRimColorFactor: '#fff0dc', parametricRimFresnelPowerFactor: 5,
             parametricRimLiftFactor: 0, rimLightingMixFactor: 0.35, outlineWidthFactor: 0.00025 },
      skin: {}, hair: { parametricRimFresnelPowerFactor: 4 }, cloth: {}, eye: { parametricRimColorFactor: '#000000' } },
    post: { on: true,
      bloom: { on: true, strength: 0.35, radius: 0.6, threshold: 0.92 },
      grade: { on: true, exposure: 1.0, tone: 'neutral', saturation: 1.08, contrast: 1.04 } },
  },
};

// 材質のグループ（VRoid の材質の名前の終わり：_SKIN・_HAIR・_CLOTH・_EYE・_FACE）
const GROUPS = [['skin', '肌', /_SKIN/i], ['hair', '髪', /_HAIR/i], ['cloth', '服', /_CLOTH/i], ['eye', '目・顔', /_(EYE|FACE)/i]];
const groupOf = (name) => (GROUPS.find(([, , re]) => re.test(name || '')) || ['other'])[0];
// 変える MToon の数値（three-vrm の MToonMaterial の名前）
const MTOON_KEYS = [
  ['shadingShiftFactor', '影の位置', -1, 1, 0.01],
  ['shadingToonyFactor', '影のやわらかさ（小さいほどやわらか）', 0, 1, 0.01],
  ['parametricRimColorFactor', 'リムライトの色', 'color'],
  ['parametricRimFresnelPowerFactor', 'リムライトの広がり（小さいほど広い）', 0.5, 20, 0.1],
  ['parametricRimLiftFactor', 'リムライトの持ち上げ', 0, 1, 0.01],
  ['rimLightingMixFactor', 'リムライトの混ぜ具合（光に合わせる）', 0, 1, 0.01],
  ['outlineWidthFactor', '輪郭線の太さ（m。肌・服だけにある）', 0, 0.002, 0.00005],
];
const TONES = { linear: ['そのまま', THREE.LinearToneMapping], neutral: ['ニュートラル（色を残す）', THREE.NeutralToneMapping],
  aces: ['ACES（映画風）', THREE.ACESFilmicToneMapping], agx: ['AgX（やわらか）', THREE.AgXToneMapping] };

// 光の向き（度）→ 位置
function dirFrom(az, el) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(3);
}

// 最後の仕上げ：キャラクター（＋にじみ）に露出・色の仕上げ・彩度・コントラストをかけ、にじみは背景の上に足す。透明な所は透明のまま
const FINISH = {
  uniforms: { tScene: { value: null }, tBloom: { value: null }, bloomOn: { value: 0 }, gradeOn: { value: 1 }, saturation: { value: 1 }, contrast: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tScene; uniform sampler2D tBloom; uniform float bloomOn; uniform float gradeOn; uniform float saturation; uniform float contrast;
    varying vec2 vUv;
    vec3 toDisplay(vec3 lin){ return clamp(sRGBTransferOETF(vec4(toneMapping(lin), 1.0)).rgb, 0.0, 1.0); }
    vec3 grade(vec3 c){
      if (gradeOn > 0.5) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, saturation); c = (c - 0.5) * contrast + 0.5; }
      return clamp(c, 0.0, 1.0);
    }
    void main(){
      vec4 s = texture2D(tScene, vUv);
      vec3 b = bloomOn > 0.5 ? texture2D(tBloom, vUv).rgb : vec3(0.0);
      float a = clamp(s.a, 0.0, 1.0);
      vec3 col = a > 0.0001 ? s.rgb / a : vec3(0.0);
      vec3 body = grade(toDisplay(col + b)) * a;     // キャラクター（にじみも重ねる）
      vec3 glow = toDisplay(b) * (1.0 - a);           // キャラクターの外のにじみ（背景の上に足す）
      gl_FragColor = vec4(body + glow, a);
    }`,
};

export function createLook(renderer, scene, camera) {
  let S = clone(LOOK_BASE);
  // 光
  const main = new THREE.DirectionalLight(0xffffff, 1), back = new THREE.DirectionalLight(0xffffff, 0), amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(main, back, amb);
  // 材質：読み込んだときの値を覚える
  let mats = [];   // { m, group, base }
  // 後処理
  const rtOpts = { type: THREE.HalfFloatType, samples: 4 };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.8);
  bloom.blendMaterial.visible = false;   // にじみだけを作る（元の絵に足すのは最後の仕上げで）
  const finishMat = new THREE.ShaderMaterial({ ...FINISH, uniforms: THREE.UniformsUtils.clone(FINISH.uniforms), depthTest: false, depthWrite: false });
  const finish = new FullScreenQuad(finishMat);
  const stereo = new THREE.StereoCamera(); stereo.aspect = 0.5;
  let rtW = 0, rtH = 0, bloomW = 0, bloomH = 0;

  function attach(vrm) {
    mats = [];
    const seen = new Set();
    vrm.scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        if (!m || !m.isMToonMaterial || seen.has(m)) continue;
        seen.add(m);
        const base = {};
        for (const [k, , t] of MTOON_KEYS) base[k] = t === 'color' ? '#' + m[k].getHexString() : m[k];
        mats.push({ m, group: groupOf(m.name), base });
      }
    });
    applyMtoon();
  }

  function applyLights() {
    const L = S.light;
    const on = L.on;
    main.position.copy(dirFrom(L.main.az, L.main.el)); main.color.set(L.main.color); main.intensity = on ? L.main.intensity : LOOK_BASE.light.main.intensity;
    if (!on) { main.position.copy(dirFrom(LOOK_BASE.light.main.az, LOOK_BASE.light.main.el)); main.color.set('#ffffff'); }
    back.position.copy(dirFrom(L.back.az, L.back.el)); back.color.set(L.back.color); back.intensity = on ? L.back.intensity : 0;
    amb.color.set(on ? L.ambient.color : '#ffffff'); amb.intensity = on ? L.ambient.intensity : LOOK_BASE.light.ambient.intensity;
  }
  function applyMtoon() {
    for (const { m, group, base } of mats) {
      const eff = S.mtoon.on ? { ...base, ...S.mtoon.all, ...(S.mtoon[group] || {}) } : base;
      for (const [k, , t] of MTOON_KEYS) {
        if (!(k in eff)) continue;
        if (t === 'color') m[k].set(eff[k]); else m[k] = eff[k];
      }
    }
  }
  function applyPost() {
    const P = S.post;
    renderer.toneMapping = P.on ? TONES[P.grade.tone][1] : THREE.NoToneMapping;
    renderer.toneMappingExposure = P.on && P.grade.on ? P.grade.exposure : 1;
    bloom.strength = P.bloom.strength; bloom.radius = P.bloom.radius; bloom.threshold = P.bloom.threshold;
    finishMat.uniforms.gradeOn.value = P.grade.on ? 1 : 0;
    finishMat.uniforms.saturation.value = P.grade.saturation;
    finishMat.uniforms.contrast.value = P.grade.contrast;
  }
  function applyAll() { applyLights(); applyMtoon(); applyPost(); }

  function ensureSize(w, h, lite) {
    if (w !== rtW || h !== rtH) { sceneRT.setSize(w, h); rtW = w; rtH = h; }
    const bw = lite ? Math.round(w / 2) : w, bh = lite ? Math.round(h / 2) : h;
    if (bw !== bloomW || bh !== bloomH) { bloom.setSize(bw, bh); bloomW = bw; bloomH = bh; }
  }

  // 1 つの目（または画面全体）を描く。vx・vw：画面の左端と幅（CSS の点）
  function renderEye(cam, vx, vw, vh, useBloom) {
    const P = S.post;
    if (!P.on) { renderer.setRenderTarget(null); renderer.setViewport(vx, 0, vw, vh); renderer.setScissor(vx, 0, vw, vh); renderer.render(scene, cam); return; }
    const pr = renderer.getPixelRatio();
    ensureSize(Math.max(1, Math.round(vw * pr)), Math.max(1, Math.round(vh * pr)), S.stereo.on && S.stereo.lite);
    renderer.setRenderTarget(sceneRT);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, cam);
    const bOn = P.bloom.on && useBloom;
    if (bOn) bloom.render(renderer, null, sceneRT, 0, false);
    finishMat.uniforms.tScene.value = sceneRT.texture;
    finishMat.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
    finishMat.uniforms.bloomOn.value = bOn ? 1 : 0;
    renderer.setRenderTarget(null);
    renderer.setViewport(vx, 0, vw, vh); renderer.setScissor(vx, 0, vw, vh);
    finish.render(renderer);
  }

  // FPS
  let fpsEl = null, frames = 0, fpsT = performance.now();
  function fpsTick(label) {
    frames++;
    const now = performance.now();
    if (now - fpsT > 500) {
      if (fpsEl) fpsEl.textContent = Math.round(frames * 1000 / (now - fpsT)) + ' FPS' + label;
      frames = 0; fpsT = now;
    }
  }
  function render() {
    const size = renderer.getSize(new THREE.Vector2());
    const W = size.x, H = size.y;
    const ac = renderer.autoClear;
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000, 0);
    if (S.stereo.on) {
      camera.updateMatrixWorld();
      stereo.eyeSep = S.stereo.eyeSep;
      stereo.update(camera);
      renderer.setRenderTarget(null); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.clear();
      renderer.autoClear = false;
      const half = Math.floor(W / 2);
      renderEye(stereo.cameraL, 0, half, H, !S.stereo.lite);
      renderEye(stereo.cameraR, half, W - half, H, !S.stereo.lite);
    } else {
      renderer.autoClear = true;
      renderEye(camera, 0, W, H, true);
    }
    renderer.autoClear = ac;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    fpsTick((S.stereo.on ? '（立体視）' : '') + (S.post.on ? '' : '・効果なし'));
  }

  // AR のとき（2026-11-25 先生：AR の見た目と重さ）。three は AR の間、描くときに自動で AR のカメラに切り替えるので、
  // 後処理（別の画面に描く → にじみ → 仕上げを AR の画面へ）の間だけ切り替えを止め、AR のカメラ（1 枚目）を直接使う。
  // AR のカメラは台（rig）に載っていて、three が台の位置を掛けた matrixWorld を作るので、描くときに作り直させない
  function renderXR() {
    const P = S.post, A = S.ar || {};
    if (!(P.on && A.post)) { renderer.render(scene, camera); fpsTick('（AR・効果なし）'); return; }
    const xr = renderer.xr;
    const xrRT = renderer.getRenderTarget();   // AR の画面（three がコマの初めに選んでいる）
    xr.updateCamera(camera);                   // 台の位置を掛けた AR のカメラと、目線に使うカメラを今のコマに合わせる
    const camXR = xr.getCamera();
    const cam = camXR.cameras && camXR.cameras.length ? camXR.cameras[0] : camXR;
    const vp = cam.viewport || new THREE.Vector4(0, 0, renderer.getSize(new THREE.Vector2()).x, renderer.getSize(new THREE.Vector2()).y);
    const keep = cam.matrixWorldAutoUpdate;
    cam.matrixWorldAutoUpdate = false;
    xr.enabled = false;
    try {
      ensureSize(Math.max(1, Math.round(vp.z)), Math.max(1, Math.round(vp.w)), !!A.lite);
      renderer.setScissorTest(false);
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(scene, cam);
      const bOn = P.bloom.on;
      if (bOn) bloom.render(renderer, null, sceneRT, 0, false);
      finishMat.uniforms.tScene.value = sceneRT.texture;
      finishMat.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
      finishMat.uniforms.bloomOn.value = bOn ? 1 : 0;
      renderer.setRenderTarget(xrRT);
      renderer.setViewport(vp.x, vp.y, vp.z, vp.w);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      finish.render(renderer);
    } finally {
      xr.enabled = true;
      cam.matrixWorldAutoUpdate = keep;
    }
    fpsTick('（AR）');
  }

  return {
    attach, render, renderXR, applyAll,
    get settings() { return S; },
    set settings(v) { S = mergeLook(v); applyAll(); },
    setFpsElement(el) { fpsEl = el; },
    groupsInModel() { const g = new Set(mats.map((x) => x.group)); return GROUPS.filter(([id]) => g.has(id)); },
    // 今の材質の値（表示用）：グループの最初の材質の、今の設定での値
    currentMtoon(group, key) {
      const x = mats.find((y) => group === 'all' || y.group === group);
      if (!x) return null;
      const eff = { ...x.base, ...S.mtoon.all, ...(group === 'all' ? {} : S.mtoon[group] || {}) };
      return eff[key];
    },
    MTOON_KEYS, GROUPS, TONES,
  };
}

// 足りない項目を標準で埋める（古い設定ファイル・プリセットでも読めるように）
export function mergeLook(v) {
  const out = clone(LOOK_BASE);
  const deep = (dst, src) => {
    for (const [k, val] of Object.entries(src || {})) {
      if (val && typeof val === 'object' && !Array.isArray(val) && dst[k] && typeof dst[k] === 'object') deep(dst[k], val);
      else dst[k] = val;
    }
  };
  deep(out, v || {});
  return out;
}
