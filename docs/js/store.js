// 選んだ素材をこの端末の Chrome の中（IndexedDB）に保存する。外には送らない。
// Chrome が空きの少ないときなどに消すことがあるので、無ければ選び直してもらう前提で使う。
// 保存するもの：
//   'pack'  … VroidApp フォルダの中身 { files: [{ path, blob, size }], savedAt }
//   'model' … VRM ファイル 1 つだけを選んだとき { blob, name, size, savedAt }（最初の版からの残り。試し用）

const DB_NAME = 'vroid-app';
const STORE = 'files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function get(key) {
  try { return (await run('readonly', (s) => s.get(key))) || null; }
  catch (e) { console.warn('保存したものを読めませんでした', e); return null; }
}

async function askPersist() {
  // 消されにくくするよう Chrome にお願いする（認められないこともある）
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
}

// ---------- フォルダ（VroidApp）----------
export async function loadSavedPack() {
  const rec = await get('pack');
  return rec && Array.isArray(rec.files) && rec.files.length ? rec : null;
}

// entries：[{ path, blob }]。前に保存したフォルダは入れ替える
export async function savePack(entries) {
  const files = entries.map((e) => ({ path: e.path, blob: e.blob, size: e.blob.size }));
  await run('readwrite', (s) => s.put({ files, savedAt: Date.now() }, 'pack'));
  await askPersist();
}

// ---------- VRM 1 つだけ ----------
export async function loadSavedModel() {
  const rec = await get('model');
  return rec && rec.blob ? rec : null;
}

export async function saveModel(file) {
  await run('readwrite', (s) => s.put({ blob: file, name: file.name, size: file.size, savedAt: Date.now() }, 'model'));
  await askPersist();
}

// 保存したものを全部消す
export async function deleteSaved() {
  await run('readwrite', (s) => { s.delete('pack'); return s.delete('model'); });
}
