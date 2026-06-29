import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

describe('email-template-versions (integration)', () => {
  const userId = new mongoose.Types.ObjectId()
  let orgId: string

  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  beforeEach(async () => {
    const { Organization } = await import('./models')
    const org = await Organization.create({
      name: 'Template Version Test Org',
      slug: `tpl-ver-${Date.now()}`,
      ownerId: userId,
    })
    orgId = org._id.toString()
  })

  afterEach(async () => {
    const { Organization, EmailTemplate, EmailTemplateVersion, Counter } = await import('./models')
    await Promise.all([
      EmailTemplateVersion.deleteMany({}),
      EmailTemplate.deleteMany({}),
      Counter.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  it('snapshots on content update and restores a prior version', async () => {
    const { EmailTemplate } = await import('./models')
    const { snapshotEmailTemplateVersion, listEmailTemplateVersions, restoreEmailTemplateVersion } =
      await import('./email-template-versions')

    const template = await EmailTemplate.create({
      organizationId: orgId,
      name: 'Welcome',
      subject: 'Original subject',
      html: '<p>Original body</p>',
      text: 'Original body',
      createdBy: userId,
    })

    const versionId = await snapshotEmailTemplateVersion(template, userId.toString())
    await EmailTemplate.updateOne(
      { _id: template._id },
      {
        $set: {
          subject: 'Updated subject',
          html: '<p>Updated body</p>',
          text: 'Updated body',
          previousVersionId: versionId,
        },
      },
    )

    const versions = await listEmailTemplateVersions(template._id.toString(), orgId)
    expect(versions).toHaveLength(1)
    expect(versions[0].version).toBe(1)
    expect(versions[0].subject).toBe('Original subject')

    const restored = await restoreEmailTemplateVersion(
      template._id.toString(),
      versions[0]._id,
      orgId,
      userId.toString(),
    )
    expect(restored).toBeTruthy()
    expect(restored!.subject).toBe('Original subject')
    expect(restored!.html).toBe('<p>Original body</p>')
    expect(restored!.restoredFromVersion).toBe(1)

    const current = await EmailTemplate.findById(template._id).lean<any>()
    expect(current!.subject).toBe('Original subject')
    expect(current!.html).toBe('<p>Original body</p>')
  })
})
