export { GET, POST } from '@/lib/api-handlers/jobs/generate-monthly-statements-worker/handler'

/** Family-batch continuation can run longer than the org-level cron tick. */
export const maxDuration = 60
