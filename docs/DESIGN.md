# Email Routing System Design

## 1. Overview

This project provides custom email addresses for a personal/family domain without operating a traditional mail server.

The central feature is regex-based inbound routing.

For example:
```
*.bin@example.com → bin@gmail.com
*.v@example.com   → vvvv@gmail.com
```

The * notation is conceptual. Actual matching is performed by regular expressions.

## 2. Requirements

### Functional requirements

The system must:
- Receive email for the domain.
- Inspect the recipient address.
- Extract the local part.
- Match the local part against ordered regex rules.
- Forward matching messages to a configured destination.
- Reject or otherwise explicitly handle unmatched messages.
- Support multiple routing destinations.
- Permit specific rules to override general rules.
- Be configurable without modifying Worker source code.
- Be testable without sending real email.

### Operational requirements

The system should:
- require minimal maintenance;
- avoid self-hosted SMTP;
- avoid self-hosted IMAP;
- avoid storing mail locally;
- keep secrets outside Git;
- have reproducible deployment;
- have automated tests;
- have automated documentation checks.

## 3. Architecture
```
                        ┌───────────────────────┐
                        │       Internet        │
                        └───────────┬───────────┘
                                    │
                                    │ SMTP
                                    ▼
                        ┌───────────────────────┐
                        │      Cloudflare       │
                        │         DNS           │
                        └───────────┬───────────┘
                                    │
                                    │ MX
                                    ▼
                        ┌───────────────────────┐
                        │ Cloudflare Email      │
                        │ Routing               │
                        │                       │
                        │ Catch-all → Worker    │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │ Email Worker          │
                        │                       │
                        │ recipient extraction  │
                        │ normalization         │
                        │ regex matching        │
                        │ destination selection │
                        └───────────┬───────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
           bin@gmail.com      vvvv@gmail.com    family@gmail.com


          Outbound path

       Existing mailbox
              │
              │ SMTP
              ▼
       SMTP relay provider
              │
              ▼
           Internet
```

## 4. Components
### 4.1 Cloudflare DNS

Cloudflare hosts authoritative DNS for the domain.

DNS provides:
- MX records;
- SPF;
- DKIM;
- DMARC;
- Worker email routing configuration.

### 4.2 Cloudflare Email Routing

Email Routing receives mail addressed to the domain.

Instead of creating one Cloudflare rule for every address, a catch-all routing configuration sends mail to the Worker.

Conceptually:
```
*@example.com
      ↓
Email Worker
```

## 5. Worker

The Worker is the routing engine.

The Worker receives the email event and determines the destination.

Pseudo-code:
```
receive(message)

recipient = normalize(message.to)

localPart = recipient.localPart

for rule in rules:
    if rule.regex matches localPart:
        forward(message, rule.destination)
        return

apply no-match policy
```

## 6. Address normalization

The router should normalize addresses before matching.

At minimum:
```
trim whitespace
lowercase the domain
```

For the local part, avoid transformations that could change its meaning unless explicitly defined as part of the routing policy.

A safe initial policy is to lowercase the entire address for routing because the project's intended addresses are not case-sensitive aliases.

This policy must be documented and tested.

## 7. Rule model

A routing rule contains:
```
interface RoutingRule {
  name: string;
  pattern: string;
  destination: string;
}
```

The runtime representation may additionally contain:
```
interface CompiledRoutingRule extends RoutingRule {
  regex: RegExp;
}
```

## 8. Example configuration
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

9. Rule ordering

Rules use first-match-wins semantics.

