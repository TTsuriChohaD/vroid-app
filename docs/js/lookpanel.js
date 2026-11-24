// 見た目のテストの調整パネル（look.js の数値をスライダーで変える）。プリセットの保存・切り替え、設定ファイル（look.json）の書き出し・読み込み
// ・前回の値はこの端末のブラウザに覚える（便利機能。消えても困らない）
// ・look.json はダウンロードして、スマホの VroidApp/<キャラクター>/ に置く（フォルダを選び直すと読み込む）。リポジトリには上げない
import { LOOK_BASE, LOOK_PRESETS, mergeLook } from './look.js';

const KEY = 'vroid-app-look';
const loadStore = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { chars: {}, presets: {} }; } catch (_) { return { chars: {}, presets: {} }; } };
const saveStore = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} };
const clone = (o) => JSON.parse(JSON.stringify(o));

export function createLookPanel(root, look, { flash = () => {} } = {}) {
  let store = loadStore();
  let charId = 'default';
  let group = 'all';
  let saveTimer = 0;
  const allPresets = () => ({ ...LOOK_PRESETS, ...store.presets });

  // キャラクターを切り替えたとき：前回の値 → look.json（current か active のプリセット）→ 読み込んだときの見た目
  function useCharacter(id, fileLook) {
    charId = id || 'default';
    if (fileLook && fileLook.presets) store.presets = { ...store.presets, ...fileLook.presets };
    const remembered = store.chars[charId] && store.chars[charId].current;
    let s = remembered || (fileLook && (fileLook.current || (fileLook.active && allPresets()[fileLook.active]))) || LOOK_BASE;
    look.settings = s;
    saveStore(store);
    build();
  }
  function remember() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { store.chars[charId] = { ...(store.chars[charId] || {}), current: look.settings }; saveStore(store); }, 400);
  }
  function changed(rebuild) { look.applyAll(); remember(); if (rebuild) build(); }

  // ---------- 部品 ----------
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };
  const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(Math.min(5, Math.max(0, -Math.floor(Math.log10(step))))));
  function slider(label, get, set, min, max, step) {
    const out = el('span', { class: 'val' }, fmt(get(), step));
    const input = el('input', { type: 'range', min, max, step, value: get() });
    input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(Number(input.value), step); changed(); });
    return el('label', { class: 'row' }, el('span', { class: 'lab' }, label), out, input);
  }
  function color(label, get, set) {
    const input = el('input', { type: 'color', value: get() });
    input.addEventListener('input', () => { set(input.value); changed(); });
    return el('label', { class: 'row color' }, el('span', { class: 'lab' }, label), input);
  }
  function toggle(label, get, set) {
    const input = el('input', { type: 'checkbox' }); input.checked = !!get();
    input.addEventListener('change', () => { set(input.checked); changed(true); });
    return el('label', { class: 'toggle' }, input, ' ', label);
  }
  function section(title, onGet, onSet, open, ...body) {
    const sum = el('summary', {}, title);
    if (onGet) {
      const cb = el('input', { type: 'checkbox', title: '入／切' }); cb.checked = !!onGet();
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { onSet(cb.checked); changed(true); });
      sum.append(' ', cb);
    }
    const d = el('details', { class: 'sec' }, sum, ...body);
    if (open) d.open = true;
    d.addEventListener('toggle', () => { openState[title] = d.open; });
    return d;
  }
  const openState = {};

  // ---------- パネル ----------
  function build() {
    const S = look.settings;
    root.innerHTML = '';
    // プリセット
    const sel = el('select', { 'aria-label': 'プリセット' }, el('option', { value: '' }, '（プリセットを選ぶ）'));
    for (const n of Object.keys(allPresets())) sel.append(el('option', { value: n }, n + (LOOK_PRESETS[n] && !store.presets[n] ? '（最初から）' : '')));
    if (store.chars[charId] && store.chars[charId].active) sel.value = store.chars[charId].active;
    const apply = () => { const p = allPresets()[sel.value]; if (!p) return; look.settings = mergeLook(p); store.chars[charId] = { ...(store.chars[charId] || {}), active: sel.value }; changed(true); flash('「' + sel.value + '」にしました'); };
    sel.addEventListener('change', apply);
    const fileIn = el('input', { type: 'file', class: 'hidden-file' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      try { const j = JSON.parse(await f.text()); if (j.presets) store.presets = { ...store.presets, ...j.presets }; look.settings = mergeLook(j.current || (j.active && allPresets()[j.active]) || j); changed(true); flash('見た目の設定を読み込みました'); }
      catch (e) { flash('読み込めませんでした：' + e.message, true); }
    });
    root.append(
      el('div', { class: 'presets' },
        sel,
        el('div', { class: 'btns' },
          el('button', { type: 'button', class: 'btn small', onclick: () => {
            const name = prompt('プリセットの名前', sel.value && !LOOK_PRESETS[sel.value] ? sel.value : '');
            if (!name) return;
            store.presets[name] = clone(look.settings); store.chars[charId] = { ...(store.chars[charId] || {}), active: name }; saveStore(store); build(); flash('「' + name + '」を保存しました');
          } }, '名前を付けて保存'),
          el('button', { type: 'button', class: 'btn small', onclick: () => {
            if (!store.presets[sel.value]) { flash('最初からあるプリセットは消せません', true); return; }
            if (!confirm('「' + sel.value + '」を消しますか')) return;
            delete store.presets[sel.value]; saveStore(store); build();
          } }, '消す'),
          el('button', { type: 'button', class: 'btn small', onclick: () => { look.settings = LOOK_BASE; store.chars[charId] = { current: null }; changed(true); flash('読み込んだときの見た目に戻しました'); } }, '元に戻す'),
          el('button', { type: 'button', class: 'btn small', onclick: exportJson }, '書き出す'),
          el('label', { class: 'btn small' }, '読み込む', fileIn),
        ),
      ),
    );
    // 光
    const L = S.light;
    root.append(section('光', () => L.on, (v) => { L.on = v; }, openState['光'],
      el('h4', {}, 'メインの光'),
      slider('向き（0＝正面・90＝左・180＝後ろ）', () => L.main.az, (v) => { L.main.az = v; }, -180, 180, 1),
      slider('高さ', () => L.main.el, (v) => { L.main.el = v; }, -30, 90, 1),
      slider('強さ', () => L.main.intensity, (v) => { L.main.intensity = v; }, 0, 6, 0.05),
      color('色', () => L.main.color, (v) => { L.main.color = v; }),
      el('h4', {}, '逆光（後ろからの光）'),
      slider('向き', () => L.back.az, (v) => { L.back.az = v; }, -180, 360, 1),
      slider('高さ', () => L.back.el, (v) => { L.back.el = v; }, -30, 90, 1),
      slider('強さ', () => L.back.intensity, (v) => { L.back.intensity = v; }, 0, 8, 0.05),
      color('色', () => L.back.color, (v) => { L.back.color = v; }),
      el('h4', {}, '環境光（全体の明るさ）'),
      slider('強さ', () => L.ambient.intensity, (v) => { L.ambient.intensity = v; }, 0, 3, 0.05),
      color('色', () => L.ambient.color, (v) => { L.ambient.color = v; }),
    ));
    // 材質（MToon）
    const M = S.mtoon;
    const gsel = el('select', { 'aria-label': 'グループ' }, el('option', { value: 'all' }, '全体'));
    for (const [id, name] of look.groupsInModel()) gsel.append(el('option', { value: id }, name));
    gsel.value = group;
    gsel.addEventListener('change', () => { group = gsel.value; build(); });
    const G = () => (M[group] ||= {});
    const rows = look.MTOON_KEYS.map(([k, label, min, max, step]) => {
      const get = () => { const v = G()[k] ?? look.currentMtoon(group, k); return v ?? (min === 'color' ? '#000000' : 0); };
      const set = (v) => { G()[k] = v; };
      return min === 'color' ? color(label, get, set) : slider(label, get, set, min, max, step);
    });
    root.append(section('材質（影・リムライト・輪郭線）', () => M.on, (v) => { M.on = v; }, openState['材質（影・リムライト・輪郭線）'],
      el('label', { class: 'row' }, el('span', { class: 'lab' }, 'どこを変えるか（グループは全体より優先）'), gsel),
      ...rows,
      el('button', { type: 'button', class: 'btn small', onclick: () => { M[group] = {}; changed(true); } }, (group === 'all' ? '全体' : 'このグループ') + 'をモデルの値に戻す'),
    ));
    // 画面全体の効果
    const P = S.post;
    root.append(section('画面の効果（にじみ・色）', () => P.on, (v) => { P.on = v; }, openState['画面の効果（にじみ・色）'],
      toggle('ブルーム（光のにじみ）', () => P.bloom.on, (v) => { P.bloom.on = v; }),
      slider('強さ', () => P.bloom.strength, (v) => { P.bloom.strength = v; }, 0, 2, 0.01),
      slider('広がり', () => P.bloom.radius, (v) => { P.bloom.radius = v; }, 0, 1, 0.01),
      slider('しきい値（明るい所だけにじむ）', () => P.bloom.threshold, (v) => { P.bloom.threshold = v; }, 0, 1.5, 0.01),
      toggle('色の調整', () => P.grade.on, (v) => { P.grade.on = v; }),
      (() => {
        const s = el('select', { 'aria-label': '色の仕上げ' });
        for (const [id, [name]] of Object.entries(look.TONES)) s.append(el('option', { value: id }, name));
        s.value = P.grade.tone; s.addEventListener('change', () => { P.grade.tone = s.value; changed(); });
        return el('label', { class: 'row' }, el('span', { class: 'lab' }, '色の仕上げ（トーンマッピング）'), s);
      })(),
      slider('露出', () => P.grade.exposure, (v) => { P.grade.exposure = v; }, 0.3, 2.5, 0.01),
      slider('彩度', () => P.grade.saturation, (v) => { P.grade.saturation = v; }, 0, 2, 0.01),
      slider('コントラスト', () => P.grade.contrast, (v) => { P.grade.contrast = v; }, 0.5, 1.6, 0.01),
    ));
    // 立体視（確かめ用）・FPS
    root.append(section('重さの確認', null, null, openState['重さの確認'],
      toggle('FPS を表示', () => S.fps, (v) => { S.fps = v; }),
      toggle('立体視（確かめ用：画面を左右に分ける）', () => S.stereo.on, (v) => { S.stereo.on = v; }),
      toggle('立体視のときは効果を軽く（ブルームを切る・にじみを半分の細かさで）', () => S.stereo.lite, (v) => { S.stereo.lite = v; }),
      slider('目の間隔（m）', () => S.stereo.eyeSep, (v) => { S.stereo.eyeSep = v; }, 0.02, 0.1, 0.001),
    ));
    onBuilt(S);
  }
  let onBuilt = () => {};

  // look.json を書き出す（ダウンロード）
  function exportJson() {
    const active = store.chars[charId] && store.chars[charId].active;
    const data = { version: 1, note: 'VRM ビューアの見た目の設定。VroidApp/<キャラクター>/look.json に置く', active: active || null, current: look.settings, presets: store.presets };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'look.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash('look.json を書き出しました。VroidApp/' + (charId === 'default' ? '<キャラクター>' : charId) + '/ に置いてフォルダを選び直すと読み込みます');
  }

  build();
  return { useCharacter, build, set onBuilt(f) { onBuilt = f; } };
}
