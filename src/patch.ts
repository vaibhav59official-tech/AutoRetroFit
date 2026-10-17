/**
 * @file patch.ts
 * @description Code patch proposal generator and safe workspace patch applier.
 * @usage Called via `generatePatch(index, workflow, plan)`, `writeIsolatedWorkspace()`, and `applyApprovedPatch()`.
 * @responsibilities Generates test suites matching target frameworks (Playwright, Cucumber, Cypress, PyTest, TestNG),
 *                   scaffolds missing method stubs in Page Objects, prevents path escapes, and applies approved diffs safely.
 */
import { cp, mkdir, readFile, realpath, writeFile, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ClassRecord, MethodRecord, PatchFile, PatchProposal, Plan, RepositoryIndex, WorkflowAnalysis } from './domain.js';

function method(index: RepositoryIndex, target: string, action = 'REUSE'): { m: MethodRecord; c: ClassRecord; isNew?: boolean } {
  const [cn, mn] = target.split('.');
  const existingM = index.methods.find(x => `${x.className}.${x.name}` === target);
  const existingC = index.classes.find(x => x.name === cn);

  if (action === 'NEW') {
    const c: ClassRecord = existingC ?? {
      file: `src/test/java/pages/${cn}.java`,
      packageName: 'pages',
      name: cn,
      line: 1,
      implements: [],
      annotations: [],
      constructors: []
    };
    const m: MethodRecord = existingM ?? {
      file: c.file,
      className: cn,
      name: mn,
      line: 1,
      annotations: [],
      calls: [],
      body: '',
      behaviors: [],
      parameters: [],
      returnType: 'void'
    };
    return { m, c, isNew: !existingM };
  }

  if (!existingM || !existingC) throw Error(`MANUAL_REVIEW_REQUIRED: missing source evidence for ${target}`);
  if (existingC.constructors.some(x => x.parameters.length)) throw Error(`MANUAL_REVIEW_REQUIRED: constructor for ${cn} requires dependencies`);
  return { m: existingM, c: existingC };
}

function javaName(s: string) { return s[0].toLowerCase() + s.slice(1); }
function keyword(w: WorkflowAnalysis, i: number) { if (w.steps[i]!.intent === 'ASSERTION') return 'Then'; return i === 0 ? 'Given' : 'And'; }

function generateMissingMethodStubs(index: RepositoryIndex, newMethods: { m: MethodRecord; c: ClassRecord }[]): PatchFile[] {
  const byClass = new Map<string, { c: ClassRecord; methods: MethodRecord[] }>();
  for (const item of newMethods) {
    if (!byClass.has(item.c.name)) byClass.set(item.c.name, { c: item.c, methods: [] });
    byClass.get(item.c.name)!.methods.push(item.m);
  }

  const patchFiles: PatchFile[] = [];
  for (const [, { c, methods }] of byClass) {
    const isJava = c.file.endsWith('.java');
    const isTs = /\.[jt]sx?$/.test(c.file);
    const isPy = c.file.endsWith('.py');
    const existingContent = index.sources[c.file];

    if (existingContent) {
      // Modify existing class file by appending stubs before the closing bracket / end
      let updated = existingContent;
      if (isJava || isTs) {
        const lastBrace = updated.lastIndexOf('}');
        const stubs = methods.map(m => `\n  // AutoRetrofit: Scaffolding new method matching framework conventions\n  public ${isTs ? 'async ' : ''}void ${m.name}() {\n    ${isJava ? 'throw new UnsupportedOperationException("TODO: Implement ' + m.name + '");' : '// TODO: Implement ' + m.name}\n  }\n`).join('');
        if (lastBrace >= 0) {
          updated = updated.slice(0, lastBrace) + stubs + updated.slice(lastBrace);
        } else {
          updated += stubs;
        }
      } else if (isPy) {
        const stubs = methods.map(m => `\n    def ${m.name}(self):\n        """AutoRetrofit: Scaffolding new method matching framework conventions"""\n        pass\n`).join('');
        updated += stubs;
      }
      patchFiles.push({ path: c.file, action: 'modify', content: updated });
    } else {
      // Create a brand new Page/Action class
      let content = '';
      if (isJava) {
        const stubs = methods.map(m => `  public void ${m.name}() {\n    throw new UnsupportedOperationException("TODO: Implement ${m.name}");\n  }`).join('\n\n');
        content = `package ${c.packageName || 'pages'};\n\npublic class ${c.name} {\n${stubs}\n}\n`;
      } else if (isTs) {
        const stubs = methods.map(m => `  async ${m.name}(): Promise<void> {\n    // TODO: Implement ${m.name}\n  }`).join('\n\n');
        content = `export class ${c.name} {\n${stubs}\n}\n`;
      } else if (isPy) {
        const stubs = methods.map(m => `    def ${m.name}(self):\n        """TODO: Implement ${m.name}"""\n        pass`).join('\n\n');
        content = `class ${c.name}:\n${stubs}\n`;
      }
      patchFiles.push({ path: c.file, action: 'create', content });
    }
  }
  return patchFiles;
}

