# Implementation Plan: Serverless Family Email Routing

## 1. Executive Summary & Foundational References

This document outlines the end-to-end implementation plan for the `family-email` system. The system delivers a maintenance-free, serverless email routing infrastructure on a custom domain managed by Cloudflare. Incoming mail is evaluated against ordered regular expression rules and forwarded to designated mailboxes using Cloudflare Email Workers. Outbound mail is transmitted through an authenticated external SMTP relay provider (such as Brevo) using existing email clients (such as Gmail "Send mail as").

This plan operates in strict alignment with the foundational repository documentation:
* [README.md](../README.md): System goals, architecture, repository layout, and operational principles.
* [docs/DESIGN.md](DESIGN.md): Architectural design, threat model, rule engine semantics, and data flow.
* [AGENTS.md](../AGENTS.md): Architectural mandates, security constraints, and first-match-wins invariants.
* [PROMPT.md](../PROMPT.md): Agent guidelines, in-repository placement mandates, and colorblind-safe standards.
* [docs/remote-configuration-guide.md](remote-configuration-guide.md): Manual external website procedures.

```
[SYSTEM INVARIANTS]
* Routing Rules: 100% configuration-driven (YAML/JSON). Zero hardcoded routing in Worker code.
* Precedence: First-match-wins evaluated in declaration order.
* Safety: Anchored regex patterns required; unanchored patterns flagged during validation.
* No-Match Handling: Explicit rejection default (drop/reject instead of silent forwarding).
* Zero Secrets: No credentials, tokens, private keys, or passwords committed to Git.
* Privacy: Redacted placeholder mailboxes (<DESTINATION_EMAIL>, alice@example.net) in public docs.
* Accessibility: Strict red-green colorblindness friendly formatting ([PASS], [FAIL], [ADDED], [-], [+]).
```

---

## 2. Architecture & System Topography

### 2.1 Logical Data Flow

```
Inbound Email Flow:
  Internet Sender
        │
        │ [SMTP Protocol]
        ▼
  Cloudflare DNS (Authoritative MX / SPF / DKIM / DMARC)
        │
        ▼
  Cloudflare Email Routing (Catch-all *@domain binding)
        │
        ▼
  Cloudflare Email Worker (`family-email-worker`)
        ├── 1. Recipient Address Extraction (`message.to`)
        ├── 2. Address Normalization (trim whitespace, lowercase)
        ├── 3. Ordered Regex Matching (`email-rules.yaml`)
        │      ├── Rule 1 Match? ──>[YES]──> Forward (`message.forward()`)
        │      ├── Rule 2 Match? ──>[YES]──> Forward (`message.forward()`)
        │      └── ...
        └── 4. No-Match Evaluation
               └── Default: Reject (`message.setReject()`)

Outbound Email Flow:
  Existing Mailbox / Client (e.g. Gmail "Send mail as")
        │
        │ [SMTP Submission with TLS / Auth on Port 587]
        ▼
  Brevo SMTP Relay (`smtp-relay.brevo.com`)
        │
        │ [DKIM Signing + SPF Alignment via Custom Domain DNS]
        ▼
  Internet Recipient
```

### 2.2 Trust Boundaries

1. **Internet / Public Boundary**: Unauthenticated incoming SMTP traffic. Recipient address can be arbitrary.
2. **Cloudflare Ingestion Boundary**: Enforces MX routing, initial antispam screening, and forwards payload to Worker.
3. **Worker Execution Boundary**: Validates recipient against pre-compiled, trusted configuration. Disallows user-controlled forwarding targets.
4. **Destination Mailbox Boundary**: Forwards only to verified destinations pre-registered in Cloudflare Email Routing.
5. **Outbound Relay Boundary**: Requires authenticated SMTP credentials over TLS; enforces sender alignment with DNS records.

---

## 3. Detailed Component Specifications

### 3.1 Build & Runtime Configuration

#### `package.json`
* **Runtime**: Node.js 22 LTS (`v22.22.2`).
* **Package Manager**: npm (invoked directly or through standard build scripts).
* **Dependencies**:
  * `js-yaml` (`^4.1.0`): Safe YAML parsing for configuration files.
  * `@types/js-yaml` (`^4.0.9`): TypeScript definitions for YAML parser.
