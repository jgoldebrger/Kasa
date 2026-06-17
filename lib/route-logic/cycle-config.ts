import { handler } from '@/lib/api/handler'
import { CycleConfig } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { cycleConfig as cycleConfigSchemas } from '@/lib/schemas'

type CalendarKind = 'gregorian' | 'hebrew'

function normalizeCalendar(v: unknown): CalendarKind {
  return v === 'hebrew' ? 'hebrew' : 'gregorian'
}

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=600' }

// GET - Get cycle configuration
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/cycle-config',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'cycle-config-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const config = await CycleConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    }).lean<any>()

    if (!config) {
      return {
        data: {
          cycleCalendar: 'gregorian' as CalendarKind,
          cycleStartMonth: 9, // September
          cycleStartDay: 1,
          cycleStartHebrewMonth: 7, // Tishrei
          cycleStartHebrewDay: 1,
          cycleAutoRollover: false,
          description: 'Membership cycle start date',
          isActive: true,
        },
        headers: CACHE_HEADERS,
      }
    }

    return {
      data: {
        cycleCalendar: normalizeCalendar(config.cycleCalendar),
        cycleStartMonth: config.cycleStartMonth,
        cycleStartDay: config.cycleStartDay,
        cycleStartHebrewMonth:
          typeof config.cycleStartHebrewMonth === 'number' ? config.cycleStartHebrewMonth : 7,
        cycleStartHebrewDay:
          typeof config.cycleStartHebrewDay === 'number' ? config.cycleStartHebrewDay : 1,
        cycleAutoRollover: Boolean(config.cycleAutoRollover),
        description: config.description,
        isActive: config.isActive,
      },
      headers: CACHE_HEADERS,
    }
  },
})

// POST - Create or update cycle configuration
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: cycleConfigSchemas.cycleConfigBody,
  name: 'POST /api/cycle-config',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'cycle-config-save',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const {
      cycleCalendar: rawCalendar,
      cycleStartMonth,
      cycleStartDay,
      cycleStartHebrewMonth,
      cycleStartHebrewDay,
      cycleAutoRollover: rawAutoRollover,
      description,
    } = body

    const cycleCalendar = normalizeCalendar(rawCalendar)
    const cycleAutoRollover = typeof rawAutoRollover === 'boolean' ? rawAutoRollover : undefined

    // Check if config already exists
    const existingConfig = await CycleConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    const updateDoc: Record<string, unknown> = {
      cycleCalendar,
      cycleStartMonth,
      cycleStartDay,
      ...(cycleStartHebrewMonth !== undefined && cycleStartHebrewMonth !== null
        ? { cycleStartHebrewMonth: Number(cycleStartHebrewMonth) }
        : {}),
      ...(cycleStartHebrewDay !== undefined && cycleStartHebrewDay !== null
        ? { cycleStartHebrewDay: Number(cycleStartHebrewDay) }
        : {}),
      ...(cycleAutoRollover !== undefined ? { cycleAutoRollover } : {}),
    }

    if (existingConfig) {
      // Update existing config
      await CycleConfig.findOneAndUpdate(
        { _id: existingConfig._id, organizationId: ctx!.organizationId },
        {
          ...updateDoc,
          description: description || existingConfig.description || 'Membership cycle start date',
        },
      )

      const updatedConfig = await CycleConfig.findOne({
        _id: existingConfig._id,
        organizationId: ctx!.organizationId,
      })

      await audit({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        action: 'cycle_config.update',
        resourceType: 'CycleConfig',
        resourceId: existingConfig._id,
        metadata: {
          cycleCalendar,
          cycleStartMonth,
          cycleStartDay,
          cycleStartHebrewMonth: updateDoc.cycleStartHebrewMonth,
          cycleStartHebrewDay: updateDoc.cycleStartHebrewDay,
          cycleAutoRollover,
        },
        request,
      })

      return {
        data: {
          cycleCalendar: normalizeCalendar(updatedConfig!.cycleCalendar),
          cycleStartMonth: updatedConfig!.cycleStartMonth,
          cycleStartDay: updatedConfig!.cycleStartDay,
          cycleStartHebrewMonth:
            typeof updatedConfig!.cycleStartHebrewMonth === 'number'
              ? updatedConfig!.cycleStartHebrewMonth
              : 7,
          cycleStartHebrewDay:
            typeof updatedConfig!.cycleStartHebrewDay === 'number'
              ? updatedConfig!.cycleStartHebrewDay
              : 1,
          cycleAutoRollover: Boolean(updatedConfig!.cycleAutoRollover),
          description: updatedConfig!.description,
          isActive: updatedConfig!.isActive,
        },
      }
    }

    // Deactivate all existing configs (if any)
    await CycleConfig.updateMany({ organizationId: ctx!.organizationId }, { isActive: false })

    // Create new active config
    const config = await CycleConfig.create({
      ...updateDoc,
      description: description || 'Membership cycle start date',
      isActive: true,
      organizationId: ctx!.organizationId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'cycle_config.create',
      resourceType: 'CycleConfig',
      resourceId: config._id,
      metadata: {
        cycleCalendar,
        cycleStartMonth,
        cycleStartDay,
        cycleStartHebrewMonth: updateDoc.cycleStartHebrewMonth,
        cycleStartHebrewDay: updateDoc.cycleStartHebrewDay,
        cycleAutoRollover,
      },
      request,
    })

    return {
      status: 201,
      data: {
        cycleCalendar: normalizeCalendar(config.cycleCalendar),
        cycleStartMonth: config.cycleStartMonth,
        cycleStartDay: config.cycleStartDay,
        cycleStartHebrewMonth:
          typeof config.cycleStartHebrewMonth === 'number' ? config.cycleStartHebrewMonth : 7,
        cycleStartHebrewDay:
          typeof config.cycleStartHebrewDay === 'number' ? config.cycleStartHebrewDay : 1,
        cycleAutoRollover: Boolean(config.cycleAutoRollover),
        description: config.description,
        isActive: config.isActive,
      },
    }
  },
})
