/**
 * @file workflow.ts
 * @description Universal multi-format manual test case parser.
 * @usage Called by CLI and analysis engine via `parseWorkflow(input, filename, format)`.
 * @responsibilities Ingests manual test cases from Excel (.xlsx), CSV, TSV, JIRA/Zephyr/Xray JSON,
 *                   and Markdown/Gherkin; normalizes steps into semantic intents and required capabilities.
 */
import { inflateRawSync } from 'node:zlib';
import type { WorkflowAnalysis, WorkflowStep } from './domain.js';

const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function step(text: string): WorkflowStep {
  const n = normalize(text);
  if (/\b(LOGIN|SIGN IN|AUTHENTICAT)/.test(n)) {
    return { text, intent: 'LOGIN', requiredCapability: n.includes('STUDENT') ? 'LOGIN_AS_STUDENT' : 'LOGIN' };
  }
  if (/SELECT.*MASTER.*BATCH|MASTER.*BATCH/.test(n)) {
    return { text, intent: 'NAVIGATE', requiredCapability: 'SELECT_MASTER_BATCH' };
  }
  if (/PAYMENT|PAY|CHECKOUT/.test(n)) {
    return { text, intent: 'PAYMENT', requiredCapability: 'COMPLETE_PAYMENT' };
  }
  if (/VERIFY|ASSERT|SHOULD|STATUS|SUCCESS|EXPECTED/.test(n)) {
    return { text, intent: 'ASSERTION', requiredCapability: /ORDER.*SUCCESS|SUCCESS.*ORDER/.test(n) ? 'VERIFY_ORDER_STATUS_SUCCESS' : 'ASSERTION' };
  }
  if (/\b(OPEN|NAVIGAT|COURSE)/.test(n)) {
    return { text, intent: 'NAVIGATE', requiredCapability: n.includes('COURSE') ? 'OPEN_COURSE' : 'NAVIGATE' };
  }
  if (/DATA|ACCOUNT|COUPON|PRECONDITION/.test(n)) {
    return { text, intent: 'DATA', requiredCapability: 'TEST_DATA' };
  }
  return { text, intent: 'UNKNOWN', requiredCapability: 'UNKNOWN' };
}

// Markdown and plain text / Gherkin parser
function parseMarkdownWorkflow(markdown: string): WorkflowAnalysis {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Untitled workflow';
  const lines = markdown.split(/\r?\n/);
  const numbered = lines.flatMap(line => {
    const m = line.match(/^\s*\d+[.)]\s+(.+)$/);
    return m ? [m[1].trim()] : [];
  });
  const gherkin = lines.flatMap(line => {
    const m = line.match(/^\s*(?:Given|When|Then|And|But)\s+(.+)$/i);
    return m ? [m[1].trim()] : [];
  });
  const raw = numbered.length ? numbered : gherkin;
  const expectedResults = lines
    .filter(x => /^\s*[-*]\s+/.test(x) && /expected|should|success|status|verify/i.test(x))
    .map(x => x.replace(/^\s*[-*]\s+/, '').trim());
  const preconditions = lines
    .filter(x => /^\s*[-*]\s+/.test(x) && /account|exists|precondition|coupon/i.test(x))
    .map(x => x.replace(/^\s*[-*]\s+/, '').trim());
  const steps = raw.map(step);
  for (const expected of expectedResults) {
    const parsed = step(`Verify ${expected}`);
    if (!steps.some(x => x.requiredCapability === parsed.requiredCapability)) steps.push(parsed);
  }
  return { title, steps, preconditions, expectedResults, source: 'heuristic' };
}

