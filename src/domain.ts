/**
 * @file domain.ts
 * @description Core domain model interfaces and type definitions for AutoRetrofit.
 * @usage Imported across all modules for shared types (RepositoryIndex, WorkflowAnalysis, Plan, RunReport, etc.).
 * @responsibilities Defines data structures for framework detection, code indexing, test steps, feasibility,
 *                   patch proposals, and execution results.
 */
export type Recommendation = 'AUTOMATE_NOW' | 'AUTOMATE_WITH_MINOR_CHANGES' | 'PARTIAL_AUTOMATION' | 'MANUAL_REVIEW_REQUIRED' | 'KEEP_MANUAL';
export type EvidenceKind = 'method' | 'class' | 'annotation' | 'body' | 'usage' | 'heuristic';
export interface Evidence { reason: string; files: string[]; confidence: number; kind?: EvidenceKind; }
export interface FrameworkKnowledge { language: string; buildTool: string; uiFramework?: string; bddFramework?: string; testRunner?: string; architecturePattern: string; pageObjectPattern: boolean; serviceLayer: boolean; helperLayer: boolean; reporting: string[]; ciCd: string[]; commands: string[]; conventions: string[]; restrictions: string[]; evidence: Evidence[]; }
export interface ConstructorRecord { line: number; parameters: string[]; }
export interface ClassRecord { file: string; packageName: string; name: string; line: number; extends?: string; implements: string[]; annotations: string[]; constructors: ConstructorRecord[]; }
export interface BehaviorRecord { id: string; label: string; method: string; className: string; evidence: Evidence[]; }
export interface MethodRecord { file: string; className: string; name: string; line: number; annotations: string[]; calls: string[]; body: string; behaviors: string[]; parameters: { name: string; type: string }[]; returnType: string; }
export interface Capability { name: string; label: string; methods: string[]; confidence: number; evidence: Evidence[]; }
export interface RepositoryIndex { root: string; files: string[]; sources: Record<string, string>; classes: ClassRecord[]; methods: MethodRecord[]; behaviors: BehaviorRecord[]; framework: FrameworkKnowledge; capabilities: Capability[]; }
export interface WorkflowStep { text: string; intent: 'LOGIN' | 'NAVIGATE' | 'PAYMENT' | 'ASSERTION' | 'DATA' | 'UNKNOWN'; requiredCapability: string; }
export interface WorkflowAnalysis { title: string; steps: WorkflowStep[]; preconditions: string[]; expectedResults: string[]; source: 'heuristic' | 'ai-assisted'; }
export interface Feasibility { score: number; recommendation: Recommendation; reasons: string[]; requiredCapabilities: string[]; matchedCapabilities: string[]; heuristic: true; }
export interface ReuseMapping { requirement: string; action: 'REUSE' | 'NEW' | 'MANUAL_REVIEW'; target?: string; confidence: number; evidence: Evidence[]; }
export interface Plan { mappings: ReuseMapping[]; filesToCreate: string[]; filesToModify: string[]; filesToDelete: string[]; filesNotToModify: string[]; dependenciesAdded: string[]; estimatedLoc: number; risk: 'LOW' | 'MEDIUM' | 'HIGH'; targetedCommand?: { executable: string; args: string[] }; }
export interface PatchFile { path: string; content: string; action: 'create' | 'modify' | 'delete'; }
export interface PatchProposal { schemaVersion: 1; filesToCreate: PatchFile[]; filesToModify: PatchFile[]; filesToDelete: string[]; unifiedDiff: string; estimatedLoc: number; dependenciesAdded: string[]; risk: Plan['risk']; reason: string; }
export interface ExecutionResult { status: 'PASS' | 'FAIL' | 'SKIPPED' | 'MANUAL_REVIEW_REQUIRED'; command?: string; executable?: string; args?: string[]; exitCode?: number; durationMs?: number; output?: string; reason?: string; evidence?: string[]; }
export type FailureCategory = 'LOCATOR_FAILURE' | 'WAIT_FAILURE' | 'ASSERTION_FAILURE' | 'TEST_DATA_FAILURE' | 'ENVIRONMENT_FAILURE' | 'AUTH_FAILURE' | 'NETWORK_FAILURE' | 'DEPENDENCY_FAILURE' | 'FRAMEWORK_FAILURE' | 'APPLICATION_FAILURE' | 'AI_GENERATION_FAILURE' | 'UNKNOWN';
export interface FailureAnalysis { category: FailureCategory; rootCause: string; evidence: string[]; confidence: number; recommendedAction: string; }
export interface RunReport { runId: string; timestamp: string; workflow: string; repository: string; framework: FrameworkKnowledge; workflowAnalysis?: WorkflowAnalysis; feasibility: Feasibility; plan: Plan; patch?: PatchProposal; execution?: ExecutionResult; failure?: FailureAnalysis; provenance: { mode: string; promptVersion: string; model: string; generationSource: 'deterministic' | 'ai' | 'ai+validated'; }; evidenceStatus: 'HEURISTIC' | 'AI-ASSISTED' | 'EXECUTION-VERIFIED'; }
