// Kleiner IndexedDB-Speicher: Projekte (Markierungen, Platzierungen), Ordner-Zugriff, Kartenkacheln.
// Alles bleibt im Browser auf diesem Rechner.

const DB = 'basenplaner'
const VERSION = 1
export type StoreName = 'kv' | 'tiles'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
        if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }))
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>(store, 'readonly', s => s.get(key))
  } catch {
    return undefined
  }
}

export async function put(store: StoreName, key: string, value: unknown): Promise<void> {
  try {
    await run(store, 'readwrite', s => s.put(value, key))
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e)
  }
}

export async function del(store: StoreName, key: string): Promise<void> {
  try {
    await run(store, 'readwrite', s => s.delete(key))
  } catch {
    /* egal */
  }
}
