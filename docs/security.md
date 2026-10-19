# Security Architecture & Threat Model

This document outlines the security architecture, threat model, trust boundaries, and hardening mechanisms implemented across the `family-email` system.

---

## 1. Threat Model & Trust Boundaries

The system processes untrusted input from the public internet (arbitrary SMTP senders) and delivers it to trusted, pre-existing mailboxes.

```
+--------------------------------------------------------------------------+
| UNTRUSTED EXTERNAL ZONE (Internet SMTP senders)                          |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
| CLOUDFLARE INGESTION BOUNDARY                                            |
| - IP reputation screening                                                |
| - Standard MX protocol sanitization                                      |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
| WORKER EXECUTION BOUNDARY (Isolated V8 Sandbox)                          |
| - Recipient normalization & validation                                   |
| - Static, pre-compiled regex matching                                    |
| - ZERO user-controllable destination injection                           |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
| TRUSTED DESTINATIONS (Pre-verified Cloudflare Mailboxes)                 |
+--------------------------------------------------------------------------+
```

---

## 2. Invariant Security Policies

### Policy 1: Zero Open Mail Relays

An open mail relay allows third parties to route arbitrary traffic to arbitrary destinations.
In this system:
* Destinations are strictly hardcoded in `config/email-rules.yaml`.
* The incoming email recipient (`message.to`) is used ONLY as a search key against static regular expressions.
* Cloudflare Email Routing cryptographically refuses to forward to any destination that has not completed out-of-band email verification.

### Policy 2: Regular Expression Denial of Service (ReDoS) Defense

Malicious senders can craft catastrophic recipient strings designed to trigger exponential backtracking in regular expression engines.
Mitigations:
1. **Length Bounds**: Input strings are constrained; regex patterns in configuration are restricted to <= 256 characters.
2. **Structural Pattern Analysis**: The configuration validator (`scripts/validate-config.ts`) screens for nested quantifiers (`(a+)+`, `(.*)*`).
3. **Execution Timeouts**: Cloudflare Workers enforce a 50ms CPU limit per invocation. If a pattern exceeds the ceiling, execution aborts safely.
4. **Isolated Error Boundaries**: All regex evaluations in `src/router.ts` run inside guarded try/catch blocks; unexpected regex errors result in safe rejection rather than hanging or leaking state.

### Policy 3: Secret Isolation & Storage

No secrets or credentials may reside within this Git repository.
* **Inbound Routing**: Requires ZERO secrets. Worker configuration is declarative and uses Cloudflare's internal execution context.
* **Outbound Sending (Brevo)**: SMTP credentials (`xkeysib-...`) are configured exclusively inside the user's email client (e.g. Gmail "Send mail as") and Cloudflare dashboard secrets.
* **Automated Secret Scanner**: The repository includes `scripts/scan-secrets.ts` which runs on pre-commit and in CI, actively scanning for API keys, private keys, and token signatures.

### Policy 4: Anti-Spoofing & Domain Authentication

To protect the domain against phishing and unauthorized sender impersonation:
* **Combined SPF**: Specifies both Cloudflare inbound endpoints and Brevo outbound relays (`v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all`).
* **Cryptographic DKIM**: Outbound messages are signed with Brevo's 2048-bit RSA key.
* **DMARC Enforcement**: Strict policy (`p=quarantine`) instructs remote mailboxes to quarantine unauthenticated messages claiming to originate from the domain.

### Policy 5: Personal Data & Privacy Protection

Public documentation and example configurations must never expose real family email addresses.
* Sanitized examples in documentation use `alice@example.net`, `bob@example.net`, or `<DESTINATION_EMAIL>`.
* The automated scanner flags unredacted personal mailboxes across tracked Markdown documents.

### Policy 6: Dependency Security & Supply Chain Defense

The repository minimizes runtime dependencies (only `yaml` is bundled for configuration parsing). To protect development and testing environments:
* **Strict Overrides Pinning**: Transitive build and test toolchain dependencies (including `vitest`, `rollup`, `tinypool`, `vite`, `sharp`, `undici`, `ws`, `postcss`, `esbuild`, and `@fastify/busboy`) are strictly constrained via `overrides` in `package.json` to prevent malicious or vulnerable versions from entering the dependency tree.
* **Hermetic Local Verification**: All updates are verified using automated unit tests (`vitest run`), static type checking (`tsc --noEmit`), configuration schema checks, and secret scans before deployment.
* **Continuous Dependabot Auditing**: Automated dependency vulnerability alerts are triaged and remediated by updating root devDependencies and pinning safe transitive overrides.

### Policy 7: Least-Privilege CI Workflow Permissions (`GITHUB_TOKEN` Hardening)

All automated GitHub Actions workflows (including `.github/workflows/validate.yml`) must explicitly restrict the automatic `GITHUB_TOKEN` permissions to the minimum scopes required for job execution.
* Workflows that only execute linting, testing, and dry-run builds must declare top-level `permissions: { contents: read }`.
* Omitting the `permissions` block leaves token permissions unconstrained, violating the principle of least privilege.
* Write scopes (`contents: write`, `pull-requests: write`, etc.) are strictly prohibited unless specifically required for deployment or release jobs.

---

## 3. Incident Severity Matrix

| Severity | Description | Immediate Action |
| :--- | :--- | :--- |
| `[CRITICAL]` | Committed SMTP API key or Cloudflare secret | Immediately revoke token in provider dashboard; rotate credentials; scrub git history. |
| `[HIGH]` | Regex catastrophic backtracking / Worker timeout loop | Revert the faulty rule; redeploy worker; update `scripts/validate-config.ts` to flag pattern. |
| `[MEDIUM]` | Misrouted alias delivering to incorrect mailbox | Update rule precedence order in `config/email-rules.yaml`; deploy fix. |
| `[LOW]` | Unanchored pattern warning | Add `^` and `$` anchors to rule pattern; re-run `npm run validate:config`. |
