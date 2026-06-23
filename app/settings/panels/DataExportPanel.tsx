'use client'

import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Button, Card } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

export default function DataExportPanel() {
  const t = useT()

  function handleExport() {
    window.location.href = '/api/organizations/export'
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-fg">{t('settings.dataExport.title')}</h2>
        <p className="text-sm text-fg-muted mt-1">{t('settings.dataExport.description')}</p>
      </div>

      <Card>
        <h3 className="font-medium text-fg text-sm mb-2">
          {t('settings.dataExport.includesTitle')}
        </h3>
        <ul className="text-sm text-fg-muted list-disc pl-5 space-y-1 mb-4">
          <li>{t('settings.dataExport.includes.families')}</li>
          <li>{t('settings.dataExport.includes.payments')}</li>
          <li>{t('settings.dataExport.includes.config')}</li>
          <li>{t('settings.dataExport.includes.audit')}</li>
        </ul>
        <p className="text-xs text-fg-muted mb-4">{t('settings.dataExport.redactionNote')}</p>
        <Button
          type="button"
          onClick={handleExport}
          leftIcon={<ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />}
        >
          {t('settings.dataExport.download')}
        </Button>
      </Card>
    </div>
  )
}
