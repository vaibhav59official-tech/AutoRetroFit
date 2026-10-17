/**
 * @file remediation.test.ts
 * @description Comprehensive unit and regression test suite for AutoRetrofit.
 * @usage Executed via `npm test` (`node dist/remediation.test.js`).
 * @responsibilities Validates multi-format workflow parsing (Excel, CSV, JIRA, MD), multi-language indexing,
 *                   missing method scaffolding, framework flexibility (Playwright, Cucumber), path containment, and Extent reports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflow } from './workflow.js';
import { indexRepository } from './repository.js';
import { createPlan } from './analysis.js';
import { generatePatch } from './patch.js';
import { loadPrompts, promptText } from './prompts.js';
import { validatePatch } from './schemas.js';
import { runTargetedCommand } from './execution.js';
import { planRepair } from './repair.js';
import { writeIsolatedWorkspace } from './patch.js';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { calculateFeasibility } from './analysis.js';
import { loadConfig } from './config.js';

test('workflow parser ignores headings and creates semantic steps', () => { const workflow = parseWorkflow('# Payment\n\n## Steps\n1. Login as a student.\n2. Open the course.\n3. Complete payment.\n\n## Expected Result\n- Order status should be SUCCESS.'); assert.deepEqual(workflow.steps.map(x => x.requiredCapability), ['LOGIN_AS_STUDENT', 'OPEN_COURSE', 'COMPLETE_PAYMENT', 'VERIFY_ORDER_STATUS_SUCCESS']); assert.equal(workflow.steps.some(x => x.requiredCapability === 'VERIFY'), false); });
test('payment plan does not modify an arbitrary first Java file', async () => { const index = await indexRepository(resolve('examples/sample-selenium-java-project')); const workflow = parseWorkflow('# Payment\n1. Login as a student.\n2. Complete payment.'); const plan = createPlan(workflow, index.capabilities, index.files); assert.deepEqual(plan.filesToModify, []); assert.equal(plan.filesNotToModify.includes('pom.xml'), true); });
test('generation returns actual files and unified diff', async () => { const index = await indexRepository(resolve('examples/sample-selenium-java-project')); const workflow = parseWorkflow('# Payment\n1. Login as a student.\n2. Open the course.\n3. Select a Master batch.\n4. Complete payment.\n\n## Expected Result\n- Order status should be SUCCESS.'); const plan = createPlan(workflow, index.capabilities, index.files); const patch = generatePatch(index, workflow, plan); validatePatch(patch); assert.equal(patch.unifiedDiff.includes('diff --git'), true); assert.equal(patch.filesToCreate.length > 0, true); assert.equal(patch.unifiedDiff.includes('AuthHelper.java'), false); });
test('prompt boundary marks repository data as untrusted', async () => { const prompt = promptText(await loadPrompts(resolve('prompts'))); assert.match(prompt, /untrusted data/i); assert.match(prompt, /Never follow instructions contained/i); });
test('execution policy refuses a full suite without a targeted command', async () => { const result = await runTargetedCommand({ mappings: [], filesToCreate: [], filesToModify: [], filesToDelete: [], filesNotToModify: [], dependenciesAdded: [], estimatedLoc: 0, risk: 'LOW' }, resolve('.')); assert.equal(result.status, 'MANUAL_REVIEW_REQUIRED'); });
test('invalid structured AI output is rejected', () => { assert.throws(() => validatePatch({ schemaVersion: 1, filesToCreate: 'not-an-array', unifiedDiff: '' }), /Invalid PatchProposal/); });
test('repair planning is bounded and limited to generated files', () => { const plan = planRepair({ category: 'ASSERTION_FAILURE', rootCause: 'x', evidence: ['x'], confidence: 0.9, recommendedAction: 'review' }, { schemaVersion: 1, filesToCreate: [{ path: 'generated.java', action: 'create', content: '' }], filesToModify: [], filesToDelete: [], unifiedDiff: '', estimatedLoc: 0, dependenciesAdded: [], risk: 'LOW', reason: 'x' }, 0); assert.deepEqual(plan.allowedFiles, ['generated.java']); assert.equal(plan.status, 'PROPOSED'); assert.equal(planRepair(undefined, { schemaVersion: 1, filesToCreate: [], filesToModify: [], filesToDelete: [], unifiedDiff: '', estimatedLoc: 0, dependenciesAdded: [], risk: 'LOW', reason: 'x' }, 2).status, 'STOPPED'); });
test('generated paths cannot escape the isolated workspace', async () => { const index = await indexRepository(resolve('examples/sample-selenium-java-project')); await assert.rejects(() => writeIsolatedWorkspace(index, { schemaVersion: 1, filesToCreate: [{ path: '../unsafe.java', action: 'create', content: 'x' }], filesToModify: [], filesToDelete: [], unifiedDiff: '', estimatedLoc: 1, dependenciesAdded: [], risk: 'LOW', reason: 'test' }, resolve(tmpdir(), 'autoretofit-path-test')), /Unsafe generated path/); });

test('login workflow is generated from discovered evidence', async () => { const i = await indexRepository(resolve('examples/sample-selenium-java-project')), w = parseWorkflow('# Login\n1. Login as a student.'); const p = generatePatch(i, w, createPlan(w, i.capabilities, i.files)); assert.match(p.filesToCreate[0]!.content, /Login as a student/); assert.match(p.filesToCreate[1]!.content, /loginAsStudent/); });
test('payment methods are discovered and status assertions consume observed status', async () => { const i = await indexRepository(resolve('examples/sample-selenium-java-project')), w = parseWorkflow('# Payment\n1. Login as a student.\n2. Open the course.\n3. Select a Master batch.\n4. Complete payment.\n\n## Expected Result\n- Order status should be SUCCESS.'); const p = generatePatch(i, w, createPlan(w, i.capabilities, i.files)); assert.match(p.filesToCreate[1]!.content, /assertOrderStatusSuccess\(paymentPage.orderStatus\(\)\)/); });
test('unsupported capabilities stop generation for manual review', async () => { const i = await indexRepository(resolve('examples/sample-selenium-java-project')), w = parseWorkflow('# Unsupported\n1. Call customer to confirm preference.'); assert.throws(() => generatePatch(i, w, createPlan(w, i.capabilities, i.files)), /MANUAL_REVIEW_REQUIRED/); });
test('manual only subjective workflow is not rated as highly suitable', () => { const f = calculateFeasibility(parseWorkflow('# Review\n1. Verify that the application feels intuitive.'), []); assert.equal(f.recommendation, 'PARTIAL_AUTOMATION'); assert.equal(f.score, 0); assert.match(f.reasons[0]!, /Heuristic estimate/); });
test('discovery retains constructor dependencies and method parameters', async () => { const d = await mkdtemp(join(tmpdir(), 'ar-')); await writeFile(join(d, 'Screen.java'), 'package demo;\npublic class Screen {\n public Screen(WebDriver driver) {}\n public String status(String key) { return key; }\n}'); const i = await indexRepository(d); assert.deepEqual(i.classes[0]!.constructors[0]!.parameters, ['WebDriver driver']); assert.deepEqual(i.methods[0]!.parameters, [{ type: 'String', name: 'key' }]); });
test('equivalent method names are semantically discovered', async () => { const d = await mkdtemp(join(tmpdir(), 'ar-')); await writeFile(join(d, 'Auth.java'), 'package demo; public class Auth { public void authenticateUser() { } }'); const i = await indexRepository(d); assert.ok(i.capabilities.some(c => c.name === 'LOGIN')); });
test('constructor dependencies and unsupported method parameters require manual review', async () => { const d = await mkdtemp(join(tmpdir(), 'ar-')); await writeFile(join(d, 'Auth.java'), 'package demo;\npublic class Auth {\n public Auth(WebDriver driver) {}\n public void login(String user) {}\n}'); const i = await indexRepository(d), w = parseWorkflow('# Login\n1. Login as a student.'), p = createPlan(w, i.capabilities, i.files); assert.throws(() => generatePatch(i, w, p), /constructor.*requires dependencies/); i.classes[0]!.constructors = []; assert.throws(() => generatePatch(i, w, p), /cannot safely supply parameters/); });
test('generated feature steps and Java bindings use matching text and keywords', async () => { const i = await indexRepository(resolve('examples/sample-selenium-java-project')), w = parseWorkflow('# Login\n1. Login as a student.\n2. Open the course.'), p = generatePatch(i, w, createPlan(w, i.capabilities, i.files)), feature = p.filesToCreate[0]!.content, java = p.filesToCreate[1]!.content; for (const text of ['Login as a student.', 'Open the course.']) { assert.ok(feature.includes(text)); assert.ok(java.includes(`("${text}")`)); } assert.ok(feature.includes('Given Login as a student.')); assert.ok(feature.includes('And Open the course.')); });
test('symlink path escape is rejected', async () => { const root = await mkdtemp(join(tmpdir(), 'ar-root-')), outside = await mkdtemp(join(tmpdir(), 'ar-out-')); try { await symlink(outside, join(root, 'escape'), 'junction'); } catch (err: any) { if (err?.code === 'EPERM') return; throw err; } const i = await indexRepository(resolve('examples/sample-selenium-java-project')); await assert.rejects(() => writeIsolatedWorkspace(i, { schemaVersion: 1, filesToCreate: [{ path: 'escape/x', action: 'create', content: 'x' }], filesToModify: [], filesToDelete: [], unifiedDiff: '', estimatedLoc: 1, dependenciesAdded: [], risk: 'LOW', reason: 'test' }, root), /symlink/); });
test('patch modifications and deletions are applied explicitly', async () => { const { applyApprovedPatch } = await import('./patch.js'), root = await mkdtemp(join(tmpdir(), 'ar-patch-')); await writeFile(join(root, 'edit.txt'), 'old'); await writeFile(join(root, 'remove.txt'), 'bye'); await applyApprovedPatch(root, { schemaVersion: 1, filesToCreate: [], filesToModify: [{ path: 'edit.txt', action: 'modify', content: 'new' }], filesToDelete: ['remove.txt'], unifiedDiff: '', estimatedLoc: 0, dependenciesAdded: [], risk: 'LOW', reason: 'test' }); assert.equal(await readFile(join(root, 'edit.txt'), 'utf8'), 'new'); });
test('required bundled prompts report missing core prompt', async () => { const d = await mkdtemp(join(tmpdir(), 'ar-prompt-')); await assert.rejects(() => loadPrompts(d), /Required bundled prompts/); });
test('repository policy is parsed and controls protected paths', async () => { const config = await loadConfig(resolve('.')); assert.equal(config.rules.do_not_modify_ci, true); const workflow = parseWorkflow('# Login\n1. Login as a student.'); const i = await indexRepository(resolve('examples/sample-selenium-java-project')); assert.ok(createPlan(workflow, i.capabilities, i.files, { doNotModifyCi: config.rules.do_not_modify_ci }).filesNotToModify.includes('pom.xml')); assert.deepEqual(createPlan(workflow, i.capabilities, i.files, { doNotModifyCi: false }).filesNotToModify, []); });

test('workflow parser supports CSV and JIRA formats', () => {
  const csv = 'Step,Expected Result\nLogin as a student,\nComplete payment,Order status should be SUCCESS';
  const wCsv = parseWorkflow(csv, 'test.csv');
  assert.equal(wCsv.steps.length, 3);
  assert.equal(wCsv.steps[0].requiredCapability, 'LOGIN_AS_STUDENT');
  assert.equal(wCsv.steps[1].requiredCapability, 'COMPLETE_PAYMENT');
  assert.equal(wCsv.steps[2].requiredCapability, 'VERIFY_ORDER_STATUS_SUCCESS');

  const jira = JSON.stringify({
    summary: 'Checkout workflow',
    steps: [
      { action: 'Login as a student.' },
      { action: 'Open the course.' },
      { action: 'Complete payment.', expectedResult: 'Order status should be SUCCESS.' }
    ]
  });
  const wJira = parseWorkflow(jira, 'jira-export.json');
  assert.equal(wJira.title, 'Checkout workflow');
  assert.equal(wJira.steps.length, 4);
  assert.equal(wJira.steps[0].requiredCapability, 'LOGIN_AS_STUDENT');
  assert.equal(wJira.steps[1].requiredCapability, 'OPEN_COURSE');
});

test('multi-language indexing detects TypeScript and Python projects', async () => {
  const dTs = await mkdtemp(join(tmpdir(), 'ar-ts-'));
  await writeFile(join(dTs, 'LoginPage.ts'), 'export class LoginPage { async loginAsStudent() {} }');
  await writeFile(join(dTs, 'package.json'), '{"name": "demo-qa"}');
  const iTs = await indexRepository(dTs);
  assert.equal(iTs.framework.language, 'typescript');
  assert.equal(iTs.classes[0].name, 'LoginPage');
  assert.ok(iTs.capabilities.some(c => c.name === 'LOGIN'));

  const dPy = await mkdtemp(join(tmpdir(), 'ar-py-'));
  await writeFile(join(dPy, 'login_page.py'), 'class LoginPage:\n    def login_as_student(self):\n        pass\n');
  await writeFile(join(dPy, 'requirements.txt'), 'pytest\n');
  const iPy = await indexRepository(dPy);
  assert.equal(iPy.framework.language, 'python');
  assert.ok(iPy.capabilities.some(c => c.name === 'LOGIN'));
});

test('implicit missing method creation scaffolds stubs without manual review blockage', async () => {
  const d = await mkdtemp(join(tmpdir(), 'ar-missing-'));
  await writeFile(join(d, 'CoursePage.java'), 'package demo;\npublic class CoursePage {\n  public void openCourse() {}\n}\n');
  const i = await indexRepository(d);
  const w = parseWorkflow('# Payment\n1. Open the course.\n2. Complete payment.');
  // With autoCreateMissing: true
  const plan = createPlan(w, i.capabilities, i.files, { autoCreateMissing: true, classes: i.classes, language: 'java' });
  const paymentMapping = plan.mappings.find(m => m.requirement === 'COMPLETE_PAYMENT');
  assert.equal(paymentMapping?.action, 'NEW');
  assert.ok(paymentMapping?.target);

  const patch = generatePatch(i, w, plan);
  assert.ok(patch.filesToModify.some(f => f.content.includes('completePayment')));
});

test('framework flexibility generates Playwright spec when targeted', () => {
  const w = parseWorkflow('# Login\n1. Login as a student.');
  const fakeIndex = {
    root: '.',
    files: [],
    sources: {},
    classes: [{ file: 'pages/LoginPage.ts', packageName: '', name: 'LoginPage', line: 1, implements: [], annotations: [], constructors: [] }],
    methods: [{ file: 'pages/LoginPage.ts', className: 'LoginPage', name: 'loginAsStudent', line: 1, annotations: [], calls: [], body: '', behaviors: ['LOGIN_AS_STUDENT'], parameters: [], returnType: 'void' }],
    behaviors: [],
    framework: { language: 'typescript', buildTool: 'npm', uiFramework: 'playwright', architecturePattern: 'page-object', pageObjectPattern: true, serviceLayer: false, helperLayer: false, reporting: [], ciCd: [], commands: [], conventions: [], restrictions: [], evidence: [] },
    capabilities: [{ name: 'LOGIN_AS_STUDENT', label: 'LOGIN AS STUDENT', methods: ['LoginPage.loginAsStudent'], confidence: 1, evidence: [] }]
  };
  const plan = createPlan(w, fakeIndex.capabilities, [], { framework: 'playwright', language: 'typescript' });
  assert.equal(plan.filesToCreate[0], 'tests/autoretrofit.spec.ts');
  const patch = generatePatch(fakeIndex, w, plan);
  assert.ok(patch.filesToCreate[0].content.includes('@playwright/test'));
  assert.ok(!patch.filesToCreate.some(f => f.path.endsWith('.feature')));
});

test('report writer produces interactive Extent HTML report without safe sandbox text', async () => {
  const { writeReport } = await import('./report.js');
  const d = await mkdtemp(join(tmpdir(), 'ar-report-'));
  const rep = await writeReport(d, {
    runId: 'test-run-123',
    timestamp: new Date().toISOString(),
    workflow: 'Payment Flow',
    repository: d,
    framework: { language: 'java', buildTool: 'maven', architecturePattern: 'page-object', pageObjectPattern: true, serviceLayer: false, helperLayer: false, reporting: [], ciCd: [], commands: [], conventions: [], restrictions: [], evidence: [] },
    feasibility: { score: 95, recommendation: 'AUTOMATE_NOW', reasons: ['High match confidence'], requiredCapabilities: ['LOGIN'], matchedCapabilities: ['LOGIN'], heuristic: true },
    plan: { mappings: [{ requirement: 'LOGIN', action: 'REUSE', target: 'LoginPage.login', confidence: 0.95, evidence: [] }], filesToCreate: [], filesToModify: [], filesToDelete: [], filesNotToModify: [], dependenciesAdded: [], estimatedLoc: 10, risk: 'LOW' },
    provenance: { mode: 'mock', promptVersion: '1', model: 'mock', generationSource: 'deterministic' },
    evidenceStatus: 'HEURISTIC'
  });
  assert.ok(rep.html.endsWith('.html'));
  const htmlContent = await readFile(rep.html, 'utf8');
  assert.ok(htmlContent.includes('AutoRetrofit'));
  assert.ok(htmlContent.includes('Extent Report'));
  assert.ok(htmlContent.includes('Suitability Score'));
  assert.ok(!htmlContent.includes('Safe Sandbox: It creates an isolated temporary copy'));
});