* **Dev Dependencies**:
  * `@cloudflare/workers-types` (`^4.20241022.0`): Type definitions for Cloudflare Workers and `ForwardableEmailMessage`.
  * `typescript` (`^5.6.3`): Static typechecking and compilation.
  * `wrangler` (`^3.80.0`): Cloudflare Worker CLI for local development, dry-run builds, and deployment.
  * `vitest` (`^2.1.3`): Unit and integration test runner.
  * `tsx` (`^4.19.1`): Direct TypeScript execution for verification and lint scripts.
* **Scripts**:
  * `"build"`: `wrangler deploy --dry-run --outdir dist`
  * `"test"`: `vitest run`
  * `"test:watch"`: `vitest`
  * `"validate:config"`: `tsx scripts/validate-config.ts`
  * `"validate:secrets"`: `tsx scripts/scan-secrets.ts`
  * `"validate:docs"`: `tsx scripts/validate-docs.ts`
  * `"validate"`: `npm run validate:config && npm run validate:secrets && npm run validate:docs && npm test`
  * `"deploy"`: `wrangler deploy`

#### `tsconfig.json`
* Standard strict Cloudflare Worker configuration:
  * `target`: `"ES2022"`
  * `module`: `"ES2022"`
  * `moduleResolution`: `"Bundler"`
  * `strict`: `true`
  * `types`: `["@cloudflare/workers-types"]`
  * `skipLibCheck`: `true`

#### `wrangler.jsonc`
* Cloudflare Workers configuration specification:
  * `name`: `"family-email-worker"`
  * `main`: `"src/index.ts"`
  * `compatibility_date`: `"2024-10-01"`
  * `rules`: Bundling configuration to import `config/email-rules.yaml` as text or embedded module.

---

### 3.2 Core Routing Engine (`src/`)

#### `src/types.ts`
Defines core domain models and validation interfaces:

```typescript
export type NoMatchAction = 'reject' | 'drop';

export interface RoutingRule {
  readonly name: string;
  readonly pattern: string;
  readonly destination: string;
  readonly description?: string;
}

export interface CompiledRoutingRule extends RoutingRule {
  readonly regex: RegExp;
}

export interface NoMatchConfig {
  readonly action: NoMatchAction;
  readonly reason?: string;
}

export interface EmailRulesConfig {
  readonly domain: string;
  readonly rules: readonly RoutingRule[];
  readonly no_match?: NoMatchConfig;
}

export type RoutingResult =
  | { readonly match: true; readonly rule: CompiledRoutingRule; readonly destination: string }
  | { readonly match: false; readonly action: NoMatchAction; readonly reason: string };
```

#### `src/router.ts`
Pure domain router logic isolated from Cloudflare Worker APIs:
* `normalizeAddress(rawAddress: string): string`: Trims surrounding whitespace and converts the address to lowercase.
* `extractLocalPart(normalizedAddress: string): string`: Splits at `@` and returns the local part preceding the domain. Returns empty string if malformed.
* `compileRules(rules: readonly RoutingRule[]): readonly CompiledRoutingRule[]`: Compiles string patterns into `RegExp` objects with syntax checking.
* `matchRules(localPart: string, compiledRules: readonly CompiledRoutingRule[], noMatch?: NoMatchConfig): RoutingResult`: Iterates over compiled rules sequentially; returns the first match or falls back to `noMatch` policy.

#### `src/index.ts`
Cloudflare Worker email event consumer:
* Implements `ExportedHandler<Env>` with `async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void>`.
* Lifecycle execution:
  1. Inspect `message.to`.
  2. Normalize recipient address and extract local part.
  3. Evaluate against loaded rules.
  4. On match: invoke `await message.forward(result.destination)`.
  5. On non-match: invoke `message.setReject(result.reason)`.
  6. On unexpected runtime exception: log diagnostic error details and reject safely to prevent open mail relays or silent message loss.

---

### 3.3 Configuration Layer (`config/`)

#### `config/email-rules.yaml`
Active configuration containing development/production rules.

#### `config/email-rules.example.yaml`
Sanitized, public reference template demonstrating valid rule configurations with placeholder emails.

