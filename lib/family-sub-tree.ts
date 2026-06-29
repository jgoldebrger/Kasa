import { Types } from 'mongoose'
import { Family } from '@/lib/models'

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

export interface FamilyTreeResult {
  currentFamilyId: string
  breadcrumbs: Array<{ _id: string; name: string }>
  root: FamilyTreeNode
}

const TREE_SELECT = '_id name hebrewName weddingDate husbandFirstName wifeFirstName parentFamilyId'

type LeanFamilyRow = {
  _id: Types.ObjectId
  name?: string
  hebrewName?: string
  weddingDate?: Date
  husbandFirstName?: string
  wifeFirstName?: string
  parentFamilyId?: Types.ObjectId | null
}

function toNode(row: LeanFamilyRow): FamilyTreeNode {
  return {
    _id: String(row._id),
    name: row.name || 'Unnamed family',
    hebrewName: row.hebrewName || undefined,
    weddingDate: row.weddingDate ? new Date(row.weddingDate).toISOString() : undefined,
    husbandFirstName: row.husbandFirstName || undefined,
    wifeFirstName: row.wifeFirstName || undefined,
    parentFamilyId: row.parentFamilyId ? String(row.parentFamilyId) : null,
    children: [],
  }
}

/** Walk up `parentFamilyId` to find the root ancestor (cycle-safe). */
export async function findFamilyRoot(
  organizationId: string,
  familyId: string,
): Promise<{ rootId: string; breadcrumbs: Array<{ _id: string; name: string }> }> {
  const breadcrumbs: Array<{ _id: string; name: string }> = []
  const seen = new Set<string>()
  let currentId = familyId

  while (currentId) {
    if (seen.has(currentId)) break
    seen.add(currentId)

    const row = await Family.findOne({
      _id: currentId,
      organizationId,
    })
      .select(TREE_SELECT)
      .lean<LeanFamilyRow>()
    if (!row) break

    breadcrumbs.unshift({ _id: String(row._id), name: row.name || 'Unnamed family' })

    const parentId = row.parentFamilyId ? String(row.parentFamilyId) : null
    if (!parentId) break
    currentId = parentId
  }

  const rootId = breadcrumbs[0]?._id ?? familyId
  return { rootId, breadcrumbs }
}

/** Build a nested tree of all descendants under `rootId`. */
export async function buildFamilySubTree(
  organizationId: string,
  rootId: string,
): Promise<FamilyTreeNode> {
  const rootRow = await Family.findOne({ _id: rootId, organizationId })
    .select(TREE_SELECT)
    .lean<LeanFamilyRow>()
  if (!rootRow) {
    return { _id: rootId, name: 'Unknown family', children: [] }
  }

  const nodes = new Map<string, FamilyTreeNode>()
  const queue = [rootId]
  const visited = new Set<string>()

  nodes.set(rootId, toNode(rootRow))

  while (queue.length > 0) {
    const batch = queue.splice(0, 50)
    const children = await Family.find({
      organizationId,
      parentFamilyId: { $in: batch.map((id) => new Types.ObjectId(id)) },
    })
      .select(TREE_SELECT)
      .lean<LeanFamilyRow[]>()

    for (const child of children) {
      const childId = String(child._id)
      if (visited.has(childId)) continue
      visited.add(childId)
      nodes.set(childId, toNode(child))
      queue.push(childId)
    }
  }

  for (const node of nodes.values()) {
    node.children = []
  }

  for (const node of nodes.values()) {
    const parentId = node.parentFamilyId
    if (!parentId || parentId === node._id) continue
    const parent = nodes.get(parentId)
    if (parent) parent.children.push(node)
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
  }

  return nodes.get(rootId) ?? toNode(rootRow)
}

export async function fetchFamilyTree(
  organizationId: string,
  familyId: string,
): Promise<FamilyTreeResult | null> {
  const current = await Family.findOne({ _id: familyId, organizationId }).select('_id').lean()
  if (!current) return null

  const { rootId, breadcrumbs } = await findFamilyRoot(organizationId, familyId)
  const root = await buildFamilySubTree(organizationId, rootId)
  return { currentFamilyId: familyId, breadcrumbs, root }
}

/** True when `descendantId` is in the subtree rooted at `ancestorId`. */
export async function isFamilyDescendantOf(
  organizationId: string,
  ancestorId: string,
  descendantId: string,
): Promise<boolean> {
  if (ancestorId === descendantId) return true

  const seen = new Set<string>()
  let currentId: string | null = descendantId

  while (currentId) {
    if (currentId === ancestorId) return true
    if (seen.has(currentId)) break
    seen.add(currentId)

    const row: { parentFamilyId?: Types.ObjectId | null } | null = await Family.findOne({
      _id: currentId,
      organizationId,
    })
      .select('parentFamilyId')
      .lean()
    if (!row?.parentFamilyId) break
    currentId = String(row.parentFamilyId)
  }

  return false
}
