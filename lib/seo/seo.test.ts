import { afterEach, describe, expect, it } from 'vitest'
import { HELP_ARTICLES } from '@/lib/help/articles'
import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import { buildRobots, buildSitemap, indexableSitemapPaths, sitemapLastmod } from '@/lib/seo/crawler'
import {
  faqPageJsonLd,
  helpArticleFaqItems,
  helpHubFaqItems,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webPageJsonLd,
} from '@/lib/seo/json-ld'
import { NOINDEX_NOFOLLOW, publicPageMetadata } from '@/lib/seo/metadata'
import {
  AUTH_PUBLIC_PATH_PREFIXES,
  INDEXABLE_PATH_PREFIXES,
  ROBOTS_DISALLOW_PATHS,
  isAuthPublicPath,
  isIndexablePath,
} from '@/lib/seo/public-routes'

describe('seo public routes', () => {
  describe('index vs auth allowlists', () => {
    it('indexes marketing/help/legal and keeps auth flows off the index list', () => {
      expect(INDEXABLE_PATH_PREFIXES).toEqual(
        expect.arrayContaining(['/welcome', '/help', '/overview', '/trust', '/dpa', '/pricing']),
      )
      expect(INDEXABLE_PATH_PREFIXES).not.toContain('/login')
      expect(AUTH_PUBLIC_PATH_PREFIXES).toEqual(
        expect.arrayContaining(['/login', '/signup', '/help']),
      )
    })

    it('treats help articles as indexable and login as public-but-not-indexable', () => {
      expect(isIndexablePath('/help/first-login')).toBe(true)
      expect(isIndexablePath('/login')).toBe(false)
      expect(isAuthPublicPath('/login')).toBe(true)
      expect(isAuthPublicPath('/twitter-image')).toBe(true)
      expect(isAuthPublicPath('/families')).toBe(false)
    })

    it('disallows the authenticated app and APIs, not help', () => {
      expect(ROBOTS_DISALLOW_PATHS).toEqual(
        expect.arrayContaining(['/api/', '/families', '/$', '/login']),
      )
      expect(ROBOTS_DISALLOW_PATHS).not.toContain('/help')
    })
  })
})

describe('seo metadata helpers', () => {
  it('marks public pages indexable with canonical and social tags', () => {
    const meta = publicPageMetadata({
      title: 'Treasurer Help Center — Kasa',
      description: 'Guides.',
      path: '/help',
    })
    expect(meta.robots).toEqual({ index: true, follow: true })
    expect(meta.alternates).toEqual({ canonical: '/help' })
    expect(meta.openGraph).toMatchObject({ url: '/help', siteName: 'Kasa' })
    expect(NOINDEX_NOFOLLOW).toMatchObject({ index: false, follow: false })
  })
})

describe('seo json-ld builders', () => {
  const base = 'https://app.example.com'

  it('emits Organization with support email', () => {
    expect(organizationJsonLd(base)).toMatchObject({
      '@type': 'Organization',
      name: 'Kasa',
      url: base,
      email: 'support@kasa.com',
    })
  })

  it('emits SoftwareApplication offers with numeric prices for listed plans only', () => {
    const json = softwareApplicationJsonLd(base)
    expect(json['@type']).toBe('SoftwareApplication')
    expect(json.offers).toHaveLength(PLAN_DEFINITIONS.length)
    const starter = json.offers.find((o) => o.name === 'Starter')
    expect(starter).toMatchObject({ price: '49', priceCurrency: 'USD', url: `${base}/pricing` })
    const institution = json.offers.find((o) => o.name === 'Institution')
    expect(institution).not.toHaveProperty('price')
  })

  it('emits WebPage and FAQPage entities from help content', () => {
    const page = webPageJsonLd({
      baseUrl: base,
      path: '/help',
      name: 'Help',
      description: 'Guides',
    })
    expect(page).toMatchObject({ '@type': 'WebPage', url: `${base}/help` })

    const hub = faqPageJsonLd(helpHubFaqItems())
    expect(hub.mainEntity).toHaveLength(HELP_ARTICLES.length)
    expect(hub.mainEntity[0]).toMatchObject({ '@type': 'Question' })

    const article = HELP_ARTICLES[0]
    const articleFaq = helpArticleFaqItems(article)
    expect(articleFaq).toHaveLength(article.sections.length)
    expect(articleFaq[0]?.question).toBe(article.sections[0]?.heading)
  })
})

describe('seo crawler documents', () => {
  const prev = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_URL: process.env.AUTH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('lists every indexable prefix plus each help article in the sitemap', () => {
    process.env.APP_BASE_URL = 'https://app.example.com'
    const paths = indexableSitemapPaths()
    for (const prefix of INDEXABLE_PATH_PREFIXES) {
      expect(paths).toContain(prefix)
    }
    for (const article of HELP_ARTICLES) {
      expect(paths).toContain(`/help/${article.slug}`)
    }
    const sitemap = buildSitemap()
    expect(sitemap[0]?.url.startsWith('https://app.example.com/')).toBe(true)
    expect(sitemap.find((e) => e.url.endsWith('/welcome'))?.priority).toBe(1)
    expect(sitemapLastmod('not-a-date')).toBe('1970-01-01T00:00:00.000Z')
    expect(sitemapLastmod()).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('allows AI crawlers on public prefixes and points sitemap at the canonical origin', () => {
    process.env.APP_BASE_URL = 'https://app.example.com'
    const robots = buildRobots()
    expect(robots.sitemap).toBe('https://app.example.com/sitemap.xml')
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules]
    expect(rules).toHaveLength(2)
    expect(rules[0]?.userAgent).toBe('*')
    expect(rules[1]?.userAgent).toEqual(
      expect.arrayContaining(['GPTBot', 'PerplexityBot', 'ClaudeBot', 'Googlebot']),
    )
    expect(rules[0]?.allow).toEqual(expect.arrayContaining(['/welcome', '/help']))
    expect(rules[0]?.disallow).toEqual(expect.arrayContaining(['/api/', '/families']))
  })
})
