import { describe, expect, it } from 'vitest'
import {
  bodyToEmailHtml,
  bodyToPlainText,
  composeBodyIsEmpty,
  emailHtmlToEditorHtml,
  isLikelyHtmlBody,
  markdownToHtml,
} from './email-utils'

describe('compose email body formatting', () => {
  it('renders markdown bold and italic without showing markers', () => {
    const html = markdownToHtml('Hello **bold** and *italic*')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).not.toContain('**')
  })

  it('detects HTML bodies from the rich editor', () => {
    expect(isLikelyHtmlBody('<p>Hello</p>')).toBe(true)
    expect(isLikelyHtmlBody('Hello **bold**')).toBe(false)
  })

  it('converts rich HTML for sending', () => {
    const html = bodyToEmailHtml('<p>Hello <strong>world</strong></p>')
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('font-family: Arial')
  })

  it('strips HTML to plain text', () => {
    expect(bodyToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('treats empty rich editor markup as empty', () => {
    expect(composeBodyIsEmpty('<p><br></p>')).toBe(true)
    expect(composeBodyIsEmpty('<p>Hi</p>')).toBe(false)
  })

  it('unwraps stored email HTML for the rich editor', () => {
    const stored = bodyToEmailHtml('<p>Hello <strong>world</strong></p>')
    expect(emailHtmlToEditorHtml(stored)).toContain('<strong>world</strong>')
    expect(emailHtmlToEditorHtml(stored)).not.toContain('font-family: Arial')
    expect(
      emailHtmlToEditorHtml(
        '<div style="font-family: Arial, sans-serif; line-height: 1.6;"><p style="margin: 0.5em 0;">fykil</p></div>',
      ),
    ).toBe('<p>fykil</p>')
  })
})