Example Structure:
```yaml
domain: example.com

rules:
  - name: special-backup
    pattern: "^backup\\.bin$"
    destination: special@example.net
    description: "Specific exception rule placed before generic bin matcher"

  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@example.net
    description: "Catch-all for disposable service aliases ending in .bin"

  - name: version
    pattern: "^.+\\.v$"
    destination: version@example.net
    description: "Aliases ending in .v"

  - name: family
    pattern: "^family$"
    destination: family@example.net
    description: "Direct alias for primary family mailbox"

no_match:
  action: reject
  reason: "Address not recognized"
```

---

### 3.4 Verification Scripts (`scripts/`)

#### `scripts/validate-config.ts`
* Loads `config/email-rules.yaml` and `config/email-rules.example.yaml`.
* Validates YAML syntax.
* Validates required schema keys: `domain`, `rules`, `no_match`.
* Validates rule constraints:
  * Non-empty, alphanumeric name string.
  * Unique rule names across the file.
  * Unique regex patterns across the file.
  * Valid JavaScript regular expression syntax.
  * Anchored patterns: flags non-anchored patterns with warnings.
  * Valid destination email syntax (RFC 5322 compatible).
  * Maximum pattern length (e.g. <= 256 characters) to protect against ReDoS.
  * Maximum rule count (e.g. <= 100 rules).

#### `scripts/scan-secrets.ts`
* Scans all committed repository files for leaked credentials:
  * Cloudflare API tokens / global keys.
  * Brevo / Sendinblue API keys and SMTP passwords (`xkeysib-...`).
  * Private keys (`-----BEGIN PRIVATE KEY-----`).
  * Real unredacted email patterns in documentation.
* Exits with code 1 if any pattern matches.

#### `scripts/validate-docs.ts`
* Verifies synchronization across documentation files (`README.md`, `docs/DESIGN.md`, `AGENTS.md`, `PROMPT.md`, `docs/*.md`).
* Ensures example rules in `README.md` and `docs/DESIGN.md` match syntax in `config/email-rules.example.yaml`.
* Checks for broken relative markdown links.
* Validates that all status markers and diff examples conform to red-green colorblind-safe guidelines.

---

### 3.5 Automated Test Suites (`tests/`)

#### `tests/router.test.ts`
Unit tests for the router domain logic:
* Address normalization (leading/trailing whitespace, mixed case).
* Local part extraction (standard address, missing domain, multiple `@` symbols).
* Regex matching behavior:
  * Exact matches (`^family$`).
  * Suffix matches (`^.+\.bin$`).
  * Character classes and dots.
* First-match-wins ordering verification (verifying that `special-backup` intercepts `backup.bin` before general `^.+\.bin$`).
* No-match behavior (explicit reject action).
* Invalid address handling.

#### `tests/rules.test.ts`
Integration tests testing the real configuration files against concrete address fixtures:
* Verifies that `config/email-rules.yaml` compiles without errors.
* Verifies that `config/email-rules.example.yaml` compiles without errors.
* Runs table-driven test cases asserting specific routing outcomes.

---

### 3.6 Documentation Suite (`docs/`)

* **`docs/dns.md`**: Authoritative DNS specifications: MX records, SPF records (combining Cloudflare and Brevo), DKIM records, DMARC policies (`p=none` vs `p=quarantine`).
* **`docs/routing.md`**: In-depth routing rules guide: regular expression syntax, precedence semantics, anchoring rules, anti-patterns, and example use cases.
* **`docs/operations.md`**: Day-2 operations guide: adding aliases, rolling out rule updates, deployment checklists, monitoring via Cloudflare Worker metrics and tail logs.
* **`docs/security.md`**: Threat model, trust boundaries, secret management protocols, ReDoS prevention, and privacy invariants.
* **`docs/decisions.md`**: Architecture Decision Records (ADRs) detailing decisions such as selecting Cloudflare Email Workers over self-hosted mail, configuration-driven routing over hardcoded routes, and Brevo for outbound relay.
* **`docs/remote-configuration-guide.md`**: Step-by-step external dashboard walkthrough (Cloudflare, Brevo, Gmail).

---

### 3.7 Continuous Integration Pipeline (`.github/workflows/validate.yml`)

