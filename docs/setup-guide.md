# Beginner Setup Guide: Personal & Family Email Routing

This guide walks you through setting up your own custom-domain email routing system from scratch.

Even if you have never used Cloudflare, never managed DNS records, and never written a regular expression before, this guide will explain each step clearly and simply.

---

## Table of Contents

1. [Understanding How It Works](#1-understanding-how-it-works)
2. [What You Need Before Starting (Prerequisites)](#2-what-you-need-before-starting-prerequisites)
3. [Important: Inbound vs. Outbound Email](#3-important-inbound-vs-outbound-email)
4. [Step 1: Point Your Domain to Cloudflare](#step-1-point-your-domain-to-cloudflare)
5. [Step 2: Prepare Your Local Environment](#step-2-prepare-your-local-environment)
6. [Step 3: Verify Your Destination Email in Cloudflare](#step-3-verify-your-destination-email-in-cloudflare)
7. [Step 4: Configure Your Email Routing Rules](#step-4-configure-your-email-routing-rules)
8. [Step 5: Test Your Rules Locally](#step-5-test-your-rules-locally)
9. [Step 6: Deploy Your Email Worker](#step-6-deploy-your-email-worker)
10. [Step 7: Turn On Cloudflare Email Routing](#step-7-turn-on-cloudflare-email-routing)
11. [Step 8: Test Inbound Email Delivery](#step-8-test-inbound-email-delivery)
12. [Step 9 (OPTIONAL): Outbound Email (Sending from Custom Addresses)](#step-9-optional-outbound-email-sending-from-custom-addresses)
13. [How to Add or Change Rules Later](#how-to-add-or-change-rules-later)
14. [Troubleshooting & Frequently Asked Questions](#troubleshooting--frequently-asked-questions)
15. [Beginner Regex Reference](#beginner-regex-reference)

---

## 1. Understanding How It Works

### The Problem
When you own a domain name (like `yourdomain.com`), you usually have two choices for email:
* Pay \$6 to \$12 per user per month for a hosted mailbox service (Google Workspace, Microsoft 365, etc.).
* Run your own email server, which requires maintaining complex software, spam filters, security certificates, and IP reputation.

### The Solution: Serverless Email Routing
This project provides a third option:
1. **You own the domain.**
2. **Cloudflare receives incoming mail for free.**
3. **A small automated program (called a Cloudflare Worker) checks who the email was sent to.**
4. **The Worker matches the address against rules you define and forwards it to your existing personal mailbox (like your existing Gmail, Outlook, or Apple Mail inbox).**

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

You can create unlimited email addresses on the fly without ever logging in to a dashboard to create a new mailbox.

---

## 2. What You Need Before Starting (Prerequisites)

Ensure you have the following items ready:

| Requirement | Description | Cost |
| :--- | :--- | :--- |
| **A Custom Domain Name** | A domain you own (e.g., `yourdomain.com`) purchased from any registrar (Porkbun, Namecheap, Squarespace, GoDaddy, etc.). | ~\$10-\$15/year |
| **A Free Cloudflare Account** | Cloudflare provides the DNS management, Email Routing, and Worker execution. | Free (\$0/mo) |
| **An Existing Personal Mailbox** | A standard personal email address where you want to receive mail (e.g., your existing Gmail, Outlook, or iCloud account). | Free |
| **A Computer with Node.js Installed** | Used to test your rules and deploy the routing worker. | Free |

---

## 3. Important: Inbound vs. Outbound Email

Before proceeding, understand this crucial distinction:

```
[SYSTEM SCOPE SUMMARY]
* INBOUND (Receiving email):   [CORE FEATURE - REQUIRED]
  Receive mail at unlimited custom addresses and forward to your existing inboxes.
* OUTBOUND (Sending email):    [COMPLETELY OPTIONAL]
  Send or reply to emails using your custom domain as the "From" address.
```

### Inbound (Receiving Mail) — The Core System
**This is what 95% of users need.**
* You can give out `amazon.bin@yourdomain.com`, `newsletters.bin@yourdomain.com`, or `family@yourdomain.com` when signing up for services, shopping online, or filling out forms.
* All incoming messages are instantly routed to your real inbox.
* If an address starts receiving spam, you know exactly which company sold or leaked your address.
* **This setup requires NO external email relays, NO monthly credit card, and NO complex mail configurations.**

### Outbound (Sending Mail) — Completely Optional
* If you only want to receive emails and read them in your normal inbox, **you do not need outbound setup at all**.
* You only need Outbound setup if you specifically want to open your email client, compose a new email, and have the recipient see `yourname@yourdomain.com` in the "From" line.
* If you do not need this, you can skip [Step 9 (OPTIONAL)](#step-9-optional-outbound-email-sending-from-custom-addresses) entirely.

---

## Step 1: Point Your Domain to Cloudflare

Cloudflare needs to manage the DNS (Domain Name System) for your domain so it can receive incoming emails.

### 1.1 Add Your Domain in Cloudflare
1. Open a browser and log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Click **Websites** in the navigation menu, then click **Add a site**.
3. Type your domain name (e.g., `yourdomain.com`) and click **Continue**.
4. Scroll down and choose the **Free** plan, then click **Continue**.
5. Cloudflare will scan your domain for existing DNS records. Click **Continue** past the scan results.

### 1.2 Update Nameservers at Your Domain Registrar
1. Cloudflare will display two nameservers assigned to your account, such as:
   * `ns1.cloudflare.com`
   * `ns2.cloudflare.com`
2. Open a new browser tab and log in to the website where you bought your domain (your registrar, such as Porkbun, Namecheap, or Squarespace).
3. Find your domain management settings, look for **Nameservers** or **DNS Settings**, and select **Custom Nameservers**.
4. Replace the existing nameservers with the two nameservers provided by Cloudflare.
5. Save your changes at the registrar.
6. Return to the Cloudflare tab and click **Check nameservers now**.
7. It may take anywhere from 5 minutes to a couple of hours for the registrar to update. Once completed, your domain in Cloudflare will show status **Active** (`[PASS]`).

---

## Step 2: Prepare Your Local Environment

To configure your rules and deploy your worker, you need a terminal with Node.js.

### 2.1 Check or Install Node.js
Open your terminal (macOS Terminal, Linux Bash, or Windows PowerShell) and check if Node.js is installed:

```bash
node -v
```

If Node.js is not installed, download the current LTS version from [nodejs.org](https://nodejs.org/) and run the installer.

### 2.2 Clone or Download This Repository
Open your terminal, navigate to the folder where you want to keep your project, and clone this repository:

```bash
git clone https://github.com/<your-account>/family-email.git
cd family-email
```

### 2.3 Install Project Dependencies
Run the install command to set up the necessary tools:

```bash
npm install
```

### 2.4 Log In to Cloudflare from Your Terminal
The deployment tool (`wrangler`) needs permission to upload your worker to your Cloudflare account:

```bash
npx wrangler login
```

This command opens a browser window asking you to authorize Wrangler. Click **Allow**. Once authorized, your terminal will confirm successful authentication.

---

## Step 3: Verify Your Destination Email in Cloudflare

**Why this step is required:**
To prevent spammers from abusing Cloudflare to forward unsolicited email to random people, Cloudflare requires that you prove ownership of any email address you want to forward mail to.

If you want mail to end up at `yourname@gmail.com`, you must verify `yourname@gmail.com` first.

### Step-by-Step Verification
1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), select your active domain.
2. In the left-hand menu, expand **Email**, then click **Email Routing**.
3. Click the **Destination addresses** tab at the top of the page.
4. Click **Add destination address**.
5. Type your personal email address (e.g., `yourname@gmail.com`).
6. Click **Save**. The status will show as `[PENDING]` (Verification pending).
7. Open your personal email inbox (`yourname@gmail.com`).
8. Look for an email from **Cloudflare** with the subject line:
   `Verify your email address for Cloudflare Email Routing`.
9. Click the **Verify email address** button inside that email.
10. A browser window will open confirming the address is verified.
11. Return to the Cloudflare dashboard and refresh the page. The destination status will now display `[PASS]` (Verified).

> Repeat this step for each personal email address you want to forward mail to (e.g., for each family member).

---

## Step 4: Configure Your Email Routing Rules

All routing decisions are controlled by a single configuration file: `config/email-rules.yaml`.

Open `config/email-rules.yaml` in your text editor (such as VS Code, Sublime Text, or nano).

### Understanding the Configuration File

Here is an annotated example of what the file looks like:

```yaml
# Replace this with your actual custom domain
domain: yourdomain.com

rules:
  # Rule 1: A specific exception
  # If someone sends an email to backup.bin@yourdomain.com,
  # it goes to your emergency backup mailbox.
  - name: backup-bin
    pattern: "^backup\\.bin$"
    destination: yourbackup@gmail.com
    description: "Specific exception for backup services"

  # Rule 2: A wildcard pattern for disposable accounts
  # Any address ending with ".bin" (e.g., amazon.bin, netflix.bin)
  # goes to your primary bin inbox.
  - name: bin
    pattern: "^.+\\.bin$"
    destination: yourprimary@gmail.com
    description: "Routes any *.bin address to primary mailbox"

  # Rule 3: An exact name match for family mail
  # Only email sent to family@yourdomain.com goes to the shared mailbox.
  - name: family
    pattern: "^family$"
    destination: sharedfamily@gmail.com
    description: "Shared family inbox"

# What happens if an incoming email matches none of the rules above:
no_match:
  action: reject
  reason: "Address not recognized"
```

### Golden Rules for Configuring Rules

1. **First-Match-Wins**:
   The Worker reads rules from top to bottom. As soon as it finds a matching rule, it sends the email and stops checking further rules.
   * Put specific rules (like `^backup\\.bin$`) **before** broad rules (like `^.+\\.bin$`).
2. **Always Anchor Your Patterns**:
   * Start your pattern with `^` (means "beginning of address").
   * End your pattern with `$` (means "end of address").
   * Put `\\.` to match an actual dot.
   * *Example*: `^.+\\.bin$` matches `store.bin`, but will NOT match `bin.other` or `combination`.
3. **Only Use Verified Destinations**:
   * Every email in the `destination:` field must have been verified in Cloudflare in [Step 3](#step-3-verify-your-destination-email-in-cloudflare).
4. **Always Reject Unmatched Mail**:
   * Keep `action: reject` under `no_match:`. This tells spammers sending to random addresses (like `sales@`, `info@`, `admin@`) that the address does not exist, protecting your inbox from spam floods.

---

## Step 5: Test Your Rules Locally

Before deploying to the cloud, you can verify your configuration and test your rules on your own computer without sending any real emails.

In your terminal, run:

```bash
npm run check
```

This single command automatically performs four checks:
1. **Config validation**: Checks that your YAML is formatted correctly, regex patterns are valid and anchored, and rule names are unique.
2. **Secret scanner**: Verifies that no private passwords or credentials were accidentally added to your code.
3. **Docs check**: Verifies documentation formatting and link integrity.
4. **Test suite**: Runs simulated routing tests to prove that addresses match the expected destinations.

If all checks pass, you will see clean `[PASS]` indicators in your terminal:

```
[PASS] config/email-rules.yaml is valid.
[PASS] Zero exposed secrets or private keys detected in repository.
[PASS] All documentation verified cleanly.
Test Files  2 passed (2)
Tests       37 passed (37)
```

If a check fails (`[FAIL]`), read the message carefully. It will pinpoint the exact line in your YAML file that needs correction.

---

## Step 6: Deploy Your Email Worker

Now that your rules are validated and tested, publish your worker to Cloudflare:

```bash
npm run deploy
```

Wrangler will package your TypeScript worker and your `email-rules.yaml` file, upload them to Cloudflare, and deploy them across Cloudflare's global network.

You should see output similar to:

```
Total Upload: ... KiB / gzip: ... KiB
Uploaded family-email-worker (...)
Current Version ID: ...
```

---

## Step 7: Turn On Cloudflare Email Routing

Now that your Worker is live, tell Cloudflare to start accepting emails for your domain and hand them over to your Worker.

### 7.1 Enable Email Routing & DNS Records
1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Email** -> **Email Routing**.
2. Click **Get started** or **Enable Email Routing**.
3. Cloudflare will display a screen showing the required MX and SPF DNS records:
   * 3 MX records pointing to Cloudflare (e.g., `route1.mx.cloudflare.net`, etc.)
   * 1 TXT record for SPF (`v=spf1 include:_spf.mx.cloudflare.net ~all`)
4. Click **Add records automatically**. Cloudflare will insert these records into your domain's DNS for you.
5. Cloudflare will verify the DNS records and show an **Email Routing is enabled** message.

### 7.2 Point Inbound Mail to Your Worker (Catch-All Rule)
1. On the **Email Routing** page, click the **Routing rules** tab.
2. Scroll down to the **Catch-all rule** section and click **Edit**:
   * **Status**: Toggle to **Active / Enabled**.
   * **Action**: Select **Send to a Worker**.
   * **Worker**: Select `family-email-worker` from the dropdown list.
3. Click **Save**.

```
[VERIFICATION CHECK]
Your catch-all rule is now active:
Any email sent to "*@yourdomain.com" is sent directly to your Worker.
```

---

## Step 8: Test Inbound Email Delivery

Let's verify that your system works end-to-end!

### 8.1 Live Log Monitoring (Optional but Helpful)
In your terminal, you can watch your Worker process emails in real time:

```bash
npx wrangler tail
```

Keep this terminal window open.

### 8.2 Send a Test Email
1. Open an external email account (such as a separate personal account, work email, or ask a friend).
2. Compose a new email addressed to one of your configured aliases:
   * To: `test.bin@yourdomain.com`
   * Subject: `Hello from my new domain`
   * Body: `Testing my automated email routing!`
3. Send the email.

### 8.3 Verify Delivery
1. Check the terminal running `npx wrangler tail`. You will see the event logged:
   ```
   [INFO] Inbound message to: "test.bin@yourdomain.com"
   [INFO] Matched rule: "bin" -> Forwarding to "yourprimary@gmail.com"
   ```
2. Open your personal destination inbox (`yourprimary@gmail.com`).
3. Your test email should appear within 5 to 15 seconds!

### 8.4 Test the Rejection of Unmatched Mail
Send another test email to an unregistered address, such as `randomnonsense@yourdomain.com`.
* Your destination inbox should receive nothing.
* The sender will receive a bounce notice stating: `Address not recognized`.
* Your system successfully filtered out unauthorized mail!

---

## Step 9 (OPTIONAL): Outbound Email (Sending from Custom Addresses)

```
================================================================================
                           [OPTIONAL FEATURE NOTICE]
You only need to complete this section if you want to COMPOSE or REPLY to
emails using your custom domain address (e.g. from anything.bin@yourdomain.com).
If you only need to RECEIVE and READ emails, you are completely done! Skip ahead
to "How to Add or Change Rules Later".
================================================================================
```

### Why Sending Requires an Outbound Relay
Cloudflare Email Routing is an **inbound-only** service. Cloudflare receives mail for your domain, but it does not send outgoing mail.

To send emails from your custom domain that do not get marked as spam by Gmail or Outlook, you need:
1. An **SMTP Relay Provider**: A trusted service that transmits outgoing mail on your behalf (such as Brevo, which offers a free plan of 300 emails/day).
2. **DKIM & SPF Records**: Cryptographic proof in your DNS that the outgoing mail is authentic.

Here is how to set this up using **Brevo** and your existing **Gmail** account:

### Step 9.1: Create a Free Brevo Account
1. Sign up at [Brevo.com](https://www.brevo.com/) (formerly Sendinblue) on the Free plan.
2. In the top-right menu under your profile name, click **Senders, Domains & Dedicated IPs**.
3. Select the **Domains** tab and click **Add a domain**.
4. Enter your custom domain (`yourdomain.com`) and click **Save this domain**.

### Step 9.2: Add Brevo Authentication Records in Cloudflare DNS
Brevo will display DNS records to authenticate your domain. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **DNS** -> **Records**, and add the following:

#### 1. Ownership Verification Record
* **Type**: `TXT`
* **Name**: `@`
* **Content**: Paste the `brevo-code:...` string shown in Brevo.
* **TTL**: `Auto`

#### 2. DKIM Cryptographic Key
* **Type**: `TXT`
* **Name**: `mail._domainkey`
* **Content**: Paste the `k=rsa; p=...` key string shown in Brevo.
* **TTL**: `Auto`

#### 3. SPF Record (CRITICAL: Merge with Cloudflare)
**Do not add a second SPF record!** A domain must have exactly one SPF record.

In Cloudflare DNS, find the existing TXT record starting with `v=spf1 include:_spf.mx.cloudflare.net ~all` (created in Step 7.1) and edit it to include Brevo:

```
v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
```

Save the record.

#### 4. Confirm in Brevo
Return to the Brevo dashboard and click **Check configuration** or **Verify this domain**. Both Domain Ownership and DKIM will show status `[PASS]` (Authenticated).

### Step 9.3: Generate an SMTP Key in Brevo
1. In Brevo, go to **Transactional** in the left sidebar, then click **Settings**.
2. Select the **Configuration** tab.
3. Note your:
   * **SMTP Server**: `smtp-relay.brevo.com`
   * **Port**: `587`
   * **Login**: Your Brevo login identifier (e.g. `7b8c9d@smtp-brevo.com`)
4. Click **Generate a new SMTP key**.
5. Give it a name (e.g. `family-email-key`) and click **Generate**.
6. Copy the generated master password immediately and save it in your password manager. (Brevo will not show it again).

### Step 9.4: Add "Send Mail As" in Gmail
Now connect this relay to your personal Gmail account so you can send from your custom domain:

1. In your personal Gmail, click the **Settings gear** -> **See all settings**.
2. Click the **Accounts and Import** tab.
3. Under **Send mail as:**, click **Add another email address**.
4. In the popup window:
   * **Name**: Your display name (e.g., `Alex Doe`).
   * **Email address**: Your custom address (e.g., `anything.bin@yourdomain.com`).
   * **Treat as an alias**: Uncheck this box.
   * Click **Next Step >>**.
5. Enter the SMTP details:
   * **SMTP Server**: `smtp-relay.brevo.com`
   * **Port**: `587`
   * **Username**: Your Brevo SMTP login username.
   * **Password**: The Brevo SMTP key you copied in Step 9.3.
   * **Secured connection using**: Select **TLS**.
   * Click **Add Account**.
6. Gmail will send a verification code to `anything.bin@yourdomain.com`.
7. Because your Cloudflare inbound routing is active, this confirmation email arrives in your Gmail inbox!
8. Open the email, copy the numeric code, paste it into the popup window, and click **Verify**.

You can now select `anything.bin@yourdomain.com` in Gmail's "From" dropdown whenever you compose a new email or reply.

---

## How to Add or Change Rules Later

Whenever you want to add a new alias, change a destination, or create a rule for a family member, follow this simple 3-step loop:

### 1. Edit Configuration
Open `config/email-rules.yaml` and add or edit your rule.

*Example*: Add a rule for your online shopping:
```yaml
  - name: shopping
    pattern: "^shopping\\.bin$"
    destination: yourprimary@gmail.com
    description: "Dedicated alias for online orders"
```

### 2. Validate and Test Locally
Run:
```bash
npm run check
```
Make sure all checks return `[PASS]`.

### 3. Deploy
Run:
```bash
npm run deploy
```

The update takes effect globally within seconds. Zero downtime, zero server restarts.

---

## Troubleshooting & Frequently Asked Questions

### 1. "I sent an email to my custom address, but nothing arrived."
* **Is the destination address verified in Cloudflare?**
  Go to Cloudflare Dashboard -> **Email** -> **Email Routing** -> **Destination addresses**. Check if the destination email shows `[PASS]` (Verified). If it says `[PENDING]`, Cloudflare will not forward any mail.
* **Is the catch-all rule enabled?**
  Go to Cloudflare Dashboard -> **Email** -> **Email Routing** -> **Routing rules**. Verify the Catch-all rule is set to **Send to a Worker** and the worker selected is `family-email-worker`.
* **Check live logs:**
  Run `npx wrangler tail` in your terminal and send another email. If nothing shows up, your domain's MX records may still be propagating (wait 15-30 minutes). If an error appears in the logs, it will tell you why the message was rejected.
* **Check your Spam/Junk folder:**
  When receiving emails from a brand-new domain for the first time, mailbox providers often route them to Spam. Open the email and click "Not Spam".

### 2. "Can I forward to multiple family members?"
Yes! Verify each family member's personal email address in Cloudflare Dashboard (Step 3). Then add their rules in `config/email-rules.yaml`:
```yaml
  - name: alex
    pattern: "^.+\\.alex$"
    destination: alex@gmail.com

  - name: sam
    pattern: "^.+\\.sam$"
    destination: sam@gmail.com
```

### 3. "Does this cost anything to keep running?"
For standard personal and family volume:
* **Cloudflare DNS**: Free.
* **Cloudflare Email Routing**: Free.
* **Cloudflare Workers**: Free tier includes 100,000 requests per day (far more than any family receives).
* **Brevo (Optional Outbound)**: Free tier includes 300 outgoing emails per day.
Your only recurring expense is your domain registration (~$10-$15/year).

---

## Beginner Regex Reference

The Worker matches the "local-part" (the part before the `@` symbol) against JavaScript Regular Expressions. Here is a quick cheat sheet for common patterns:

| Desired Behavior | Example Matching Addresses | Pattern to Use | Explanation |
| :--- | :--- | :--- | :--- |
| **All addresses ending in `.bin`** | `store.bin`, `uber.bin`, `sub.bin` | `"^.+\\.bin$"` | `^` = start, `.+` = 1+ characters, `\\.` = literal dot, `bin$` = ends with bin |
| **All addresses ending in `.v`** | `news.v`, `alerts.v`, `finance.v` | `"^.+\\.v$"` | Matches any prefix ending with `.v` |
| **Exact single name** | `family` (only `family@yourdomain.com`) | `"^family$"` | Matches only the word `family` exactly |
| **Addresses starting with `alert.`** | `alert.server`, `alert.bank` | `"^alert\\..+$"` | Matches anything starting with `alert.` |
| **Specific keyword anywhere** | `backup.bin` | `"^backup\\.bin$"` | Exact match for an exception rule |

### Important Rules to Remember:
* Always enclose patterns in double quotes: `"^pattern$"`.
* Always start with `^` and end with `$`.
* Always write a literal dot as `\\.` (a single unescaped `.` in regex means "any character").
