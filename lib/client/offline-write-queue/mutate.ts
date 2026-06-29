import { enqueueOperation } from './queue'
import type { OfflineQueueSpec } from './types'

export type MutateWithOfflineQueueResult =
  | { ok: true; response: Response }
  | { ok: false; queued: true }
  | { ok: false; queued: false; response?: Response }

function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError
}

/**
 * Perform a mutation, queueing it in IndexedDB when offline or when the
 * network is unreachable. Caller supplies the queue spec so only approved
 * lightweight mutations enter the offline contract.
 */
export async function mutateWithOfflineQueue(
  url: string,
  init: RequestInit,
  queueSpec: OfflineQueueSpec,
): Promise<MutateWithOfflineQueueResult> {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await enqueueOperation(queueSpec)
    return { ok: false, queued: true }
  }

  try {
    const response = await fetch(url, init)
    if (response.ok) {
      return { ok: true, response }
    }
    return { ok: false, queued: false, response }
  } catch (err) {
    if (isNetworkFailure(err)) {
      await enqueueOperation(queueSpec)
      return { ok: false, queued: true }
    }
    throw err
  }
}
