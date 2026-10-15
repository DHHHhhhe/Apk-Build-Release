import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { projectVariants, projects } from '../../../db/schema'
import type { ProjectRow, ProjectVariantRow } from '../../../db/schema'
import type { Project, ProjectVariant } from '../types'

export function parseJsonArray(raw: string | null): string[] {
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
    return []
  } catch {
    return []
  }
}

export function toVariantDto(row: ProjectVariantRow): ProjectVariant {
  return {
    name: row.name,
    flavor: row.flavor,
    buildType: row.buildType,
    source: row.source
  }
}

export function listVariants(projectId: string): ProjectVariant[] {
  const rows = db
    .select()
    .from(projectVariants)
    .where(eq(projectVariants.projectId, projectId))
    .all()
  return rows
    .map(toVariantDto)
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    appModule: row.appModule,
    alias: row.alias,
    selectedVariants: parseJsonArray(row.selectedVariants),
    variants: listVariants(row.id),
    variantsSource: row.variantsSource,
    variantsResolvedAt: row.variantsResolvedAt ? row.variantsResolvedAt.getTime() : null,
    limitations: parseJsonArray(row.variantsNotes),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  }
}

export function findProjectRow(projectId: string): ProjectRow | null {
  const row = db.select().from(projects).where(eq(projects.id, projectId)).get()
  return row ?? null
}
