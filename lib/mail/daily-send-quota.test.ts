import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Types } from 'mongoose'

vi.mock('@/lib/models', () => ({
  EmailMessage: {
    countDocuments: vi.fn(),
  },
}))

import { EmailMessage } from '@/lib/models'
import { checkDailySendQuota, getTodaySentCount } from './daily-send-quota'

describe('daily-send-quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('getTodaySentCount queries sent statuses for today', async () => {
    vi.mocked(EmailMessage.countDocuments).mockResolvedValue(12)
    const orgId = new Types.ObjectId().toString()
    const count = await getTodaySentCount(orgId)
    expect(count).toBe(12)
    expect(EmailMessage.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: expect.any(Types.ObjectId),
        status: { $in: ['sent', 'opened', 'clicked'] },
        createdAt: expect.objectContaining({ $gte: expect.any(Date) }),
      }),
    )
  })

  it('checkDailySendQuota allows when under limit', async () => {
    vi.stubEnv('GMAIL_DAILY_LIMIT', '10')
    vi.mocked(EmailMessage.countDocuments).mockResolvedValue(5)
    const result = await checkDailySendQuota(new Types.ObjectId().toString())
    expect(result).toEqual({ ok: true })
  })

  it('checkDailySendQuota rejects when at limit', async () => {
    vi.stubEnv('GMAIL_DAILY_LIMIT', '10')
    vi.mocked(EmailMessage.countDocuments).mockResolvedValue(10)
    const result = await checkDailySendQuota(new Types.ObjectId().toString())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Daily send quota exceeded')
    }
  })
})
