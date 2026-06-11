import { describe, it, expect, vi } from 'vitest'
import {
  FAMILIES_LIST_PAGE_SIZE,
  collectAllFamiliesPages,
  familiesListUrl,
  parseFamiliesListResponse,
} from './families-list'

describe('families-list client helpers', () => {
  it('parseFamiliesListResponse accepts legacy arrays and paginated envelopes', () => {
    expect(parseFamiliesListResponse([{ _id: '1' }])).toEqual({
      items: [{ _id: '1' }],
      nextCursor: null,
    })
    expect(
      parseFamiliesListResponse({ items: [{ _id: '2' }], nextCursor: 'abc' }),
    ).toEqual({
      items: [{ _id: '2' }],
      nextCursor: 'abc',
    })
    expect(parseFamiliesListResponse({ error: 'nope' })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('familiesListUrl builds limit and cursor query params', () => {
    expect(familiesListUrl(null)).toBe(`/api/families?limit=${FAMILIES_LIST_PAGE_SIZE}`)
    expect(familiesListUrl('cursor-token', 25)).toBe('/api/families?limit=25&cursor=cursor-token')
  })

  it('collectAllFamiliesPages walks nextCursor until exhausted', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ _id: '1' }], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [{ _id: '2' }], nextCursor: null })

    const all = await collectAllFamiliesPages(fetchPage, 1)
    expect(all).toEqual([{ _id: '1' }, { _id: '2' }])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[0][0]).toBe(null)
    expect(fetchPage.mock.calls[1][0]).toBe('c2')
  })
})
