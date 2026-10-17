# AutoRetrofit

AutoRetrofit is an evidence-backed CLI for retrofitting automated test scaffolding into existing QA repositories. It inspects the repository first, identifies reusable methods and capabilities, estimates whether manual test workflows are suitable for automation, and generates clean, framework-aligned test suites and missing method stubs.

## Highlights & Capabilities

- **Universal Test Case Ingestion**: Ingests industry-standard test case formats globally used in QA:
  - **Excel** (`.xlsx`, `.xls`) and **CSV/TSV** (Excel, Google Sheets, TestRail, Zephyr, Xray exports)
  - **JIRA / TestRail / Zephyr JSON** (Issue exports with test steps and expected results)
  - **Markdown / Gherkin / Plain Text** (`.md`, `.feature`, `.txt`)
- **Multi-Language Architecture**: Scans and discovers capabilities across:
  - **Java** (`.java` + Maven/Gradle)
  - **TypeScript / JavaScript** (`.ts`, `.tsx`, `.js`, `.jsx` + Playwright, Cypress, Jest)
  - **Python** (`.py` + PyTest, PyTest-BDD)
  - **C#** (`.cs` + .NET, NUnit)
- **Implicit Missing Method Creation**: If a required capability or method does not exist in the codebase, AutoRetrofit automatically synthesizes clean method stubs matching your project conventions and design patterns (Page Object Model, Helper, or Service classes) so test generation never gets blocked.
- **Framework-Adaptive Generation**: Auto-adapts to your repository's existing test framework:
  - **Cucumber Java**: Emits `.feature` and Java step definition classes
  - **TestNG / JUnit Java**: Emits `@Test` test classes
  - **Playwright (TypeScript/JS)**: Emits `tests/*.spec.ts`
  - **Cypress**: Emits `cypress/e2e/*.cy.ts`
  - **PyTest**: Emits `tests/test_*.py`
- **Extent-Reports Interactive HTML Dashboard**: Produces rich, self-contained `report.html` reports styled after ExtentReports. Openable directly in your IDE's integrated browser (e.g. VS Code Simple Browser) or any desktop browser (Chrome, Edge, Firefox) without requiring any web server.

## Quick Start

```bash
npm install
npm run build
npx autoretofit doctor

# 1. Analyze feasibility from Markdown, CSV, Excel, or JIRA
npx autoretofit analyze --repo ./examples/sample-selenium-java-project --test ./examples/test-cases/payment.md
npx autoretofit analyze --repo ./examples/sample-selenium-java-project --test ./examples/test-cases/payment.csv
npx autoretofit analyze --repo ./examples/sample-selenium-java-project --test ./examples/test-cases/payment-jira.json

# 2. Plan automation with reuse mappings and missing method scaffolding
npx autoretofit plan --repo ./examples/sample-selenium-java-project --test ./examples/test-cases/payment.md

# 3. Retrofit and generate interactive Extent HTML report
npx autoretofit retrofit --repo ./examples/sample-selenium-java-project --test ./examples/test-cases/payment.md
```

## Flags & Options

- `--test <path>`: Path to test case file (`.md`, `.feature`, `.csv`, `.xlsx`, `.json`)
- `--repo <path>`: Root directory of QA repository (default: current working directory)
- `--format <auto|markdown|csv|excel|jira>`: Test case input format (auto-detected if omitted)
- `--framework <auto|cucumber|playwright|cypress|pytest|testng|junit>`: Target test framework
- `--no-auto-create`: Disable automatic scaffolding of missing methods (forces manual review)
- `--apply`: Apply the generated test files and method stubs directly to the repository

## Interactive Extent-Reports Dashboard

The `retrofit` command outputs an ExtentReports-styled HTML dashboard located at:
`.autoretofit/runs/<runId>/report.html`

It includes:
- **KPI Dashboard**: Readiness score (0-100), automation recommendation, step coverage, reused vs. newly scaffolded method counts.
- **Extent Step Table**: Full trace of each step, intent, required capability, bound method, confidence rating, and source file evidence.
- **Code Scaffolding & Unified Diff**: Complete review of generated test files and method stubs.
- **Zero-Dependency Self-Contained HTML**: Fully offline, no server or external CSS/JS CDN needed.
