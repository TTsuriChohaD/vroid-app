// 選んだ VRM をこの端末の Chrome の中（IndexedDB）に保存する。外には送らない。
// Chrome が空きの少ないときなどに消すことがあるので、無ければ選び直してもらう前提で使う。

const DB_NAME = 'vroid-app';
const STORE = 'files';
const KEY = 'model';

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

// 保存した VRM：{ blob, name, size, savedAt } か null
export async function loadSavedModel() {
  try {
    const rec = await run('readonly', (s) => s.get(KEY));
    return rec && rec.blob ? rec : null;
  } catch (e) {
    console.warn('保存した VRM を読めませんでした', e);
    return null;
  }
}

export async function saveModel(file) {
  await run('readwrite', (s) => s.put({ blob: file, name: file.name, size: file.size, savedAt: Date.now() }, KEY));
  // 消されにくくするよう Chrome にお願いする（認められないこともある）
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
}

export async function deleteSavedModel() {
  await run('readwrite', (s) => s.delete(KEY));
}
