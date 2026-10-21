# Writing, Testing, and Pushing Custom Email Rules

This guide provides complete instructions for authoring custom email routing rules, testing them locally, committing them to version control, and deploying them live to Cloudflare.

---

## Table of Contents

1. [How Custom Rules Work](#1-how-custom-rules-work)
2. [Writing Custom Rules](#2-writing-custom-rules)
   - [Rule Schema & Fields](#rule-schema--fields)
   - [Evaluation Order (First-Match-Wins)](#evaluation-order-first-match-wins)
   - [Regex Rules & Syntax Requirements](#regex-rules--syntax-requirements)
   - [Rule Recipe Catalog](#rule-recipe-catalog)
   - [Pre-Requisite: Destination Address Verification](#pre-requisite-destination-address-verification)
   - [Unmatched Mail Policy (`no_match`)](#unmatched-mail-policy-no_match)
3. [Testing Rules Locally](#3-testing-rules-locally)
   - [Step 1: Configuration Validation](#step-1-configuration-validation)
   - [Step 2: Automated Routing Tests](#step-2-automated-routing-tests)
   - [Step 3: Writing Tests for Your New Rules](#step-3-writing-tests-for-your-new-rules)
   - [Step 4: Master Pre-Flight Check](#step-4-master-pre-flight-check)
4. [Pushing Rules to Git (Version Control)](#4-pushing-rules-to-git-version-control)
   - [Inspecting the Diff](#inspecting-the-diff)
   - [Creating a Feature Branch](#creating-a-feature-branch)
   - [Committing Changes Atomically](#committing-changes-atomically)
   - [Pushing to Remote & Pull Requests](#pushing-to-remote--pull-requests)
5. [Pushing Rules to Cloudflare (Live Deployment)](#5-pushing-rules-to-cloudflare-live-deployment)
   - [How Worker Bundling Works](#how-worker-bundling-works)
   - [Dry-Run Build Check](#dry-run-build-check)
   - [Deploying Live to the Edge](#deploying-live-to-the-edge)
   - [Verifying Live Deliveries (`wrangler tail`)](#verifying-live-deliveries-wrangler-tail)
   - [Emergency Rollback](#emergency-rollback)
6. [Common Pitfalls & Troubleshooting](#6-common-pitfalls--troubleshooting)

---

## 1. How Custom Rules Work

In this system, routing rules are **configuration, not code**:
* All routing rules reside in `config/email-rules.yaml`.
* The Cloudflare Worker (`src/index.ts`) imports `config/email-rules.yaml` at build time.
* When you run `npm run deploy`, Cloudflare's `wrangler` tool compiles the TypeScript Worker, packages the YAML rules directly into the Worker bundle, and deploys it to Cloudflare's global edge network.
* Incoming email events are matched against these rules in memory, and the Worker forwards or rejects the message in milliseconds.

```
+-------------------------------------------------------------------------+
|                        THE RULE LIFECYCLE                               |
|                                                                         |
|  1. Edit Rules         Edit config/email-rules.yaml                     |
|         │                                                               |
|         ▼                                                               |
|  2. Test Locally       npm run check (validates syntax & runs tests)   |
|         │                                                               |
|         ▼                                                               |
|  3. Push to Git        git commit && git push (version control)         |
|         │                                                               |
|         ▼                                                               |
|  4. Deploy to Edge     npm run deploy (pushes live to Cloudflare)       |
+-------------------------------------------------------------------------+
```

---

## 2. Writing Custom Rules

All rules are defined in `config/email-rules.yaml`. Open this file in your editor to add or change rules.

### Rule Schema & Fields

Each entry in the `rules:` list represents an individual routing decision:

```yaml
domain: yourdomain.com

rules:
  - name: my-rule-name           # [REQUIRED] Unique alphanumeric identifier
    pattern: "^.+\\.bin$"         # [REQUIRED] Anchored JavaScript regular expression
    destination: user@gmail.com  # [REQUIRED] Pre-verified destination email address
    description: "Brief note"    # [OPTIONAL] Human-readable documentation
```

#### Field Constraints:
* `name`: Must be unique across all rules. Only alphanumeric characters, hyphens (`-`), and underscores (`_`) are allowed (e.g. `backup-bin`, `shopping_rule`).
* `pattern`: Must be a valid JavaScript regular expression:
  * Maximum length: 256 characters.
  * Must be enclosed in double quotes (e.g. `"^.+\\.bin$"`).
  * Must be anchored with `^` at the start and `$` at the end.
  * Must not contain nested quantifiers that risk ReDoS (e.g., `(a+)+` is prohibited).
* `destination`: Must be a syntactically valid email address (RFC 5322) that has been **pre-verified** in the Cloudflare Dashboard.
* `description`: Optional text explaining the purpose of the rule.

---

### Evaluation Order (First-Match-Wins)

**The order of rules in `config/email-rules.yaml` is load-bearing.**

The Worker iterates through the rules from top to bottom. As soon as a rule's regex matches the incoming local-part, the email is forwarded to that destination and evaluation **stops immediately**. Subsequent rules are ignored.

#### Crucial Ordering Principle: Specific Before General
Always place specific exception rules **above** broad wildcard rules.

```yaml
rules:
  # 1. SPECIFIC EXCEPTION (Must come first)
  - name: backup-bin
    pattern: "^backup\\.bin$"
    destination: admin@yourdomain.com
    description: "Only backup.bin goes to the admin mailbox"

  # 2. GENERAL WILDCARD (Must come second)
  - name: bin
    pattern: "^.+\\.bin$"
    destination: general-bin@yourdomain.com
    description: "All other *.bin addresses go to the general bin mailbox"
```

* If someone sends to `backup.bin@yourdomain.com`: Rule 1 matches &rarr; forwarded to `admin@yourdomain.com`.
* If someone sends to `shopping.bin@yourdomain.com`: Rule 1 does not match; Rule 2 matches &rarr; forwarded to `general-bin@yourdomain.com`.

If Rule 2 were placed above Rule 1, `backup.bin` would match `^.+\\.bin$` first and be sent to `general-bin@yourdomain.com`. Rule 1 would be shadowed and never execute!

---

### Regex Rules & Syntax Requirements

The regular expression is matched against the **local-part** of the incoming address (everything before the `@` symbol).

Incoming addresses are automatically normalized before matching:
* Surrounding whitespace is trimmed.
* The address is converted to lowercase.
* The domain portion is stripped.
* Example: `  Shopping.Bin+receipt@YourDomain.Com  ` becomes `shopping.bin+receipt`.

#### Three Syntax Rules to Always Follow:
1. **Always Anchor**: Start with `^` (start of string) and end with `$` (end of string).
   * Good: `"^.+\\.bin$"` (matches `store.bin`)
   * Bad: `".bin"` (matches `combination`, `cabin.org`, `bin.other`)
2. **Always Escape Literal Dots with Double Backslashes**:
   * In YAML double-quoted strings, a literal dot must be written as `\\.`.
   * Good: `"^.+\\.bin$"` (matches only a real dot followed by `bin`)
   * Bad: `"^.+bin$"` (matches `robin`, `cabin`, `dustbin`)
3. **Keep Patterns Linear**:
   * Avoid nested quantifiers like `^([a-z]+)+$` which cause catastrophic backtracking.

---

### Rule Recipe Catalog

Here are copy-pasteable patterns for common real-world use cases:

#### Recipe 1: Catch-All Service Suffix (`*.bin`)
Directs any address ending with `.bin` to a disposable/service inbox.
```yaml
  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@gmail.com
    description: "Routes shopping.bin, store.bin, uber.bin to bin mailbox"
```

#### Recipe 2: Exact Mailbox Alias (`family`)
Directs only an exact single address (e.g. `family@yourdomain.com`).
```yaml
  - name: family
    pattern: "^family$"
    destination: shared-family@gmail.com
    description: "Routes only family@yourdomain.com"
```

#### Recipe 3: Multi-Keyword Match (`(shopping|orders|receipts).bin`)
Matches multiple specific sub-services with one rule using a group:
```yaml
  - name: commerce-bin
    pattern: "^(shopping|orders|receipts|delivery)\\.bin$"
    destination: purchases@gmail.com
    description: "Routes shopping, orders, receipts, and delivery to purchases"
```

#### Recipe 4: Sub-Addressing / Plus-Addressing (`bin+tag`)
Matches a base name with or without an optional plus-tag:
```yaml
  - name: plus-bin
    pattern: "^bin(\\+[a-z0-9_-]+)?$"
    destination: bin@gmail.com
    description: "Matches bin@ and bin+newsletter@, bin+spam@"
```

#### Recipe 5: Prefix-Based Routing (`alert.*`)
Routes any system alert prefix to a monitoring inbox:
```yaml
  - name: system-alerts
    pattern: "^alert\\..+$"
    destination: oncall@gmail.com
    description: "Routes alert.server, alert.backup, alert.disk to oncall"
```

#### Recipe 6: Family Member Partitioning
Routes separate namespaces to different family members' personal inboxes:
```yaml
  # Alice's addresses: *.alice@yourdomain.com or alice@yourdomain.com
  - name: alice-wildcard
    pattern: "^(.+\\.)?alice$"
    destination: alice.personal@gmail.com

  # Bob's addresses: *.bob@yourdomain.com or bob@yourdomain.com
  - name: bob-wildcard
    pattern: "^(.+\\.)?bob$"
    destination: bob.personal@gmail.com
```

---

### Pre-Requisite: Destination Address Verification

**CRITICAL CLOUDFLARE REQUIREMENT**:
Before adding any new destination address to `config/email-rules.yaml`, that address **must be verified** in the Cloudflare Dashboard.

If you route email to an unverified address, Cloudflare will silently drop or bounce the message.

#### How to Verify a New Destination Address:
1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) and select your domain.
2. Go to **Email** -> **Email Routing** -> **Destination addresses** tab.
3. Click **Add destination address**.
4. Enter the email address (e.g., `newmember@gmail.com`) and click **Save**.
5. Check that inbox for an email from Cloudflare titled `Verify your email address for Cloudflare Email Routing`.
6. Click the verification button inside the email.
7. Return to Cloudflare and confirm the status badge displays **Verified** (`[PASS]`).
8. Now you can safely use this address in `config/email-rules.yaml`.

---

### Unmatched Mail Policy (`no_match`)

At the bottom of `config/email-rules.yaml`, configure the fallback action for mail that doesn't match any rule:

```yaml
no_match:
  action: reject
  reason: "Address not recognized"
```

* `action: reject`: Instructs Cloudflare to return an immediate SMTP 550 rejection to the sender MTA. This prevents your mailbox from being flooded by spammers guessing random names.
* Do not set up a catch-all forward to a personal inbox unless you want all internet spam sent to your domain.

---

## 3. Testing Rules Locally

Never deploy rules without testing them locally first. The repository provides automated verification tools that test your configuration offline without sending real emails.

### Step 1: Configuration Validation
Validates YAML syntax, schema fields, regex validity, duplicate names, and safety:

```bash
npm run validate:config
```

Expected output:
```
[CONFIG VALIDATION] Starting configuration checks...
[CHECK] Validating: config/email-rules.yaml
  [PASS] config/email-rules.yaml is valid.
[SUMMARY] Errors: 0, Warnings: 0
[PASS] All configuration files validated successfully.
```

If you made a syntax error (e.g. unanchored regex or invalid email syntax), the script reports `[FAIL]` and points to the exact rule and line number.

---

### Step 2: Automated Routing Tests
Runs the test suite with Vitest to ensure all existing routing logic passes:

```bash
npm test
```

Expected output:
```
Test Files  2 passed (2)
Tests       37 passed (37)
```

---

### Step 3: Writing Tests for Your New Rules
Whenever you add a custom rule to `config/email-rules.yaml`, you should add a corresponding test case in `tests/rules.test.ts` to prove that your rule routes as expected and cannot regress in future edits.

Open `tests/rules.test.ts` and locate the `testCases` array:

```typescript
// Inside tests/rules.test.ts
const testCases = [
  // Existing tests...
  {
    email: 'shopping.bin@example.net',
    expectedMatched: true,
    expectedRule: 'bin',
    expectedDestination: 'bin@example.net',
  },

  // ADD YOUR NEW RULE TEST HERE:
  {
    email: 'my-custom-address.bin@example.net',
    expectedMatched: true,
    expectedRule: 'my-rule-name',
    expectedDestination: 'my-destination@example.net',
  },

  // ADD A REJECTION TEST FOR ADDRESSES THAT SHOULD NOT MATCH:
  {
    email: 'not-matching@example.net',
    expectedMatched: false,
    expectedRule: undefined,
    expectedDestination: undefined,
  },
];
```

Run `npm test` again to confirm your new test passes!

---

### Step 4: Master Pre-Flight Check
Run the master gate, which executes typechecking, configuration validation, secret scanning, documentation link checks, and all unit tests in a single command:

```bash
npm run check
```

Once all checks return `[PASS]`, your rules are verified and ready to be pushed.

---

## 4. Pushing Rules to Git (Version Control)

Because routing rules live in `config/email-rules.yaml`, every rule change should be committed to Git to maintain an auditable history of who added what alias and when.

### Inspecting the Diff
Review your changes before staging:

```bash
git status
git diff config/email-rules.yaml
```

Ensure only intended rules were modified and no private credentials or secret tokens were added.

### Creating a Feature Branch
If you are collaborating or using GitHub Rulesets/branch protection on `main`:

```bash
git checkout -b update-email-rules
```

### Committing Changes Atomically
Stage only your configuration and test changes:

```bash
git add config/email-rules.yaml tests/rules.test.ts
git commit -m "rules: add shopping and family aliases to email router

- Add shopping.bin rule routing to primary mailbox.
- Add family alias rule routing to shared family inbox.
- Add table-driven integration tests in tests/rules.test.ts."
```

### Pushing to Remote & Pull Requests
Push your branch to GitHub:

```bash
git push -u origin update-email-rules
```

If branch protection is enabled, open a Pull Request on GitHub. GitHub Actions will automatically run the CI validation workflow (`.github/workflows/validate.yml`). Once status checks pass `[PASS]`, merge the Pull Request into `main`.

---

## 5. Pushing Rules to Cloudflare (Live Deployment)

Committing to Git updates your source history, but **does not automatically update Cloudflare's edge servers** unless a CD pipeline is configured.

To push the new rules live to Cloudflare edge locations, you deploy the Worker.

### How Worker Bundling Works
Cloudflare Worker bundling is configured in `wrangler.jsonc`:
```jsonc
"rules": [
  {
    "type": "Text",
    "globs": ["**/*.yaml", "**/*.yml"],
    "fallthrough": true
  }
]
```
When Wrangler builds the Worker, it bundles `config/email-rules.yaml` directly into the compiled JavaScript bundle. Updating the rules requires uploading a new Worker build.

---

### Dry-Run Build Check
Before pushing live, verify that Wrangler can build and bundle your configuration cleanly:

```bash
npm run build
```

This compiles TypeScript, bundles the YAML rules, and confirms the worker package is valid without publishing to Cloudflare.

---

### Deploying Live to the Edge
To push your rules live across Cloudflare's global network:

```bash
npm run deploy
```

*(Alternatively: `npx wrangler deploy`)*

Expected output:
```
Total Upload: ~35 KiB / gzip: ~8 KiB
Uploaded family-email-worker (0.85 sec)
Current Version ID: a1b2c3d4-e5f6-7890-abcd-1234567890ab
```

The deployment is atomic and takes effect globally within seconds with zero downtime.

---

### Verifying Live Deliveries (`wrangler tail`)
To observe incoming email traffic and confirm your new rule matches live messages:

1. In your terminal, start the live log stream:
   ```bash
   npx wrangler tail
   ```
2. Send a test email from an external account (e.g. your phone or work email) to your newly configured address:
   `my-test.bin@yourdomain.com`
3. Watch the log output in your terminal:
   ```
   [INFO] Inbound message to: "my-test.bin@yourdomain.com"
   [INFO] Matched rule: "bin" -> Forwarding to "user@gmail.com"
   ```
4. Verify that the email appears in the destination inbox within 5-15 seconds.

---

### Emergency Rollback
If a newly pushed rule causes unexpected behavior or bounces legitimate mail:

#### Option A: Cloudflare Dashboard Instant Rollback (Fastest)
1. Open Cloudflare Dashboard -> **Workers & Pages** -> **family-email-worker**.
2. Click the **Deployments** tab.
3. Find the previous stable version in the deployment history.
4. Click the three dots `...` next to it and select **Rollback to this version**.
5. The previous routing configuration is restored immediately.

#### Option B: Git Revert and Redeploy
1. Revert the commit in Git:
   ```bash
   git revert HEAD
   ```
2. Redeploy the previous configuration:
   ```bash
   npm run deploy
   ```

---

## 6. Common Pitfalls & Troubleshooting

### Pitfall 1: Unverified Destination Address
* **Symptom**: `npm run deploy` succeeds, `wrangler tail` logs `Forwarding to user@gmail.com`, but the email never arrives in the inbox.
* **Cause**: Cloudflare requires that every destination address be verified in **Email Routing** -> **Destination addresses**.
* **Remediation**: Check the destination tab in Cloudflare. If it shows `[PENDING]`, resend the verification email and click the confirmation link.

### Pitfall 2: Rule Shadowing (Ordering Mistake)
* **Symptom**: Mail sent to `backup.bin@yourdomain.com` goes to `general@gmail.com` instead of `admin@gmail.com`.
* **Cause**: A general wildcard rule (`^.+\\.bin$`) appears in the file *before* the specific rule (`^backup\\.bin$`).
* **Remediation**: Reorder the rules in `config/email-rules.yaml` so the specific exception rule appears above the broad rule.

### Pitfall 3: Unanchored Regex Warning
* **Symptom**: `npm run validate:config` outputs a warning: `Pattern is not anchored with ^ and $`.
* **Cause**: The pattern was written without `^` or `$`, such as `".bin"`. This pattern would match `combination@yourdomain.com` and `bin.extra@yourdomain.com`.
* **Remediation**: Always anchor the pattern: `"^.+\\.bin$"`.

### Pitfall 4: Missing Double Backslash on Dots
* **Symptom**: Pattern `"^.+bin$"` matches `robin@yourdomain.com` and `cabin@yourdomain.com`.
* **Cause**: In regular expressions, a single unescaped dot `.` matches any character.
* **Remediation**: Write literal dots as `\\.` (e.g. `"^.+\\.bin$"`).

### Pitfall 5: Catch-All Rule Not Bound to Worker
* **Symptom**: Test email bounces with an MX or 550 error before reaching the Worker.
* **Cause**: In Cloudflare Dashboard -> **Email Routing** -> **Routing rules**, the Catch-all rule is disabled or set to "Drop" instead of "Send to a Worker: family-email-worker".
* **Remediation**: Edit the Catch-all rule in Cloudflare Dashboard and select **Send to a Worker** pointing to `family-email-worker`.
