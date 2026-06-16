import { redirect } from 'next/navigation'

/**
 * Backwards-compat redirect — the lifecycle-event-types UI now lives as
 * a tab inside `/settings`. Old bookmarks / nav links bounce here and
 * forward straight to the consolidated settings page so we have a
 * single source of truth for event-type management.
 */
export default function LifecycleEventTypesRedirect() {
  redirect('/settings?tab=eventTypes')
}
