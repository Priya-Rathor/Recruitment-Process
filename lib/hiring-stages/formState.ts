// =============================================================================
// Stored rows -> the shape the form component holds.
//
// A separate module because the conversion is needed by a SERVER component (the
// edit page) while the type it produces belongs to a CLIENT component. Putting
// it in HiringStages.tsx would drag "use client" into the server page's import
// graph; putting it in queries.ts would drag the Supabase client into the
// client bundle.
//
// The difference is small but load-bearing: the database stores
// `prompt_template` as nullable text, and a React <textarea> cannot hold null
// without becoming an uncontrolled input halfway through editing.
// =============================================================================
import { STAGES, type StageKey } from "@/lib/hiring-stages/catalog";
import { emptyStageConfig } from "@/lib/hiring-stages/config";
import type { JobHiringStage } from "@/lib/hiring-stages/queries";
import type { StageConfig } from "@/lib/hiring-stages/config";

export type StageFormState = {
  enabled: boolean;
  promptTemplate: string;
  config: StageConfig;
};

export type StagesFormState = Record<StageKey, StageFormState>;

export function stagesToFormState(rows: JobHiringStage[]): StagesFormState {
  const byKey = new Map(rows.map((row) => [row.stage_key, row]));

  return Object.fromEntries(
    STAGES.map((stage) => {
      const row = byKey.get(stage.key);
      return [
        stage.key,
        {
          enabled: row?.enabled ?? false,
          // null -> "" so the textarea stays controlled.
          promptTemplate: row?.prompt_template ?? "",
          config: row?.config ?? emptyStageConfig(stage.key),
        },
      ];
    })
  ) as StagesFormState;
}
