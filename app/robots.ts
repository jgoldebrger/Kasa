import type { MetadataRoute } from 'next'
import { buildRobots } from '@/lib/seo/crawler'

export default function robots(): MetadataRoute.Robots {
  return buildRobots()
}