function generatedCucumberJava(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan, infos: Map<string, ReturnType<typeof method>>): PatchFile[] {
  const unique = [...new Map([...infos].filter(([k]) => !k.startsWith('__')).map(([, v]) => [v.c.name, v])).values()];
  const imports = unique.map(v => `import ${v.c.packageName || 'pages'}.${v.c.name};`).join('\n');
  const fields = unique.map(v => `  private final ${v.c.name} ${javaName(v.c.name)} = new ${v.c.name}();`).join('\n');
  const lines = w.steps.map((s, i) => {
    const target = infos.get(s.requiredCapability)!;
    let call = `${javaName(target.c.name)}.${target.m.name}()`;
    if (target.m.parameters.length) {
      const src = infos.get(`__source_${s.requiredCapability}`)!;
      call = `${javaName(target.c.name)}.${target.m.name}(${javaName(src.c.name)}.${src.m.name}())`;
    }
    const ann = keyword(w, i);
    return `  @${ann}("${s.text.replaceAll('"', '\\"')}")\n  public void workflowStep${i + 1}() { ${call}; }`;
  }).join('\n\n');
  const cls = `package stepdefinitions;\n\n${imports}\nimport io.cucumber.java.en.*;\n\npublic final class AutoRetrofitSteps {\n${fields}\n\n${lines}\n}\n`;
  const feature = `Feature: ${w.title}\n\n  Scenario: ${w.title}\n${w.steps.map((s, i) => `    ${keyword(w, i)} ${s.text}`).join('\n')}\n`;
  return [
    { path: 'src/test/resources/features/autoretofit.feature', action: 'create', content: feature },
    { path: 'src/test/java/stepdefinitions/AutoRetrofitSteps.java', action: 'create', content: cls }
  ];
}

function generatedPlaywrightTs(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan, infos: Map<string, ReturnType<typeof method>>): PatchFile[] {
  const unique = [...new Map([...infos].filter(([k]) => !k.startsWith('__')).map(([, v]) => [v.c.name, v])).values()];
  const imports = unique.map(v => `import { ${v.c.name} } from '../pages/${v.c.name}.js';`).join('\n');
  const instantiations = unique.map(v => `  const ${javaName(v.c.name)} = new ${v.c.name}(page);`).join('\n');
  const calls = w.steps.map((s, i) => {
    const target = infos.get(s.requiredCapability)!;
    return `    // Step ${i + 1}: ${s.text}\n    await ${javaName(target.c.name)}.${target.m.name}();`;
  }).join('\n');
  const spec = `import { test, expect } from '@playwright/test';\n${imports}\n\ntest.describe('${w.title}', () => {\n  test('should execute ${w.title}', async ({ page }) => {\n${instantiations}\n\n${calls}\n  });\n});\n`;
  return [{ path: 'tests/autoretrofit.spec.ts', action: 'create', content: spec }];
}

function generatedCypressTs(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan, infos: Map<string, ReturnType<typeof method>>): PatchFile[] {
  const calls = w.steps.map((s, i) => {
    const target = infos.get(s.requiredCapability)!;
    return `    // Step ${i + 1}: ${s.text}\n    cy.log('${s.text}');`;
  }).join('\n');
  const spec = `describe('${w.title}', () => {\n  it('executes ${w.title}', () => {\n${calls}\n  });\n});\n`;
  return [{ path: 'cypress/e2e/autoretrofit.cy.ts', action: 'create', content: spec }];
}

