import type { Migration } from './runner'
import { migrateLegacySecrets } from './encrypt-legacy-secrets'
import { migrateTaskAssignees } from './task-legacy-email'

export const migrations: Migration[] = [
  {
    id: '2024-encrypt-legacy-secrets',
    description: 'Encrypt legacy plaintext SMTP passwords and 2FA secrets',
    up: async () => {
      await migrateLegacySecrets()
    },
  },
  {
    id: '2024-task-legacy-email-assignees',
    description: 'Link legacy email-only tasks to org members when email matches',
    up: async () => {
      await migrateTaskAssignees()
    },
  },
]
