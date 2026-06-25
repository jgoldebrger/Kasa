export interface FamilyOption {
  _id: string
  name: string
  email?: string
  emailOptOut?: boolean
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

export interface CampaignStats {
  campaignId: string
  sent: number
  opened: number
  clicked: number
  openRate: number
  clickRate: number
}
