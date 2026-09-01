'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useFamilyDetail } from '../../FamilyDetailContext'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input, Select, Textarea } from '@/app/components/ui'

const StripePaymentForm = dynamic(() => import('@/app/components/StripePaymentForm'), {
  ssr: false,
  loading: () => (
    <div className="p-4 bg-app-subtle rounded-lg border border-border text-sm text-fg-muted">
      Loading payment form…
    </div>
  ),
})

export function FamilyPaymentModal() {
  const {
    params,
    toast,
    isAdmin,
    data,
    showPaymentModal,
    setShowPaymentModal,
    useStripe,
    setUseStripe,
    viewingMemberId,
    memberActiveTab,
    paymentForm,
    setPaymentForm,
    savedPaymentMethods,
    fetchFamilyDetails,
    fetchSavedPaymentMethods,
    handleAddPayment,
  } = useFamilyDetail()

  const [submitting, setSubmitting] = useState(false)

  if (!showPaymentModal || !isAdmin) return null

  const handleSubmit = async (e: React.FormEvent) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await handleAddPayment(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open title="Add Payment" onClose={() => setShowPaymentModal(false)} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {viewingMemberId && memberActiveTab === 'payments' ? (
          <Select
            label="Payment For"
            value={paymentForm.paymentFor}
            onChange={(e) =>
              setPaymentForm({
                ...paymentForm,
                paymentFor: e.target.value as 'family' | 'member',
                memberId: e.target.value === 'family' ? '' : viewingMemberId,
              })
            }
            required
          >
            <option value="member">
              Member (Current:{' '}
              {data?.members?.find((m: { _id: string }) => m._id === viewingMemberId)?.firstName}{' '}
              {data?.members?.find((m: { _id: string }) => m._id === viewingMemberId)?.lastName})
            </option>
            <option value="family">Family</option>
          </Select>
        ) : (
          <input type="hidden" value="family" />
        )}

        {paymentForm.paymentFor === 'member' && !viewingMemberId && (
          <Select
            label="Select Member"
            value={paymentForm.memberId}
            onChange={(e) => setPaymentForm({ ...paymentForm, memberId: e.target.value })}
            required={paymentForm.paymentFor === 'member'}
          >
            <option value="">Select a member...</option>
            {data?.members?.map((member: { _id: string; firstName: string; lastName: string }) => (
              <option key={member._id} value={member._id}>
                {member.firstName} {member.lastName}
              </option>
            ))}
          </Select>
        )}

        <Input
          label="Amount"
          type="number"
          required
          min="0.01"
          step="0.01"
          value={paymentForm.amount || ''}
          onChange={(e) => {
            const value = e.target.value
            setPaymentForm({ ...paymentForm, amount: value ? parseFloat(value) : 0 })
          }}
          placeholder="0.00"
        />
        <Input
          label="Payment Date"
          type="date"
          required
          value={paymentForm.paymentDate}
          onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
        />
        <Input
          label="Year"
          type="number"
          required
          value={paymentForm.year}
          onChange={(e) => setPaymentForm({ ...paymentForm, year: parseInt(e.target.value) })}
        />
        <Select
          label="Type"
          value={paymentForm.type}
          onChange={(e) => setPaymentForm({ ...paymentForm, type: e.target.value })}
        >
          <option value="membership">Membership</option>
          <option value="donation">Donation</option>
          <option value="other">Other</option>
        </Select>
        <Select
          label="Payment Frequency"
          value={paymentForm.paymentFrequency}
          onChange={(e) =>
            setPaymentForm({
              ...paymentForm,
              paymentFrequency: e.target.value as 'one-time' | 'monthly',
            })
          }
          required
        >
          <option value="one-time">One-Time Payment</option>
          <option value="monthly">Monthly Payment</option>
        </Select>
        <Select
          label="Payment Method"
          value={paymentForm.paymentMethod || 'cash'}
          onChange={(e) => {
            const selectedMethod = e.target.value as 'cash' | 'credit_card' | 'check' | 'quick_pay'
            setPaymentForm({
              ...paymentForm,
              paymentMethod: selectedMethod,
              useSavedCard: false,
            })
          }}
          required
        >
          <option value="cash">Cash</option>
          <option value="credit_card">Credit Card</option>
          <option value="check">Check</option>
          <option value="quick_pay">Quick Pay</option>
        </Select>

        {paymentForm.paymentMethod === 'credit_card' && (
          <div className="space-y-3 p-4 bg-accent/10 rounded-lg border border-accent/20">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-fg">Credit Card Information</h4>
              {paymentForm.amount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useStripe}
                    onChange={(e) => {
                      setUseStripe(e.target.checked)
                      if (e.target.checked) {
                        setPaymentForm({ ...paymentForm, useSavedCard: false })
                      }
                    }}
                    className="rounded"
                  />
                  <span>Use Stripe (Secure Payment)</span>
                </label>
              )}
            </div>

            {savedPaymentMethods.length > 0 && !useStripe && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Saved Cards on File</label>
                <div className="space-y-2">
                  {savedPaymentMethods.map(
                    (card: {
                      _id: string
                      cardType: string
                      last4: string
                      isDefault?: boolean
                      expiryMonth: string | number
                      expiryYear: string | number
                      nameOnCard?: string
                    }) => (
                      <label
                        key={card._id}
                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/10 ${
                          paymentForm.useSavedCard && paymentForm.selectedSavedCardId === card._id
                            ? 'bg-accent/20 border-accent'
                            : 'bg-surface'
                        }`}
                      >
                        <input
                          type="radio"
                          name="savedCard"
                          checked={
                            paymentForm.useSavedCard && paymentForm.selectedSavedCardId === card._id
                          }
                          onChange={() =>
                            setPaymentForm({
                              ...paymentForm,
                              useSavedCard: true,
                              selectedSavedCardId: card._id,
                            })
                          }
                          className="rounded"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{card.cardType.toUpperCase()}</span>
                            <span>•••• {card.last4}</span>
                            {card.isDefault && (
                              <span className="rounded bg-success/10 px-2 py-1 text-xs text-success">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-fg-muted">
                            Expires {card.expiryMonth}/{card.expiryYear}
                            {card.nameOnCard && ` • ${card.nameOnCard}`}
                          </div>
                        </div>
                      </label>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setPaymentForm({
                        ...paymentForm,
                        useSavedCard: false,
                        selectedSavedCardId: '',
                      })
                    }
                    className="text-sm text-accent hover:text-accent-hover"
                  >
                    Use new card instead
                  </button>
                </div>
              </div>
            )}

            {!paymentForm.useSavedCard && (
              <>
                {useStripe ? (
                  <StripePaymentForm
                    amount={paymentForm.amount}
                    familyId={params.id as string}
                    paymentDate={paymentForm.paymentDate}
                    year={paymentForm.year}
                    type={paymentForm.type}
                    notes={paymentForm.notes}
                    saveCard={paymentForm.saveCard}
                    paymentFrequency={paymentForm.paymentFrequency}
                    memberId={
                      paymentForm.paymentFor === 'member' && paymentForm.memberId
                        ? paymentForm.memberId
                        : undefined
                    }
                    onSuccess={async () => {
                      setShowPaymentModal(false)
                      setUseStripe(false)
                      setPaymentForm({
                        amount: 0,
                        paymentDate: new Date().toISOString().split('T')[0],
                        year: new Date().getFullYear(),
                        type: 'membership',
                        paymentMethod: 'cash',
                        paymentFrequency: 'one-time',
                        paymentFor: 'family',
                        memberId: '',
                        saveCard: false,
                        useSavedCard: false,
                        selectedSavedCardId: '',
                        ccLast4: '',
                        ccCardType: '',
                        ccExpiryMonth: '',
                        ccExpiryYear: '',
                        ccNameOnCard: '',
                        checkNumber: '',
                        checkBankName: '',
                        checkRoutingNumber: '',
                        notes: '',
                      })
                      fetchFamilyDetails()
                      fetchSavedPaymentMethods()
                    }}
                    onError={(error: string) => {
                      toast.error(`Payment error: ${error}`)
                    }}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Last 4 Digits"
                        type="text"
                        required
                        maxLength={4}
                        value={paymentForm.ccLast4}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            ccLast4: e.target.value.replace(/\D/g, '').slice(0, 4),
                          })
                        }
                        placeholder="1234"
                      />
                      <Select
                        label="Card Type"
                        value={paymentForm.ccCardType}
                        onChange={(e) =>
                          setPaymentForm({ ...paymentForm, ccCardType: e.target.value })
                        }
                      >
                        <option value="">Select...</option>
                        <option value="Visa">Visa</option>
                        <option value="Mastercard">Mastercard</option>
                        <option value="American Express">American Express</option>
                        <option value="Discover">Discover</option>
                        <option value="Other">Other</option>
                      </Select>
                      <Input
                        label="Expiry Month"
                        type="text"
                        maxLength={2}
                        value={paymentForm.ccExpiryMonth}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            ccExpiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2),
                          })
                        }
                        placeholder="MM"
                      />
                      <Input
                        label="Expiry Year"
                        type="text"
                        maxLength={4}
                        value={paymentForm.ccExpiryYear}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            ccExpiryYear: e.target.value.replace(/\D/g, '').slice(0, 4),
                          })
                        }
                        placeholder="YYYY"
                      />
                    </div>
                    <Input
                      label="Name on Card"
                      type="text"
                      value={paymentForm.ccNameOnCard}
                      onChange={(e) =>
                        setPaymentForm({ ...paymentForm, ccNameOnCard: e.target.value })
                      }
                      placeholder="John Doe"
                    />
                    {paymentForm.amount > 0 && (
                      <label className="flex items-center gap-2 text-sm mt-3">
                        <input
                          type="checkbox"
                          checked={paymentForm.saveCard}
                          onChange={(e) =>
                            setPaymentForm({ ...paymentForm, saveCard: e.target.checked })
                          }
                          className="rounded"
                        />
                        <span>Save card for future use</span>
                      </label>
                    )}
                  </>
                )}
              </>
            )}
            {paymentForm.useSavedCard && paymentForm.selectedSavedCardId && (
              <div className="mt-3 rounded-lg border border-success/20 bg-success/10 p-4">
                <p className="mb-2 text-sm text-success">
                  Ready to charge saved card. Click "Add Payment" below to process.
                </p>
                {paymentForm.paymentFrequency === 'monthly' && (
                  <p className="text-xs text-success">
                    This will be set up as a monthly recurring payment.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {paymentForm.paymentMethod === 'check' && (
          <div className="space-y-3 rounded-lg border border-success/20 bg-success/10 p-4">
            <h4 className="font-medium text-fg mb-2">Check Information</h4>
            <Input
              label="Check Number"
              type="text"
              required
              value={paymentForm.checkNumber}
              onChange={(e) => setPaymentForm({ ...paymentForm, checkNumber: e.target.value })}
              placeholder="1234"
            />
            <Input
              label="Bank Name"
              type="text"
              value={paymentForm.checkBankName}
              onChange={(e) => setPaymentForm({ ...paymentForm, checkBankName: e.target.value })}
              placeholder="Bank Name"
            />
            <Input
              label="Routing Number"
              type="text"
              value={paymentForm.checkRoutingNumber}
              onChange={(e) =>
                setPaymentForm({
                  ...paymentForm,
                  checkRoutingNumber: e.target.value.replace(/\D/g, ''),
                })
              }
              placeholder="9-digit routing number"
              maxLength={9}
            />
          </div>
        )}

        <Textarea
          label="Notes"
          value={paymentForm.notes}
          onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
          rows={3}
        />
        {!(paymentForm.paymentMethod === 'credit_card' && useStripe) && (
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowPaymentModal(false)
                setUseStripe(false)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Add Payment
            </Button>
          </div>
        )}
      </form>
    </Modal>
  )
}
