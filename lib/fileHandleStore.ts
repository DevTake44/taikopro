// File System Access API(Chrome/Edge限定)で選んだファイルの「場所」を覚えておくための
// 小さなIndexedDBラッパー。FileSystemFileHandleはlocalStorageには保存できない
// (構造化複製可能だがJSONにはできない)ため、IndexedDBを直接使う。
// これにより、一度ファイルを選んでもらえば、次回以降はファイル選択ダイアログを
// 開かずに同じファイルを読みに行ける(1クリック取込)。

const DB_NAME = "taikopro-file-handles";
const STORE_NAME = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFileHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadFileHandle(key: string): Promise<FileSystemFileHandle | null> {
  const db = await openDb();
  const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}
