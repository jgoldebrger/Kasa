/**
 * Fuzzy duplicate detection for family names and emails.
 * Used by CSV import preview and family create/update.
 */

export interface FamilyMatchCandidate {
  name?: string
  email?: string
}

export interface ExistingFamilyRecord {
  familyId: string
  name: string
  email?: string
}

export interface SimilarFamilyMatch {
  familyId: string
  name: string
  email?: string
  score: number
  matchReason: 'name' | 'email' | 'both'
}

const NAME_SIMILARITY_THRESHOLD = 0.82
const EMAIL_LOCAL_SIMILARITY_THRESHOLD = 0.85

/** Normalize a family name for fuzzy comparison. */
export function normalizeFamilyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const row = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) row[j] = j

  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = temp
    }
  }
  return row[b.length]
}

/** Similarity ratio in [0, 1] — 1 is an exact match. */
export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@')
  return at === -1 ? email : email.slice(0, at)
}

function emailDomain(email: string): string {
  const at = email.indexOf('@')
  return at === -1 ? '' : email.slice(at + 1)
}

function scorePair(
  candidate: FamilyMatchCandidate,
  existing: ExistingFamilyRecord,
): SimilarFamilyMatch | null {
  const candName = candidate.name ? normalizeFamilyName(candidate.name) : ''
  const existName = normalizeFamilyName(existing.name)
  const candEmail = candidate.email ? normalizeEmail(candidate.email) : ''
  const existEmail = existing.email ? normalizeEmail(existing.email) : ''

  let nameScore = 0
  if (candName && existName) {
    if (candName === existName) {
      nameScore = 1
    } else if (candName.length >= 3 && existName.length >= 3) {
      nameScore = stringSimilarity(candName, existName)
    }
  }

  let emailScore = 0
  if (candEmail && existEmail) {
    if (candEmail === existEmail) {
      emailScore = 1
    } else if (emailDomain(candEmail) === emailDomain(existEmail)) {
      emailScore = stringSimilarity(emailLocalPart(candEmail), emailLocalPart(existEmail))
    }
  }

  const nameMatch = nameScore >= NAME_SIMILARITY_THRESHOLD
  const emailMatch = emailScore >= EMAIL_LOCAL_SIMILARITY_THRESHOLD || candEmail === existEmail

  if (!nameMatch && !emailMatch) return null

  let matchReason: SimilarFamilyMatch['matchReason'] = 'name'
  if (nameMatch && emailMatch) matchReason = 'both'
  else if (emailMatch) matchReason = 'email'

  const score = Math.max(nameScore, emailScore)

  return {
    familyId: existing.familyId,
    name: existing.name,
    email: existing.email,
    score: Math.round(score * 100) / 100,
    matchReason,
  }
}

/**
 * Find existing families similar to the candidate. Exact name matches are
 * excluded — callers handle those as hard duplicates / skips.
 */
export function findSimilarFamilies(
  candidate: FamilyMatchCandidate,
  existingFamilies: ExistingFamilyRecord[],
  opts: { excludeFamilyId?: string; excludeExactName?: boolean } = {},
): SimilarFamilyMatch[] {
  const candName = candidate.name ? normalizeFamilyName(candidate.name) : ''
  const matches: SimilarFamilyMatch[] = []

  for (const fam of existingFamilies) {
    if (opts.excludeFamilyId && fam.familyId === opts.excludeFamilyId) continue
    if (opts.excludeExactName && candName && normalizeFamilyName(fam.name) === candName) continue

    const scored = scorePair(candidate, fam)
    if (scored) matches.push(scored)
  }

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, 3)
}
