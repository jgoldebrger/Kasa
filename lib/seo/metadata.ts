import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/seo/json-ld'

export const INDEX_FOLLOW: Metadata['robots'] = { index: true, follow: true }

export const NOINDEX_NOFOLLOW: Metadata['robots'] = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false, noimageindex: true },
}

export function publicPageMetadata(opts: {
  title: string
  description: string
  path: string
}): Metadata {
  return {
    title: opts.title,
    description: opts.description,
    robots: INDEX_FOLLOW,
    alternates: { canonical: opts.path },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url: opts.path,
      type: 'website',
      siteName: SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
    },
  }
}