// Industry-standard CSV/TSV parser (Excel exports, TestRail, Zephyr)
function parseCsvWorkflow(csv: string): WorkflowAnalysis {
  const lines = csv.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!lines.length) return { title: 'Empty CSV workflow', steps: [], preconditions: [], expectedResults: [], source: 'heuristic' };

  // Parse CSV line handling quotes
  const parseLine = (line: string): string[] => {
    const delim = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',';
    const result: string[] = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        if (inQuotes && line[i + 1] === char) { current += char; i++; }
        else inQuotes = !inQuotes;
      } else if (char === delim && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const rows = lines.map(parseLine);
  const header = rows[0].map(h => h.toLowerCase());
  const stepCol = header.findIndex(h => /step|action|description/i.test(h));
  const expectedCol = header.findIndex(h => /expected|result|assertion/i.test(h));
  const titleCol = header.findIndex(h => /test\s*case|title|summary|name/i.test(h));
  const preCol = header.findIndex(h => /precondition|prerequisite/i.test(h));

  let title = 'Imported CSV Test Case';
  const steps: WorkflowStep[] = [];
  const preconditions: string[] = [];
  const expectedResults: string[] = [];

  const dataRows = (stepCol >= 0 || expectedCol >= 0) ? rows.slice(1) : rows;
  for (const row of dataRows) {
    if (titleCol >= 0 && row[titleCol] && title === 'Imported CSV Test Case') {
      title = row[titleCol];
    }
    if (preCol >= 0 && row[preCol]) {
      preconditions.push(row[preCol]);
    }
    const stepText = stepCol >= 0 ? row[stepCol] : (row[1] ?? row[0]);
    if (stepText && !/^(step|action|description)$/i.test(stepText)) {
      steps.push(step(stepText));
    }
    const expectedText = expectedCol >= 0 ? row[expectedCol] : (row[2] ?? '');
    if (expectedText && !/^(expected|result)$/i.test(expectedText)) {
      expectedResults.push(expectedText);
      const parsed = step(`Verify ${expectedText}`);
      if (!steps.some(x => x.requiredCapability === parsed.requiredCapability)) {
        steps.push(parsed);
      }
    }
  }

  return { title, steps, preconditions, expectedResults, source: 'heuristic' };
}

// Industry-standard JIRA / Zephyr / TestRail / Xray JSON parser
function parseJsonWorkflow(jsonStr: string): WorkflowAnalysis {
  const data = JSON.parse(jsonStr);
  let title = 'Imported JIRA Test Case';
  const steps: WorkflowStep[] = [];
  const preconditions: string[] = [];
  const expectedResults: string[] = [];

  // Single JIRA issue with fields
  const issue = Array.isArray(data) ? data[0] : (data.fields ? data.fields : data);
  if (issue.summary) title = issue.summary;
  else if (data.title) title = data.title;
  else if (data.testCaseName) title = data.testCaseName;

  if (issue.description && typeof issue.description === 'string') {
    // If description has markdown or numbered steps, extract them
    const md = parseMarkdownWorkflow(`# ${title}\n\n${issue.description}`);
    if (md.steps.length > 0) return md;
  }

  // Zephyr or Xray manual test steps array
  const rawSteps = issue.steps || issue.testSteps || issue.testScript?.steps || data.steps || [];
  if (Array.isArray(rawSteps)) {
    for (const s of rawSteps) {
      if (typeof s === 'string') {
        steps.push(step(s));
      } else if (typeof s === 'object' && s !== null) {
        const action = s.action || s.step || s.stepDescription || s.description || '';
        const expected = s.expectedResult || s.result || s.data || '';
        if (action) steps.push(step(action));
        if (expected) {
          expectedResults.push(expected);
          const parsed = step(`Verify ${expected}`);
          if (!steps.some(x => x.requiredCapability === parsed.requiredCapability)) {
            steps.push(parsed);
          }
        }
      }
    }
  }

  if (issue.preconditions && Array.isArray(issue.preconditions)) {
    preconditions.push(...issue.preconditions);
  } else if (typeof issue.preconditions === 'string') {
    preconditions.push(issue.preconditions);
  }

  return { title, steps, preconditions, expectedResults, source: 'heuristic' };
}

