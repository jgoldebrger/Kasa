import { z } from 'zod'

export const SecurityEnvironmentSchema = z.enum([
  'local',
  'staging',
  'production-like',
])

export const ProxyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  server: z.string().url().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  /** Burp/ZAP CA for MITM TLS (PEM path). Playwright ignores by default unless set. */
  ignoreHttpsErrors: z.boolean().default(true),
})

export const ZapConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiUrl: z.string().url().default('http://127.0.0.1:8080'),
  apiKey: z.string().optional(),
  dockerImage: z.string().default('ghcr.io/zaproxy/zaproxy:stable'),
  baselineTimeoutMs: z.number().int().positive().default(600_000),
})

export const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
})

export const SecurityConfigSchema = z.object({
  environment: SecurityEnvironmentSchema,
  baseUrl: z.string().url(),
  /** Allow destructive/fuzz tests (never true in production-like by default). */
  allowDestructive: z.boolean(),
  owner: CredentialsSchema,
  member: CredentialsSchema,
  platformAdmin: CredentialsSchema.optional(),
  orgNames: z.object({
    alpha: z.string(),
    beta: z.string(),
  }),
  proxy: ProxyConfigSchema,
  zap: ZapConfigSchema,
  cronSecret: z.string().optional(),
  reportDir: z.string().default('security/reports/output'),
  captureHar: z.boolean().default(true),
  captureTrafficLog: z.boolean().default(true),
  concurrency: z.object({
    rateLimitWorkers: z.number().int().min(2).max(50).default(10),
    rateLimitBurst: z.number().int().min(5).max(200).default(30),
  }),
  headers: z.object({
    /** Spoofed tenant header used in IDOR tests. */
    orgIdHeader: z.string().default('x-organization-id'),
  }),
})

export type SecurityEnvironment = z.infer<typeof SecurityEnvironmentSchema>
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>
export type ZapConfig = z.infer<typeof ZapConfigSchema>
export type SecurityCredentials = z.infer<typeof CredentialsSchema>
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>
