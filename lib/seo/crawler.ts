import type { MetadataRoute } from 'next'
import { resolveAppBaseUrl } from '@/lib/app-base-url'
import { HELP_ARTICLES } from '@/lib/help/articles'
import { LEGAL_LAST_UPDATED } from '@/lib/legal/contacts'
import {
  AI_CRAWLER_USER_AGENTS,
  INDEXABLE_PATH_PREFIXES,
  ROBOTS_DISALLOW_PATHS,
} from '@/lib/seo/public-routes'

export function sitemapLastmod(input = LEGAL_LAST_UPDATED): string {
  const parsed = Date.parse(`${input} UTC`)
  if (Number.isNaN(parsed)) return '1970-01-01T00:00:00.000Z'
  return new Date(parsed).toISOString()
}

export function indexableSitemapPaths(): string[] {
  const helpArticles = HELP_ARTICLES.map((article) => `/help/${article.slug}`)
  return [...INDEXABLE_PATH_PREFIXES, ...helpArticles]
}

export function buildSitemap(): MetadataRoute.Sitemap {
  const base = resolveAppBaseUrl()
  const lastModified = sitemapLastmod()
  return indexableSitemapPaths().map((path) => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency: path.startsWith('/help') ? 'weekly' : 'monthly',
    priority: path === '/welcome' ? 1 : path === '/help' || path === '/overview' ? 0.8 : 0.6,
  }))
}

export function buildRobots(): MetadataRoute.Robots {
  const base = resolveAppBaseUrl()
  const allow = [...INDEXABLE_PATH_PREFIXES]
  const disallow = [...ROBOTS_DISALLOW_PATHS]
  const aiAgents = [...AI_CRAWLER_USER_AGENTS]
  return {
    rules: [
      {
        userAgent: '*',
        allow,
        disallow,
      },
      {
        userAgent: aiAgents,
        allow,
        disallow,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
