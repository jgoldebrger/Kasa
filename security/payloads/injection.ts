/** NoSQL / injection probes for JSON API bodies and query params. */
export const INJECTION_PAYLOADS = {
  nosql: [
    { $gt: '' },
    { $ne: null },
    { $where: '1==1' },
    { email: { $regex: '.*' } },
  ],
  sql: [
    "' OR '1'='1",
    '"; DROP TABLE users;--',
    "1' UNION SELECT null--",
  ],
  ldap: ['*)(uid=*', '*)(objectClass=*'],
  pathTraversal: [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\win.ini',
    '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  ],
} as const

export const COMMAND_INJECTION = [
  '; id',
  '| whoami',
  '`id`',
  '$(curl http://127.0.0.1)',
] as const