// Lightweight zero-dependency XLSX parser using node:zlib
function parseXlsxWorkflow(buffer: Buffer): WorkflowAnalysis {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  // Scan Local File Headers (ZIP format)
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      const data = method === 8 ? inflateRawSync(compressed) : compressed;
      entries.set(name, data);
    } catch {
      // Skip corrupt or unhandled entries
    }
    offset = dataStart + compressedSize;
  }

  // Shared strings
  const strings: string[] = [];
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8');
  if (sharedXml) {
    const matches = sharedXml.matchAll(/<t[^>]*>(.*?)<\/t>/gs);
    for (const m of matches) strings.push(m[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  }

  // Sheet XML
  const sheetXml = entries.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (!sheetXml) {
    return { title: 'Untitled Excel Test Case', steps: [], preconditions: [], expectedResults: [], source: 'heuristic' };
  }

  // Parse rows
  const rowMatches = sheetXml.matchAll(/<row[^>]*>(.*?)<\/row>/gs);
  const rows: string[][] = [];
  for (const rm of rowMatches) {
    const rowContent = rm[1];
    const cellMatches = rowContent.matchAll(/<c\s+r="([A-Z]+)\d+"(?:\s+t="([a-z]+)")?[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/gs);
    const row: string[] = [];
    for (const cm of cellMatches) {
      const isString = cm[2] === 's';
      const val = cm[3] ?? '';
      const text = isString && strings[parseInt(val, 10)] !== undefined ? strings[parseInt(val, 10)] : val;
      row.push(text.trim());
    }
    if (row.length) rows.push(row);
  }

  if (!rows.length) {
    return { title: 'Untitled Excel Test Case', steps: [], preconditions: [], expectedResults: [], source: 'heuristic' };
  }

  // Re-use CSV parsing logic on the extracted rows
  const header = rows[0].map(h => h.toLowerCase());
  const stepCol = header.findIndex(h => /step|action|description/i.test(h));
  const expectedCol = header.findIndex(h => /expected|result|assertion/i.test(h));
  const titleCol = header.findIndex(h => /test\s*case|title|summary|name/i.test(h));
  const preCol = header.findIndex(h => /precondition|prerequisite/i.test(h));

  let title = 'Imported Excel Test Case';
  const steps: WorkflowStep[] = [];
  const preconditions: string[] = [];
  const expectedResults: string[] = [];

  const dataRows = (stepCol >= 0 || expectedCol >= 0) ? rows.slice(1) : rows;
  for (const row of dataRows) {
    if (titleCol >= 0 && row[titleCol] && title === 'Imported Excel Test Case') {
      title = row[titleCol];
    }
    if (preCol >= 0 && row[preCol]) {
      preconditions.push(row[preCol]);
    }
    const stepText = stepCol >= 0 ? row[stepCol] : (row[1] ?? row[0]);
    if (stepText && !/^(step|action|description)$/i.test(stepText)) {
      steps.push(step(stepText));
    }
    const expectedText = expectedCol >= 0 ? row[expectedCol] : (row[2] ?? '');
    if (expectedText && !/^(expected|result)$/i.test(expectedText)) {
      expectedResults.push(expectedText);
      const parsed = step(`Verify ${expectedText}`);
      if (!steps.some(x => x.requiredCapability === parsed.requiredCapability)) {
        steps.push(parsed);
      }
    }
  }

  return { title, steps, preconditions, expectedResults, source: 'heuristic' };
}

// Unified multi-format parser supporting Markdown, Gherkin, CSV, Excel, JIRA JSON
export function parseWorkflow(input: string | Buffer, filename = '', format = ''): WorkflowAnalysis {
  let str: string;
  if (Buffer.isBuffer(input)) {
    if (input[0] === 0x50 && input[1] === 0x4b && input[2] === 0x03 && input[3] === 0x04) {
      return parseXlsxWorkflow(input);
    }
    str = input.toString('utf8');
  } else {
    str = String(input);
  }
  const lowerFile = filename.toLowerCase();
  const lowerFmt = format.toLowerCase();

  if (lowerFmt === 'excel' || lowerFmt === 'xlsx' || lowerFile.endsWith('.xlsx')) {
    return parseXlsxWorkflow(Buffer.from(str));
  }
  if (lowerFmt === 'csv' || lowerFmt === 'tsv' || lowerFile.endsWith('.csv') || lowerFile.endsWith('.tsv')) {
    return parseCsvWorkflow(str);
  }
  if (lowerFmt === 'jira' || lowerFmt === 'json' || lowerFile.endsWith('.json') || (str.trim().startsWith('{') || str.trim().startsWith('['))) {
    try {
      return parseJsonWorkflow(str);
    } catch {
      // Fallback to markdown if JSON parse fails
    }
  }

  // Default: Markdown / Gherkin
  return parseMarkdownWorkflow(str);
}
