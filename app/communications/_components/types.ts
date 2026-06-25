export interface FamilyOption {
  _id: string
  name: string
  email?: string
  emailOptOut?: boolean
  communicationsOptOut?: boolean
}

export interface EmailLogRow {
  _id: string
  familyId: string | null
  familyName: string | null
  to: string
  subject: string
  kind: string
  status: string
  openCount: number
  clickCount: number
  error: string | null
  createdAt: string
}

export interface EmailTemplate {
  _id: string
  name: string
  subject: string
  body: string
}

export interface EmailDraft {
  _id: string
  name?: string
  subject: string
  body: string
  familyIds?: string[]
  updatedAt?: string
}

export interface EmailAttachment {
  filename: string
  content: string
  contentType: string
}

export interface EmailEvent {
  type: string
  timestamp: string
  url?: string
}

export interface EmailDetail {
  _id: string
  familyId: string | null
  familyName: string | null
  to: string
  subject: string
  kind: string
  status: string
  error: string | null
  openCount: number
  clickCount: number
  createdAt: string
  events: EmailEvent[]
}

export interface CampaignLinkClick {
  url: string
  count?: number
  clicks?: number
}

export interface CampaignStats {
  campaignId?: string
  sent: number
  opened: number
  clicked: number
  failed?: number
  total?: number
  openRate?: number
  clickRate?: number
  topLinks?: CampaignLinkClick[]
}

export interface ScheduledEmailRow {
  _id: string
  subject: string
  familyIds: string[]
  scheduledFor: string
  status: string
  sentAt?: string | null
  error?: string | null
  createdAt?: string
}
