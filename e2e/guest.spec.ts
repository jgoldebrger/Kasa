import { test, expect } from '@playwright/test'
import { loginAsE2eMember } from './helpers'

test.describe('guest access', () => {
  test('public marketing click path stays indexable and chrome-free', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page).toHaveTitle(/Membership Books for Kehilla Treasurers/)
    await expect(
      page.getByRole('heading', { name: 'Membership books built for kehilla treasurers' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /skip/i })).toHaveCount(0)
    const welcomeLd = page.locator('script[type="application/ld+json"]')
    await expect(welcomeLd).toHaveCount(3)

    await page.getByRole('link', { name: 'Product overview' }).click()
    await expect(page).toHaveURL(/\/overview/)
    await expect(page.getByRole('heading', { name: 'Published plan figures' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Starter' })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')

    await page.getByRole('link', { name: 'Help Center' }).first().click()
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByRole('heading', { name: 'Guides for kehilla treasurers' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Frequently asked' })).toBeVisible()

    await page.getByRole('link', { name: 'First login and setup wizard' }).click()
    await expect(page).toHaveURL(/\/help\/first-login/)
    await expect(page.getByRole('heading', { name: 'First login and setup wizard' })).toBeVisible()

    await page.getByRole('link', { name: '← Help Center' }).click()
    await expect(page).toHaveURL(/\/help$/)
    await page
      .getByRole('navigation', { name: 'Legal' })
      .getByRole('link', { name: 'Trust & Security' })
      .click()
    await expect(page).toHaveURL(/\/trust/)
    await expect(page.getByRole('heading', { name: 'Trust & Security' })).toBeVisible()
  })

  test('robots and sitemap expose public URLs only', async ({ request }) => {
    const robots = await request.get('/robots.txt')
    expect(robots.ok()).toBeTruthy()
    const robotsBody = await robots.text()
    expect(robotsBody).toContain('Allow: /welcome')
    expect(robotsBody).toContain('Disallow: /families')
    expect(robotsBody).toContain('User-Agent: GPTBot')
    expect(robotsBody).toContain('Sitemap:')

    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.ok()).toBeTruthy()
    const sitemapBody = await sitemap.text()
    expect(sitemapBody).toContain('/welcome')
    expect(sitemapBody).toContain('/help/first-login')
    expect(sitemapBody).not.toContain('/families')
  })

  test('protected routes redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/families')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  test('login works with seeded credentials', async ({ page }) => {
    await loginAsE2eMember(page)
  })
})
