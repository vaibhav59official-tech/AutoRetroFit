/**
 * @file analysis.ts
 * @description Automation feasibility scoring and patch plan generator.
 * @usage Called via `calculateFeasibility(workflow, capabilities)` and `createPlan(workflow, capabilities, files, options)`.
 * @responsibilities Computes automation readiness scores (0-100), matches required steps to existing methods,
 *                   plans implicit missing method scaffolding, and targets framework-specific test artifacts.
 */
import type { Capability, Feasibility, Plan, ReuseMapping, WorkflowAnalysis, Evidence, ClassRecord, WorkflowStep } from './domain.js';

const similarity = (r: string, c: Capability) => {
  const a = new Set(r.split('_')), b = new Set(c.name.split('_'));
  return [...a].filter(x => b.has(x)).length / Math.max(a.size, b.size, 1);
};

const equivalents: Record<string, string[]> = {
  LOGIN_AS_STUDENT: ['LOGIN'],
  OPEN_COURSE: ['OPEN_COURSE'],
  SELECT_MASTER_BATCH: ['SELECT_BATCH'],
  COMPLETE_PAYMENT: ['PAYMENT'],
  VERIFY_ORDER_STATUS_SUCCESS: ['ASSERTION']
};

function candidate(req: string, c: Capability) {
  return req === c.name || (equivalents[req] ?? []).includes(c.name) || similarity(req, c) >= .65;
}

export function calculateFeasibility(w: WorkflowAnalysis, cs: Capability[]): Feasibility {
  const required = [...new Set(w.steps.map(s => s.requiredCapability))];
  const human = w.steps.some(s => /feels intuitive|verbally|call the customer|subjective|human/i.test(s.text));
  const matched = required.filter(r => cs.some(c => candidate(r, c)));
  const coverage = required.length ? matched.length / required.length : 0;
  const confidence = matched.length ? matched.reduce((sum, r) => sum + Math.max(...cs.filter(c => candidate(r, c)).map(c => c.confidence)), 0) / matched.length : 0;
  const uncertainty = w.steps.some(s => /manual|human|external|email|phone|captcha|otp|account|credential/i.test(s.text));
  const score = Math.round(100 * coverage * confidence * (human ? .25 : uncertainty ? .75 : 1));
  return {
    score,
    recommendation: human ? 'PARTIAL_AUTOMATION' : coverage === 1 && confidence >= .9 ? 'AUTOMATE_WITH_MINOR_CHANGES' : coverage > 0 ? 'PARTIAL_AUTOMATION' : 'MANUAL_REVIEW_REQUIRED',
    reasons: [
      `Heuristic estimate: ${matched.length} of ${required.length} distinct requirements have candidates; candidate confidence ${Math.round(confidence * 100)}%.`,
      ...(uncertainty ? ['Test data or environmental dependencies may require setup.'] : []),
      ...(human ? ['Human-only or subjective interaction lowers estimated coverage.'] : [])
    ],
    requiredCapabilities: required,
    matchedCapabilities: matched,
    heuristic: true
  };
}

