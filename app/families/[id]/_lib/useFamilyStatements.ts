'use client'

import { useState, useCallback } from 'react'
import { escapeHtml } from '@/lib/html-escape'
import type { FamilyDetails } from './helpers'

export interface UseFamilyStatementsOptions {
  familyId: string
  isAdmin: boolean
  memberFinancialAccess: boolean
  data: FamilyDetails | null
  formatMoney: (n: number) => string
  emailConfig: any
  setEmailConfig: React.Dispatch<React.SetStateAction<any>>
  emailFormData: { email: string; password: string; fromName: string }
  setEmailFormData: React.Dispatch<
    React.SetStateAction<{ email: string; password: string; fromName: string }>
  >
  isFamilyFetchStale: (gen: number) => boolean
  beginFamilyFetch: () => number
  toast: { success: (msg: string) => void; error: (msg: string) => void }
}

export function useFamilyStatements({
  familyId,
  isAdmin,
  memberFinancialAccess,
  data,
  formatMoney,
  emailConfig,
  setEmailConfig,
  emailFormData,
  setEmailFormData,
  isFamilyFetchStale,
  beginFamilyFetch,
  toast,
}: UseFamilyStatementsOptions) {
  const [statements, setStatements] = useState<any[]>([])
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)

  const fetchStatements = useCallback(
    async (sharedGen?: number) => {
      if (!familyId) return
      if (!isAdmin && !memberFinancialAccess) return
      const gen = sharedGen ?? beginFamilyFetch()
      try {
        const url = isAdmin
          ? `/api/statements?familyId=${familyId}`
          : `/api/families/${familyId}/member-statements`
        const res = await fetch(url)
        if (isFamilyFetchStale(gen)) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => ({}))
        if (isFamilyFetchStale(gen)) return
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data.statements)
            ? data.statements
            : []
        const sorted = rows.sort(
          (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        )
        setStatements(sorted)
      } catch (error) {
        if (isFamilyFetchStale(gen)) return
        console.error('Error fetching statements:', error)
      }
    },
    [familyId, isAdmin, memberFinancialAccess, beginFamilyFetch, isFamilyFetchStale],
  )

  const handlePrintStatement = useCallback(
    async (statement: any) => {
      try {
        const res = await fetch(`/api/statements/${statement._id}`)
        if (!res.ok) {
          toast.error('Failed to load statement for printing')
          return
        }
        const stmtData = await res.json().catch(() => ({}))
        const transactions = stmtData.transactions || []

        const printWindow = window.open('', '_blank')
        if (printWindow) {
          const transactionsHTML =
            transactions.length > 0
              ? `
          <h2 style="margin-top: 30px; margin-bottom: 15px;">Transaction Details</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Type</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Description</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Amount</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${transactions
                .map(
                  (t: any) => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(new Date(t.date).toLocaleDateString())}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${t.type === 'payment' ? 'Payment' : t.type === 'withdrawal' ? 'Withdrawal' : t.type === 'cycle-charge' ? 'Annual Dues' : 'Event'}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(t.description)}</td>
                  <td style="padding: 8px; border: 1px solid #ddd; text-align: right; ${t.amount >= 0 ? 'color: green;' : 'color: red;'}">${t.amount > 0 ? '+' : ''}${formatMoney(t.amount)}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(t.notes || '-')}</td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        `
              : ''

          printWindow.document.write(`
          <html>
            <head>
              <title>Statement ${escapeHtml(statement.statementNumber)}</title>
              <style>
                @media print {
                  @page { margin: 1cm; }
                  body { margin: 0; }
                }
              </style>
            </head>
            <body style="font-family: Arial, sans-serif; padding: 40px; line-height: 1.6;">
              <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px;">
                <h1 style="margin: 0; color: #333;">Kasa Family Management</h1>
                <h2 style="margin: 10px 0 0 0; color: #666; font-weight: normal;">Statement</h2>
              </div>
              
              <div style="margin-bottom: 30px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 5px 0;"><strong>Statement Number:</strong> ${escapeHtml(statement.statementNumber)}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Date:</strong> ${escapeHtml(new Date(statement.date).toLocaleDateString())}</td>
                  </tr>
                  <tr>
                    <td style="padding: 5px 0;"><strong>Family:</strong> ${escapeHtml(stmtData?.family?.name || 'N/A')}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Period:</strong> ${escapeHtml(new Date(statement.fromDate).toLocaleDateString())} - ${escapeHtml(new Date(statement.toDate).toLocaleDateString())}</td>
                  </tr>
                </table>
              </div>

              <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Opening Balance:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">${formatMoney(statement.openingBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Income:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: green;">${formatMoney(statement.income)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Withdrawals:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.withdrawals)}</td>
                </tr>
                ${
                  (statement.cycleCharges || 0) > 0
                    ? `
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Annual Dues Charged:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.cycleCharges || 0)}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Expenses:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: red;">${formatMoney(statement.expenses)}</td>
                </tr>
                <tr style="background-color: #f0f0f0;">
                  <td style="padding: 10px; font-weight: bold; font-size: 1.1em;">Closing Balance:</td>
                  <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 1.1em;">${formatMoney(statement.closingBalance)}</td>
                </tr>
              </table>
              
              ${transactionsHTML}
              
              <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 0.9em;">
                <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
                <p>Kasa Family Management System</p>
              </div>
            </body>
          </html>
        `)
          printWindow.document.close()
          printWindow.print()
        }
      } catch (error) {
        console.error('Error printing statement:', error)
        toast.error('Error printing statement')
      }
    },
    [formatMoney, toast],
  )

  const handleSavePDFStatement = useCallback(
    async (statement: any) => {
      await handlePrintStatement(statement)
    },
    [handlePrintStatement],
  )

  const handleSendStatementEmail = useCallback(
    async (statement: any) => {
      if (!data?.family?.email) {
        toast.error(
          'This family does not have an email address. Please add an email address in the Contacts tab.',
        )
        return
      }

      if (!emailConfig?.email) {
        setShowEmailModal(true)
        return
      }

      setSendingEmail(statement._id)

      try {
        const emailRes = await fetch('/api/statements/send-single-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statement: { _id: statement._id } }),
        })

        const emailResult = await emailRes.json().catch(() => ({}))

        if (emailRes.ok) {
          toast.success(`Statement sent successfully to ${data.family.email}`)
        } else {
          throw new Error(emailResult.error || 'Failed to send email')
        }
      } catch (error: any) {
        console.error('Error sending statement email:', error)
        toast.error(`Error sending email: ${error.message}`)
      } finally {
        setSendingEmail(null)
      }
    },
    [data?.family?.email, emailConfig?.email, toast],
  )

  const handleSaveEmailConfig = useCallback(async () => {
    if (!emailFormData.email || !emailFormData.password) {
      toast.error('Please enter both email address and password')
      return
    }

    try {
      const res = await fetch('/api/email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailFormData),
      })

      if (res.ok) {
        const config = await res.json().catch(() => ({}))
        setEmailConfig(config)
        setShowEmailModal(false)
        toast.success('Email configuration saved successfully. You can now send statements.')
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(`Error: ${error.error || 'Failed to save email configuration'}`)
      }
    } catch (error) {
      console.error('Error saving email config:', error)
      toast.error('Error saving email configuration')
    }
  }, [emailFormData, setEmailConfig, toast])

  const handlePrintAllStatements = useCallback(async () => {
    if (!data?.family) return

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      let allStatementsHTML = ''

      for (const statement of statements) {
        try {
          const res = await fetch(`/api/statements/${statement._id}`)
          if (!res.ok) continue
          const statementData = await res.json().catch(() => ({}))
          const transactions = statementData.transactions || []

          const transactionsHTML =
            transactions.length > 0
              ? `
            <h3 style="margin-top: 20px; margin-bottom: 10px; font-size: 1em;">Transaction Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.9em;">
              <thead>
                <tr style="background-color: #f5f5f5;">
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Type</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Description</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${transactions
                  .map(
                    (t: any) => `
                  <tr>
                    <td style="padding: 6px; border: 1px solid #ddd;">${escapeHtml(new Date(t.date).toLocaleDateString())}</td>
                    <td style="padding: 6px; border: 1px solid #ddd;">${t.type === 'payment' ? 'Payment' : t.type === 'withdrawal' ? 'Withdrawal' : t.type === 'cycle-charge' ? 'Annual Dues' : 'Event'}</td>
                    <td style="padding: 6px; border: 1px solid #ddd;">${escapeHtml(t.description)}</td>
                    <td style="padding: 6px; border: 1px solid #ddd; text-align: right; ${t.amount >= 0 ? 'color: green;' : 'color: red;'}">${t.amount > 0 ? '+' : ''}${formatMoney(t.amount)}</td>
                  </tr>
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          `
              : ''

          allStatementsHTML += `
            <div style="page-break-after: always; margin-bottom: 40px;">
              <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px;">
                <h1 style="margin: 0; color: #333; font-size: 1.5em;">Kasa Family Management</h1>
                <h2 style="margin: 5px 0 0 0; color: #666; font-weight: normal; font-size: 1.2em;">Statement</h2>
              </div>
              
              <div style="margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 5px 0;"><strong>Statement Number:</strong> ${escapeHtml(statement.statementNumber)}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Date:</strong> ${escapeHtml(new Date(statement.date).toLocaleDateString())}</td>
                  </tr>
                  <tr>
                    <td style="padding: 5px 0;"><strong>Family:</strong> ${escapeHtml(data.family.name)}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Period:</strong> ${escapeHtml(new Date(statement.fromDate).toLocaleDateString())} - ${escapeHtml(new Date(statement.toDate).toLocaleDateString())}</td>
                  </tr>
                </table>
              </div>

              <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Opening Balance:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatMoney(statement.openingBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Income:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: green;">${formatMoney(statement.income)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Withdrawals:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.withdrawals)}</td>
                </tr>
                ${
                  (statement.cycleCharges || 0) > 0
                    ? `
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Annual Dues Charged:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.cycleCharges || 0)}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Expenses:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: red;">${formatMoney(statement.expenses)}</td>
                </tr>
                <tr style="background-color: #f0f0f0;">
                  <td style="padding: 8px; font-weight: bold;">Closing Balance:</td>
                  <td style="padding: 8px; text-align: right; font-weight: bold;">${formatMoney(statement.closingBalance)}</td>
                </tr>
              </table>
              
              ${transactionsHTML}
            </div>
          `
        } catch (error) {
          console.error(`Error fetching statement ${statement._id}:`, error)
        }
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>All Statements - ${escapeHtml(data.family.name)}</title>
            <style>
              @media print {
                @page { margin: 1cm; }
                body { margin: 0; }
              }
            </style>
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
            ${allStatementsHTML}
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 0.9em;">
              <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
              <p>Kasa Family Management System</p>
            </div>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.print()
    }
  }, [data?.family, statements, formatMoney])

  const resetStatements = useCallback(() => {
    setStatements([])
  }, [])

  return {
    statements,
    setStatements,
    sendingEmail,
    setSendingEmail,
    showEmailModal,
    setShowEmailModal,
    fetchStatements,
    handlePrintStatement,
    handleSavePDFStatement,
    handleSendStatementEmail,
    handleSaveEmailConfig,
    handlePrintAllStatements,
    resetStatements,
  }
}
