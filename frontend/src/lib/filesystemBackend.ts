/**
 * Local backup using the Web File System Access API.
 * Reads/writes todo.txt (todotxt.org format) in a user-chosen directory.
 */

const TODO_FILENAME = 'todo.txt';
const DONE_FILENAME = 'done.txt';
const IDB_NAME = 'otto-fs-backup';
const IDB_STORE = 'handle';
const IDB_KEY = 'directory';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(IDB_STORE);
    };
  });
}

/**
 * Persist a directory handle to IndexedDB so it can be restored (with user permission).
 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put(handle, IDB_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve the stored directory handle, if any.
 * Caller should use requestPermission() or prompt again if access was revoked.
 */
export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clear the stored directory handle.
 */
export async function clearDirectoryHandle(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Show the directory picker and persist the chosen handle.
 * Returns the handle or null if user cancelled.
 */
export async function requestBackupDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window === 'undefined' || !window.showDirectoryPicker) {
    return null;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveDirectoryHandle(handle);
    return handle;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Return the name of the stored backup directory (from IndexedDB), if any.
 * Does not request permission; use for display only.
 */
export async function getBackupDirectoryName(): Promise<string | null> {
  const handle = await getDirectoryHandle();
  return handle?.name ?? null;
}

/**
 * Ensure we have permission to read/write the directory.
 * Returns the handle if we have access, null otherwise.
 */
export async function getBackupDirectoryWithPermission(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getDirectoryHandle();
  if (!handle) return null;
  try {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    if (state === 'granted') return handle;
    const requested = await handle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

/**
 * Read the contents of todo.txt from the given directory.
 * Returns file content or empty string if file does not exist.
 */
export async function readTodoFile(dir: FileSystemDirectoryHandle): Promise<string> {
  try {
    const fileHandle = await dir.getFileHandle(TODO_FILENAME, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err) {
    if ((err as Error).name === 'NotFoundError') return '';
    throw err;
  }
}

/**
 * Write full content to todo.txt in the given directory.
 */
export async function writeTodoFile(dir: FileSystemDirectoryHandle, content: string): Promise<void> {
  const fileHandle = await dir.getFileHandle(TODO_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Read the contents of done.txt from the given directory.
 * Returns file content or empty string if file does not exist.
 */
export async function readDoneFile(dir: FileSystemDirectoryHandle): Promise<string> {
  try {
    const fileHandle = await dir.getFileHandle(DONE_FILENAME, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err) {
    if ((err as Error).name === 'NotFoundError') return '';
    throw err;
  }
}

/**
 * Append a line to done.txt (creates the file if it does not exist).
 */
export async function appendLineToDoneFile(
  dir: FileSystemDirectoryHandle,
  line: string,
): Promise<void> {
  const existing = await readDoneFile(dir);
  const newContent = existing.trimEnd();
  const appended = newContent ? newContent + '\n' + line + '\n' : line + '\n';
  const fileHandle = await dir.getFileHandle(DONE_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(appended);
  await writable.close();
}
