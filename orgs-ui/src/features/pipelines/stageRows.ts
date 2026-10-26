import type {
  PipelineStage,
  PipelineStageDefinition,
} from "typespec/orgs/hiring/pipelines";
import {
  isPipelineName,
  maxPipelineStages,
} from "typespec/orgs/hiring/pipelines";
import type { StageKind } from "typespec/orgs/hiring/vocabulary";
import type { PipelineStageInput } from "typespec/orgs/openings/pipeline";

/**
 * One editable stage. `id` is set for a stage the server already holds; a
 * stage of an Opening's pipeline that is marked `removed` stays visible until
 * the pipeline is saved, so a refusal can be explained beside it.
 */
export interface StageRow {
  key: string;
  id?: string;
  name: string;
  kind: StageKind;
  removed?: boolean;
}

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `stage-row-${counter}`;
}

export function newRow(kind: StageKind = "review", name = ""): StageRow {
  return { key: nextKey(), name, kind };
}

export function rowsFromStages(stages: readonly PipelineStage[]): StageRow[] {
  return stages.map((stage) => ({
    key: stage.id,
    id: stage.id,
    name: stage.name,
    kind: stage.kind,
  }));
}

export function rowsFromDefinitions(
  stages: readonly PipelineStageDefinition[],
): StageRow[] {
  return stages.map((stage) => ({
    key: nextKey(),
    name: stage.name,
    kind: stage.kind,
  }));
}

export function keptRows(rows: readonly StageRow[]): StageRow[] {
  return rows.filter((row) => !row.removed);
}

/** Moves the row at `index` past the next kept row in `direction`. */
export function moveRow(
  rows: readonly StageRow[],
  index: number,
  direction: -1 | 1,
): StageRow[] {
  let target = index + direction;
  while (rows[target]?.removed) target += direction;
  if (rows[index] === undefined || rows[target] === undefined) return [...rows];
  const next = [...rows];
  const moved = next[index] as StageRow;
  next[index] = next[target] as StageRow;
  next[target] = moved;
  return next;
}

export function updateRow(
  rows: readonly StageRow[],
  index: number,
  change: Partial<Pick<StageRow, "name" | "kind" | "removed">>,
): StageRow[] {
  return rows.map((row, position) =>
    position === index ? { ...row, ...change } : row,
  );
}

/** Removes a new stage outright and marks a stored one for removal. */
export function removeRow(
  rows: readonly StageRow[],
  index: number,
): StageRow[] {
  const row = rows[index];
  if (row === undefined) return [...rows];
  return row.id === undefined
    ? rows.filter((_, position) => position !== index)
    : updateRow(rows, index, { removed: true });
}

export function sameRows(
  left: readonly StageRow[],
  right: readonly StageRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        row.id === other.id &&
        row.name === other.name &&
        row.kind === other.kind &&
        Boolean(row.removed) === Boolean(other.removed)
      );
    })
  );
}

export type StageRowsProblem = "none" | "empty" | "tooMany" | "name";

/** What keeps the kept rows from being saved, as a reason to show. */
export function rowsProblem(rows: readonly StageRow[]): StageRowsProblem {
  const kept = keptRows(rows);
  if (kept.length < 1) return "empty";
  if (kept.length > maxPipelineStages) return "tooMany";
  if (kept.some((row) => !isPipelineName(row.name.trim()))) return "name";
  return "none";
}

export function toDefinitions(
  rows: readonly StageRow[],
): PipelineStageDefinition[] {
  return keptRows(rows).map((row) => ({
    name: row.name.trim(),
    kind: row.kind,
  }));
}

export function toInputs(rows: readonly StageRow[]): PipelineStageInput[] {
  return keptRows(rows).map((row) => ({
    ...(row.id !== undefined && { id: row.id }),
    name: row.name.trim(),
    kind: row.kind,
  }));
}
