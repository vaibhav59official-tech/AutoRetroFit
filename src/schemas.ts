/**
 * @file schemas.ts
 * @description Runtime schema validation for AI payloads and patch proposals.
 * @usage Called via `validatePatch(patch)` and `validateWorkflow(workflow)`.
 * @responsibilities Asserts schema shape, validates expected properties, and prevents malformed AI outputs from propagating.
 */
import type { Capability, Feasibility, FrameworkKnowledge, PatchProposal, Plan, WorkflowAnalysis, FailureAnalysis } from './domain.js';
export type FrameworkAnalysis = FrameworkKnowledge;
export type CapabilityMatch = { requirement: string; target?: string; action: 'REUSE' | 'NEW' | 'MANUAL_REVIEW'; confidence: number; evidence: string[] };
export type FeasibilityAnalysis = Feasibility;
export type AutomationPlan = Plan;
export type RepairProposal = { schemaVersion: 1; files: string[]; reason: string; confidence: number; };
export function validateWorkflow(value: unknown): asserts value is WorkflowAnalysis { const x = value as WorkflowAnalysis; if (!x || typeof x.title !== 'string' || !Array.isArray(x.steps) || x.steps.some(s => typeof s?.text !== 'string' || typeof s?.requiredCapability !== 'string')) throw new Error('Invalid WorkflowAnalysis schema'); }
export function validatePatch(value: unknown): asserts value is PatchProposal { const x = value as PatchProposal; if (!x || x.schemaVersion !== 1 || !Array.isArray(x.filesToCreate) || typeof x.unifiedDiff !== 'string' || !Array.isArray(x.dependenciesAdded)) throw new Error('Invalid PatchProposal schema'); for (const file of [...x.filesToCreate, ...x.filesToModify]) if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || !['create', 'modify', 'delete'].includes(file.action)) throw new Error('Invalid PatchFile schema'); }
export function validateCapabilityMatch(value: unknown): asserts value is CapabilityMatch { const x = value as CapabilityMatch; if (!x || typeof x.requirement !== 'string' || !['REUSE', 'NEW', 'MANUAL_REVIEW'].includes(x.action) || typeof x.confidence !== 'number' || !Array.isArray(x.evidence)) throw new Error('Invalid CapabilityMatch schema'); }
export function validateFrameworkAnalysis(value: unknown): asserts value is FrameworkAnalysis { const x = value as FrameworkAnalysis; if (!x || typeof x.language !== 'string' || typeof x.buildTool !== 'string' || !Array.isArray(x.evidence)) throw new Error('Invalid FrameworkAnalysis schema'); }
export function validateFeasibility(value: unknown): asserts value is Feasibility { const x = value as Feasibility; if (!x || typeof x.score !== 'number' || typeof x.recommendation !== 'string' || !Array.isArray(x.reasons)) throw new Error('Invalid FeasibilityAnalysis schema'); }
export function validateAutomationPlan(value: unknown): asserts value is AutomationPlan { const x = value as AutomationPlan; if (!x || !Array.isArray(x.mappings) || !Array.isArray(x.filesToCreate) || !Array.isArray(x.filesToModify)) throw new Error('Invalid AutomationPlan schema'); }
export function validateFailureAnalysis(value: unknown): asserts value is FailureAnalysis { const x = value as FailureAnalysis; if (!x || typeof x.category !== 'string' || typeof x.rootCause !== 'string' || !Array.isArray(x.evidence)) throw new Error('Invalid FailureAnalysis schema'); }
