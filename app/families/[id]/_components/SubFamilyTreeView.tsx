'use client'

import Link from 'next/link'
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/outline'
import { Card } from '@/app/components/ui'

export interface FamilyTreeNode {
  _id: string
  name: string
  hebrewName?: string
  weddingDate?: string
  husbandFirstName?: string
  wifeFirstName?: string
  parentFamilyId?: string | null
  children: FamilyTreeNode[]
}

export interface FamilyTreeData {
  currentFamilyId: string
  breadcrumbs: Array<{ _id: string; name: string }>
  root: FamilyTreeNode
}

function TreeNode({
  node,
  currentFamilyId,
  depth,
}: {
  node: FamilyTreeNode
  currentFamilyId: string
  depth: number
}) {
  const isCurrent = node._id === currentFamilyId
  const subtitle = [node.husbandFirstName, node.wifeFirstName].filter(Boolean).join(' & ')
  const wedding = node.weddingDate ? new Date(node.weddingDate).toLocaleDateString() : null

  return (
    <li className="relative">
      <div
        className={`flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
          isCurrent
            ? 'border-accent bg-accent/10 shadow-sm'
            : 'border-border bg-surface hover:bg-fg/[0.03]'
        }`}
        style={{ marginLeft: depth > 0 ? `${depth * 1.25}rem` : 0 }}
      >
        {depth > 0 && (
          <span aria-hidden="true" className="absolute -left-3 top-5 h-px w-3 bg-border" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/families/${node._id}`}
              className={`font-medium hover:underline ${isCurrent ? 'text-accent' : 'text-fg'}`}
            >
              {node.name}
            </Link>
            {isCurrent && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                Current
              </span>
            )}
          </div>
          {node.hebrewName && (
            <p
              className="text-xs text-fg-muted"
              dir="rtl"
              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
            >
              {node.hebrewName}
            </p>
          )}
          {(subtitle || wedding) && (
            <p className="mt-0.5 text-xs text-fg-muted">
              {[subtitle, wedding].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="relative mt-2 space-y-2 border-l border-border pl-4">
          {node.children.map((child) => (
            <TreeNode
              key={child._id}
              node={child}
              currentFamilyId={currentFamilyId}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function SubFamilyTreeView({
  tree,
  loading,
}: {
  tree: FamilyTreeData | null
  loading: boolean
}) {
  if (loading) {
    return (
      <Card compact className="mb-6">
        <div className="flex items-center gap-3 py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-fg-muted">Loading household tree…</p>
        </div>
      </Card>
    )
  }

  if (!tree) return null

  return (
    <Card compact className="mb-6">
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-fg">Household tree</h4>
        <p className="mt-0.5 text-xs text-fg-muted">
          Parent and child families linked when members are promoted to their own household.
        </p>
      </div>

      {tree.breadcrumbs.length > 1 && (
        <nav aria-label="Household ancestry" className="mb-4 overflow-x-auto">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
            <li className="flex items-center gap-1">
              <HomeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Root</span>
            </li>
            {tree.breadcrumbs.map((crumb, idx) => (
              <li key={crumb._id} className="flex items-center gap-1">
                <ChevronRightIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                {idx === tree.breadcrumbs.length - 1 ? (
                  <span className="font-medium text-fg">{crumb.name}</span>
                ) : (
                  <Link
                    href={`/families/${crumb._id}`}
                    className="hover:text-accent hover:underline"
                  >
                    {crumb.name}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <ul className="space-y-2">
        <TreeNode node={tree.root} currentFamilyId={tree.currentFamilyId} depth={0} />
      </ul>
    </Card>
  )
}
