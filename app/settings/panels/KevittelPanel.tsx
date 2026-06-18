'use client'

import { PrinterIcon, DocumentArrowDownIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { escapeHtml } from '@/lib/html-escape'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Button } from '@/app/components/ui'

export interface KevittelPanelProps {
  families: any[]
  loading: boolean
}

function buildKevittelPrintHtml(families: any[]): string {
  const familiesWithKevittel = families
    .filter((family) => {
      const hasHusbandName = family.husbandHebrewName && family.husbandHebrewName.trim() !== ''
      const hasWifeName = family.wifeHebrewName && family.wifeHebrewName.trim() !== ''
      const hasChildren = (family.members || []).some(
        (child: any) => child.hebrewFirstName && child.hebrewFirstName.trim() !== '',
      )
      return hasHusbandName || hasWifeName || hasChildren
    })
    .map((family) => {
      const husbandHebrewName = family.husbandHebrewName || ''
      const husbandFatherHebrewName = family.husbandFatherHebrewName || ''
      const wifeHebrewName = family.wifeHebrewName || ''
      const wifeFatherHebrewName = family.wifeFatherHebrewName || ''
      const children = family.members || []

      const entries: string[] = []

      if (husbandHebrewName && husbandHebrewName.trim() !== '') {
        let husbandEntry = escapeHtml(husbandHebrewName)
        if (husbandFatherHebrewName && husbandFatherHebrewName.trim() !== '') {
          husbandEntry += ` בן ${escapeHtml(husbandFatherHebrewName)}`
        }
        entries.push(husbandEntry)
      }

      if (wifeHebrewName && wifeHebrewName.trim() !== '') {
        let wifeEntry = `וזו' ${escapeHtml(wifeHebrewName)}`
        if (wifeFatherHebrewName && wifeFatherHebrewName.trim() !== '') {
          wifeEntry += ` בת ${escapeHtml(wifeFatherHebrewName)}`
        }
        entries.push(wifeEntry)
      }

      children.forEach((child: any) => {
        const childHebrewName = child.hebrewFirstName || ''
        if (childHebrewName && childHebrewName.trim() !== '') {
          entries.push(`ב' ${escapeHtml(childHebrewName)}`)
        }
      })

      return entries.join('<br>')
    })
    .filter((text) => text.trim() !== '')

  return `
    <html>
      <head>
        <title>Kevittel</title>
        <style>
          @media print {
            @page { margin: 2cm; }
            body { margin: 0; }
          }
          body {
            font-family: Arial Hebrew, David, sans-serif;
            direction: rtl;
            text-align: right;
            padding: 40px;
            line-height: 2;
            font-size: 18px;
          }
          .kevittel-item {
            margin-bottom: 20px;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
          }
          .kevittel-item:last-child {
            border-bottom: none;
          }
        </style>
      </head>
      <body>
        ${familiesWithKevittel.map((text) => `<div class="kevittel-item">${text}</div>`).join('')}
      </body>
    </html>
  `
}

function openKevittelPrint(families: any[]) {
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(buildKevittelPrintHtml(families))
    printWindow.document.close()
    printWindow.print()
  }
}

export default function KevittelPanel({ families, loading }: KevittelPanelProps) {
  return (
    <SettingsPanel
      icon={<UserGroupIcon />}
      title="Kevittel"
      description="Print Hebrew family names for kevittel sheets."
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => openKevittelPrint(families)}
            leftIcon={<PrinterIcon className="h-4 w-4" />}
          >
            Print
          </Button>
          <Button
            onClick={() => openKevittelPrint(families)}
            leftIcon={<DocumentArrowDownIcon className="h-4 w-4" />}
          >
            Save as PDF
          </Button>
        </>
      }
    >
      <div id="kevittel-content" className="space-y-4 print:space-y-2">
        {loading ? (
          <div className="text-center py-12 text-fg-muted">Loading families...</div>
        ) : (
          (() => {
            const familiesWithHebrewNames = families.filter((family) => {
              const hasHusbandName =
                family.husbandHebrewName && family.husbandHebrewName.trim() !== ''
              const hasWifeName = family.wifeHebrewName && family.wifeHebrewName.trim() !== ''
              const hasChildren = (family.members || []).some(
                (child: any) => child.hebrewFirstName && child.hebrewFirstName.trim() !== '',
              )
              return hasHusbandName || hasWifeName || hasChildren
            })

            if (families.length === 0) {
              return <div className="text-center py-12 text-fg-muted">No families found.</div>
            }

            if (familiesWithHebrewNames.length === 0) {
              return (
                <div className="text-center py-12">
                  <p className="text-fg-muted mb-4">No families with Hebrew names found.</p>
                  <p className="text-sm text-fg-subtle">
                    Please add Hebrew names to families in the Families section.
                  </p>
                  {families.length > 0 && (
                    <p className="text-xs text-fg-subtle mt-2">
                      {families.length} families loaded, but none have qualifying entries to print.
                    </p>
                  )}
                </div>
              )
            }

            return (
              <>
                {familiesWithHebrewNames
                  .map((family) => {
                    const husbandHebrewName = family.husbandHebrewName || ''
                    const husbandFatherHebrewName = family.husbandFatherHebrewName || ''
                    const wifeHebrewName = family.wifeHebrewName || ''
                    const wifeFatherHebrewName = family.wifeFatherHebrewName || ''
                    const children = family.members || []

                    const entries: string[] = []

                    if (husbandHebrewName && husbandHebrewName.trim() !== '') {
                      let husbandEntry = husbandHebrewName
                      if (husbandFatherHebrewName && husbandFatherHebrewName.trim() !== '') {
                        husbandEntry += ` בן ${husbandFatherHebrewName}`
                      }
                      entries.push(husbandEntry)
                    }

                    if (wifeHebrewName && wifeHebrewName.trim() !== '') {
                      let wifeEntry = `וזו' ${wifeHebrewName}`
                      if (wifeFatherHebrewName && wifeFatherHebrewName.trim() !== '') {
                        wifeEntry += ` בת ${wifeFatherHebrewName}`
                      }
                      entries.push(wifeEntry)
                    }

                    children.forEach((child: any) => {
                      const childHebrewName = child.hebrewFirstName || ''
                      if (childHebrewName && childHebrewName.trim() !== '') {
                        entries.push(`ב' ${childHebrewName}`)
                      }
                    })

                    if (entries.length === 0) {
                      return null
                    }

                    return (
                      <div
                        key={family._id}
                        className="border-b border-border py-3 print:py-2 print:border-border"
                      >
                        {entries.map((entry, index) => (
                          <div
                            key={index}
                            className="text-xl font-semibold text-fg print:text-lg print:font-normal mb-2 last:mb-0"
                            dir="rtl"
                            lang="he"
                            style={{
                              fontFamily: 'Arial Hebrew, David, sans-serif',
                              textAlign: 'right',
                              lineHeight: '1.8',
                            }}
                          >
                            {entry}
                          </div>
                        ))}
                      </div>
                    )
                  })
                  .filter(Boolean)}
              </>
            )
          })()
        )}
      </div>
    </SettingsPanel>
  )
}
