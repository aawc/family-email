# GitHub Actions Workflow Permissions Hardening Plan

## 1. Problem Statement & Root Cause

### Problem
GitHub Actions security analysis reported a medium-severity warning for the CI workflow:
```
Workflow does not contain permissions
Actions job or workflow does not limit the permissions of the GITHUB_TOKEN. Consider setting an explicit permissions block, using the following as a minimal starting point: {contents: read}
```

### Root Cause Analysis
- **Defect Mechanism**: The workflow configuration `.github/workflows/validate.yml` lacked an explicit `permissions` block at both the top level and the individual job level.
- **Trigger Conditions**: When a workflow omits an explicit `permissions` block, GitHub assigns default permissions to the automatic `GITHUB_TOKEN` secret based on repository or organization settings (often defaulting to read-and-write for all scopes, or inheriting broad permissions).
- **Security Impact**: Granting unconstrained permissions violates the principle of least privilege. In the event of a compromised third-party build tool, compromised npm dependency, or malicious pull request script, an over-privileged `GITHUB_TOKEN` could be abused to push unauthorized commits, overwrite releases, modify issue metadata, or alter GitHub settings.
- **Remediation**: Setting an explicit top-level `permissions` block with `contents: read` restricts the `GITHUB_TOKEN` to read-only access for repository contents and revokes all other scopes (`issues`, `pull-requests`, `actions`, `packages`, `deployments`, etc.).

---

## 2. Technical Scope & Architecture

### 2.1 Workflow Analysis (`.github/workflows/validate.yml`)
The workflow defines a single job `validate` triggered on push and pull request to `main`:
1. `actions/checkout@v4`: Requires `contents: read` to fetch repository source code.
2. `actions/setup-node@v4`: Sets up Node.js 22 LTS (no token required).
3. `npm ci`: Installs project dependencies locally (no token required).
4. `npm run typecheck`: Static TypeScript validation (no token required).
5. `npm run scan-secrets`: In-repo secret scanner (no token required).
6. `npm run validate:config`: Configuration schema validator (no token required).
7. `npm run validate:docs`: Documentation link and formatting validator (no token required).
8. `npm test`: Vitest test runner (no token required).
9. `npm run build`: Dry-run Cloudflare Worker compilation via Wrangler (no token required).

None of the steps write to the repository, create GitHub releases, publish packages, or interact with GitHub issues or pull requests via the API. Therefore, `contents: read` is strictly sufficient for all job operations.

### 2.2 Invariant Verification
- Top-level workflow placement:
  ```yaml
  name: Validate

  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]

  permissions:
    contents: read

  jobs:
    validate:
      runs-on: ubuntu-latest
      ...
  ```
- Setting permissions at the workflow level applies securely across all current and future jobs in this workflow file.

---

## 3. Files Impacted

| File Path | Description of Changes |
| :--- | :--- |
| `.github/workflows/validate.yml` | Add top-level `permissions: { contents: read }` block. |
| `docs/workflow-permissions-hardening-plan.md` | Pre-implementation design and remediation plan (this document). |
| `docs/security.md` | Add Policy 7 documenting least-privilege CI workflow token permissions. |
| `docs/PLAN.md` | Update CI Pipeline section to document the permissions restriction. |

---

## 4. Verification & Validation Plan

1. **Pre-flight Check Gate**:
   Execute `corepack npm run check` to ensure:
   - TypeScript compiles cleanly (`tsc --noEmit`).
   - Configuration validator passes (`scripts/validate-config.ts`).
   - Secret scanner detects zero leaks (`scripts/scan-secrets.ts`).
   - Documentation validator passes (`scripts/validate-docs.ts`).
   - Vitest unit and integration test suite passes 100% (37/37 tests).
2. **Worker Dry-Run Build**:
   Execute `corepack npx wrangler deploy --dry-run` to ensure Worker bundling succeeds.
3. **YAML Syntax Validation**:
   Ensure `.github/workflows/validate.yml` adheres to valid YAML structure and GitHub Actions workflow schema.
4. **Clean Git Hygiene**:
   Inspect `git status` and `git diff` to guarantee only expected files are staged.