function canonicalMethodName(cap: string, lang = 'java'): string {
  const parts = cap.toLowerCase().split('_');
  if (lang === 'python') return parts.join('_');
  if (lang === 'csharp') return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  // Java / TypeScript / JavaScript camelCase
  return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function selectTargetClass(s: WorkflowStep, classes: ClassRecord[] = [], lang = 'java'): string {
  const intent = s.intent;
  if (classes.length) {
    if (intent === 'LOGIN') {
      const match = classes.find(c => /Login/i.test(c.name));
      if (match) return match.name;
    }
    if (intent === 'PAYMENT') {
      const match = classes.find(c => /Payment|Checkout/i.test(c.name));
      if (match) return match.name;
    }
    if (intent === 'NAVIGATE') {
      const match = classes.find(c => /Course|Home|Nav|Main/i.test(c.name));
      if (match) return match.name;
    }
    if (intent === 'ASSERTION') {
      const match = classes.find(c => /Validator|Assert|Status/i.test(c.name));
      if (match) return match.name;
    }
    const pageObj = classes.find(c => /Page/i.test(c.name));
    if (pageObj) return pageObj.name;
    return classes[0].name;
  }
  if (intent === 'LOGIN') return 'LoginPage';
  if (intent === 'PAYMENT') return 'PaymentPage';
  if (intent === 'NAVIGATE') return 'CoursePage';
  return 'WorkflowActions';
}

export function createPlan(
  w: WorkflowAnalysis,
  cs: Capability[],
  files: string[],
  options: {
    doNotModifyCi?: boolean;
    autoCreateMissing?: boolean;
    framework?: string;
    language?: string;
    classes?: ClassRecord[];
  } = {}
): Plan {
  const mappings: ReuseMapping[] = [];
  for (const s of w.steps) {
    if (mappings.some(m => m.requirement === s.requiredCapability)) continue;
    const matches = cs.filter(c => candidate(s.requiredCapability, c)).sort((a, b) => b.confidence - a.confidence);
    const best = matches[0];
    if (best) {
      mappings.push({
        requirement: s.requiredCapability,
        action: 'REUSE',
        target: best.methods[0],
        confidence: best.confidence,
        evidence: best.evidence
      });
    } else if (options.autoCreateMissing) {
      const targetClass = selectTargetClass(s, options.classes, options.language);
      const methodName = canonicalMethodName(s.requiredCapability, options.language);
      mappings.push({
        requirement: s.requiredCapability,
        action: 'NEW',
        target: `${targetClass}.${methodName}`,
        confidence: 0.85,
        evidence: [{
          reason: `Implicit method creation planned for ${s.requiredCapability} in ${targetClass} matching framework conventions`,
          files: [],
          confidence: 0.85,
          kind: 'heuristic'
        }]
      });
    } else {
      mappings.push({
        requirement: s.requiredCapability,
        action: 'MANUAL_REVIEW',
        target: undefined,
        confidence: 0.2,
        evidence: [{ reason: 'No repository capability evidence', files: [], confidence: 0.2, kind: 'heuristic' }]
      });
    }
  }

  const pending = mappings.some(m => m.action === 'MANUAL_REVIEW');
  const fw = options.framework?.toLowerCase() ?? '';
  const lang = options.language?.toLowerCase() ?? 'java';

  let filesToCreate: string[] = [];
  let targetedCommand: { executable: string; args: string[] } | undefined;

  if (fw === 'playwright' || (!fw && lang === 'typescript' && files.some(f => /playwright\.config/i.test(f)))) {
    const spec = 'tests/autoretrofit.spec.ts';
    filesToCreate = files.includes(spec) ? [] : [spec];
    targetedCommand = { executable: 'npx', args: ['playwright', 'test', 'tests/autoretrofit.spec.ts'] };
  } else if (fw === 'cypress' || (!fw && files.some(f => /cypress\.config/i.test(f)))) {
    const spec = 'cypress/e2e/autoretrofit.cy.ts';
    filesToCreate = files.includes(spec) ? [] : [spec];
    targetedCommand = { executable: 'npx', args: ['cypress', 'run', '--spec', spec] };
  } else if (fw === 'pytest' || (!fw && lang === 'python')) {
    const testPy = 'tests/test_autoretrofit.py';
    filesToCreate = files.includes(testPy) ? [] : [testPy];
    targetedCommand = { executable: 'pytest', args: ['-k', 'autoretrofit'] };
  } else if (fw === 'testng' || fw === 'junit') {
    const javaTest = 'src/test/java/tests/AutoRetrofitTest.java';
    filesToCreate = files.includes(javaTest) ? [] : [javaTest];
    targetedCommand = { executable: 'mvn', args: ['-q', 'test', '-Dtest=AutoRetrofitTest'] };
  } else {
    // Default: Cucumber Java BDD
    const feature = 'src/test/resources/features/autoretofit.feature';
    const steps = 'src/test/java/stepdefinitions/AutoRetrofitSteps.java';
    filesToCreate = files.includes(feature) ? [] : [feature, steps];
    targetedCommand = filesToCreate.length ? { executable: 'mvn', args: ['-q', 'test'] } : undefined;
  }

  const protectedFiles = options.doNotModifyCi === false ? [] : files.filter(f => /(^|\/)(pom.xml|jenkinsfile|\.github\/workflows\/)/i.test(f));
  return {
    mappings,
    filesToCreate,
    filesToModify: [],
    filesToDelete: [],
    filesNotToModify: protectedFiles,
    dependenciesAdded: [],
    estimatedLoc: filesToCreate.length ? mappings.length * 8 : 0,
    risk: pending ? 'HIGH' : 'MEDIUM',
    targetedCommand
  };
}
