/**
 * @file config.ts
 * @description Configuration file loader for `.autoretofit.yaml`.
 * @usage Called via `loadConfig(root)` during context initialization.
 * @responsibilities Reads project-level rules, CI protection flags, and overrides from `.autoretofit.yaml`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface AutoRetrofitConfig {
    framework?: { language?: string; build?: string };
    ui?: { framework?: string };
    bdd?: { framework?: string };
    runner?: { framework?: string };
    rules: {
        no_new_dependencies: boolean;
        minimal_diff: boolean;
        do_not_modify_ci: boolean;
    };
}

const defaults: AutoRetrofitConfig = {
    rules: {
        no_new_dependencies: true,
        minimal_diff: true,
        do_not_modify_ci: true
    }
};

function booleanRule(
    raw: Record<string, unknown>,
    nested: Record<string, unknown>,
    kebab: string,
    snake: keyof AutoRetrofitConfig['rules'],
    fallback: boolean
): boolean {
    const value = nested[snake] ?? raw[kebab] ?? raw[snake];
    return typeof value === 'boolean' ? value : fallback;
}

export async function loadConfig(root: string): Promise<AutoRetrofitConfig> {
    try {
        const raw = parse(await readFile(join(root, '.autoretofit.yaml'), 'utf8')) as Record<string, unknown>;
        const rules = (raw.rules ?? {}) as Record<string, unknown>;
        const framework = (raw.framework ?? {}) as Record<string, unknown>;
        const ui = (raw.ui ?? {}) as Record<string, unknown>;
        const bdd = (raw.bdd ?? {}) as Record<string, unknown>;
        const runner = (raw.runner ?? {}) as Record<string, unknown>;

        return {
            framework: {
                language: String(raw.language ?? framework.language ?? ''),
                build: String(raw.build ?? framework.build ?? '')
            },
            ui: { framework: String(raw.ui && typeof raw.ui === 'string' ? raw.ui : ui.framework ?? '') },
            bdd: { framework: String(raw.bdd && typeof raw.bdd === 'string' ? raw.bdd : bdd.framework ?? '') },
            runner: { framework: String(raw.runner && typeof raw.runner === 'string' ? raw.runner : runner.framework ?? '') },
            rules: {
                no_new_dependencies: booleanRule(raw, rules, 'no-new-dependencies', 'no_new_dependencies', defaults.rules.no_new_dependencies),
                minimal_diff: booleanRule(raw, rules, 'minimal-diff', 'minimal_diff', defaults.rules.minimal_diff),
                do_not_modify_ci: booleanRule(raw, rules, 'do-not-modify-ci', 'do_not_modify_ci', defaults.rules.do_not_modify_ci)
            }
        };
    } catch {
        return defaults;
    }
}
