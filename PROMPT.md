# Family Email Routing - Agent System Prompt & Guidelines

This document provides foundational rules and instructions for automated and human agents operating on the `family-email` repository.

Agents must read and follow this guide along with [README.md](README.md), [docs/DESIGN.md](docs/DESIGN.md), and [AGENTS.md](AGENTS.md).

---

## 1. System Purpose & Architecture

This repository implements a lightweight personal and family email routing system on a custom domain managed by Cloudflare.

The core feature is regex-based routing of inbound email addresses to existing target mailboxes without operating an SMTP/IMAP server.

### Architecture

```
Inbound:
Internet Mail
  ↓ SMTP
Cloudflare DNS (MX / SPF / DKIM / DMARC)
  ↓
Cloudflare Email Routing (Catch-all *@domain)
  ↓
Cloudflare Email Worker (TypeScript regex router)
  ↓
First matching regex rule
  ↓
Existing Mailbox (e.g., bin@gmail.com, vvvv@gmail.com)

Outbound:
Existing Mailbox / Email Client
  ↓ SMTP submission
External SMTP Relay (e.g., Brevo)
  ↓
Internet Mail
```

### Core Invariants

* **Configuration-driven**: Routing rules live in configuration (e.g. YAML/JSON), never hard-coded in Worker source code.
* **First-match-wins**: Rules evaluate in strict declaration order. Specific exception rules must precede general patterns.
* **Anchored regexes**: Patterns should normally be anchored (e.g., `^.+\.bin$`).
* **Explicit no-match**: Unmatched mail must follow an explicit policy (default: `reject`).
* **Security & zero secrets**: Never commit API keys, SMTP credentials, or private keys to Git. Use environment variables, Cloudflare secrets, or password managers.
* **Privacy**: Never commit real family email addresses to public docs or git history. Use placeholders (e.g., `alice@example.net`, `<DESTINATION_EMAIL>`).

---

## 2. In-Repository File Placement Policy

Agents must ALWAYS only create files inside this repository.

* **Strict Repository Boundary**: Never create or place files outside the repository boundary (such as in `/tmp` or arbitrary paths in `$HOME`).
* **All Files Included**: All source code, tests, documentation, specifications, plans, designs, artifacts, scratch scripts, logs, notes, and temporary data files must reside strictly within the repository tree.
* **Scratch & Tooling Directory**: Temporary analysis scripts or scratch files must be created in a designated in-repo directory (such as `scratch/`, `scripts/`, or `plans/`) and properly tracked or excluded via `.gitignore`.

---

## 3. Mandatory Pre-Implementation Planning

Agents must ALWAYS create a plan or design document and place it within the repository (e.g., under `docs/` or `plans/`) before implementing or modifying code.

* **Prior to Code Edits**: Do not edit production code or configuration until a design or implementation plan document is written and staged/committed in the repository.
* **Plan Contents**:
  - Problem statement and requirements.
  - Architectural impact and component interfaces.
  - Regex and routing rule behavior.
  - Error handling, edge cases, and failure modes.
  - Verification and test strategy (unit, integration, validation).
* **Code Scope Discipline**: Keep design documents focused on architecture, interfaces, and contracts. Avoid large boilerplate code blocks; implementation details belong in tested code.

---

## 4. Remote Website Configuration Instructions

If a change requires manual actions on an external or remote website, agents must ALWAYS create a dedicated markdown document in `docs/` detailing those steps.

Applicable scenarios:
* Cloudflare Dashboard configuration (DNS records, Email Routing enabling, destination email verification).
* Domain registrar / DNS provider records.
* SMTP relay setup (e.g., Brevo account, API keys, sender validation, SMTP credentials).
* Mailbox client configuration (e.g., Gmail "Send mail as" SMTP settings).

Requirements:
* Provide explicit, step-by-step instructions with exact menu paths, field names, and DNS record tables.
* Never leave external setup instructions solely in ephemeral chat messages.

---

## 5. Code, Build, and Testing Standards

