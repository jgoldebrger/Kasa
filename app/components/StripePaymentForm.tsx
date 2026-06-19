'use client'

import { useState, useEffect } from 'react'
import type { Stripe, StripeElementsOptions } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCurrency } from '@/lib/client/useCurrency'
import { toMinorUnits } from '@/lib/money'
import { Button, Alert } from '@/app/components/ui'

// Lazy-load @stripe/stripe-js so the Stripe SDK isn't bundled into the
// initial JS for users who never see a credit-card form. Promises are
// memoized per connected account (or platform) on first call.
const _stripePromises = new Map<string, Promise<Stripe | null>>()
function getStripeJs(stripeAccountId?: string): Promise<Stripe | null> {
  const cacheKey = stripeAccountId || '__platform__'
  let promise = _stripePromises.get(cacheKey)
  if (!promise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
    promise = import('@stripe/stripe-js').then((m) =>
      m.loadStripe(key, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined),
    )
    _stripePromises.set(cacheKey, promise)
  }
  return promise
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

type PaymentFormInnerProps = StripePaymentFormProps & {
  clientSecret: string
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
  clientSecret,
  onSuccess,
  onError,
}: PaymentFormInnerProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const { format } = useCurrency()

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
          }
        }

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
  const { amount, familyId, type, onError } = props
  const { currency } = useCurrency()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [connectAccountId, setConnectAccountId] = useState<string | undefined>()
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let requestId = 0
    const createPaymentIntent = async () => {
      const thisRequest = ++requestId
      setInitializing(true)
      setClientSecret(null)
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
          onError(errorData.error || `Server error: ${res.status} ${res.statusText}`)
          return
        }

        const data = await res.json()
        if (thisRequest !== requestId) return
        if (data.clientSecret) {
          setConnectAccountId(data.stripeAccountId || undefined)
          setClientSecret(data.clientSecret)
        } else {
          onError(data.error || 'Failed to create payment intent - no client secret returned')
        }
      } catch (error: any) {
        if (thisRequest !== requestId) return
        onError(error.message || 'Failed to initialize payment')
      } finally {
        if (thisRequest === requestId) setInitializing(false)
      }
    }

    if (amount > 0) {
      createPaymentIntent()
    } else {
      setInitializing(false)
    }
    return () => {
      requestId += 1
    }
  }, [amount, familyId, type, onError])

  const minorAmount = toMinorUnits(amount, currency || 'USD')
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

  if (initializing || !clientSecret) {
    return (
      <div className="py-6 text-center text-sm text-fg-muted">
        {initializing ? 'Preparing secure payment…' : 'Unable to start payment.'}
      </div>
    )
  }

  return (
    <Elements
      key={connectAccountId || 'platform'}
      stripe={getStripeJs(connectAccountId)}
      options={options}
    >
      <PaymentForm {...props} clientSecret={clientSecret} />
    </Elements>
  )
}
