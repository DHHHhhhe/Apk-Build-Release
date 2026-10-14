import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { projectVariants, projects } from '../../../db/schema'
import { parseJsonArray } from './mapper'
import type { ResolveVariantsOutcome } from './resolve-variants'

/**
 * 把解析结果写回库：变体全量替换 + 更新签名与提示。
 * 已经勾选但这次解析不到的变体（比如 flavor 被删了）要一并去掉，否则界面上会留下幽灵选项。
 */
export function persistVariants(projectId: string, outcome: ResolveVariantsOutcome): string[] {
  const variantNames = new Set(outcome.variants.map((variant) => variant.name))

  return db.transaction((tx) => {
    tx.delete(projectVariants).where(eq(projectVariants.projectId, projectId)).run()

    for (const variant of outcome.variants) {
      tx.insert(projectVariants)
        .values({
          id: randomUUID(),
          projectId,
          name: variant.name,
          flavor: variant.flavor,
          buildType: variant.buildType,
          source: variant.source
        })
        .run()
    }

    const current = tx
      .select({ selectedVariants: projects.selectedVariants })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()
    const keptSelection = parseJsonArray(current?.selectedVariants ?? null).filter((name) =>
      variantNames.has(name)
    )

    tx.update(projects)
      .set({
        appModule: outcome.appModule,
        variantsSource: outcome.source,
        variantsSignature: outcome.signature,
        variantsNotes: JSON.stringify(outcome.limitations),
        variantsResolvedAt: new Date(),
        selectedVariants: JSON.stringify(keptSelection)
      })
      .where(eq(projects.id, projectId))
      .run()

    return keptSelection
  })
}
