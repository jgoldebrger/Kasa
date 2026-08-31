import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import type { HelpArticle } from '@/lib/help/articles'
import { HELP_ARTICLES } from '@/lib/help/articles'
import { LEGAL_ENTITY_NAME, SUPPORT_CONTACT_EMAIL } from '@/lib/legal/contacts'

export const SITE_NAME = LEGAL_ENTITY_NAME

export const DEFAULT_SOFTWARE_DESCRIPTION =
  'Membership books for kehilla treasurers: age-based dues, Hebrew-calendar statements, and family balances.'

export function organizationJsonLd(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: baseUrl,
    email: SUPPORT_CONTACT_EMAIL,
  }
}

export function softwareApplicationJsonLd(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${baseUrl}/welcome`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: DEFAULT_SOFTWARE_DESCRIPTION,
    offers: PLAN_DEFINITIONS.map((plan) => {
      const numeric = plan.monthlyPriceLabel.replace(/[^0-9.]/g, '')
      return {
        '@type': 'Offer' as const,
        name: plan.name,
        description: plan.description,
        ...(numeric ? { price: numeric, priceCurrency: 'USD' } : {}),
        url: `${baseUrl}/pricing`,
      }
    }),
  }
}

export function webPageJsonLd(opts: {
  baseUrl: string
  path: string
  name: string
  description: string
}) {
  const url = `${opts.baseUrl}${opts.path}`
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: opts.name,
    description: opts.description,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: opts.baseUrl,
    },
  }
}

export interface FaqItem {
  question: string
  answer: string
}

export function faqPageJsonLd(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

export function helpHubFaqItems(): FaqItem[] {
  return HELP_ARTICLES.map((article) => ({
    question: article.title,
    answer: article.summary,
  }))
}

export function helpArticleFaqItems(article: HelpArticle): FaqItem[] {
  return article.sections.map((section) => ({
    question: section.heading,
    answer: section.body,
  }))
}