The CI workflow enforces least-privilege token permissions by declaring a top-level `permissions: { contents: read }` block, restricting the automatic `GITHUB_TOKEN` to read-only repository contents access and preventing unconstrained token scopes across all jobs.

Runs on every pull request and push to `main`:
1. Check out repository.
2. Set up Node.js 22 LTS.
3. Install dependencies via `npm ci`.
4. Run `npm run validate:secrets` ([PASS]/[FAIL] secret check).
5. Run `npm run validate:config` ([PASS]/[FAIL] configuration validation).
6. Run `npm run validate:docs` ([PASS]/[FAIL] doc link & sync check).
7. Run `npm test` ([PASS]/[FAIL] Vitest unit & integration tests).
8. Run `npm run build` ([PASS]/[FAIL] Worker dry-run build via Wrangler).

---

## 4. Phased Implementation Roadmap

```
Phase 1: Project Scaffolding & Tooling Setup
   │
   ▼
Phase 2: Router Domain Modeling & Unit Tests (TDD)
   │
   ▼
Phase 3: Configuration Schema & Validation Tooling
   │
   ▼
Phase 4: Cloudflare Worker Ingestion & Event Handling
   │
   ▼
Phase 5: Secret Scanner & Documentation Verification
   │
   ▼
Phase 6: Comprehensive Documentation Suite
   │
   ▼
Phase 7: CI Automation & Production Readiness Gate
```

---

### Phase 1: Project Scaffolding & Tooling Setup

* **Objective**: Establish the Node.js TypeScript build environment, directory tree, and Cloudflare Worker runtime dependencies.
* **Deliverables**:
  * [ADDED] `package.json`
  * [ADDED] `tsconfig.json`
  * [ADDED] `wrangler.jsonc`
  * [ADDED] `.gitignore`
* **Dependencies**: Verified host runtime Node.js 22 LTS.
* **Verification Gate**:
  * `npm install` executes cleanly with zero vulnerabilities.
  * `npx tsc --noEmit` verifies TypeScript configuration.
  * Status: `[PASS]`

---

### Phase 2: Router Domain Modeling & Unit Tests (TDD)

* **Objective**: Build pure, deterministic email routing primitives and establish the unit test harness.
* **Deliverables**:
  * [ADDED] `src/types.ts`
  * [ADDED] `src/router.ts`
  * [ADDED] `tests/router.test.ts`
* **Dependencies**: Phase 1 tooling.
* **Verification Gate**:
  * Red-Green verification: Write tests in `tests/router.test.ts` asserting expected routing outcomes; confirm tests fail before router logic implementation and pass after.
  * Address normalization passes whitespace trimming and case conversion tests.
  * First-match-wins ordering verified with overlapping rules.
  * Vitest suite executes with 100% test pass rate.
  * Status: `[PASS]`

---

### Phase 3: Configuration Schema & Validation Tooling

* **Objective**: Define YAML configuration files and author the validation engine to enforce safety, uniqueness, and anchoring.
* **Deliverables**:
  * [ADDED] `config/email-rules.yaml`
  * [ADDED] `config/email-rules.example.yaml`
  * [ADDED] `scripts/validate-config.ts`
  * [ADDED] `tests/rules.test.ts`
* **Dependencies**: Phase 2 router primitives.
* **Verification Gate**:
  * `npx tsx scripts/validate-config.ts` validates syntax, uniqueness, and destination syntax.
  * Malformed configuration test fixtures (duplicate rule names, unclosed regex, invalid email) fail validation with descriptive errors.
  * `npm test` validates real and example rule files.
  * Status: `[PASS]`

---

### Phase 4: Cloudflare Worker Ingestion & Event Handling

* **Objective**: Implement the Cloudflare Email Worker handler binding email events to the router engine.
* **Deliverables**:
  * [ADDED] `src/index.ts`
* **Dependencies**: Phase 2 router and Phase 3 configuration.
* **Verification Gate**:
  * `npm run build` (`wrangler deploy --dry-run`) bundles the worker successfully.
  * Error boundary tests verify that unhandled exceptions reject safely rather than crashing or creating open mail loops.
  * Status: `[PASS]`

---

### Phase 5: Secret Scanner & Documentation Verification