function generatedPytest(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan, infos: Map<string, ReturnType<typeof method>>): PatchFile[] {
  const slug = w.title.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const calls = w.steps.map((s, i) => {
    const target = infos.get(s.requiredCapability)!;
    return `    # Step ${i + 1}: ${s.text}\n    ${javaName(target.c.name)}.${target.m.name}()`;
  }).join('\n');
  const content = `import pytest\n\ndef test_${slug}():\n    """${w.title}"""\n${calls}\n`;
  return [{ path: 'tests/test_autoretrofit.py', action: 'create', content }];
}

function generatedTestNgJava(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan, infos: Map<string, ReturnType<typeof method>>): PatchFile[] {
  const unique = [...new Map([...infos].filter(([k]) => !k.startsWith('__')).map(([, v]) => [v.c.name, v])).values()];
  const imports = unique.map(v => `import ${v.c.packageName || 'pages'}.${v.c.name};`).join('\n');
  const fields = unique.map(v => `  private final ${v.c.name} ${javaName(v.c.name)} = new ${v.c.name}();`).join('\n');
  const calls = w.steps.map((s, i) => {
    const target = infos.get(s.requiredCapability)!;
    return `    // Step ${i + 1}: ${s.text}\n    ${javaName(target.c.name)}.${target.m.name}();`;
  }).join('\n');
  const cls = `package tests;\n\nimport org.testng.annotations.Test;\n${imports}\n\npublic class AutoRetrofitTest {\n${fields}\n\n  @Test\n  public void testWorkflow() {\n${calls}\n  }\n}\n`;
  return [{ path: 'src/test/java/tests/AutoRetrofitTest.java', action: 'create', content: cls }];
}

function generated(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan): { filesToCreate: PatchFile[]; filesToModify: PatchFile[] } {
  if (p.mappings.some(x => (x.action !== 'REUSE' && x.action !== 'NEW') || !x.target)) {
    throw Error('MANUAL_REVIEW_REQUIRED: workflow has an unsupported or unmapped capability');
  }

  const infos = new Map<string, ReturnType<typeof method>>();
  const newlyCreated: { m: MethodRecord; c: ClassRecord }[] = [];

  for (const x of p.mappings) {
    const res = method(index, x.target!, x.action);
    infos.set(x.requirement, res);
    if (x.action === 'NEW' || res.isNew) {
      newlyCreated.push({ m: res.m, c: res.c });
    }
  }

  for (const [req, { m }] of infos) {
    if (m.parameters.length) {
      if (req !== 'VERIFY_ORDER_STATUS_SUCCESS' || m.parameters.length !== 1) {
        throw Error(`MANUAL_REVIEW_REQUIRED: cannot safely supply parameters to ${m.name}`);
      }
      const arg = m.parameters[0]!;
      const accessor = index.methods.find(a => a.parameters.length === 0 && a.returnType !== 'void' && a.returnType === arg.type && /status/i.test(a.name));
      if (!accessor) throw Error(`MANUAL_REVIEW_REQUIRED: no evidenced value source for ${arg.name}`);
      const c = index.classes.find(c => c.name === accessor.className)!;
      if (c.constructors.some(x => x.parameters.length)) throw Error(`MANUAL_REVIEW_REQUIRED: value source constructor requires dependencies`);
      infos.set(`__source_${req}`, { m: accessor, c });
    }
  }

  // Generate test files matching the targeted framework
  let testFiles: PatchFile[] = [];
  const filesToCreateList = p.filesToCreate;

  if (filesToCreateList.some(f => f.includes('tests/autoretrofit.spec.ts'))) {
    testFiles = generatedPlaywrightTs(index, w, p, infos);
  } else if (filesToCreateList.some(f => f.includes('cypress/e2e/autoretrofit.cy.ts'))) {
    testFiles = generatedCypressTs(index, w, p, infos);
  } else if (filesToCreateList.some(f => f.includes('tests/test_autoretrofit.py'))) {
    testFiles = generatedPytest(index, w, p, infos);
  } else if (filesToCreateList.some(f => f.includes('AutoRetrofitTest.java'))) {
    testFiles = generatedTestNgJava(index, w, p, infos);
  } else {
    // Default Cucumber Java
    testFiles = generatedCucumberJava(index, w, p, infos);
  }

  // Generate missing method stubs if any
  const stubPatches = generateMissingMethodStubs(index, newlyCreated);
  const filesToCreate = [...testFiles, ...stubPatches.filter(p => p.action === 'create')];
  const filesToModify = stubPatches.filter(p => p.action === 'modify');

  return { filesToCreate, filesToModify };
}

