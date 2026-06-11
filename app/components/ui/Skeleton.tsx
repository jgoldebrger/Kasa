'use client'

import { CSSProperties } from 'react'

export interface SkeletonProps {
  /** Width — number (px) or any CSS length. Defaults to 100%. */
  w?: number | string
  /** Height — number (px) or any CSS length. Defaults to 16px. */
  h?: number | string
  /** Override border-radius. */
  radius?: number | string
  className?: string
  /** Render as inline-block (default) or block. */
  inline?: boolean
}

/**
 * Visual placeholder block with a subtle shimmer.
 * Use during data fetching instead of "Loading…" text.
 */
export function Skeleton({ w = '100%', h = 16, radius, className = '', inline = false }: SkeletonProps) {
  const style: CSSProperties = {
    width: typeof w === 'number' ? `${w}px` : w,
    height: typeof h === 'number' ? `${h}px` : h,
  }
  if (radius !== undefined) style.borderRadius = typeof radius === 'number' ? `${radius}px` : radius
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={`ui-skeleton ${inline ? 'inline-block' : 'block'} ${className}`}
      style={style}
    />
  )
}

/**
 * Stack of N skeleton rows — quick drop-in replacement for table loading.
 */
export function SkeletonRows({ count = 5, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} role="status" aria-label="Loading content">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} h={18} w={`${60 + ((i * 7) % 35)}%`} />
      ))}
    </div>
  )
}

/**
 * Card-shaped skeleton for grid/dashboard placeholders.
 */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`surface-card p-4 ${className}`}
      role="status"
      aria-label="Loading card"
    >
      <Skeleton h={14} w="35%" />
      <div className="mt-3">
        <Skeleton h={28} w="60%" />
      </div>
      <div className="mt-3">
        <Skeleton h={10} w="80%" />
      </div>
    </div>
  )
}
