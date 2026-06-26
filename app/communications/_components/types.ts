export interface FamilyOption {
  _id: string
  name: string
  email?: string
  emailOptOut?: boolean
  communicationsOptOut?: boolean
  emailDeliverabilityWarning?: boolean
  emailFormatInvalid?: boolean
  openBalance?: number
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

export type EmailTemplateCategory = 'general' | 'billing' | 'events' | 'announcements' | string

export interface EmailTemplate {
  _id: string
  name: string
  subject: string
  body: string
  category?: EmailTemplateCategory
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

export interface CampaignSubjectVariantStats {
  subjectA?: string
  subjectB?: string
  sentA?: number
  sentB?: number
  openedA?: number
  openedB?: number
  openRateA?: number
  openRateB?: number
  winner?: 'A' | 'B' | 'tie' | null
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
  subjectVariant?: CampaignSubjectVariantStats
}

export interface EmailQuota {
  sent: number
  limit: number
  remaining: number
}

export interface TopCampaignRow {
  campaignId: string
  subject?: string
  sent?: number
  opened?: number
  clicked?: number
  openRate?: number
  clickRate?: number
}

export interface EmailAutomationRuleRow {
  _id: string
  name: string
  enabled: boolean
  templateId: string
  templateName?: string
  ruleType: 'balance_gt_zero' | 'event_within_30_days'
  lastRunAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface EmailJobRow {
  jobId: string
  kind: string
  status: string
  totalFamilies: number
  processed: number
  sent: number
  failed: number
  lastError?: string | null
  createdAt?: string
  startedAt?: string | null
  completedAt?: string | null
}

export interface EmailAnalyticsBucket {
  date: string
  sent?: number
  opened?: number
  clicked?: number
  failed?: number
}

export interface EmailAnalytics {
  summary: {
    sent: number
    opened: number
    clicked: number
    failed: number
    openRate?: number
    clickRate?: number
  }
  buckets?: EmailAnalyticsBucket[]
  daily?: EmailAnalyticsBucket[]
  topCampaigns?: TopCampaignRow[]
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
