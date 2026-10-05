# Family Domain Email

A lightweight personal/family email system for a domain managed by Cloudflare.

The system supports email addresses that do not need to be individually created. Instead, the recipient address is matched against regular expressions and routed to the appropriate mailbox.

For example:

```
anything.bin@example.com  → bin@gmail.com
foo.bin@example.com        → bin@gmail.com
backup.v@example.com       → vvvv@gmail.com
anything.v@example.com     → vvvv@gmail.com
```

The receiving system is implemented with a Cloudflare Email Worker.

Outbound email uses an SMTP relay such as Brevo.

## Architecture

```
                         Internet
                            │
                            │ SMTP
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
                            ▼
                 ┌──────────────────────┐
                 │ Cloudflare Email     │
                 │ Worker               │
                 │                      │
                 │ Regex router         │
                 └──────────┬───────────┘
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
       bin@gmail.com   vvvv@gmail.com   family@gmail.com

Existing mailbox / email client
             │
             │ SMTP submission
             ▼
       Brevo SMTP relay
             │
             ▼
        Internet mail
```

## Design goals

The system should:

* use a personally owned domain;
* support arbitrary regex-based inbound addresses;
* avoid operating an SMTP/IMAP server;
* route addresses to ordinary existing mailboxes;
* support multiple family members;
* make routing rules configuration-driven;
* keep secrets out of Git;
* make changes easy to test;
* keep code and documentation synchronized automatically.

## Example routing rules

Routing rules live in configuration rather than being hard-coded into the Worker.

```
domain: example.com

rules:
  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@gmail.com

  - name: version
    pattern: "^.+\\.v$"
    destination: vvvv@gmail.com

  - name: family
    pattern: "^family$"
    destination: family@gmail.com
```

The regex is applied to the local part of the recipient address.

For:
```
invoice.bin@example.com
```

the Worker evaluates:
```
invoice.bin
```

against:
```
^.+\.bin$
```

and forwards the message to:
```
bin@gmail.com
```

## Routing semantics

Rules are evaluated in order.

The first matching rule wins.

Example:
```
rules:
  - name: special
    pattern: "^backup\\.bin$"
    destination: special@gmail.com

  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@gmail.com
```

Therefore:
```
backup.bin@example.com → special@gmail.com
test.bin@example.com   → bin@gmail.com
```

This allows specific exceptions to be placed before general rules.

### No-match behavior

Messages that do not match any rule should have an explicit policy.

The default recommended policy is:
```
NO MATCH → reject
```

Do not silently forward unmatched messages to a personal mailbox unless explicitly configured.

This reduces spam and prevents accidental delivery of arbitrary addresses.

## Outbound email

Inbound email and outbound email are separate concerns.

### Receiving

```
Internet
   ↓
Cloudflare MX
   ↓
Cloudflare Email Worker
   ↓
Regex routing
   ↓
Existing mailbox
```

### Sending
```
Email client
   ↓
SMTP relay
   ↓
Internet
```

A provider such as Brevo can provide the outbound SMTP relay.

The exact provider, quota, pricing, SMTP hostname, and authentication requirements must be checked against current provider documentation rather than assumed from this repository.

## Why not run our own mail server?

A self-hosted mail server requires dealing with:
- SMTP;
- IMAP;
- spam filtering;
- DNS;
- SPF;
- DKIM;
- DMARC;
- IP reputation;
- Reverse DNS;
- Blocklists;
- TLS;
- Backups;
- Emailbox storage;
- Abuse handling;
- Deliverability.


For personal/family usage, this is unnecessary operational complexity.

Cloudflare handles receiving and the Worker handles routing.

An external SMTP provider handles outbound delivery.

## Repository layout

```
family-email/
├── README.md
├── DESIGN.md
├── AGENTS.md
├── PROMPT.md
├── package.json
├── wrangler.jsonc
│
├── src/
│   ├── index.ts
│   ├── router.ts
│   └── types.ts
│
├── config/
│   ├── email-rules.yaml
│   └── email-rules.example.yaml
│
├── tests/
│   ├── router.test.ts
│   └── rules.test.ts
│
├── scripts/
│   ├── validate-config.ts
│   ├── validate-docs.ts
│   └── scan-secrets.ts
│
├── docs/
│   ├── dns.md
│   ├── routing.md
│   ├── operations.md
│   ├── security.md
│   └── decisions.md
│
└── .github/
    └── workflows/
        └── validate.yml
```

## Configuration

Use an example configuration in Git:
```
domain: example.com

rules:
  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@example.net

  - name: version
    pattern: "^.+\\.v$"
    destination: version@example.net
```

Private production configuration should not contain unnecessary personal information.

Never commit:
- passwords;
- SMTP credentials;
- API tokens;
- Cloudflare tokens;
- private keys;
- OAuth tokens.

## DNS

Cloudflare should host the domain's DNS.

The system requires appropriate:
- MX records;
- SPF;
- DKIM;
- DMARC;
- Worker Email Routing configuration.

Provider-generated DNS values must never be invented.

The actual values should be obtained from the Cloudflare and outbound SMTP provider dashboards.

See:
```
docs/dns.md
```

## Cloudflare Worker

The Worker receives the email event and extracts:
```
message.to
```

It then extracts the local part:
```
foo.bin@example.com
    ↓
foo.bin
```

and evaluates the routing rules.

Conceptually:
```
for (const rule of rules) {
  if (rule.regex.test(localPart)) {
    await message.forward(rule.destination);
    return;
  }
}

reject(message);
```

The production implementation should validate and compile configuration safely and should not allow malformed rules to break the entire Worker.

## Regex requirements

Every regex should be anchored.

Prefer:
```
^.+\.bin$
```

over:
```
.bin
```

The first expression means:
```
the entire local part must end in .bin
```

This prevents accidental partial matches.

Avoid overly broad expressions such as:
```
.*
```

unless they are intentionally being used as a final catch-all rule.

## Testing

Routing must be tested independently from Cloudflare.

Example:
```
foo.bin@example.com
→ bin@gmail.com

bar.bin@example.com
→ bin@gmail.com

foo.v@example.com
→ vvvv@gmail.com

family@example.com
→ family@gmail.com

unknown@example.com
→ reject
```

Also test:
- uppercase input;
- malformed addresses;
- empty local parts;
- overlapping rules;
- special characters;
- duplicate rules;
- invalid regular expressions;
- no-match behavior.

## Security

The Worker must not trust configuration blindly.

Validate:

- regex syntax;
- destination email syntax;
- domain;
- rule names;
- duplicate names;
- duplicate patterns;
- maximum rule count.

Do not execute arbitrary code supplied through configuration.

## Documentation automation

Documentation is part of the project.

When the implementation changes, the documentation must be reviewed.

When the architecture changes, update:
```
README.md
DESIGN.md
AGENTS.md
PROMPT.md
docs/
```

CI should check for obvious inconsistencies.

The goal is that an agent can inspect the repository and understand the actual architecture without relying on chat history.

## Deployment

The deployment process should eventually be:
```
npm install
npm test
npm run validate
npm run deploy
```

The exact commands may change as the implementation evolves.

Deployment must not require secrets to be committed to Git.

## Operational principle

Keep the system boring.

Prefer:
```
Cloudflare
+
small Worker
+
configuration
+
existing mailboxes
+
SMTP provider
```

over a custom mail server.

The system should be easy for another person to understand and maintain several years from now.
