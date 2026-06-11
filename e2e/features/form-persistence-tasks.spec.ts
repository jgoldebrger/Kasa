import { test, expect } from '@playwright/test'
import { ensureAlphaOrg } from '../helpers'
import { uniqueTag } from '../helpers/form-persistence'

test.describe('Form persistence — tasks', () => {
  test.setTimeout(180_000)

  test.beforeEach(async ({ page }) => {
    await ensureAlphaOrg(page)
  })

  test('create task form fields persist in list after reload', async ({ page }) => {
    const tag = uniqueTag('task')
    const title = `E2E Task ${tag}`
    const description = `Description ${tag}`
    const email = `task-${tag}@example.com`
    const notes = `Notes ${tag}`

    await page.goto('/tasks')
    await page.getByRole('button', { name: /create task|add task|new task/i }).click()
    const dialog = page.getByRole('dialog', { name: /create task/i })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Description').fill(description)
    await dialog.getByLabel('Due Date').fill('2030-12-31')
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Priority').selectOption('high')
    await dialog.getByLabel('Notes').fill(notes)

    const createRes = page.waitForResponse(
      (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: /^create task$/i }).click()
    const res = await createRes
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    const taskId = body.task?._id ?? body._id

    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(description).first()).toBeVisible()
    await expect(page.getByText(/high/i).first()).toBeVisible()

    await page.reload()
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(description).first()).toBeVisible()

    if (taskId) {
      const api = await page.request.get(`/api/tasks/${taskId}`)
      expect(api.ok()).toBeTruthy()
      const task = await api.json()
      const t = task.task ?? task
      expect(t.title).toBe(title)
      expect(t.description).toBe(description)
      expect(t.email).toBe(email)
      expect(t.notes).toBe(notes)
      expect(t.priority).toBe('high')
    }
  })
})
