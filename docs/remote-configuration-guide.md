# Remote Website Configuration Guide

This guide provides step-by-step instructions for all external, third-party dashboard operations required to activate, configure, and maintain the `family-email` system.

Because this project relies on serverless edge infrastructure rather than a self-hosted mail server, physical deployment requires coordinated configuration across three external platforms:
1. **Cloudflare Dashboard**: Domain DNS management, Email Routing activation, destination address verification, and Email Worker binding.
2. **Brevo Dashboard** (formerly Sendinblue): Outbound authenticated SMTP relay setup, domain signing, and DKIM generation.
3. **Email Client (e.g., Gmail)**: Configuring "Send mail as" aliases using the authenticated SMTP relay.

```
[VERIFICATION STATUS CODES]
* [PASS]: Verified and active.
* [PENDING]: Awaiting DNS propagation, verification click, or account approval.
* [WARN]: Critical configuration notice or potential misconfiguration trap.
* [FAIL]: Error state requiring remediation.
```

---

## 1. Prerequisites Checklist

Before beginning remote dashboard configuration, ensure you have:
* An active, registered domain name (referred to throughout as `<yourdomain.com>`).
* A Cloudflare account (Free plan is fully sufficient).
* A Brevo account (Free plan provides up to 300 emails/day, which is suitable for family outbound volume).
* Administrative access to target destination mailboxes (e.g. `<destination>@gmail.com`) to approve verification links.
* The local Worker codebase deployed to Cloudflare Workers (via `wrangler deploy` as detailed in [docs/PLAN.md](PLAN.md)).

---

## 2. Cloudflare Account & Zone Setup

To allow Cloudflare to manage incoming email and authoritative DNS records, your domain must be active on Cloudflare DNS.

### Step 2.1: Add Domain to Cloudflare
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the top navigation or sidebar, click **Websites** -> **Add a site**.
3. Enter your domain name (`<yourdomain.com>`) and select the **Free** plan.
4. Cloudflare will scan for existing DNS records. Review the imported records and click **Continue**.

### Step 2.2: Update Nameservers at Domain Registrar
1. Cloudflare will display two assigned nameservers (for example: `ns1.cloudflare.com` and `ns2.cloudflare.com`).
2. Log in to your domain registrar's administration panel (e.g., Namecheap, Google Domains / Squarespace, Porkbun).
3. Navigate to **DNS / Nameservers management** for `<yourdomain.com>`.
4. Switch nameserver mode from "Default / Basic DNS" to "Custom DNS".
5. Enter the two Cloudflare nameservers provided.
6. Save changes. Nameserver propagation typically takes between 5 minutes and 24 hours.
7. Return to Cloudflare and click **Check nameservers now**.
8. Confirm the zone status shows **Active** (`[PASS]`).

---

## 3. Cloudflare Email Routing Inbound Setup

Cloudflare Email Routing ingests incoming mail at edge points of presence, performs initial spam evaluation, and dispatches the raw message event to your Cloudflare Worker.

### Step 3.1: Enable Email Routing
1. In the Cloudflare Dashboard, select your active website `<yourdomain.com>`.
2. In the left-hand navigation menu, expand **Email** and select **Email Routing**.
3. Click the **Get started** or **Enable Email Routing** button.
4. Cloudflare will prompt you to add recommended DNS records automatically. Allow Cloudflare to insert the default MX and TXT records:
   * MX: `route1.mx.cloudflare.net` (Priority 93)
   * MX: `route2.mx.cloudflare.net` (Priority 53)
   * MX: `route3.mx.cloudflare.net` (Priority 81)
   * TXT (SPF): `v=spf1 include:_spf.mx.cloudflare.net ~all`
5. Note: We will later merge this SPF record with Brevo's outbound SPF record in Section 6.

---

## 4. Destination Address Verification

**Important Security Requirement:** Cloudflare Email Routing will **strictly refuse** to forward any email to an external mailbox unless that destination address has been explicitly registered and verified in the Cloudflare Dashboard.

Every destination address listed in `config/email-rules.yaml` (e.g., `bin@example.net`, `vvvv@example.net`) must undergo this verification process.

