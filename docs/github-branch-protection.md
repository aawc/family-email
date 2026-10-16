# GitHub Branch Protection & Ruleset Configuration Guide

This guide details the remediation procedure for the GitHub repository warning:
```
Your main branch isn't protected
Protect this branch from force pushing or deletion, or require status checks before merging.
```

In accordance with repository operational standards, all remote website configuration steps are documented here rather than existing solely in ephemeral chat instructions.

```
[VERIFICATION STATUS CODES]
* [PASS]: Verified and active.
* [PENDING]: Awaiting dashboard configuration, initial PR run, or admin confirmation.
* [WARN]: Configuration trade-off or potential friction point.
* [FAIL]: Insecure or invalid configuration state.
```

---

## 1. Technical Analysis & Risk Assessment

When a GitHub repository default branch (`main`) is unprotected:
1. **Unrestricted Force Pushes**: Any contributor or tool with write access can execute `git push --force` or `--force-with-lease`, overwriting historical commits and destroying the auditable commit trail.
2. **Accidental Deletion**: The default branch can be deleted or renamed directly via git CLI or web UI.
3. **CI Gate Bypass**: Commits can be pushed directly to `main` without executing the automated test suite, secrets scanner, configuration validator, or documentation verifier defined in `.github/workflows/validate.yml`.

### Architecture Trade-Off Matrix

| Configuration Model | Push Mechanism | CI Status Enforcement | Solo Maintainer Friction | Auditability & Safety |
| :--- | :--- | :--- | :--- | :--- |
| **Model A: Ruleset with PR & Status Checks (Recommended)** | Feature branch -> PR | Automated and mandatory before merge (`[PASS]`) | Low (Set required approvals to 0 to self-merge) | High: No unverified code reaches `main` (`[PASS]`) |
| **Model B: Direct Push with Deletion/Force-Push Block Only** | Direct `git push origin main` | Cannot be enforced by GitHub prior to commit landing (`[WARN]`) | Zero friction (`[PASS]`) | Medium: History is safe, but broken code can land (`[WARN]`) |
| **Model C: Model A with Admin Bypass** | Direct push or PR | Enforced on PRs; Admin can bypass in emergencies (`[PASS]`) | Very low (`[PASS]`) | High, provided bypass is reserved for emergencies (`[PASS]`) |

**Technical Conclusion**: **Model A (or Model C)** is the standard engineering choice. GitHub cannot evaluate asynchronous CI status checks on direct `git push` commands. Therefore, enforcing that CI passes requires either creating a Pull Request or relying solely on local discipline (`npm run check`) prior to pushing.

---

## 2. Remote Configuration: Modern GitHub Rulesets (Recommended)

GitHub Rulesets provide granular, modern branch management that replaces legacy branch protection rules.

### Step 2.1: Navigate to Repository Rulesets
1. Open the repository on GitHub: `https://github.com/aawc/family-email`.
2. Click the **Settings** tab in the top repository navigation bar.
3. In the left sidebar, expand the **Rules** section and click **Rulesets**.
4. Click the **New ruleset** dropdown button and select **New branch ruleset**.

### Step 2.2: Configure General Ruleset Settings
1. **Ruleset Name**: Enter `Protect main branch`.
2. **Enforcement status**: Select **Active**.

### Step 2.3: Define Target Branch
1. Under the **Target branches** section, click **Add target**.
2. Select **Include default branch** from the dropdown.
   * This automatically targets `main` and remains valid even if the default branch is ever renamed.

### Step 2.4: Configure Branch Protections (Force Push & Deletion)
In the **Rules** section:
1. Check **Restrict deletions**:
   * Prevents anyone from deleting the `main` branch.
2. Check **Block force pushes**:
   * Disallows `git push --force` and preserves linear/commit history integrity.

### Step 2.5: Configure Status Checks (Automated CI Verification)
1. Check **Require status checks to pass**.
2. Click **+ Add checks**.
3. In the search box, type `validate` (this corresponds to the job name `validate` defined in `.github/workflows/validate.yml`).
4. Select `validate` from the dropdown list.
5. Check **Require branches to be up to date before merging**:
   * Ensures tests have passed against the current state of `main` before merging, preventing semantic merge conflicts.

