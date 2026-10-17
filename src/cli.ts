#!/usr/bin/env node
/**
 * @file cli.ts
 * @description Main command-line interface entry point for AutoRetrofit.
 * @usage Executed via `npx autoretofit <command>` (doctor, analyze, plan, generate, verify, retrofit).
 * @responsibilities Parses CLI arguments, loads configuration, orchestrates analysis/planning,
 *                   runs execution policies, invokes patch generators, and outputs Extent reports.
 */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexRepository } from './repository.js';
import { calculateFeasibility, createPlan } from './analysis.js';
import { providerFromEnv } from './ai.js';
import { runTargetedCommand, analyzeFailure } from './execution.js';
import { writeReport } from './report.js';
import { parseWorkflow } from './workflow.js';
import { generatePatch, writeIsolatedWorkspace, applyApprovedPatch } from './patch.js';
import { loadPrompts, promptText } from './prompts.js';
import { loadConfig } from './config.js';
import type { PatchProposal, RunReport } from './domain.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'doctor';

function available(name: string): boolean {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(lookup, [name], { stdio: 'ignore' }).status === 0;
}

async function loadDotEnv() {
  try {
    const text = await readFile('.env', 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* optional */
  }
}

function value(name: string, fallback = '') {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? fallback : fallback;
}

async function buildContext() {
  const root = resolve(value('--repo', '.'));
  const testFile = resolve(value('--test'));
  if (!value('--test')) throw new Error('--test is required');

  const format = value('--format');
  const framework = value('--framework');
  const autoCreateMissing = !args.includes('--no-auto-create');

  const rawInput = await readFile(testFile);
  const workflow = parseWorkflow(rawInput, testFile, format);
  const index = await indexRepository(root);
  const config = await loadConfig(root);
  const feasibility = calculateFeasibility(workflow, index.capabilities);

  const targetFramework = framework || index.framework.bddFramework || index.framework.testRunner;
  const plan = createPlan(workflow, index.capabilities, index.files, {
    doNotModifyCi: config.rules.do_not_modify_ci,
    autoCreateMissing,
    framework: targetFramework,
    language: index.framework.language,
    classes: index.classes
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../prompts'), resolve(here, '../../prompts'), resolve('prompts')];
  let prompts;
  let promptError: unknown;
  for (const candidate of candidates) {
    try {
      prompts = await loadPrompts(candidate);
      break;
    } catch (e) {
      promptError = e;
    }
  }
  if (!prompts) throw new Error(`Unable to load required bundled prompts: ${promptError instanceof Error ? promptError.message : String(promptError)}`);

  const selected = new Set([
    ...plan.mappings.filter(x => x.target).map(x => index.methods.find(m => `${m.className}.${m.name}` === x.target)?.file),
    ...index.files.filter(x => /stepdefinitions|\.spec\.|\.test\./i.test(x))
  ].filter((x): x is string => !!x));

  const relevantSources = [...selected].map(file => ({ file, source: index.sources[file] }));
  return { root, workflow, index, config, feasibility, plan, prompts, relevantSources, runId: `${Date.now()}-${basename(root)}` };
}

async function generatedPatch(context: Awaited<ReturnType<typeof buildContext>>): Promise<{ patch: PatchProposal; source: 'deterministic' | 'ai' | 'ai+validated' }> {
  const deterministic = generatePatch(context.index, context.workflow, context.plan);
  const providerMode = process.env.AUTORETROFIT_MODEL_PROVIDER ?? 'mock';
  if (providerMode === 'mock') return { patch: deterministic, source: 'deterministic' };

  const ai = await providerFromEnv(process.env).generate({
    task: 'patch-generation',
    context: { workflow: context.workflow, plan: context.plan, relevantSources: context.relevantSources },
    systemPrompt: promptText(context.prompts),
    expectedSchema: 'PatchProposal'
  });

  if (!('unifiedDiff' in ai.content) || ai.content.filesToCreate.length + ai.content.filesToModify.length === 0) {
    throw new Error('AI returned a validated but unusable patch proposal');
  }
  return { patch: ai.content, source: 'ai+validated' };
}

async function main() {
  await loadDotEnv();
  if (command === 'doctor') {
    const java = available('java');
    const maven = available(process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
    const node = available('node');
    const python = available('python') || available('python3');
    const ready = node;
    console.log(`AutoRetrofit Doctor\n\nNode.js       ✓\nGit           ${available('git') ? '✓' : '✗'}\nJava          ${java ? '✓' : '✗'}\nMaven         ${maven ? '✓' : '✗'}\nPython        ${python ? '✓' : '✗'}\nAI Provider   ${process.env.AUTORETROFIT_API_KEY ? '✓ configured' : '✓ mock/offline default'}\n\nStatus: ${ready ? 'READY' : 'EXECUTION_UNAVAILABLE'}`);
    return;
  }

  const context = await buildContext();

  const newMethods = context.plan.mappings.filter(m => m.action === 'NEW');
  if (newMethods.length > 0 && command !== 'analyze' && command !== 'plan') {
    for (const m of newMethods) {
      console.log(`[AutoRetrofit] Scaffolding missing method '${m.target}' for capability '${m.requirement}' matching framework structure.`);
    }
  }

  if (command === 'analyze') {
    console.log(JSON.stringify({
      runId: context.runId,
      framework: context.index.framework,
      classes: context.index.classes,
      behaviors: context.index.behaviors,
      capabilities: context.index.capabilities,
      workflow: context.workflow,
      feasibility: context.feasibility
    }, null, 2));
    return;
  }

  if (command === 'plan') {
    console.log(JSON.stringify({
      workflow: context.workflow,
      feasibility: context.feasibility,
      plan: context.plan
    }, null, 2));
    return;
  }

  const generated = await generatedPatch(context);
  if (command === 'generate') {
    console.log(generated.patch.unifiedDiff || 'No patch required.');
    return;
  }

  const isolated = join(tmpdir(), 'autoretofit', context.runId);
  await writeIsolatedWorkspace(context.index, generated.patch, isolated);
  if (args.includes('--apply')) await applyApprovedPatch(context.root, generated.patch);

  const execution = (command === 'verify' || command === 'retrofit')
    ? await runTargetedCommand(context.plan, isolated, args.includes('--approve-execution'))
    : undefined;

  const report: RunReport = {
    runId: context.runId,
    timestamp: new Date().toISOString(),
    workflow: context.workflow.title,
    repository: context.root,
    framework: context.index.framework,
    workflowAnalysis: context.workflow,
    feasibility: context.feasibility,
    plan: context.plan,
    patch: generated.patch,
    execution,
    failure: execution ? analyzeFailure(execution) : undefined,
    provenance: {
      mode: process.env.AUTORETROFIT_MODEL_PROVIDER ?? 'mock',
      promptVersion: context.prompts.version,
      model: process.env.AUTORETROFIT_MODEL ?? 'mock',
      generationSource: generated.source
    },
    evidenceStatus: execution?.status === 'PASS' ? 'EXECUTION-VERIFIED' : generated.source === 'deterministic' ? 'HEURISTIC' : 'AI-ASSISTED'
  };

  if (command === 'retrofit') {
    const output = await writeReport(context.root, report);
    console.log(`AutoRetrofit Extent Report: file:///${output.html.replaceAll('\\', '/')}\nSummary Report: file:///${output.markdown.replaceAll('\\', '/')}\nData Report: file:///${output.json.replaceAll('\\', '/')}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => {
  console.error(`AutoRetrofit error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
