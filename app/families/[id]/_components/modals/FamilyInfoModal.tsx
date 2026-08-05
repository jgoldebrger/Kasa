'use client'

import { useState } from 'react'
import { useFamilyDetail } from '../../FamilyDetailContext'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { normalizePlanId } from '@/lib/payment-plan-display'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input, Select } from '@/app/components/ui'

export function FamilyInfoModal() {
  const {
    params,
    isAdmin,
    showInfoModal,
    setShowInfoModal,
    infoForm,
    setInfoForm,
    paymentPlans,
    setData,
    fetchFamilyDetails,
  } = useFamilyDetail()

  const [infoSubmitting, setInfoSubmitting] = useState(false)

  if (!showInfoModal || !isAdmin) return null

  return (
    <Modal
      open
      title="Edit Family Information"
      onClose={() => setShowInfoModal(false)}
      maxWidth="max-w-4xl"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (infoSubmitting) return
          setInfoSubmitting(true)
          try {
            const res = await fetch(`/api/families/${params.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...infoForm,
                weddingDate: infoForm.weddingDate
                  ? new Date(infoForm.weddingDate).toISOString()
                  : undefined,
                paymentPlanId: infoForm.paymentPlanId || null,
              }),
            })
            const updated = await res.json().catch(() => null)
            if (res.ok) {
              if (updated && typeof updated === 'object') {
                setData((prev: { family?: Record<string, unknown> } | null) => {
                  if (!prev) return prev
                  const paymentPlanId =
                    updated.paymentPlanId != null ? normalizePlanId(updated.paymentPlanId) : null
                  return {
                    ...prev,
                    family: { ...prev.family, ...updated, paymentPlanId },
                  }
                })
              }
              invalidateCache(/^\/api\/families/)
              setShowInfoModal(false)
              fetchFamilyDetails()
            }
          } catch (error) {
            console.error('Error updating family info:', error)
          } finally {
            setInfoSubmitting(false)
          }
        }}
        className="space-y-6"
      >
        <div>
          <h3 className="text-lg font-semibold mb-4 text-fg">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Input
                label="Family Name *"
                type="text"
                required
                value={infoForm.name}
                onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
              />
            </div>
            <div>
              <Input
                label="Family Name (Hebrew)"
                type="text"
                dir="rtl"
                lang="he"
                value={infoForm.hebrewName}
                onChange={(e) => setInfoForm({ ...infoForm, hebrewName: e.target.value })}
                className="text-right"
                style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
              />
            </div>
            <div>
              <Input
                label="Wedding Date *"
                type="date"
                required
                value={infoForm.weddingDate}
                onChange={(e) => setInfoForm({ ...infoForm, weddingDate: e.target.value })}
              />
            </div>
            <div>
              <Select
                label="Payment Plan"
                value={infoForm.paymentPlanId}
                onChange={(e) => setInfoForm({ ...infoForm, paymentPlanId: e.target.value })}
              >
                <option value="">Select a plan</option>
                {paymentPlans.map((plan: { _id: string; name: string }) => (
                  <option key={plan._id} value={normalizePlanId(plan._id)}>
                    {plan.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4 text-fg">Husband Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="First Name"
              type="text"
              value={infoForm.husbandFirstName}
              onChange={(e) => setInfoForm({ ...infoForm, husbandFirstName: e.target.value })}
            />
            <Input
              label="Hebrew Name"
              type="text"
              dir="rtl"
              lang="he"
              value={infoForm.husbandHebrewName}
              onChange={(e) => setInfoForm({ ...infoForm, husbandHebrewName: e.target.value })}
              className="text-right"
              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
            />
            <Input
              label="Father's Hebrew Name"
              type="text"
              dir="rtl"
              lang="he"
              value={infoForm.husbandFatherHebrewName}
              onChange={(e) =>
                setInfoForm({ ...infoForm, husbandFatherHebrewName: e.target.value })
              }
              className="text-right"
              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
            />
            <Input
              label="Cell Phone"
              type="tel"
              value={infoForm.husbandCellPhone}
              onChange={(e) => setInfoForm({ ...infoForm, husbandCellPhone: e.target.value })}
            />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4 text-fg">Wife Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="First Name"
              type="text"
              value={infoForm.wifeFirstName}
              onChange={(e) => setInfoForm({ ...infoForm, wifeFirstName: e.target.value })}
            />
            <Input
              label="Hebrew Name"
              type="text"
              dir="rtl"
              lang="he"
              value={infoForm.wifeHebrewName}
              onChange={(e) => setInfoForm({ ...infoForm, wifeHebrewName: e.target.value })}
              className="text-right"
              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
            />
            <Input
              label="Father's Hebrew Name"
              type="text"
              dir="rtl"
              lang="he"
              value={infoForm.wifeFatherHebrewName}
              onChange={(e) => setInfoForm({ ...infoForm, wifeFatherHebrewName: e.target.value })}
              className="text-right"
              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
            />
            <Input
              label="Cell Phone"
              type="tel"
              value={infoForm.wifeCellPhone}
              onChange={(e) => setInfoForm({ ...infoForm, wifeCellPhone: e.target.value })}
            />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4 text-fg">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              wrapperClassName="md:col-span-2"
              value={infoForm.email}
              onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })}
              placeholder="family@example.com"
            />
            <Input
              label="Phone"
              type="tel"
              value={infoForm.phone}
              onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
            <Input
              label="ZIP Code"
              type="text"
              value={infoForm.zip}
              onChange={(e) => setInfoForm({ ...infoForm, zip: e.target.value })}
              placeholder="12345"
            />
            <Input
              label="Street Address"
              type="text"
              wrapperClassName="md:col-span-2"
              value={infoForm.street || infoForm.address}
              onChange={(e) =>
                setInfoForm({
                  ...infoForm,
                  street: e.target.value,
                  address: e.target.value,
                })
              }
              placeholder="123 Main Street"
            />
            <Input
              label="City"
              type="text"
              value={infoForm.city}
              onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })}
              placeholder="New York"
            />
            <Input
              label="State"
              type="text"
              value={infoForm.state}
              onChange={(e) => setInfoForm({ ...infoForm, state: e.target.value })}
              placeholder="NY"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="secondary" onClick={() => setShowInfoModal(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={infoSubmitting}>
            Save Info
          </Button>
        </div>
      </form>
    </Modal>
  )
}
