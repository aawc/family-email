# Architecture Decision Records (ADRs)

This document records the architectural and engineering decisions governing the `family-email` routing system.

---

## ADR-001: Cloudflare Email Routing + Workers vs. Self-Hosted Mail Server

### Context
Providing custom email addresses on a personal domain typically requires either running a full mail server stack (Postfix, Dovecot, SpamAssassin, OpenDKIM) or subscribing to expensive per-user enterprise workspace plans (e.g. Google Workspace, Microsoft 365).

### Decision
We choose **Cloudflare Email Routing combined with Cloudflare Email Workers**.

### Rationale
* **Zero Infrastructure Overhead**: No server patching, kernel updates, backup rotations, or disk space management.
* **Serverless Resilience**: High availability and DDoS protection provided by Cloudflare's global edge network.
* **Cost Efficiency**: Runs entirely within Cloudflare's generous free tiers.
* **Stateless Operations**: No email is stored at rest on intermediary infrastructure; messages are evaluated and forwarded instantaneously.

### Consequences
* Requires that Cloudflare manage authoritative DNS for the domain.
* Forwarding destinations must complete an initial out-of-band email verification before receiving traffic.

---

## ADR-002: Configuration-Driven Routing vs. Hardcoded Worker Logic

### Context
Routing aliases could be implemented directly inside TypeScript code (e.g. switch statements or literal regexes in `src/index.ts`) or extracted into declarative configuration.

### Decision
We enforce **100% configuration-driven routing** using `config/email-rules.yaml`.

### Rationale
* **Separation of Concerns**: Non-technical rule adjustments should not require altering TypeScript engine code or risking code regressions.
* **Static Validation**: Enables automated pre-commit and CI linting (`scripts/validate-config.ts`) to verify regex correctness, pattern uniqueness, and ReDoS safety prior to bundling.
* **Auditability**: Rule changes produce clean, readable Git diffs.

---

## ADR-003: First-Match-Wins Sequential Evaluation Semantics

### Context
When multiple regular expressions can match a single address, a resolution strategy must be defined: first-match-wins, longest-prefix-match, or specificity scoring.

### Decision
We adopt **strictly ordered, first-match-wins** evaluation semantics.

### Rationale
* **Determinism & Simplicity**: The behavior of any address is completely predictable by reading the configuration file from top to bottom.
* **Exception Handling**: Specific rules (e.g., `backup.bin`) placed higher in the configuration safely intercept traffic before general wildcard matchers (e.g., `^.+\\.bin$`).
* **Zero Ambiguity**: Eliminates opaque scoring heuristics or conflict resolution algorithms.

---

## ADR-004: Decoupled Outbound SMTP Relay (Brevo)

### Context
Cloudflare Email Workers only support inbound email handling. Sending outbound messages from custom domain addresses requires an outbound submission path.

### Decision
We decouple outbound sending entirely from the worker, utilizing an **authenticated external SMTP relay provider (Brevo)** connected directly to existing email clients (such as Gmail "Send mail as").

### Rationale
* **Deliverability & Reputation**: Established SMTP relay providers manage IP reputation, feedback loops, and TLS handshake compliance far better than ephemeral compute platforms.
* **Native Client Integration**: Family members continue using their preferred mail interfaces without switching clients.
* **Zero Worker Complexity**: Keeps the Cloudflare Worker small, fast, and purely focused on inbound routing.

---

## ADR-005: Fail-Closed Default (Explicit Reject) for Unmatched Mail

### Context
When an incoming email matches no configured rule, the system can either:
1. Silently forward to a fallback/catch-all mailbox.
2. Silently discard/drop the message.
3. Explicitly reject the message at the SMTP boundary.

### Decision
We mandate an **explicit reject policy (`action: reject`)** as the default behavior.

### Rationale
* **Spam Prevention**: Silent catch-all mailboxes quickly become overwhelmed with dictionary attacks and automated bot spam.
* **Immediate Feedback**: Legitimate senders who mistype an alias receive an immediate Non-Delivery Report (NDR) informing them that the mailbox does not exist, preventing dropped communications.
* **Audit Trail**: Rejected events are logged with clear diagnostic status markers in Cloudflare Worker logs.

---

## ADR-006: Runtime & Language Selection (Node.js 22 LTS, TypeScript & ESM)

### Context
The tooling and build scripts require a dependable runtime.

### Decision
We standardize on **Node.js 22 LTS (`v22.22.2`) with ECMAScript Modules (`type: module`), TypeScript 5, and Wrangler 3**.

### Rationale
* **Hermetic & Native**: Leverages the LTS Node binary present on the host environment without requiring unverified external version managers.
* **Strong Type Safety**: TypeScript enforces end-to-end interface contracts across domain types, configuration schemas, and test fixtures.
* **Modern Tooling**: `vitest` delivers fast, native ESM unit test execution; `wrangler` provides official bundler support for text and YAML assets.
