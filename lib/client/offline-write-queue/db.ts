import type { QueuedOperation } from './types'

const DB_NAME = 'kasa-offline-write-queue'
const DB_VERSION = 1
const STORE = 'operations'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('organizationId', 'organizationId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
  })
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const store = tx.objectStore(STORE)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
        tx.oncomplete = () => db.close()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      }),
  )
}

export async function putOperation(op: QueuedOperation): Promise<void> {
  await runTx('readwrite', (store) => store.put(op))
}

export async function deleteOperation(id: string): Promise<void> {
  await runTx('readwrite', (store) => store.delete(id))
}

export async function getAllOperations(): Promise<QueuedOperation[]> {
  return runTx('readonly', (store) => store.getAll())
}

export async function clearOperationsForOrg(organizationId: string): Promise<void> {
  const all = await getAllOperations()
  const toDelete = all.filter((op) => op.organizationId === organizationId)
  if (toDelete.length === 0) return
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        for (const op of toDelete) store.delete(op.id)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      }),
  )
}
