'use client'

import { useState, useEffect } from 'react'
import type { Stripe, StripeElementsOptions } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCurrency } from '@/lib/client/useCurrency'
import { toMinorUnits } from '@/lib/money'
import { Button, Alert } from '@/app/components/ui'

// Lazy-load @stripe/stripe-js so the Stripe SDK isn't bundled into the
// initial JS for users who never see a credit-card form. The promise is
// memoized on first call so subsequent renders reuse it.
let _stripePromise: Promise<Stripe | null> | null = null
function getStripe(): Promise<Stripe | null> {
  if (!_stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
    _stripePromise = import('@stripe/stripe-js').then((m) => m.loadStripe(key))
  }
  return _stripePromise
}

interface StripePaymentFormProps {
  amount: number
  familyId: string
  paymentDate: string
  year: number
  type: string
  notes?: string
  saveCard?: boolean
  paymentFrequency?: 'one-time' | 'monthly'
  memberId?: string // Optional: for member-specific payments
  onSuccess: (paymentIntentId: string, paymentMethodId?: string) => void
  onError: (error: string) => void
}

function PaymentForm({
  amount,
  familyId,
  paymentDate,
  year,
  type,
  notes,
  saveCard = false,
  paymentFrequency = 'one-time',
  memberId,
  onSuccess,
  onError,
}: StripePaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [clientSecret, setClientSecret] = useState<string>('')
  const { format } = useCurrency()

  useEffect(() => {
    let requestId = 0
    const createPaymentIntent = async () => {
      const thisRequest = ++requestId
      try {
        const res = await fetch('/api/stripe/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount,
            familyId,
            description: `${type} payment for family ${familyId}`,
          }),
        })

        if (thisRequest !== requestId) return

        if (!res.ok) {
          const errorData = await res
            .json()
            .catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }))
          console.error('Payment intent creation failed:', errorData)
          onError(errorData.error || `Server error: ${res.status} ${res.statusText}`)
          return
        }

        const data = await res.json()
        if (thisRequest !== requestId) return
        if (data.clientSecret) {
          setClientSecret(data.clientSecret)
        } else {
          console.error('No clientSecret in response:', data)
          onError(data.error || 'Failed to create payment intent - no client secret returned')
        }
      } catch (error: any) {
        if (thisRequest !== requestId) return
        console.error('Error creating payment intent:', error)
        onError(error.message || 'Failed to initialize payment')
      }
    }

    if (amount > 0) {
      createPaymentIntent()
    }
    return () => {
      requestId += 1
    }
  }, [amount, familyId, type, onError])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }

    if (!stripe || !elements) {
      return
    }

    setProcessing(true)

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      onError('Card element not found')
      setProcessing(false)
      return
    }

    try {
      // Confirm payment with Stripe
      const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      })

      if (confirmError) {
        onError(confirmError.message || 'Payment failed')
        setProcessing(false)
        return
      }

      if (paymentIntent?.status === 'succeeded') {
        let savedPaymentMethodId = undefined

        // Save payment method if requested. We pass the PaymentIntent
        // id so the server can verify the PM was actually used in a
        // succeeded charge for this org+family — without that check
        // any `pm_…` could be attached to this family's saved-card
        // list.
        if (saveCard && paymentIntent.payment_method) {
          try {
            const saveRes = await fetch(`/api/families/${familyId}/saved-payment-methods`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                paymentMethodId: paymentIntent.payment_method as string,
                paymentIntentId: paymentIntent.id,
                setAsDefault: true,
              }),
            })
            if (saveRes.ok) {
              const saved = await saveRes.json()
              savedPaymentMethodId = saved._id
            }
          } catch (err) {
            console.error('Error saving payment method:', err)
            // Continue even if saving fails
          }
        }

        // Confirm payment in our backend. CRITICAL: the card has
        // ALREADY been charged at this point. If our /confirm-payment
        // call fails (network blip, 500, validation issue), we must NOT
        // tell the user "payment failed" — that produces angry support
        // tickets when the customer sees a Stripe charge on their card.
        // The stripe webhook (`payment_intent.succeeded` handler) acts
        // as a backstop and will create the Payment row asynchronously,
        // so we treat any non-2xx here as a "syncing" condition instead
        // of a hard failure.
        try {
          const res = await fetch('/api/stripe/confirm-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentIntentId: paymentIntent.id,
              familyId,
              paymentDate,
              year,
              type,
              notes,
              paymentFrequency,
              savedPaymentMethodId:
                savedPaymentMethodId ||
                (saveCard && paymentIntent.payment_method ? 'will_be_saved' : undefined),
              memberId: memberId || undefined,
            }),
          })

          if (res.ok) {
            const data = await res.json().catch(() => ({}))
            if (data?.success) {
              onSuccess(paymentIntent.id, savedPaymentMethodId)
              return
            }
          } else {
            const errData = await res.json().catch(() => ({}))
            console.error('[stripe-form] confirm-payment failed AFTER successful charge', {
              status: res.status,
              err: errData?.error,
            })
          }
        } catch (confirmErr) {
          console.error('[stripe-form] confirm-payment network error AFTER successful charge', {
            err: confirmErr,
          })
        }
        // Stripe captured the funds; webhook will reconcile the ledger.
        // Surface this to the caller as success so the user isn't told
        // their payment failed when it actually went through.
        onSuccess(paymentIntent.id, savedPaymentMethodId)
        return
      } else {
        onError(`Payment status: ${paymentIntent?.status}`)
      }
    } catch (error: any) {
      onError(error.message || 'Payment processing failed')
    } finally {
      setProcessing(false)
    }
  }

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#424770',
        '::placeholder': {
          color: '#aab7c4',
        },
      },
      invalid: {
        color: '#9e2146',
      },
    },
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-app-subtle rounded-lg border border-border">
        <label className="block text-sm font-medium mb-2 text-fg">Card Details</label>
        <div className="p-3 border border-border rounded-lg bg-surface">
          <CardElement options={cardElementOptions} />
        </div>
      </div>

      <Button
        type="button"
        className="w-full"
        onClick={handleSubmit}
        disabled={!stripe || processing || !clientSecret}
        loading={processing}
      >
        {processing ? 'Processing…' : `Pay ${format(amount)}`}
      </Button>
    </div>
  )
}

export default function StripePaymentForm(props: StripePaymentFormProps) {
  // Pull the org's configured currency from context so Stripe Elements
  // shows the right symbol on the card sheet (₪, €, etc.) instead of
  // always defaulting to USD. We pass the raw lowercase code through —
  // Stripe accepts any ISO-4217 in lowercase. Falls back to `usd` for
  // anonymous mounts where the context hasn't loaded yet.
  const { currency } = useCurrency()
  const minorAmount = toMinorUnits(props.amount, currency || 'USD')
  const options: StripeElementsOptions = {
    mode: 'payment',
    amount: minorAmount,
    currency: (currency || 'usd').toLowerCase(),
  }

  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    return (
      <Alert variant="warning">
        Stripe is not configured. Please set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your environment
        variables.
      </Alert>
    )
  }

  return (
    <Elements stripe={getStripe()} options={options}>
      <PaymentForm {...props} />
    </Elements>
  )
}
