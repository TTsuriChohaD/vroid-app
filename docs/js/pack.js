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
//   "pose": { "CLASP": { "curl": 0.2 } } }
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
    chars.push({ id, dir: pre, name: conf.name || id, outfits, pose: conf.pose || null });
  }

  const total = files.reduce((s, f) => s + f.blob.size, 0);
  return { chars, byPath, total, count: files.length };
}

// 今月に合う衣装（どれにも当たらなければ先頭）
export function outfitForToday(ch, now = new Date()) {
  const m = now.getMonth() + 1;
  return ch.outfits.find((o) => Array.isArray(o.months) && o.months.includes(m)) || ch.outfits[0];
}
