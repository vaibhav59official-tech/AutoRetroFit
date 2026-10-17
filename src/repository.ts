/**
 * @file repository.ts
 * @description Multi-language repository scanner and capability indexer.
 * @usage Called via `indexRepository(root)` to index classes, methods, and framework conventions.
 * @responsibilities Scans source files (Java, TypeScript, JavaScript, Python, C#), extracts AST/syntax
 *                   records (classes, methods, parameters), detects framework/build tools, and builds semantic capabilities.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BehaviorRecord, Capability, ClassRecord, ConstructorRecord, Evidence, FrameworkKnowledge, MethodRecord, RepositoryIndex } from './domain.js';

const ignored = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.autoretofit', '.env', '__pycache__', '.pytest_cache', '.next', 'bin', 'obj']);

async function files(root: string, dir = root): Promise<string[]> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    const children = await Promise.all(entries.map(async entry => {
        if (ignored.has(entry.name) || entry.name.startsWith('.env') || entry.isSymbolicLink()) return [];
        const path = join(dir, entry.name);
        return entry.isDirectory() ? files(root, path) : [relative(root, path).replaceAll('\\', '/')];
    }));
    return children.flat();
}

export function behavior(name: string): string | undefined {
    const n = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    if (/LOGIN|AUTHENTICAT|SIGN_IN/.test(n)) return 'LOGIN';
    if (/OPEN.*COURSE|NAVIGAT.*COURSE/.test(n)) return 'OPEN_COURSE';
    if (/SELECT.*BATCH/.test(n)) return 'SELECT_BATCH';
    if (/PAYMENT|PAY|CHECKOUT/.test(n)) return 'PAYMENT';
    if (/ASSERT|VERIFY|CHECK/.test(n)) return 'ASSERTION';
    return undefined;
}

// Java scanner
function extractJava(file: string, text: string): { classes: ClassRecord[]; methods: MethodRecord[] } {
    const lines = text.split(/\r?\n/), pkg = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? '', cm = text.match(/\bclass\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w, ]+))?/), name = cm?.[1] ?? file.split('/').pop()!.replace('.java', ''), at = cm ? text.slice(0, text.indexOf(cm[0])).split(/\r?\n/).length : 1;
    const cr = new RegExp(`(?:public|protected|private)\\s+${name}\\s*\\(([^)]*)\\)`).exec(text), constructors: ConstructorRecord[] = cr ? [{ line: text.slice(0, text.indexOf(cr[0])).split(/\r?\n/).length, parameters: cr[1].trim() ? cr[1].split(',').map(x => x.trim()) : [] }] : [];
    const classes: ClassRecord[] = cm ? [{ file, packageName: pkg, name, line: at, extends: cm[2], implements: cm[3]?.split(',').map(x => x.trim()) ?? [], annotations: lines.slice(0, at).filter(x => x.trim().startsWith('@')).map(x => x.trim()), constructors }] : [];
    const methods: MethodRecord[] = []; const re = /(?:public|protected|private)?\s*(?:static\s+)?([\w<>?,.\[\]]+)\s+(\w+)\s*\(([^;{}]*)\)\s*\{/;
    lines.forEach((line, i) => {
        const m = re.exec(line);
        if (!m || m[2] === name) return;
        let depth = 0, end = i;
        for (; end < lines.length; end++) {
            for (const c of lines[end]) {
                if (c === '{') depth++;
                if (c === '}') depth--;
            }
            if (depth === 0) break;
        }
        const raw = m[3].trim(), params = raw ? raw.split(',').map(p => {
            const a = p.trim().split(/\s+/);
            return { type: a.slice(0, -1).join(' '), name: a.at(-1) ?? '' };
        }) : [];
        const body = lines.slice(i, end + 1).join('\n'), id = behavior(m[2]);
        methods.push({ file, className: name, name: m[2], line: i + 1, annotations: lines.slice(Math.max(0, i - 3), i).filter(x => x.trim().startsWith('@')).map(x => x.trim()), calls: [...body.matchAll(/(\w+)\s*\(/g)].map(x => x[1]).filter(x => x !== m[2]), body, behaviors: id ? [id] : [], parameters: params, returnType: m[1] });
    });
    return { classes, methods };
}

// TypeScript / JavaScript scanner
function extractTypeScript(file: string, text: string): { classes: ClassRecord[]; methods: MethodRecord[] } {
    const lines = text.split(/\r?\n/);
    const fileName = file.split('/').pop()!.replace(/\.[jt]sx?$/, '');
    const classMatch = text.match(/\bclass\s+(\w+)(?:\s+extends\s+(\w+))?/);
    const className = classMatch?.[1] ?? fileName;
    const at = classMatch ? text.slice(0, text.indexOf(classMatch[0])).split(/\r?\n/).length : 1;

    const ctorMatch = text.match(/constructor\s*\(([^)]*)\)/);
    const constructors: ConstructorRecord[] = ctorMatch ? [{
        line: text.slice(0, text.indexOf(ctorMatch[0])).split(/\r?\n/).length,
        parameters: ctorMatch[1].trim() ? ctorMatch[1].split(',').map(x => x.trim()) : []
    }] : [];

    const classes: ClassRecord[] = [{
        file,
        packageName: '',
        name: className,
        line: at,
        extends: classMatch?.[2],
        implements: [],
        annotations: [],
        constructors
    }];

    const methods: MethodRecord[] = [];
    // Match method definitions or exported functions
    const methodRe = /(?:(?:public|private|protected|async|static)\s+)*(\w+)\s*\(([^)]*)\)(?::\s*([\w<>[\]]+))?\s*\{/g;
    let match;
    while ((match = methodRe.exec(text)) !== null) {
        const mName = match[1];
        if (mName === 'constructor' || mName === 'if' || mName === 'for' || mName === 'while' || mName === 'switch' || mName === 'catch') continue;
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        const rawParams = match[2].trim();
        const params = rawParams ? rawParams.split(',').map(p => {
            const parts = p.trim().split(':');
            return { name: parts[0].trim(), type: parts[1]?.trim() ?? 'any' };
        }) : [];
        const id = behavior(mName);
        methods.push({
            file,
            className,
            name: mName,
            line,
            annotations: [],
            calls: [],
            body: '',
            behaviors: id ? [id] : [],
            parameters: params,
            returnType: match[3]?.trim() ?? 'void'
        });
    }
    return { classes, methods };
}

// Python scanner
function extractPython(file: string, text: string): { classes: ClassRecord[]; methods: MethodRecord[] } {
    const lines = text.split(/\r?\n/);
    const fileName = file.split('/').pop()!.replace(/\.py$/, '');
    const classMatch = text.match(/\bclass\s+(\w+)(?:\(([^)]*)\))?:/);
    const className = classMatch?.[1] ?? fileName;
    const at = classMatch ? text.slice(0, text.indexOf(classMatch[0])).split(/\r?\n/).length : 1;

    const classes: ClassRecord[] = [{
        file,
        packageName: '',
        name: className,
        line: at,
        extends: classMatch?.[2]?.trim(),
        implements: [],
        annotations: [],
        constructors: []
    }];

    const methods: MethodRecord[] = [];
    const funcRe = /^\s*def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([\w[\]]+))?:/gm;
    let match;
    while ((match = funcRe.exec(text)) !== null) {
        const mName = match[1];
        if (mName === '__init__') continue;
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        const rawParams = match[2].trim();
        const params = rawParams ? rawParams.split(',')
            .map(p => p.trim())
            .filter(p => p !== 'self' && p !== 'cls')
            .map(p => {
                const parts = p.split(':');
                return { name: parts[0].trim(), type: parts[1]?.trim() ?? 'Any' };
            }) : [];
        const id = behavior(mName);
        methods.push({
            file,
            className,
            name: mName,
            line,
            annotations: [],
            calls: [],
            body: '',
            behaviors: id ? [id] : [],
            parameters: params,
            returnType: match[3]?.trim() ?? 'None'
        });
    }
    return { classes, methods };
}

// C# scanner
function extractCSharp(file: string, text: string): { classes: ClassRecord[]; methods: MethodRecord[] } {
    const lines = text.split(/\r?\n/);
    const cm = text.match(/\bclass\s+(\w+)(?:\s*:\s*([\w, ]+))?/);
    const name = cm?.[1] ?? file.split('/').pop()!.replace('.cs', '');
    const at = cm ? text.slice(0, text.indexOf(cm[0])).split(/\r?\n/).length : 1;
    const classes: ClassRecord[] = [{
        file,
        packageName: text.match(/^\s*namespace\s+([\w.]+)/m)?.[1] ?? '',
        name,
        line: at,
        extends: cm?.[2]?.split(',')[0]?.trim(),
        implements: cm?.[2]?.split(',').slice(1).map(x => x.trim()) ?? [],
        annotations: [],
        constructors: []
    }];
    const methods: MethodRecord[] = [];
    const re = /(?:public|protected|private)?\s*(?:static\s+|async\s+)?([\w<>?,.\[\]]+)\s+(\w+)\s*\(([^;{}]*)\)\s*\{/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m[2] === name) continue;
        const line = text.slice(0, m.index).split(/\r?\n/).length;
        const raw = m[3].trim();
        const params = raw ? raw.split(',').map(p => {
            const a = p.trim().split(/\s+/);
            return { type: a.slice(0, -1).join(' '), name: a.at(-1) ?? '' };
        }) : [];
        const id = behavior(m[2]);
        methods.push({
            file,
            className: name,
            name: m[2],
            line,
            annotations: [],
            calls: [],
            body: '',
            behaviors: id ? [id] : [],
            parameters: params,
            returnType: m[1]
        });
    }
    return { classes, methods };
}

function extract(file: string, text: string): { classes: ClassRecord[]; methods: MethodRecord[] } {
    if (file.endsWith('.java')) return extractJava(file, text);
    if (/\.[jt]sx?$/.test(file)) return extractTypeScript(file, text);
    if (file.endsWith('.py')) return extractPython(file, text);
    if (file.endsWith('.cs')) return extractCSharp(file, text);
    return { classes: [], methods: [] };
}

function detect(texts: Map<string, string>): FrameworkKnowledge {
    const all = [...texts.values()].join('\n'), names = [...texts.keys()];
    const java = names.some(x => x.endsWith('.java'));
    const ts = names.some(x => /\.[jt]sx?$/.test(x));
    const python = names.some(x => x.endsWith('.py'));
    const csharp = names.some(x => x.endsWith('.cs'));

    const maven = names.includes('pom.xml');
    const gradle = names.some(x => x.includes('build.gradle'));
    const npm = names.includes('package.json');
    const pip = names.includes('requirements.txt') || names.includes('pyproject.toml');
    const dotnet = names.some(x => x.endsWith('.csproj') || x.endsWith('.sln'));

    const selenium = /selenium|WebDriver|org\.openqa/.test(all);
    const playwright = /@playwright\/test|playwright/i.test(all) || names.some(x => /playwright\.config/i.test(x));
    const cypress = /cypress/i.test(all) || names.some(x => /cypress\.config/i.test(x));
    const cucumber = /cucumber|@Given|@When|@Then/i.test(all);
    const pytest = /pytest/i.test(all) || names.some(x => /pytest\.ini|conftest\.py/i.test(x));
    const testng = /org\.testng/i.test(all);
    const jest = /jest/i.test(all);

    let language = 'unknown';
    if (java) language = 'java';
    else if (ts) language = names.some(x => /\.tsx?$/.test(x)) ? 'typescript' : 'javascript';
    else if (python) language = 'python';
    else if (csharp) language = 'csharp';

    let buildTool = 'unknown';
    if (maven) buildTool = 'maven';
    else if (gradle) buildTool = 'gradle';
    else if (npm) buildTool = 'npm';
    else if (pip) buildTool = 'pip';
    else if (dotnet) buildTool = 'dotnet';

    let bddFramework: string | undefined;
    if (cucumber) bddFramework = 'cucumber';
    else if (pytest && /pytest.*bdd/i.test(all)) bddFramework = 'pytest-bdd';

    let uiFramework: string | undefined;
    if (playwright) uiFramework = 'playwright';
    else if (cypress) uiFramework = 'cypress';
    else if (selenium) uiFramework = 'selenium';

    let testRunner: string | undefined;
    if (playwright) testRunner = 'playwright';
    else if (cypress) testRunner = 'cypress';
    else if (testng) testRunner = 'testng';
    else if (pytest) testRunner = 'pytest';
    else if (jest) testRunner = 'jest';

    const page = names.some(x => /Page\.(java|ts|js|py|cs)$/i.test(x)) || names.some(x => x.includes('/pages/'));
    const commands: string[] = [];
    if (maven) commands.push('mvn test');
    else if (gradle) commands.push('gradle test');
    else if (playwright) commands.push('npx playwright test');
    else if (cypress) commands.push('npx cypress run');
    else if (pytest) commands.push('pytest');
    else if (npm) commands.push('npm test');
    else if (dotnet) commands.push('dotnet test');

    return {
        language,
        buildTool,
        uiFramework,
        bddFramework,
        testRunner,
        architecturePattern: page ? 'page-object' : 'unknown',
        pageObjectPattern: page,
        helperLayer: /Helper|Utils/i.test(all),
        serviceLayer: /Service/i.test(all),
        reporting: [],
        ciCd: [],
        commands,
        conventions: page ? ['Page Object naming'] : [],
        restrictions: [],
        evidence: []
    };
}

export async function indexRepository(root: string): Promise<RepositoryIndex> {
    const paths = await files(root);
    const contents = await Promise.all(paths.map(async file => {
        try { return [file, await readFile(join(root, file), 'utf8')] as const; }
        catch { return undefined; }
    }));
    const texts = new Map(contents.filter((entry): entry is readonly [string, string] => entry !== undefined));
    const parsed = paths.map(file => extract(file, texts.get(file) ?? ''));
    const classes = parsed.flatMap(result => result.classes);
    const methods = parsed.flatMap(result => result.methods);
    const capabilities: Capability[] = [];

    for (const id of new Set(methods.flatMap(method => method.behaviors))) {
        const candidates = methods.filter(method => method.behaviors.includes(id) && !/\/stepdefinitions\/|\.spec\.|\.test\./i.test(method.file));
        capabilities.push({
            name: id,
            label: id.replaceAll('_', ' '),
            methods: candidates.map(method => `${method.className}.${method.name}`),
            confidence: .66,
            evidence: candidates.map(method => ({
                reason: `Name-based semantic candidate ${method.name}; signature and body retained for validation`,
                files: [`${method.file}:${method.line}`],
                confidence: .66,
                kind: 'heuristic'
            }))
        });
    }

    const behaviors: BehaviorRecord[] = methods.map(method => ({
        id: method.behaviors[0] ?? method.name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
        label: method.name,
        method: `${method.className}.${method.name}`,
        className: method.className,
        evidence: [{
            reason: 'Source signature and body extracted',
            files: [`${method.file}:${method.line}`],
            confidence: .7,
            kind: 'method'
        }]
    }));

    return {
        root,
        files: paths,
        sources: Object.fromEntries(texts),
        classes,
        methods,
        behaviors,
        framework: detect(texts),
        capabilities
    };
}
