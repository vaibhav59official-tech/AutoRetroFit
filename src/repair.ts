/**
 * @file repair.ts
 * @description Bounded repair planner for test execution failures.
 * @usage Called via `planRepair(failure, patch, attempt, maxAttempts)`.
 * @responsibilities Bounds automated fix iterations, confines edits strictly to generated test files,
 *                   and stops cycles when evidence or confidence is insufficient.
 */
import type { FailureAnalysis, PatchProposal } from './domain.js';
export interface RepairPlan { attempt: number; maxAttempts: number; allowedFiles: string[]; reason: string; status: 'PROPOSED' | 'STOPPED'; }
export function planRepair(failure: FailureAnalysis | undefined, patch: PatchProposal, attempt: number, maxAttempts = 2): RepairPlan { const allowedFiles = patch.filesToCreate.map(x => x.path).concat(patch.filesToModify.map(x => x.path)); if (!failure || attempt >= maxAttempts || failure.confidence < 0.6) return { attempt, maxAttempts, allowedFiles, reason: 'Repair stopped because evidence is missing, confidence is low, or the attempt limit was reached.', status: 'STOPPED' }; return { attempt, maxAttempts, allowedFiles, reason: `${failure.category}: ${failure.recommendedAction}`, status: 'PROPOSED' }; }
