/**
 * Offline Queue — IndexedDB-backed queue for network operations that
 * failed or were attempted while offline.
 *
 * Queue items carry a type, payload, retry count, and timestamps.
 * The queue processor drains items in FIFO order with exponential backoff.
 */

const DB_NAME = 'herald-offline-queue';
const STORE_NAME = 'queue';
const DB_VERSION = 1;
const MAX_RETRIES = 10;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

export type QueueItemType =
  | 'transcribe'      // audio blob → transcribe → assess → save report → sync
  | 'sync-report'     // report payload → sync to Supabase
  | 'sync-disposition' // disposition payload → sync
  | 'transfer'        // transfer action payload → sync

export interface QueueItem {
  id?: number; // auto-incremented by IndexedDB
  type: QueueItemType;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextRetryAt: string;
}

// ── IndexedDB helpers ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

// ── Public API ──

/** Add an item to the offline queue */
export async function enqueue(type: QueueItemType, payload: Record<string, unknown>): Promise<void> {
  const db = await openDB();
  const now = new Date().toISOString();
  const item: QueueItem = {
    type,
    payload,
    attempts: 0,
    lastError: null,
    createdAt: now,
    nextRetryAt: now,
  };
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Get all items in the queue, oldest first */
export async function getAll(): Promise<QueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result as QueueItem[]);
    req.onerror = () => reject(req.error);
  });
}

/** Get items that are ready to retry (nextRetryAt <= now) */
export async function getReady(): Promise<QueueItem[]> {
  const all = await getAll();
  const now = new Date().toISOString();
  return all.filter(item => item.nextRetryAt <= now && item.attempts < MAX_RETRIES);
}

/** Count of pending items */
export async function count(): Promise<number> {
  const all = await getAll();
  return all.filter(item => item.attempts < MAX_RETRIES).length;
}

/** Remove an item after successful processing */
export async function remove(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Mark an item as failed — increment attempt count and set next retry time */
export async function markFailed(id: number, error: string): Promise<void> {
  const db = await openDB();
  const store = tx(db, 'readwrite');
  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as QueueItem | undefined;
      if (!item) { resolve(); return; }
      item.attempts += 1;
      item.lastError = error;
      const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, item.attempts), BACKOFF_MAX_MS);
      item.nextRetryAt = new Date(Date.now() + delay).toISOString();
      const putReq = store.put(item);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Remove items that have exceeded max retries */
export async function purgeExpired(): Promise<number> {
  const all = await getAll();
  const expired = all.filter(item => item.attempts >= MAX_RETRIES);
  const db = await openDB();
  const store = tx(db, 'readwrite');
  for (const item of expired) {
    if (item.id != null) store.delete(item.id);
  }
  return expired.length;
}

/** Clear the entire queue */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