function diff(f: PatchFile) {
  if (f.action === 'create') {
    return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${f.path}\n${f.content.split(/\r?\n/).map(x => '+' + x).join('\n')}\n`;
  }
  return `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n@@ -1 +1 @@\n+${f.content.split(/\r?\n/).slice(-10).join('\n+')}\n`;
}

export function generatePatch(index: RepositoryIndex, w: WorkflowAnalysis, p: Plan): PatchProposal {
  const result = p.filesToCreate.length ? generated(index, w, p) : { filesToCreate: [], filesToModify: [] };
  const allFiles = [...result.filesToCreate, ...result.filesToModify];
  return {
    schemaVersion: 1,
    filesToCreate: result.filesToCreate,
    filesToModify: result.filesToModify,
    filesToDelete: [],
    unifiedDiff: allFiles.map(diff).join('\n'),
    estimatedLoc: allFiles.reduce((n, x) => n + x.content.split(/\r?\n/).length, 0),
    dependenciesAdded: [],
    risk: p.risk,
    reason: 'Generated directly from workflow steps and repository evidence.'
  };
}

function safe(root: string, candidate: string) {
  if (isAbsolute(candidate) || candidate.split(/[\\/]/).includes('..')) throw Error(`Unsafe generated path rejected: ${candidate}`);
  const base = resolve(root), target = resolve(base, candidate), rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Unsafe generated path rejected: ${candidate}`);
  return target;
}

async function ensureContained(root: string, target: string) {
  const base = await realpath(root);
  let current = dirname(target);
  while (current !== base && current.startsWith(base)) {
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink()) throw Error(`Unsafe generated path rejected: symlink ${current}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    current = dirname(current);
  }
  if (current !== base) throw Error('Unsafe generated path rejected: path escaped workspace');
}

async function apply(root: string, patch: PatchProposal) {
  for (const f of [...patch.filesToCreate, ...patch.filesToModify]) {
    const target = safe(root, f.path);
    await ensureContained(root, target);
    await mkdir(dirname(target), { recursive: true });
    if (f.action === 'create') await writeFile(target, f.content, { flag: 'w' });
    else if (f.action === 'modify') {
      try { await readFile(target); } catch { throw Error(`Cannot modify missing file: ${f.path}`); }
      await writeFile(target, f.content);
    } else throw Error(`Unsupported patch action: ${f.action}`);
  }
  for (const f of patch.filesToDelete) {
    const target = safe(root, f);
    await ensureContained(root, target);
    const { unlink } = await import('node:fs/promises');
    await unlink(target);
  }
}

export async function writeIsolatedWorkspace(index: RepositoryIndex, patch: PatchProposal, destination: string) {
  await mkdir(destination, { recursive: true });
  let ignore: string[] = [];
  try {
    ignore = (await readFile(join(index.root, '.gitignore'), 'utf8')).split(/\r?\n/).map(x => x.trim().replace(/^\//, '').replace(/\/$/, '')).filter(x => x && !x.startsWith('#') && !x.startsWith('!'));
  } catch { }
  await cp(index.root, destination, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const rel = relative(index.root, src).replaceAll('\\', '/'), parts = rel.split('/');
      if (parts.some(x => ['.git', 'node_modules', 'target', 'dist', '.autoretofit', '.env'].includes(x) || x.startsWith('.env.'))) return false;
      return !ignore.some(rule => parts.some(part => part === rule) || rel === rule || rel.startsWith(`${rule}/`));
    }
  });
  await apply(destination, patch);
  return destination;
}

export async function applyApprovedPatch(root: string, patch: PatchProposal) {
  await apply(root, patch);
}
