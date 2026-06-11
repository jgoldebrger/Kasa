import { z } from 'zod'
import { isoDate, optionalString, trimmedName } from './common'

const aggregate = z.enum(['count', 'sum', 'avg', 'min', 'max'])
const source = z.enum(['payments', 'events', 'members', 'families'])

export const savedReportConfig = z.object({
  source,
  rowDim: optionalString(64),
  colDim: optionalString(64),
  measure: optionalString(64),
  aggregate,
  fromDate: optionalString(40),
  toDate: optionalString(40),
})

export const savedReportCreateBody = z.object({
  name: trimmedName,
  description: optionalString(1000),
  source,
  config: savedReportConfig,
})

export const savedReportUpdateBody = z.object({
  name: trimmedName.optional(),
  description: optionalString(1000),
  source: source.optional(),
  config: savedReportConfig.optional(),
})

export const reportRunBody = savedReportConfig

export const statementDateRangeBody = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
  })
  .refine((d) => d.fromDate.getTime() <= d.toDate.getTime(), {
    message: 'fromDate must be on or before toDate',
  })
