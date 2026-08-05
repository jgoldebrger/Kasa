'use client'

import { useState } from 'react'
import { useFamilyDetail } from '../../FamilyDetailContext'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input, Textarea } from '@/app/components/ui'

export function FamilyWithdrawalModal() {
  const {
    isAdmin,
    showWithdrawalModal,
    setShowWithdrawalModal,
    editingWithdrawal,
    setEditingWithdrawal,
    withdrawalForm,
    setWithdrawalForm,
    handleSaveWithdrawal,
  } = useFamilyDetail()

  const [submitting, setSubmitting] = useState(false)

  if (!showWithdrawalModal || !isAdmin) return null

  const closeModal = () => {
    setShowWithdrawalModal(false)
    setEditingWithdrawal(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await handleSaveWithdrawal(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={editingWithdrawal ? 'Edit Withdrawal' : 'Add Withdrawal'}
      onClose={closeModal}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={withdrawalForm.amount}
          onChange={(e) =>
            setWithdrawalForm({
              ...withdrawalForm,
              amount: parseFloat(e.target.value) || 0,
            })
          }
        />
        <Input
          label="Withdrawal Date"
          type="date"
          required
          value={withdrawalForm.withdrawalDate}
          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, withdrawalDate: e.target.value })}
        />
        <Input
          label="Reason"
          type="text"
          value={withdrawalForm.reason}
          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, reason: e.target.value })}
          placeholder="e.g. Refund, Adjustment"
        />
        <Textarea
          label="Notes"
          value={withdrawalForm.notes}
          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, notes: e.target.value })}
          rows={3}
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editingWithdrawal ? 'Save Changes' : 'Add Withdrawal'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
