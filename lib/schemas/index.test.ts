import { describe, expect, it } from 'vitest'
import * as schemas from './index'
import * as auth from './auth'
import * as calculation from './calculation'
import * as emailConfig from './email-config'
import * as family from './family'
import * as lifecycle from './lifecycle'
import * as member from './member'
import * as organization from './organization'
import * as payment from './payment'
import * as report from './report'
import * as statement from './statement'
import * as task from './task'
import * as common from './common'

const namespaceModules = {
  auth,
  calculation,
  emailConfig,
  family,
  lifecycle,
  member,
  organization,
  payment,
  report,
  statement,
  task,
} as const

describe('schemas index', () => {
  it('re-exports all schema namespaces', () => {
    for (const [name, mod] of Object.entries(namespaceModules)) {
      expect(schemas[name as keyof typeof namespaceModules]).toBe(mod)
    }
    expect(schemas.auth.signupBody).toBe(auth.signupBody)
    expect(schemas.family.familyCreateBody).toBe(family.familyCreateBody)
    expect(schemas.payment.paymentBody).toBe(payment.paymentBody)
    expect(schemas.statement.statementGenerateBody).toBe(statement.statementGenerateBody)
    expect(schemas.task.taskBody).toBe(task.taskBody)
    expect(schemas.member.addMemberBody).toBe(member.addMemberBody)
    expect(schemas.organization.organizationCreateBody).toBe(organization.organizationCreateBody)
    expect(schemas.calculation.calculationPostBody).toBe(calculation.calculationPostBody)
    expect(schemas.lifecycle.lifecycleEventTypeBody).toBe(lifecycle.lifecycleEventTypeBody)
    expect(schemas.emailConfig.emailConfigBody).toBe(emailConfig.emailConfigBody)
    expect(schemas.report.reportRunBody).toBe(report.reportRunBody)
    expect(schemas.objectId).toBe(common.objectId)
  })
})
