# Email Routing Specification

This document details the configuration model, regex matching semantics, address normalization pipeline, and execution order of the `family-email` routing engine.

*For practical, step-by-step instructions on authoring, testing, committing, and deploying rules, see the [Custom Rules Guide](custom-rules.md).*

---

## 1. Core Principles

The routing engine operates under three mandatory invariants:

1. **Configuration-Driven**: All routing rules reside in `config/email-rules.yaml`. The Cloudflare Worker code (`src/index.ts` and `src/router.ts`) contains zero hardcoded aliases or destinations.
2. **First-Match-Wins**: Rules are evaluated strictly in sequential order. The first rule whose regex matches the incoming local-part routes the email; subsequent rules are ignored.
3. **Fail-Closed Default**: If no rule matches, the message is explicitly rejected (`action: reject`). Silent catch-all forwarding is prohibited to prevent spam flooding.

---

## 2. Address Normalization Pipeline

Before any regular expression matching occurs, incoming recipient addresses pass through normalization:

```
Raw Input (`message.to`)
        │  e.g. "  Foo.Bar+tag@Example.Net  "
        ▼
1. Trimming & Lowercasing
        │  Trims surrounding whitespace
        │  Converts entire string to lowercase
        │  Result: "foo.bar+tag@example.net"
        ▼
2. Local-Part Extraction
        │  Splits string at the last '@' character
        │  Extracts everything prior to '@'
        │  Result: "foo.bar+tag"
        ▼
3. Routing Engine Evaluation
        │  Evaluates "foo.bar+tag" against compiled rules
```

---

## 3. Rule Structure & Schema

Each routing rule in `config/email-rules.yaml` must conform to the following schema:

```yaml
rules:
  - name: <string>          # Alphanumeric unique identifier (e.g., 'backup-bin')
    pattern: <string>       # Anchored JavaScript regex (e.g., '^backup\\.bin$')
    destination: <string>   # Verified destination email (e.g., 'admin@example.net')
    description: <string>   # Optional human-readable documentation
```

### Constraints & Validation Rules

* `name`: Must be unique within the configuration file and match `^[a-zA-Z0-9_-]+$`.
* `pattern`: Must be a valid JavaScript regular expression:
  * Maximum length: 256 characters.
  * Must be anchored with `^` at the beginning and `$` at the end.
  * Must not contain nested quantifiers susceptible to catastrophic backtracking (ReDoS).
* `destination`: Must be a syntactically valid email address (RFC 5322 compatible) pre-verified in Cloudflare Email Routing.

---

## 4. Evaluation Semantics (First-Match-Wins)

Because rules evaluate in declaration order, specific exception rules must precede generalized wildcard rules.

### Precedence Example

Consider this rule sequence:

```yaml
rules:
  # 1. Specific exception
  - name: backup-bin
    pattern: "^backup\\.bin$"
    destination: admin-bin@example.net

  # 2. General matcher
  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@example.net
```

### Routing Outcomes

| Incoming Address | Normalized Local-Part | Matched Rule | Destination | Status |
| :--- | :--- | :--- | :--- | :--- |
| `backup.bin@example.net` | `backup.bin` | `backup-bin` | `admin-bin@example.net` | `[PASS] Intercepted by specific rule` |
| `newsletter.bin@example.net` | `newsletter.bin` | `bin` | `bin@example.net` | `[PASS] Matched general rule` |
| `alerts.bin@example.net` | `alerts.bin` | `bin` | `bin@example.net` | `[PASS] Matched general rule` |
| `bin@example.net` | `bin` | *None* | *Rejected* | `[PASS] Rejected (+ requires >=1 character)` |

If `backup-bin` were placed after `bin`, `backup.bin` would match `^.+\\.bin$` first and be routed to `bin@example.net`. Order is load-bearing.

---

## 5. Regex Patterns & Best Practices

### Recommended Patterns

* **Sub-Domain or Dot Notation Aliases**:
  * Pattern: `^.+\\.bin$`
  * Matches: `amazon.bin`, `uber.bin`, `stripe.bin`
  * Does NOT match: `bin`, `amazon_bin`, `bin.backup`
* **Short Identity Tags**:
  * Pattern: `^.+\\.v$`
  * Matches: `newsletter.v`, `finance.v`
  * Does NOT match: `v`, `dev.vv`
* **Direct Named Mailboxes**:
  * Pattern: `^family$`
  * Matches: `family`
  * Does NOT match: `family-tree`, `myfamily`

### Patterns to Avoid (Anti-Patterns)

* **Unanchored Patterns**: `.bin` matches `bin`, `combination`, `cabin.org`. Always anchor with `^` and `$`.
* **Unescaped Dots**: `^.+bin$` matches `cabin`, `robin`. Use `\\.` to match literal dots.
* **Nested Quantifiers**: `^([a-z]+)+$` can trigger catastrophic backtracking on long malformed strings. Keep patterns linear.

---

## 6. No-Match Policy

When an incoming recipient does not match any configured rule, the router executes the `no_match` policy:

```yaml
no_match:
  action: reject
  reason: "Address not recognized"
```

* `action: reject`: Invokes `message.setReject(reason)`, generating an immediate SMTP rejection back to the sender MTA.
* Under no circumstances should unconfigured addresses be routed to an administrative mailbox. Drop or reject unmatched traffic to suppress spam loops.
