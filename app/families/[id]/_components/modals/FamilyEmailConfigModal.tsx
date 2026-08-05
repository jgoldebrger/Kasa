'use client'

import { useFamilyDetail } from '../../FamilyDetailContext'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input } from '@/app/components/ui'

export function FamilyEmailConfigModal() {
  const {
    isAdmin,
    showEmailModal,
    setShowEmailModal,
    emailFormData,
    setEmailFormData,
    handleSaveEmailConfig,
  } = useFamilyDetail()

  if (!showEmailModal || !isAdmin) return null

  return (
    <Modal
      open
      title="Email Configuration"
      description="Configure email settings to send statements via email."
      onClose={() => setShowEmailModal(false)}
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        <Input
          label="Gmail Address"
          type="email"
          required
          value={emailFormData.email}
          onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
          placeholder="your-email@gmail.com"
        />
        <Input
          label="Gmail App Password"
          type="password"
          required
          value={emailFormData.password}
          onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
          placeholder="16-character app password"
        />
        <p className="text-xs text-fg-muted">
          Generate an app password from{' '}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            Google Account Settings
          </a>
        </p>
        <Input
          label="From Name"
          type="text"
          value={emailFormData.fromName}
          onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
          placeholder="Kasa Family Management"
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setShowEmailModal(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSaveEmailConfig}>
            Save & Continue
          </Button>
        </div>
      </div>
    </Modal>
  )
}
