# DNS Configuration Specification

This document details the authoritative DNS configuration for custom domain email routing and outbound sending.

## 1. Overview & Topography

The domain uses Cloudflare DNS as its authoritative nameserver. Inbound email is delivered through Cloudflare Email Routing, while outbound email is transmitted via an authenticated SMTP relay provider (such as Brevo).

```
                 Authoritative DNS Zone (Cloudflare)
               ┌─────────────────────────────────────┐
               │ MX Records: Cloudflare Ingestion    │
               │ SPF: Cloudflare + Brevo Combined    │
               │ DKIM: Brevo Outbound Signing Key    │
               │ DMARC: Domain Protection Policy     │
               └─────────────────────────────────────┘
```

---

## 2. Inbound MX Records (Cloudflare Email Routing)

Cloudflare Email Routing requires three authoritative MX records with sequential priority. Cloudflare automatically generates and validates these when Email Routing is activated:

| Record Type | Host / Name | Target / Value | Priority | Status |
| :--- | :--- | :--- | :--- | :--- |
| `MX` | `@` | `isaac.mx.cloudflare.net` | `10` | `[REQUIRED]` |
| `MX` | `@` | `linda.mx.cloudflare.net` | `20` | `[REQUIRED]` |
| `MX` | `@` | `amir.mx.cloudflare.net` | `30` | `[REQUIRED]` |

*Note: Existing MX records pointing to legacy mail hosts must be removed before activating Cloudflare Email Routing to prevent delivery failures.*

---

## 3. SPF (Sender Policy Framework) Configuration

SPF dictates which server IP ranges are authorized to send email on behalf of `@example.net`.

Because inbound routing passes through Cloudflare and outbound email is submitted through Brevo, the SPF record combines both mechanisms.

### Unified SPF Record

| Record Type | Host / Name | Target / Value | TTL |
| :--- | :--- | :--- | :--- |
| `TXT` | `@` | `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` | `Auto` |

### Field Breakdown

* `v=spf1`: Declares the record as SPF Version 1.
* `include:_spf.mx.cloudflare.net`: Authorizes Cloudflare Email Routing infrastructure (required for bounce handling and internal envelope generation).
* `include:spf.brevo.com`: Authorizes Brevo SMTP relay servers to transmit outbound messages from clients (e.g. Gmail "Send mail as").
* `~all`: SoftFail directive. Instructs receiving MTAs to accept the message but flag alignment issues during initial rollout. Can be hardened to `-all` (HardFail) once deliverability is established.

---

## 4. DKIM (DomainKeys Identified Mail) Configuration

DKIM provides cryptographic proof that outbound messages originated from the authorized domain and were not tampered with in transit.

Brevo generates a dedicated DKIM key for the domain upon domain registration in their dashboard.

### DKIM Record (Brevo)

| Record Type | Host / Name | Value / Destination | TTL |
| :--- | :--- | :--- | :--- |
| `TXT` | `mail._domainkey` | `k=rsa; p=<BREVO_PUBLIC_KEY>` | `Auto` |

*Alternatively, if Brevo provides a CNAME record:*

| Record Type | Host / Name | Target | Proxy Status |
| :--- | :--- | :--- | :--- |
| `CNAME` | `mail._domainkey` | `mail._domainkey.brevo.com` | `DNS Only (Grey Cloud)` |

*Crucial rule: DKIM CNAME or TXT records MUST have Cloudflare proxy disabled (DNS Only / Grey Cloud) so that remote mail servers can query raw cryptographic keys directly.*

---

## 5. DMARC (Domain-based Message Authentication, Reporting & Conformance)

DMARC specifies what remote mail servers should do when incoming messages fail SPF or DKIM checks, and configures aggregate diagnostic reports.

### Phase 1: Monitoring Mode (`p=none`)

Used during initial setup to observe delivery reports without rejecting legitimate mail:

| Record Type | Host / Name | Target / Value |
| :--- | :--- | :--- |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; sp=none; rua=mailto:dmarc-reports@example.net; pct=100; adkim=r; aspf=r` |

### Phase 2: Enforced Quarantine (`p=quarantine`)

Activated after confirming that SPF and DKIM pass consistently:

| Record Type | Host / Name | Target / Value |
| :--- | :--- | :--- |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; sp=quarantine; rua=mailto:dmarc-reports@example.net; pct=100; adkim=r; aspf=r` |

### DMARC Tag Definitions

* `v=DMARC1`: Protocol version.
* `p=quarantine`: Policy for the root domain. Delivers failing messages to the recipient's spam/junk folder.
* `sp=quarantine`: Policy applied to subdomains.
* `rua=mailto:...`: Reporting URI for aggregate XML feedback.
* `pct=100`: Percentage of messages subject to policy enforcement.
* `adkim=r`: Relaxed DKIM alignment.
* `aspf=r`: Relaxed SPF alignment.

---

## 6. Verification Checklist

```
[CHECKLIST: DNS READINESS]
[PASS] MX records point strictly to isaac, linda, and amir cloudflare endpoints.
[PASS] Root domain contains exactly one TXT SPF record combining Cloudflare and Brevo.
[PASS] mail._domainkey record exists with DNS-only (unproxied) resolution.
[PASS] _dmarc record exists with active reporting address.
[PASS] No conflicting legacy mail records remain in the Cloudflare zone.
```