Example:
```
rules:
  - name: special-backup
    pattern: "^backup\\.bin$"
    destination: special@gmail.com

  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@gmail.com


Results:

backup.bin → special@gmail.com
foo.bin    → bin@gmail.com


This makes rule ordering meaningful and allows exceptions.

10. Regex safety

Regexes must be treated as configuration, not executable code.

Rules must:

be valid JavaScript regular expressions;

have a maximum length;

be anchored where appropriate;

avoid unnecessary catastrophic backtracking;

be compiled during configuration validation.

A malicious or accidentally pathological regex should not be able to consume excessive Worker CPU.

11. No-match policy

Recommended behavior:

no match → reject


Possible future policies:

no match → reject
no match → forward to fallback
no match → discard


The selected policy must be explicit in configuration.

Example:

no_match:
  action: reject

12. Destination validation

Every destination must be validated as an email address.

The destination should not be allowed to come from the incoming message.

For example, do not implement:

recipient controls destination


Instead:

recipient
   ↓
trusted rule
   ↓
trusted destination

13. Outbound email

Inbound routing and outbound sending are intentionally independent.

The Worker does not need to become an outbound SMTP server.

Outbound mail is sent through a dedicated SMTP provider.

Recommended logical flow:

Gmail / Outlook / Thunderbird / Apple Mail
                    │
                    ▼
              SMTP relay
                    │
                    ▼
               Internet


The outbound provider must support:

custom sender domain;

SMTP authentication;

DKIM;

SPF;

DMARC alignment.

14. Authentication

The domain should publish:

SPF
DKIM
DMARC


The exact provider-specific DNS values are external configuration and must not be invented by this repository.

DMARC should initially be deployed in monitoring mode:

p=none


After legitimate senders are verified, enforcement can be increased.

15. Data flow

Example:

Sender
  │
  │ To: invoice.bin@example.com
  ▼
Cloudflare
  │
  ▼
Worker
  │
  ├── local part = invoice.bin
  │
  ├── /^.+\.bin$/ → MATCH
  │
  ▼
bin@gmail.com


Another example:

Sender
  │
  │ To: test.v@example.com
  ▼
Cloudflare
  │
  ▼
Worker
  │
  ├── local part = test.v
  │
  ├── /^.+\.bin$/ → NO MATCH
  │
  ├── /^.+\.v$/ → MATCH
  │
  ▼
vvvv@gmail.com

16. Configuration versus code

Routing behavior belongs in configuration.

Good:

pattern: "^.+\\.bin$"
destination: bin@gmail.com


Bad:

if (address.endsWith(".bin")) {
  ...
}


The latter makes every routing change a code deployment.

The configuration-driven approach allows the same Worker to serve many aliases.

17. Testing architecture

Tests should operate at several levels.

Unit tests

Test:

normalizeAddress()
extractLocalPart()
compileRules()
matchRules()

Routing tests

Test:

foo.bin → bin
foo.v → v
family → family
unknown → no match

Conflict tests

Test:

specific rule before general rule

Invalid configuration tests

Test:

invalid regex
invalid email
duplicate rule name
duplicate patterns
missing destination
missing domain

Integration testing

After deployment, send real email through the domain and verify:

incoming message
→ Worker
→ destination mailbox

18. Security boundaries

The system has four important trust boundaries:

Internet
   ↓
Cloudflare
   ↓
Worker
   ↓
configured destination


The Internet controls the recipient address but must not control the destination.

Only trusted configuration determines forwarding destinations.

19. Availability

The architecture intentionally delegates availability to managed providers.

There is no:

home server
home IP address
self-hosted SMTP daemon
self-hosted IMAP daemon


This reduces the number of failure modes.

20. Backups

There is little value in backing up the Worker runtime itself because it is deployed from Git.

Back up:

Git repository;

routing configuration;

DNS configuration documentation;

deployment credentials using a password manager;

provider account recovery information.

Do not back up secrets into the Git repository.

21. Future extensions

Possible future features:

rule priorities;

aliases;

destination groups;

audit logging;

automatic generated documentation;

rule testing CLI;

web-based rule editor;

Terraform/OpenTofu infrastructure;

Cloudflare API deployment;

email headers indicating the matched rule.

These should not be implemented until they solve an actual requirement.

22. Design principles

The project follows these principles:

Managed services over self-hosting.

Configuration over hard-coded routing.

First-match-wins for predictable behavior.

Explicit no-match handling.

No secrets in Git.

Automated testing.

Documentation as part of the system.

Minimal operational complexity.
