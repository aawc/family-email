# Operational Runbook

This runbook guides day-to-day maintenance, rule modifications, deployments, and diagnostic troubleshooting for the `family-email` system.

---

## 1. Development & Verification Workflow

All routing rules are version-controlled in `config/email-rules.yaml`. Never modify routing rules via external dashboards or directly in compiled bundles.

*For comprehensive recipes, schema constraints, Git workflow, and deployment steps, see the [Custom Rules Guide](custom-rules.md).*

### Step-by-Step Rule Update Procedure

```
1. Edit Rules
       │  Update config/email-rules.yaml
       ▼
2. Validate Configuration
       │  npm run validate:config
       ▼
3. Run Test Suite
       │  npm test
       ▼
4. Run Pre-flight Checks
       │  npm run check
       ▼
5. Deploy Worker
       │  npm run deploy
```

---

## 2. Local Verification Commands

Before committing any changes or triggering a deployment, execute the local verification gate:

```bash
# Validate configuration syntax, schema, and regex safety
npm run validate:config

# Run comprehensive unit and integration tests
npm test

# Verify zero secrets or private keys exist in the repository
npm run scan-secrets

# Validate documentation links and formatting
npm run validate:docs

# Master pre-flight check (runs typecheck, validation, tests)
npm run check
```

Output indicators follow strict accessibility conventions:
* `[PASS]`: Check passed successfully.
* `[FAIL]`: Error requiring remediation.
* `[WARN]`: Advisory warning (e.g. unanchored regex pattern).

---

## 3. Adding a New Destination Mailbox

Cloudflare Email Routing requires that any external forwarding target be verified before an Email Worker can forward messages to it.

If a new rule forwards to an unverified email address:

1. Navigate to **Cloudflare Dashboard** -> **Email** -> **Email Routing**.
2. Select the **Destination addresses** tab.
3. Click **Add destination address** and enter the destination email (e.g., `new-member@example.net`).
4. Cloudflare dispatches a confirmation email containing a verification link.
5. Have the mailbox owner click the verification link.
6. Once the status shows **Verified**, add the corresponding rule to `config/email-rules.yaml`.

---

## 4. Deploying Updates

Deployments use Cloudflare's official `wrangler` CLI:

### Dry-Run Deployment (Validation Build)

```bash
npm run build
```

This compiles TypeScript, bundles the YAML configuration via Wrangler text rules, and confirms the worker builds cleanly without deploying to production.

### Production Deployment

```bash
npm run deploy
```

Wrangler uploads the worker script and triggers an atomic, zero-downtime update across Cloudflare's global edge network.

---

## 5. Live Diagnostics & Log Tailing

To inspect incoming email traffic and debug routing decisions in real time:

```bash
npx wrangler tail
```

This establishes a WebSocket connection streaming live Cloudflare Worker events.

### Log Output Format

* **Successful Forward**:
  ```
  [INFO] Inbound message to: "shopping.bin@example.net"
  [INFO] Matched rule: "bin" -> Forwarding to "bin@example.net"
  ```
* **Rejected Recipient**:
  ```
  [INFO] Inbound message to: "unknown@example.net"
  [WARN] No matching rule found. Action: reject (Reason: Address not recognized)
  ```
* **Internal Routing Failure**:
  ```
  [CRITICAL] Unhandled email routing error for recipient "malformed@": ...
  ```

---

## 6. Incident Response & Rollback Procedures

If an invalid rule or regression causes legitimate email to reject:

1. **Immediate Git Rollback**:
   ```bash
   git revert HEAD
   npm run deploy
   ```
2. **Cloudflare Dashboard Version Rollback**:
   * Navigate to **Cloudflare Dashboard** -> **Workers & Pages** -> **family-email-worker**.
   * Under the **Deployments** tab, select the previous stable deployment.
   * Click **Rollback to this version** for instantaneous remediation while investigating the defect.

---

## 7. Branch Protection & Repository Governance

To protect the default branch from accidental force-pushing, deletion, or unverified changes, the repository enforces GitHub Rulesets and automated status checks.

Refer to the dedicated guide: [docs/github-branch-protection.md](github-branch-protection.md).
