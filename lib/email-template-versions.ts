import { Types } from 'mongoose'
import { EmailTemplate, EmailTemplateVersion, nextCounter } from '@/lib/models'

type TemplateSnapshotSource = {
  _id: Types.ObjectId | string
  organizationId: Types.ObjectId | string
  subject: string
  html: string
  text?: string | null
}

export async function snapshotEmailTemplateVersion(
  template: TemplateSnapshotSource,
  createdByUserId: string,
): Promise<Types.ObjectId> {
  const templateId = String(template._id)
  const version = await nextCounter(`email-template-version:${templateId}`)
  const doc = await EmailTemplateVersion.create({
    organizationId: template.organizationId,
    templateId: template._id,
    version,
    subject: template.subject,
    html: template.html,
    text: template.text ?? '',
    createdByUserId,
  })
  return doc._id as Types.ObjectId
}

export async function listEmailTemplateVersions(
  templateId: string,
  organizationId: string,
  limit = 10,
) {
  const rows = await EmailTemplateVersion.find({
    templateId,
    organizationId,
  })
    .sort({ version: -1 })
    .limit(limit)
    .lean<any[]>()

  return rows.map((r) => ({
    _id: String(r._id),
    templateId: String(r.templateId),
    version: r.version,
    subject: r.subject,
    html: r.html,
    text: r.text ?? null,
    createdAt: r.createdAt,
    createdByUserId: r.createdByUserId ? String(r.createdByUserId) : null,
  }))
}

export async function restoreEmailTemplateVersion(
  templateId: string,
  versionId: string,
  organizationId: string,
  userId: string,
) {
  const version = await EmailTemplateVersion.findOne({
    _id: versionId,
    templateId,
    organizationId,
  }).lean<any>()

  if (!version) return null

  const updated = await EmailTemplate.findOneAndUpdate(
    { _id: templateId, organizationId },
    {
      $set: {
        subject: version.subject,
        html: version.html,
        text: version.text ?? '',
        previousVersionId: version._id,
        updatedByUserId: userId,
      },
    },
    { new: true, runValidators: true },
  ).lean<any>()

  if (!updated) return null

  return {
    _id: String(updated._id),
    name: updated.name,
    category: updated.category ?? 'general',
    subject: updated.subject,
    html: updated.html,
    text: updated.text ?? null,
    restoredFromVersion: version.version,
  }
}