* **Objective**: Implement automated pre-commit and CI verification scripts to enforce zero-secret and synchronized documentation invariants.
* **Deliverables**:
  * [ADDED] `scripts/scan-secrets.ts`
  * [ADDED] `scripts/validate-docs.ts`
* **Dependencies**: Phase 1-4 files.
* **Verification Gate**:
  * `npx tsx scripts/scan-secrets.ts` scans all repo files and confirms zero exposed API keys or unredacted personal mailboxes.
  * `npx tsx scripts/validate-docs.ts` checks link integrity and documentation consistency.
  * Status: `[PASS]`

---

### Phase 6: Comprehensive Documentation Suite

* **Objective**: Complete in-repo technical documentation covering DNS, routing rules, operations, security, and architectural decisions.
* **Deliverables**:
  * [ADDED] `docs/dns.md`
  * [ADDED] `docs/routing.md`
  * [ADDED] `docs/operations.md`
  * [ADDED] `docs/security.md`
  * [ADDED] `docs/decisions.md`
  * [ADDED] `docs/remote-configuration-guide.md`
* **Dependencies**: Architecture specs and verified implementation contracts.
* **Verification Gate**:
  * All documentation adheres to colorblind-safe formatting standards.
  * Zero GitHub alert syntax (`> [!NOTE]`) present.
  * `npm run validate:docs` exits code 0.
  * Status: `[PASS]`

---

### Phase 7: CI Automation & Production Readiness Gate

* **Objective**: Wire all verification gates into GitHub Actions CI workflow and execute complete repository verification.
* **Deliverables**:
  * [ADDED] `.github/workflows/validate.yml`
* **Dependencies**: All preceding phases.
* **Verification Gate**:
  * Master validation script `npm run validate` runs cleanly.
  * Git workspace clean check (`git status --porcelain`).
  * End-to-end readiness checklist verified.
  * Status: `[PASS]`

---

## 5. Risk Assessment & Mitigation Matrix

| Risk Factor | Impact | Likelihood | Mitigation Strategy | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Catastrophic Backtracking (ReDoS)** | High (Worker CPU limit exceeded) | Medium | Strict regex validation: length limits, compile-time evaluation in validation script, rejection of nested quantifiers. | `[PASS] Mitigated` |
| **Misrouted Email via Ambiguous Regex** | High (Mail delivered to wrong user) | Medium | First-match-wins ordering with explicit rule hierarchy. Validation warnings on unanchored patterns. Comprehensive table-driven tests. | `[PASS] Mitigated` |
| **Secret Leakage in Git** | Critical (Compromised relay / DNS) | Low | Multi-layer secret scanning script in pre-commit and CI; placeholder documentation standard. | `[PASS] Mitigated` |
| **Silent Delivery Failure / Dropped Mail** | High (Lost communication) | Low | Explicit no-match policy (`reject`). Error boundaries in Worker index handler. Cloudflare Worker real-time logs. | `[PASS] Mitigated` |
| **Outbound Spam Flagging / Low Deliverability** | High (Mail sent to spam folder) | Medium | Unified SPF record, DKIM key alignment, strict DMARC policy with gradual ramp-up (`p=none` -> `p=quarantine`). | `[PASS] Mitigated` |
| **Unverified Destination Mailbox** | High (Cloudflare blocks forwarding) | High | Step-by-step verification procedures in `docs/remote-configuration-guide.md` requiring dashboard confirmation prior to rule activation. | `[PASS] Mitigated` |

---

## 6. Red-Green Colorblindness Accessibility Compliance

In accordance with repository accessibility policies:
* Status outcomes are explicitly encoded with text labels and distinct geometric brackets:
  * `[PASS]` / `[OK]`: Operational and verified.
  * `[FAIL]` / `[ERROR]`: Failure requiring remediation.
  * `[WARN]` / `[!]`: Warning or advisory notice.
  * `[ADDED]` / `[+]`: New artifact or file.
  * `[REMOVED]` / `[-]`: Deleted artifact or code.
  * `[MODIFIED]` / `[~]`: Altered configuration.
* Diffs use standard line prefix tags (`[+]`, `[-]`, `[ ]`) without reliance on red/green highlighting.
* Color palettes for diagrams and tables prioritize high-contrast pairs (Blue `#0072B2` vs Orange `#D55E00`).
