'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker on first paint and listens for a new
 * worker becoming available so we can prompt the user to reload.
 *
 * Intentionally a no-op in development — Next's HMR + a service
 * worker compete for the same cache layer and the result is a UX
 * regression instead of an improvement.
 */
export default function PwaInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        })

        // When a new worker takes control, force a one-time refresh so
        // the page is no longer mixing old + new bundles.
        let refreshing = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return
          refreshing = true
          window.location.reload()
        })

        // If an update is found while we're running, tell the new
        // worker to take over immediately rather than waiting for all
        // tabs to close. A more polite UX would surface a toast here.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              installing.postMessage({ type: 'SKIP_WAITING' })
            }
          })
        })
      } catch (err) {
        console.warn('[pwa] service worker registration failed:', err)
      }
    }

    void register()
  }, [])

  return null
}
