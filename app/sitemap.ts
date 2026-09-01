import type { MetadataRoute } from 'next'
import { buildSitemap } from '@/lib/seo/crawler'

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap()
}