* **Cloudflare Workers (TypeScript)**: Worker code in `src/` must remain small, deterministic, and modular. Responsibilities: receive event, extract and normalize recipient, evaluate validated rules in order, forward or reject.
* **Vitest Test Suite**: Unit and integration tests in `tests/` must verify:
  - Routing matching and destination selection.
  - Rule precedence (specific overrides broad).
  - Address normalization (whitespace trimming, case normalization).
  - No-match rejection or fallback behavior.
  - Red-Green test verification: ensure tests fail before a fix and pass after.
* **Configuration Validation**:
  - Validate YAML/JSON syntax and required fields (`name`, `pattern`, `destination`).
  - Validate regex syntax and compile safety during validation (no catastrophic backtracking).
  - Reject duplicate rule names and duplicate patterns.
  - Validate destination email address format.
  - Enforce maximum rule length and rule count limits.

---

## 6. Red-Green Colorblind-Safe Standards

The user and reviewers may be red-green color blind. All output, diffs, status markers, and documentation MUST follow accessible presentation standards without relying solely on red/green colors.

### Diff Presentation Standards

* **Explicit Line Prefixes**:
  - Removed lines: Prefix with `[-]` or `[REMOVED]` (e.g., `[-] old_code()`).
  - Added lines: Prefix with `[+]` or `[ADDED]` (e.g., `[+] new_code()`).
  - Context lines: Prefix with `[ ]` or standard two-space indentation.
* **Inline / Word-Level Diffs**:
  - Use explicit text markers: `~~[REMOVED: old_text]~~` and `**[ADDED: new_text]**` or `[-old-]` / `{+new+}`.
* **Status Indicators**:
  - Use explicit text with distinct geometric symbols:
    - Passed / Success: `[PASS]`, `[OK]`, `[✓]`
    - Failed / Error: `[FAIL]`, `[ERROR]`, `[✗]`
    - Added / Created: `[ADDED]`, `[+]`
    - Removed / Deleted: `[REMOVED]`, `[-]`
    - Modified: `[MODIFIED]`, `[~]`
    - Warning: `[WARN]`, `[!]`
    - Pending: `[PENDING]`, `[...]`
  - Never use bare colored circles (🟢/🔴/🟡).
* **Color Palettes**:
  - Use colorblind-safe pairs: Blue (`#0072B2`) vs Orange (`#D55E00`), accompanied by double encoding (line styles, markers).

### Formatting Rules

* **No GitHub-style alert boxes**: Do not use `> [!NOTE]`, `> [!WARNING]`, etc. Use standard markdown headers or blockquotes.

---

## 7. Documentation Synchronization

Documentation is an integral part of this system. When making changes to routing rules, configuration, providers, DNS, or architecture, agents must inspect and update:

* [README.md](README.md)
* [docs/DESIGN.md](docs/DESIGN.md)
* [AGENTS.md](AGENTS.md)
* [PROMPT.md](PROMPT.md)
* [docs/](docs/)

Ensure diagrams, examples, and rule catalogs stay accurate.

---

## 8. Git Workflow & Completion Criteria

Before concluding work:

1. Inspect changes:
   ```bash
   git status
   git diff
   ```
2. Run test suites and validation scripts (if present):
   ```bash
   npm test
   npm run validate
   ```
3. Verify completion criteria:
   - All unit and validation tests pass.
   - In-repository file placement is strictly respected.
   - A pre-implementation plan or design doc is staged/committed in repo.
   - Remote website instructions are documented in `docs/` if manual setup is needed.
   - Model and tooling neutrality is maintained (no LLM or harness names).
   - Documentation is fully synchronized.
   - Zero credentials or private family emails are committed.

---

## 9. Model and Tooling Neutrality

Do not cite, name, or reference specific Large Language Models (LLMs), AI foundation models, AI providers, or agent execution harnesses in repository files (including source code, configuration, comments, documentation, commit messages, or changelists), unless strictly required for a technical integration.

* **Vendor-Neutral Terminology**: Maintain implementation-focused, vendor-neutral terminology (e.g., "automated agents", "assistants", "code generators", "static analyzers", or "tooling").
* **No Branding or Leakage**: Avoid model branding, harness-specific identifiers, or ephemeral agent runtime metadata in repository assets.