### Step 4.1: Register Destination Mailboxes
1. In the Cloudflare Dashboard, go to **Email** -> **Email Routing**.
2. Select the **Destination addresses** tab.
3. Click **Add destination address**.
4. Enter the personal target email address (e.g., `user@gmail.com`).
5. Click **Save**. The status will initially display as `[PENDING]` (Verification pending).

### Step 4.2: Verify Ownership via Confirmation Email
1. Check the inbox of the target destination mailbox (`user@gmail.com`).
2. Locate the verification email from `Cloudflare <noreply@cloudflare.com>` with the subject:
   `Verify your email address for Cloudflare Email Routing`.
3. Open the email and click the **Verify email address** button.
4. A Cloudflare browser confirmation tab will open confirming successful verification.
5. Return to the Cloudflare **Destination addresses** tab and refresh the page.
6. Verify that the destination status displays `[PASS]` (Verified).
7. Repeat this procedure for every destination email address referenced in your routing rules.

---

## 5. Worker Catch-All Rule Binding

Once the Email Worker (`family-email-worker`) is published to your Cloudflare account, configure Cloudflare Email Routing to delegate all inbound traffic to it via a catch-all routing rule.

### Step 5.1: Verify Worker Deployment
1. In Cloudflare Dashboard, navigate to **Compute (Workers) -> Workers & Pages**.
2. Confirm that `family-email-worker` appears in the list and shows a recent deployment timestamp (`[PASS]`).

### Step 5.2: Configure Email Routing Catch-All Rule
1. Return to **Email** -> **Email Routing** -> **Routing rules** tab.
2. Scroll to the **Catch-all rule** card.
3. Click **Edit** (or configure if not yet enabled):
   * **Status**: Enabled (Toggled ON).
   * **Action**: Select **Send to a Worker**.
   * **Worker**: Select `family-email-worker` from the dropdown list.
4. Click **Save**.
5. Ensure that any default fallback rules (such as "Drop" or "Reject") under custom addresses do not preemptively shadow the catch-all worker. The catch-all rule will now receive all incoming messages for `*@<yourdomain.com>`.

---

## 6. Outbound SMTP Relay Provider (Brevo) Setup

To send emails from your custom domain addresses (e.g. `anything.bin@<yourdomain.com>`), you must configure an authenticated outbound SMTP relay. Brevo provides custom domain DKIM signing and SMTP relaying on their free tier.

