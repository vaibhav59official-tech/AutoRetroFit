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

---

## Why AutoRetrofit for SDETs? (Real-World Use Cases)

For an SDET (Software Development Engineer in Test), the biggest challenges are rarely writing raw test scripts—they are **automation backlog debt, code duplication across large frameworks, inaccurate sprint estimations, and slow turnaround times**.

Here is how an SDET uses **AutoRetrofit** to solve real-world industry problems:

### 1. Eliminating "Sprint Automation Lag" (In-Sprint Automation)
* **The Real Problem**: In agile sprints, manual QA or Product Owners write test cases in JIRA, Excel, or TestRail. Because SDETs have to manually read each case, find the right Page Objects, write glue code, and hook assertions, test automation consistently lags 1–2 sprints behind development.
* **How AutoRetrofit Solves It**:
  1. Export the sprint's user story test cases directly from JIRA or Excel.
  2. Run `npx autoretofit retrofit --test ./sprint-42-cases.csv --apply`.
  3. AutoRetrofit automatically indexes the repo, binds existing Page Object methods, scaffolds missing ones, and creates the test files in seconds.
* **Impact**: Turns days of tedious boilerplate wiring into a 5-minute automated scaffolding task, enabling **true in-sprint automation**.

### 2. Preventing "Wheel Reinvention" & Code Duplication
* **The Real Problem**: In large enterprise QA repos (e.g., 100+ Page Objects, Utilities, and Helpers built by multiple engineers over years), an SDET often doesn't know that an authentication helper or payment interaction method already exists in another package. They write a duplicate method with slightly different locators, leading to code bloat and maintenance nightmares.
* **How AutoRetrofit Solves It**:
  * AutoRetrofit’s **Repository Semantic Indexer** scans the entire codebase before writing code.
  * It discovers methods like `AuthHelper.loginAsStudent` or `CoursePage.selectMasterBatch` across all packages and binds them directly.
* **Impact**: Enforces DRY (Don't Repeat Yourself) principles across distributed QA teams and maximizes the reuse of proven, battle-tested methods.

### 3. Evidence-Based Sprint Sizing & Automation ROI Estimation
* **The Real Problem**: In sprint planning, the QA Manager asks: *"We have 30 manual regression cases for this release. How many can we automate this sprint, and what is the effort?"* SDETs typically guess, resulting in missed sprint commitments.
* **How AutoRetrofit Solves It**:
  * The SDET runs the `analyze` command across the test case sheet:
    ```bash
    npx autoretofit analyze --repo ./my-repo --test ./regression-backlog.xlsx
    ```
  * AutoRetrofit immediately outputs:
    * **Suitability Score** (e.g. `85/100`).
    * **Exact Coverage**: `24 of 28 steps already exist in the codebase`.
    * **Exact Deficit**: `4 steps require new method stubs in CheckoutPage`.
* **Impact**: Sizing is backed by hard static code analysis evidence rather than subjective guesswork.

### 4. Test-Driven Scaffolding for New Features (Missing Method Stubbing)
* **The Real Problem**: When automating tests for brand-new features, Page Object classes or methods do not exist yet. SDETs must design method signatures, determine conventions, and wire calls manually.
* **How AutoRetrofit Solves It**:
  * With **Implicit Missing Method Creation**, AutoRetrofit identifies which methods are missing and automatically scaffolds clean stubs directly into the appropriate Page Object class:
    ```java
    // Scaffolds directly in PaymentPage.java
    public void applyPromoCode() {
        throw new UnsupportedOperationException("TODO: Implement applyPromoCode");
    }
    ```
  * It simultaneously wires the step definition to call this stub.
* **Impact**: The SDET only needs to fill in the specific locator logic inside the stub—the entire test harness, architecture wiring, and call hierarchy are already completed.

### 5. Seamless Multi-Framework Migrations
* **The Real Problem**: Companies often decide to migrate legacy test suites (e.g. from Java Selenium Cucumber to Playwright TypeScript or PyTest). Manually rewriting hundreds of BDD scenarios and step definitions into Playwright specs takes months.
* **How AutoRetrofit Solves It**:
  * AutoRetrofit separates the **workflow intent** from the **underlying framework generator**.
  * By simply specifying `--framework playwright`, the exact same manual test steps produce a clean Playwright spec (`tests/checkout.spec.ts`) instead of Cucumber feature files.
* **Impact**: Speeds up framework migration and modernization initiatives across enterprise test suites.

### 6. Transparent Reporting for Non-Technical Stakeholders
* **The Real Problem**: Product Owners, QA Managers, and Release Leads do not read raw Git diffs or step definition code to understand automation readiness.
* **How AutoRetrofit Solves It**:
  * AutoRetrofit produces the standalone **Extent-Reports HTML Dashboard** (`report.html`).
  * It shows the complete traceability matrix:
    * Plain-English manual test step → Reused repository method → Evidence file & line number.
* **Impact**: The SDET can attach `report.html` to Pull Requests or JIRA tickets, providing audit-ready visibility to stakeholders without extra documentation effort.

### Summary of SDET Value Proposition

| Traditional SDET Workflow | AutoRetrofit-Powered SDET Workflow |
| :--- | :--- |
| Read manual test cases from Excel/JIRA one-by-one. | Ingest raw `.xlsx`, `.csv`, or `.json` directly via CLI. |
| Manually search 50+ Page Object files for matching methods. | Automatically index & discover reusable methods in milliseconds. |
| Duplicate methods when unaware of existing utilities. | Prevent duplicates by matching semantic capability mappings. |
| Manually write step definitions, feature files, or specs. | Auto-generate framework-aligned tests (Playwright, TestNG, Cucumber, PyTest). |
| Guess sprint effort for automating manual backlogs. | Run `analyze` for instant, evidence-backed suitability scoring. |
| Manually draft test summaries for managers. | Hand off the interactive ExtentReports dashboard (`report.html`). |

---

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
