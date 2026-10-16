# Family Domain Email

A lightweight, serverless email routing system for personal and family domains managed by Cloudflare.

Instead of paying \$6 to \$12 per user per month for hosted mailboxes (like Google Workspace or Microsoft 365) or running your own complex email server, this project lets you receive email at unlimited custom addresses on your own domain and route them straight to your existing personal mailbox (such as Gmail, Outlook, or iCloud).

```
Incoming email sent to:
shopping.bin@yourdomain.com
          │
          ▼
   Cloudflare DNS
          │
          ▼
Cloudflare Email Routing
          │
          ▼
Cloudflare Email Worker
  (Checks rule: does it end in ".bin"?)
          │
          ▼ [MATCH]
Forwarded directly to your existing mailbox:
   bin@gmail.com
```

Addresses do not need to be created one by one. The recipient address is matched against ordered regular expressions in configuration and forwarded automatically:

```
anything.bin@yourdomain.com  → bin@gmail.com
shopping.bin@yourdomain.com  → bin@gmail.com
backup.v@yourdomain.com      → vvvv@gmail.com
anything.v@yourdomain.com    → vvvv@gmail.com
family@yourdomain.com        → family@gmail.com
```

* For an exhaustive, click-by-click walkthrough, see the [Beginner Setup Guide](docs/setup-guide.md).
* For external dashboard instructions, see the [Remote Configuration Guide](docs/remote-configuration-guide.md).

---

## Architecture & Scope

```
[SYSTEM SCOPE]
* INBOUND (Receiving email):   [CORE FEATURE - REQUIRED]
  Receive mail at unlimited custom addresses and forward to existing mailboxes for $0/month.
* OUTBOUND (Sending email):    [COMPLETELY OPTIONAL]
  Send or reply to emails using your custom domain as the "From" address via an SMTP relay.
```

### Complete System Diagram

```
                         Internet
                            │
                            │ SMTP (Incoming mail)
                            ▼
                 ┌──────────────────────┐
                 │      Cloudflare      │
                 │         DNS          │
                 └──────────┬───────────┘
                            │
                            │ MX
                            ▼
                 ┌──────────────────────┐
                 │ Cloudflare Email     │
                 │ Routing              │
                 │                      │
                 │ Catch-all: *@domain  │
                 └──────────┬───────────┘
                            │
                            │ Dispatches event
                            ▼
                 ┌──────────────────────┐
                 │ Cloudflare Email     │
                 │ Worker               │
                 │                      │
                 │ Regex router engine  │
                 └──────────┬───────────┘
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
       bin@gmail.com   vvvv@gmail.com   family@gmail.com

--- OPTIONAL OUTBOUND PATH ---
Existing mailbox / email client (e.g., Gmail "Send mail as")
             │
             │ Authenticated SMTP submission
             ▼
       Brevo SMTP relay (or other SMTP provider)
             │
             │ DKIM signed delivery
             ▼
        Internet mail
```

---

## Why This Approach?

Operating a traditional mail server requires:
* Managing SMTP and IMAP daemons;
* Configuring complex spam filters (SpamAssassin, Rspamd);
* Maintaining server security, TLS certificates, and software patches;
* Managing IP reputation, reverse DNS (PTR), blocklists, and deliverability;
* Handling storage, backups, and quota management.

This system delegates all operational complexity to managed services:
* **Cloudflare** receives incoming mail and handles edge spam filtering for free.
* **A tiny TypeScript Worker** matches addresses against your rules and forwards them.
* **Your existing mailbox** (e.g. Gmail) stores your mail and provides search, spam filtering, and mobile apps.
* **An external SMTP relay** (optional) handles outbound deliverability if you choose to send mail from your domain.

Total operating cost: **\$0/month** (only your annual domain registration fee of ~\$10-\$15/year).

---

## Quick-Start Guide for Novices

Here is the high-level roadmap to set up your own domain email routing. For the detailed click-by-click walkthrough, consult the [Beginner Setup Guide](docs/setup-guide.md).

