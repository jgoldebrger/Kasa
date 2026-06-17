/**
 * Dry-run production env validation against .env.local.
 *
 * Usage: npm run check:env
 */

import { config } from 'dotenv'
import { __resetEnvValidationForTests, validateProductionEnv } from '../lib/env-validation'

config({ path: '.env.local' })
;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
delete process.env.VITEST
__resetEnvValidationForTests()

validateProductionEnv()
console.log('Production env check passed')