### Step 2.6: Configure Pull Request Requirements (Solo vs Team Setup)
1. Check **Require a pull request before merging**.
2. **Required approvals**:
   * For **Solo Maintainer** repositories: Set **Required approvals** to `0` (or uncheck required approvals if your GitHub UI allows it).
     * *Rationale*: If set to `1` or higher, GitHub will prevent you from approving and merging your own PRs without adding a second GitHub account as a collaborator.
   * For **Team** repositories: Set **Required approvals** to `1` or more.
3. Check **Dismiss stale pull request approvals when new commits are pushed** (if approvals are required).

### Step 2.7: Configure Bypass Permissions (Optional Admin Emergency Bypass)
1. Scroll to the **Bypass list** section at the top of the ruleset.
2. Click **Add bypass**.
3. Select **Role** -> **Repository admin**.
4. In the bypass options dropdown:
   * Select **For pull requests only** (allows admins to merge PRs even if checks are pending in emergency situations) OR **Always** (allows emergency direct pushes if GitHub Actions is degraded).
   * Leave blank if strict non-bypassable enforcement is preferred.

### Step 2.8: Save Ruleset
1. Click **Create** (or **Save changes**) at the bottom of the page.
2. Confirm the ruleset status is marked `[PASS]` (Active).

---

## 3. Remote Configuration: Classic Branch Protection (Alternative)

If your GitHub organization tier or UI preferences favor classic branch protection rules:

1. In repository **Settings**, select **Branches** from the left navigation.
2. Under "Branch protection rules", click **Add branch protection rule** (or **Add rule**).
3. **Branch name pattern**: Enter `main`.
4. Enable the following settings:
   * Check **Require a pull request before merging**.
     * Uncheck "Require approvals" (or set required approvals to 0) for solo repositories.
   * Check **Require status checks to pass before merging**.
     * Check **Require branches to be up to date before merging**.
     * In the "Status checks that are required" search bar, search for and check `validate`.
   * Check **Do not allow bypassing the above settings** (or leave unchecked for admin override).
   * Confirm that "Allow force pushes" is **Unchecked**.
   * Confirm that "Allow deletions" is **Unchecked**.
5. Click **Create** or **Save changes**.

---

## 4. Local Development Workflow with Branch Protection

Once branch protection is active, direct pushes (`git push origin main`) will be rejected by GitHub with:
```
remote: error: GH006: Protected branch update failed for refs/heads/main.
```

Adopt the following standardized feature branch workflow:

### Step 4.1: Create a Feature Branch
```bash
# Ensure local main is up to date
git checkout main
git pull origin main

# Create and switch to a descriptive feature or fix branch
git checkout -b feature/update-routing-rules
```

### Step 4.2: Develop, Test, and Verify Locally
```bash
# Make modifications to config/email-rules.yaml or code
# Run local pre-flight gate before pushing
npm run check
```

### Step 4.3: Push Feature Branch and Open PR
```bash
git push -u origin feature/update-routing-rules
```
Open the generated GitHub Pull Request URL.

### Step 4.4: Merge into Main
1. Wait for the `validate` GitHub Actions workflow to finish (`[PASS]`).
2. Click **Squash and merge** (or **Rebase and merge**).
3. Delete the remote feature branch.
4. Locally sync:
   ```bash
   git checkout main
   git pull origin main
   git branch -d feature/update-routing-rules
   ```

---

## 5. Verification Checklist

After completing the dashboard steps, verify your configuration:

* `[PASS]` Warning banner on repository overview page has disappeared.
* `[PASS]` `main` branch displays the "Protected" badge under `https://github.com/aawc/family-email/branches`.
* `[PASS]` Force pushing is rejected: Attempting `git push --force origin main` fails with a remote protection error.
* `[PASS]` Pull Request status check `validate` is required before the merge button becomes active.
* `[PASS]` Required approvals setting allows the repository owner to merge their own pull requests.