### Prerequisites
* **A custom domain** purchased from any registrar (Porkbun, Namecheap, Squarespace, GoDaddy, etc.).
* **A free Cloudflare account** ([cloudflare.com](https://dash.cloudflare.com/)).
* **An existing personal mailbox** (e.g. Gmail, Outlook) to receive forwarded mail.
* **Node.js installed on your computer** ([nodejs.org](https://nodejs.org/)).

---

### Step 1: Connect Your Domain to Cloudflare DNS
1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), click **Websites** -> **Add a site**.
2. Enter your domain name and select the **Free** plan.
3. Cloudflare will provide two nameservers (e.g. `ns1.cloudflare.com` and `ns2.cloudflare.com`).
4. Log in to your domain registrar, change your domain's nameservers to Cloudflare's, and save.
5. In Cloudflare, confirm the zone shows status **Active** (`[PASS]`).

---

### Step 2: Clone and Prepare the Project
In your terminal, clone this repository, install dependencies, and log in to Cloudflare:

```bash
git clone https://github.com/<your-account>/family-email.git
cd family-email
npm install
npx wrangler login
```

`wrangler login` will open a browser tab. Click **Allow** to authorize deployments.

---

### Step 3: Verify Destination Mailboxes in Cloudflare
Cloudflare requires proof of ownership for any external email address before it will forward mail to it.

1. In Cloudflare Dashboard, go to **Email** -> **Email Routing** -> **Destination addresses** tab.
2. Click **Add destination address** and enter your personal email (e.g., `yourname@gmail.com`).
3. Open your personal inbox, find the confirmation email from Cloudflare, and click the verification link.
4. Confirm the status displays **Verified** (`[PASS]`).
5. Repeat for any additional family members who will receive forwarded mail.

---

### Step 4: Configure Your Routing Rules
Open `config/email-rules.yaml` in your text editor.

Update `domain` to your domain, and define your routing rules:

```yaml
domain: yourdomain.com

rules:
  # Specific exception: backup-related mail goes to a special mailbox
  - name: backup-bin
    pattern: "^backup\\.bin$"
    destination: yourbackup@gmail.com
    description: "Emergency backup service alerts"

  # Wildcard rule: anything ending in .bin goes to your primary bin inbox
  # Matches: shopping.bin, newsletter.bin, banking.bin
  - name: bin
    pattern: "^.+\\.bin$"
    destination: yourprimary@gmail.com
    description: "Disposable and service aliases"

  # Sub-identity rule: anything ending in .v
  # Matches: service.v, alerts.v
  - name: version
    pattern: "^.+\\.v$"
    destination: yourversion@gmail.com
    description: "Secondary identity aliases"

  # Exact match rule: shared family inbox
  # Matches only: family@yourdomain.com
  - name: family
    pattern: "^family$"
    destination: sharedfamily@gmail.com
    description: "Shared household mailbox"

# Explicit policy for any incoming email that does not match a rule
no_match:
  action: reject
  reason: "Address not recognized"
```

---

### Step 5: Test and Validate Locally
Before deploying, run the local verification suite:

```bash
npm run check
```

This checks your YAML configuration, tests regex validity, scans for exposed credentials, and runs unit tests simulating email routing. Confirm all checks show `[PASS]`.

---

### Step 6: Deploy the Email Worker
Publish the Worker to your Cloudflare account:

```bash
npm run deploy
```

---

### Step 7: Enable Email Routing in Cloudflare
1. In Cloudflare Dashboard, go to **Email** -> **Email Routing**.
2. Click **Enable Email Routing** and allow Cloudflare to add the default MX and SPF DNS records automatically.
3. In the **Routing rules** tab, scroll to **Catch-all rule** and click **Edit**:
   * **Status**: Active / Enabled
   * **Action**: Send to a Worker
   * **Worker**: Select `family-email-worker`
4. Click **Save**.

---

### Step 8: Test Inbound Email Delivery
1. In your terminal, optionally open live event logs:
   ```bash
   npx wrangler tail
   ```
2. From a separate email account, send an email to `test.bin@yourdomain.com`.
3. Check your personal inbox (`yourprimary@gmail.com`). The message should arrive within 5-15 seconds!

---

## Understanding Routing Rules & Regex

### Rule Precedence: First-Match-Wins
Rules are evaluated in strict order from top to bottom. The first rule whose pattern matches the recipient's local-part forwards the email and stops evaluation.

Always place specific exception rules **before** general wildcard rules:
```yaml
rules:
  # 1. Specific exception (MUST be first)
  - name: special
    pattern: "^backup\\.bin$"
    destination: special@gmail.com

  # 2. General pattern (MUST be second)
  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@gmail.com
```

With this order:
* `backup.bin@yourdomain.com` matches `backup-bin` -> forwarded to `special@gmail.com`.
* `shopping.bin@yourdomain.com` matches `bin` -> forwarded to `bin@gmail.com`.

### Beginner Regex Cheat Sheet

The pattern is matched against the local part (everything before `@`):

| Desired Behavior | Example Inbound Addresses | Pattern | Explanation |
| :--- | :--- | :--- | :--- |
| **All addresses ending in `.bin`** | `store.bin`, `uber.bin` | `"^.+\\.bin$"` | `^` = start, `.+` = 1+ chars, `\\.` = dot, `bin$` = ends with bin |
| **All addresses ending in `.v`** | `news.v`, `alerts.v` | `"^.+\\.v$"` | Matches any prefix followed by `.v` |
| **Exact name only** | `family` | `"^family$"` | Matches only `family@yourdomain.com` |
| **Addresses starting with `alert.`** | `alert.server`, `alert.bank` | `"^alert\\..+$"` | Matches anything with `alert.` prefix |
| **Specific keyword exception** | `backup.bin` | `"^backup\\.bin$"` | Exact literal match |

* Always anchor patterns with `^` at the beginning and `$` at the end.
* Always escape dots as `\\.` (in regular expressions, an unescaped dot matches any character).

---

## Outbound Email (Sending as Your Domain) [OPTIONAL]

```
================================================================================
                           [OPTIONAL FEATURE NOTICE]
Setting up outbound email is COMPLETELY OPTIONAL.
If you only want to receive and read emails sent to your custom addresses,
you are already done! You do not need an SMTP relay, Brevo, or outbound DNS keys.
================================================================================
```

### When Do You Need Outbound Setup?
* **You DO NOT need it if**: You only want to receive emails, sign up for services with disposable aliases, and read forwarded messages in your personal inbox.
* **You DO need it if**: You want to compose a new message or reply to an email directly from `anything.bin@yourdomain.com` and have the recipient see your custom domain in the "From" field.

### High-Level Outbound Setup (Using Free Brevo Relay)
1. **Create an SMTP Relay Account**: Sign up for a free account at [Brevo](https://www.brevo.com/) (includes 300 free outgoing emails/day).
2. **Add Your Domain in Brevo**: Add `yourdomain.com` under **Senders, Domains & Dedicated IPs**.
3. **Add DNS Records in Cloudflare**:
   * Add Brevo's domain verification TXT record.
   * Add the DKIM TXT record (`mail._domainkey`).
   * **Merge SPF Records**: Update Cloudflare's SPF TXT record so both Cloudflare and Brevo are included in one record:
     ```
     v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
     ```
4. **Generate SMTP Credentials**: In Brevo, go to **Transactional** -> **Settings** -> **Configuration** and generate an SMTP key.
5. **Connect to Your Email Client**: In Gmail, go to **Settings** -> **Accounts and Import** -> **Send mail as** -> **Add another email address**. Enter your custom alias, Brevo's SMTP server (`smtp-relay.brevo.com`, port `587`), and your SMTP key. Verify the confirmation code sent to your inbox.

For comprehensive instructions and troubleshooting, see the [Beginner Setup Guide (Step 9)](docs/setup-guide.md#step-9-optional-outbound-email-sending-from-custom-addresses) and the [Remote Configuration Guide](docs/remote-configuration-guide.md).

---

## Day-to-Day Maintenance: Adding or Changing Rules

Whenever you want to add a new alias, change a destination, or add a family member:

1. **Edit**: Open `config/email-rules.yaml` and add or modify your rule.
2. **Validate**: Run `npm run check` in your terminal to verify syntax and tests.
3. **Deploy**: Run `npm run deploy`.

Changes take effect globally across Cloudflare edge locations within seconds.

---

## Repository Layout

```
family-email/
├── README.md                          # Primary overview and quick-start guide
├── AGENTS.md                          # Agent operating guidelines and system rules
├── PROMPT.md                          # Repository prompt and engineering directives
├── package.json                       # Project dependencies and script definitions
├── wrangler.jsonc                     # Cloudflare Worker configuration
│
├── src/
│   ├── index.ts                       # Worker entry point: handles Cloudflare email event
│   ├── router.ts                      # Core routing engine: normalization and regex matching
│   └── types.ts                       # TypeScript interfaces for rules and configuration
│
├── config/
│   ├── email-rules.yaml               # Active production routing configuration
│   └── email-rules.example.yaml       # Template configuration with example patterns
│
├── tests/
│   ├── router.test.ts                 # Unit tests for address parsing and normalization
│   └── rules.test.ts                  # Tests verifying email-rules.yaml matching behavior
│
├── scripts/
│   ├── validate-config.ts             # Validator for YAML schema, syntax, and regex safety
│   ├── validate-docs.ts               # Linter for markdown links, alert boxes, and formatting
│   └── scan-secrets.ts                # Scanner ensuring zero secrets exist in git
│
└── docs/
    ├── setup-guide.md                 # Complete, novice-friendly step-by-step setup guide
    ├── remote-configuration-guide.md  # Detailed external dashboard and DNS instructions
    ├── github-branch-protection.md    # Repository governance and branch protection rulesets
    ├── DESIGN.md                      # In-depth architectural design specifications
    ├── dns.md                         # Authoritative DNS specifications (MX, SPF, DKIM, DMARC)
    ├── routing.md                     # Technical routing engine specifications and semantics
    ├── operations.md                  # Operational runbook, log tailing, and rollback procedures
    ├── security.md                    # Security threat model and defense-in-depth policies
    └── decisions.md                   # Architecture Decision Records (ADRs)
```

---

## Available Developer Commands

| Command | Description |
| :--- | :--- |
| `npm run check` | Master pre-flight check: runs typecheck, config validator, secret scan, doc check, and tests. |
| `npm test` | Runs the test suite via Vitest. |
| `npm run validate:config` | Validates YAML syntax, required fields, and regex safety in `config/email-rules.yaml`. |
| `npm run scan-secrets` | Scans the repository for accidental credentials or private keys. |
| `npm run validate:docs` | Verifies documentation formatting, link integrity, and model neutrality. |
| `npm run build` | Performs a dry-run deployment build with Wrangler. |
| `npm run deploy` | Deploys the worker to Cloudflare's global edge network. |
| `npx wrangler tail` | Streams real-time execution logs for live inbound emails. |

---

## Frequently Asked Questions (FAQ)

### Can I forward different addresses to different family members?
Yes. Verify each family member's personal email address in Cloudflare Dashboard (Step 3). Then add rules directing their aliases to their personal address in `config/email-rules.yaml`.

### What happens if someone sends an email to an unconfigured address?
The Worker executes the `no_match` policy (`action: reject`). The sender receives an automated bounce notice ("Address not recognized"), and your personal inbox receives nothing. This keeps spam from flooding your inbox.

### Is my email stored on Cloudflare?
No. Cloudflare Email Routing is purely a transit service. The Worker receives the message event in memory, forwards the raw email stream to your destination mailbox, and terminates. No email bodies or attachments are stored on Cloudflare servers.

### Where can I get more help?
* Step-by-step beginner guide: [docs/setup-guide.md](docs/setup-guide.md)
* Remote dashboard configurations: [docs/remote-configuration-guide.md](docs/remote-configuration-guide.md)
* DNS and authentication records: [docs/dns.md](docs/dns.md)
* Routing engine specifications: [docs/routing.md](docs/routing.md)
* Operations and troubleshooting runbook: [docs/operations.md](docs/operations.md)
* Branch protection & repository governance: [docs/github-branch-protection.md](docs/github-branch-protection.md)