### Step 6.1: Account Registration & Domain Addition
1. Register or log in to your account at [Brevo](https://www.brevo.com/).
2. In the top-right profile dropdown, click **Senders, Domains & Dedicated IPs**.
3. Select the **Domains** tab and click **Add a domain**.
4. Enter your custom domain name (`<yourdomain.com>`).
5. Check the box to confirm domain ownership and click **Save this domain**.

### Step 6.2: Retrieve Domain Authentication Keys (DKIM & SPF)
Brevo will display the required DNS authentication records:
1. **Brevo Code / Ownership Verification**:
   * Type: `TXT`
   * Name: `<yourdomain.com>` (or `@`)
   * Value: `brevo-code:<unique_hash>`
2. **DKIM Record (DomainKeys Identified Mail)**:
   * Type: `TXT`
   * Name: `mail._domainkey.<yourdomain.com>`
   * Value: `k=rsa; p=<public_key_string>`
3. **SPF Record**:
   * Brevo suggests: `v=spf1 include:spf.brevo.com ~all`
   * **Do not paste this directly as a standalone record.** You must merge it with Cloudflare's inbound SPF record in the next step.

### Step 6.3: Generate SMTP Relay Credentials
1. In Brevo, navigate in the left sidebar to **Transactional** -> **Settings**.
2. Select the **Configuration** tab.
3. Locate the **SMTP Relay** section:
   * **SMTP Server**: `smtp-relay.brevo.com`
   * **Port**: `587` (TLS) or `465` (SSL)
   * **Login / Username**: Note your account login email or SMTP username (e.g. `7a8b9c@smtp-brevo.com`).
4. Click **Generate a new SMTP key**:
   * Name the key: `family-email-relay`.
   * Click **Generate**.
   * **Important:** Copy the generated master password immediately and store it securely in a password manager. Brevo will never display this key again.
   * Never commit this key to Git.

---

## 7. Unified Cloudflare DNS Records

All DNS records for inbound reception and outbound delivery must be published in Cloudflare DNS.

### Step 7.1: DNS Record Inventory

Navigate to Cloudflare Dashboard -> **DNS** -> **Records** and configure the following records:

| Record Type | Name / Host | Target / Value | Priority | Proxy Status | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MX** | `@` | `route1.mx.cloudflare.net` | 93 | DNS Only | Cloudflare Inbound Ingestion #1 |
| **MX** | `@` | `route2.mx.cloudflare.net` | 53 | DNS Only | Cloudflare Inbound Ingestion #2 |
| **MX** | `@` | `route3.mx.cloudflare.net` | 81 | DNS Only | Cloudflare Inbound Ingestion #3 |
| **TXT** | `@` | `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` | - | DNS Only | Unified SPF Record (Cloudflare + Brevo) |
| **TXT** | `@` | `brevo-code:<unique_hash>` | - | DNS Only | Brevo Domain Ownership Verification |
| **TXT** | `mail._domainkey` | `k=rsa; p=<brevo_public_key>` | - | DNS Only | Brevo Outbound DKIM Key |
| **TXT** | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@<yourdomain.com>; pct=100; adkim=r; aspf=r` | - | DNS Only | DMARC Policy (Initially use `p=none` for staging) |

**Important Note on SPF Record Merging:**
A domain must have exactly **one** TXT record starting with `v=spf1`. Publishing multiple SPF records violates RFC 7208 and causes permanent deliverability failures (`PermError`). Both Cloudflare (for inbound bounces) and Brevo (for outbound relay) must be included within a single record:
```
v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
```

### Step 7.2: Verify Domain Authentication in Brevo
1. Return to the Brevo Dashboard -> **Senders, Domains & Dedicated IPs** -> **Domains**.
2. Click **Verify this domain** or **Check configuration**.
3. Confirm that both the Domain Ownership and DKIM status cards display **Authenticated** / `[PASS]`.

---

## 8. Email Client Outbound Configuration (Gmail "Send mail as")

You can send email from your custom addresses directly from an existing Gmail mailbox using Brevo's SMTP relay.

### Step 8.1: Add "Send Mail As" Alias in Gmail
1. Log in to your personal Gmail account on a desktop web browser.
2. In the top-right corner, click the **Settings gear icon** -> **See all settings**.
3. Navigate to the **Accounts and Import** tab.
4. Locate the section labeled **Send mail as:** and click **Add another email address**.

### Step 8.2: Configure Alias Details
A popup window will appear:
1. **Name**: Enter your desired display name (e.g., `Alex Doe`).
2. **Email address**: Enter your custom alias (e.g., `anything.bin@<yourdomain.com>`).
3. **Treat as an alias**:
   * *Unchecked (Recommended)*: When sending as this custom alias, replies are treated as coming from an independent identity.
4. Click **Next Step >>**.

### Step 8.3: Configure SMTP Credentials
1. **SMTP Server**: Enter `smtp-relay.brevo.com`.
2. **Port**: Select `587`.
3. **Username**: Enter your Brevo SMTP login username.
4. **Password**: Enter the Brevo SMTP key generated in Section 6.3.
5. Select **Secured connection using TLS (recommended)**.
6. Click **Add Account**.

### Step 8.4: Confirm Alias Ownership
1. Gmail will send a confirmation email with a verification code to `anything.bin@<yourdomain.com>`.
2. Because your Cloudflare Email Worker and regex rules are active, the incoming message is routed automatically according to `email-rules.yaml` and delivered straight to your Gmail inbox!
3. Open the incoming confirmation email in Gmail.
4. Either click the verification link in the email or copy the numeric confirmation code, paste it into the popup window, and click **Verify**.
5. In Gmail Settings, under "When replying to a message:", choose **Reply from the same address the message was sent to**.

---

## 9. End-to-End Verification & Testing Matrix

Execute the following manual test suite to verify all routing and deliverability pathways:

| Test Case | Method / Input | Expected Result | Verification Check |
| :--- | :--- | :--- | :--- |
| **1. Standard Regex Inbound** | Send email from external account (e.g. Yahoo/Proton) to `newsletter.bin@<yourdomain.com>`. | Worker matches `^.+\.bin$`; forwards to `bin@example.net`. | Message arrives in target mailbox inbox within 15 seconds. `[PASS]` |
| **2. Exception Rule Inbound** | Send email from external account to `backup.bin@<yourdomain.com>`. | Worker matches first exception rule `^backup\.bin$`; forwards to `special@example.net`. | Message arrives in exception mailbox, NOT default bin mailbox. `[PASS]` |
| **3. Unmatched Inbound** | Send email from external account to `unregistered-test@<yourdomain.com>`. | Worker evaluates all rules; finds no match; triggers explicit reject policy (`message.setReject`). | Sender receives an automated 550 SMTP bounce notice ("Address not recognized"). `[PASS]` |
| **4. Outbound Sending** | In Gmail, compose a message; select `anything.bin@<yourdomain.com>` as the From address; send to an external test email. | Brevo accepts authenticated SMTP submission; signs with DKIM; delivers to external recipient. | Recipient receives email. Sender shows as `anything.bin@<yourdomain.com>`. `[PASS]` |
| **5. Authentication Alignment** | Inspect full email headers in recipient inbox (Gmail "Show original" or `mail-tester.com`). | SPF: `PASS`, DKIM: `PASS`, DMARC: `PASS`. Zero alignment warnings. | Verified `[PASS]` across all three authentication standards. |

---

## 10. Troubleshooting Checklist

### Issue 1: Forwarded email never arrives in destination mailbox
* **Check Destination Verification**: Open Cloudflare Dashboard -> **Email Routing** -> **Destination addresses**. Is the destination email marked `[PASS]` (Verified)? If `[PENDING]`, Cloudflare will silently discard or bounce forwards.
* **Inspect Worker Real-Time Logs**:
  Run `wrangler tail` in your terminal or open Cloudflare Dashboard -> **Workers & Pages** -> `family-email-worker` -> **Logs** -> **Begin log stream**. Send a test email and inspect the console logs to confirm whether the event executed and which rule matched.
* **Check Spam / Junk Folder**: First-time forwarded messages from newly registered domains are often filtered by mailbox providers until marked as "Not Spam".

### Issue 2: Brevo fails to verify domain DKIM or Ownership
* **Check DNS Record Name**: In Cloudflare DNS, ensure the record name is entered as `mail._domainkey` (Cloudflare automatically appends the root domain). Do not enter `mail._domainkey.<yourdomain.com>.<yourdomain.com>`.
* **Ensure DNS Proxy is Disabled**: Cloudflare proxy mode (Orange Cloud) cannot be applied to TXT or MX records. Ensure the proxy status is set to **DNS Only** (Grey Cloud).
* **Propagation Wait Time**: Allow up to 30 minutes for DNS caching across authoritative nameservers to clear before re-testing in Brevo.

### Issue 3: Gmail rejects SMTP submission on "Add another email address"
* **Authentication Error**: Verify the username matches the Brevo SMTP login format (often different from your primary account email address).
* **Port / TLS Mismatch**: Ensure Port `587` with **TLS** is selected. Port `465` requires **SSL**.
* **Key Revocation**: If the SMTP key was truncated or mistyped, generate a fresh SMTP key in Brevo and re-enter.

### Issue 4: Email marked as Spam or Fails DMARC
* **Conflicting SPF Records**: Verify via `dig TXT <yourdomain.com>` that there is only one SPF record containing both `include:_spf.mx.cloudflare.net` and `include:spf.brevo.com`.
* **DMARC Staging Policy**: If testing causes deliverability issues, ensure DMARC policy is set to `p=none` before stepping up to `p=quarantine` or `p=reject`.
