// VroidApp フォルダの中身を読み解く（キャラクター・衣装の一覧を作る）
//
// VroidApp/                     ← 選ぶフォルダ（名前は何でもよい）
// ├─ <キャラクター>/            ← 英数字の名前がおすすめ
// │   ├─ character.json         ← 名前・衣装の一覧・姿勢の数値（なくてもよい）
// │   ├─ models/<衣装>.vrm
// │   ├─ voices/lines.json と *.wav
// │   ├─ motions/*.vrma
// │   └─ touch.json
// └─ common/motions/*.vrma      ← 全員で使う動き
//
// character.json の例：
// { "name": "ライトブルー",
//   "outfits": [ { "id": "winter", "name": "冬", "file": "winter.vrm", "months": [11, 12, 1, 2] },
//                { "id": "hoodie", "name": "パーカー", "file": "hoodie.vrm" } ],
//   "pose": { "CLASP": { "curl": 0.2 } },
//   "expressions": { "shy": { "relaxed": 0.5, "happy": 0.2 } } }   ← 表情の組み合わせ（touch.js の EMOTIONS を上書き・追加）
// touch.json の書き方は touch.js の DEFAULT_TOUCH と同じ
// character.json がなければ、models/ の .vrm を全部、衣装として並べる。

const COMMON = 'common';

// files：[{ path, blob }]（path は "VroidApp/lightblue/models/winter.vrm" のような道すじ）
export async function buildPack(files) {
  // いちばん上のフォルダ名（VroidApp など）を外す
  const split = (p) => p.replace(/\\/g, '/').split('/').filter(Boolean);
  const roots = new Set(files.map((f) => split(f.path)[0]));
  const dropRoot = roots.size === 1 && files.every((f) => split(f.path).length > 1);
  const byPath = new Map();
  for (const f of files) {
    const parts = split(f.path);
    byPath.set((dropRoot ? parts.slice(1) : parts).join('/'), f.blob);
  }
  // キャラクターのフォルダを直接選んだとき（いちばん上に character.json や models/ がある）は、
  // そのフォルダ 1 つをキャラクターとして扱う
  const paths = [...byPath.keys()];
  const flat = paths.some((p) => p === 'character.json' || p.startsWith('models/'));
  const rootName = dropRoot ? [...roots][0] : 'character';
  const charDirs = flat ? [''] : [...new Set(paths.filter((p) => p.includes('/')).map((p) => p.split('/')[0]))].filter((d) => d !== COMMON);

  const commonMotions = flat ? [] : motionsIn(COMMON + '/motions/');
  const chars = [];
  for (const dir of charDirs.sort()) {
    const pre = dir ? dir + '/' : '';
    const id = dir || rootName;
    let conf = {};
    const confBlob = byPath.get(pre + 'character.json');
    if (confBlob) {
      try { conf = JSON.parse(await confBlob.text()); }
      catch (e) { throw new Error(id + '/character.json の書き方に誤りがあります（' + e.message + '）'); }
    }
    const vrms = paths.filter((p) => p.startsWith(pre + 'models/') && /\.vrm$/i.test(p)).sort();
    let outfits;
    if (Array.isArray(conf.outfits) && conf.outfits.length) {
      outfits = conf.outfits
        .map((o, i) => ({ id: String(o.id || o.file || i), name: o.name || o.id || o.file, path: pre + 'models/' + o.file, months: o.months }))
        .filter((o) => byPath.has(o.path));
    } else {
      outfits = vrms.map((p) => { const n = p.split('/').pop().replace(/\.vrm$/i, ''); return { id: n, name: n, path: p }; });
    }
    if (!outfits.length) continue;   // VRM のないフォルダは飛ばす
    // 動き：common/motions/ と、そのキャラクターの motions/（同じ名前ならキャラクターの方を使う）
    const motions = new Map([...commonMotions, ...motionsIn(pre + 'motions/')]);
    // タッチの設定（なければページの標準）
    let touch = null;
    const touchBlob = byPath.get(pre + 'touch.json');
    if (touchBlob) {
      try { touch = JSON.parse(await touchBlob.text()); }
      catch (e) { throw new Error(id + '/touch.json の書き方に誤りがあります（' + e.message + '）'); }
    }
    chars.push({ id, dir: pre, name: conf.name || id, outfits, pose: conf.pose || null, motions, touch,
      expressions: conf.expressions || null });   // 表情の組み合わせ（例 { "shy": { "Blush": 1, "relaxed": 0.3 } }）
  }

  const total = files.reduce((s, f) => s + f.blob.size, 0);
  return { chars, byPath, total, count: files.length };

  // 名前（拡張子なし）→ 道すじ
  function motionsIn(dirPrefix) {
    return paths.filter((p) => p.startsWith(dirPrefix) && /\.vrma$/i.test(p) && !p.slice(dirPrefix.length).includes('/'))
      .map((p) => [p.slice(dirPrefix.length).replace(/\.vrma$/i, ''), p]);
  }
}

// 今月に合う衣装（どれにも当たらなければ先頭）
export function outfitForToday(ch, now = new Date()) {
  const m = now.getMonth() + 1;
  return ch.outfits.find((o) => Array.isArray(o.months) && o.months.includes(m)) || ch.outfits[0];
}
