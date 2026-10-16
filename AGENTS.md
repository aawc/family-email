# Purpose

This repository implements and documents a Cloudflare-based personal/family email routing system.

The most important feature is regex-based routing of incoming addresses.

Example:
```
anything.bin@example.com → bin@gmail.com
anything.v@example.com   → vvvv@gmail.com
```

Agents must preserve this architecture unless the user explicitly requests a redesign.

# 1. Read before changing anything

Always read:
```
README.md
DESIGN.md
AGENTS.md
PROMPT.md
```

Then inspect:
```
src/
config/
tests/
scripts/
docs/
```

if present.

# 2. Architectural rules

The intended architecture is:
```
Domain
  ↓
Cloudflare DNS
  ↓
Cloudflare Email Routing
  ↓
Cloudflare Email Worker
  ↓
Regex routing
  ↓
Existing mailbox
```

Outbound:
```
Existing mailbox/email client
  ↓
SMTP relay provider
  ↓
Internet
```

Do not introduce a self-hosted mail server without explicit approval.

# 3. Routing rules are configuration

Do not hard-code individual aliases into Worker code.

Prefer:
```
rules:
  - name: bin
    pattern: "^.+\\.bin$"
    destination: bin@gmail.com
```

The Worker should be generic.

# 4. First-match-wins

Routing rules are evaluated in order.

Never change this behavior without updating:
```
README.md
DESIGN.md
PROMPT.md
tests/
```

Specific rules should normally appear before broad rules.

# 5. Regex requirements

Patterns should normally be anchored.

Good:
```
^.+\.bin$
```

Bad:
```
.bin
```

Do not automatically rewrite user-supplied regexes, because doing so may change semantics.

Instead, validation should warn about potentially unanchored patterns.

# 6. Security

Never commit:
```
Cloudflare API tokens
SMTP passwords
SMTP API keys
private keys
OAuth tokens
mailbox passwords
```

Never print secrets in CI logs.

Use:
```
environment variables
GitHub Actions secrets
Cloudflare secrets
password managers
```

as appropriate.

# 7. Personal data

Do not unnecessarily commit real family email addresses.

Use examples such as:
```
alice@example.net
bob@example.net
```

or:
```
<DESTINATION_EMAIL>
```

for public documentation.

# 8. Configuration validation

Configuration validation must check:

- YAML/JSON syntax;
- required fields;
- valid regexes;
- valid destination addresses;
- duplicate rule names;
- duplicate patterns;
- maximum rule length;
- maximum rule count;
- no obviously unsafe patterns.

# 9. Tests

Every routing change should have tests.

Minimum examples:
```
foo.bin → bin
bar.bin → bin
foo.v → v
family → family
unknown → reject
```

Also test overlapping rules.

Example:
```
backup.bin
```

must match a special rule if that rule appears before:
```
^.+\.bin$
```

# 10. Documentation synchronization

When changing:
```
routing
configuration
provider
DNS
architecture
deployment
security
```

inspect and update all affected documentation.

At minimum inspect:
```
README.md
DESIGN.md
AGENTS.md
PROMPT.md
```

Do not leave obsolete diagrams or examples.

# 11. Provider information

Provider behavior changes over time.

For current information about:

- Cloudflare Email Routing;
- Cloudflare Email Workers;
- Cloudflare pricing;
- SMTP provider pricing;
- SMTP endpoints;
- DNS requirements;

consult current primary provider documentation.

Never assume that an old free-tier limit is still valid.

# 12. DNS

Never invent:

- MX records;
- DKIM selectors;
- DKIM keys;
- SPF values;
- verification tokens.

Use provider-generated values.

If documentation needs an example, use clearly marked placeholders.

# 13. Worker changes

Keep Worker code small.

The Worker should primarily:

- receive the message;
- parse the recipient;
- normalize it;
- load validated rules;
- find the first match;
- forward or reject.

Avoid putting unrelated application logic in the Worker.

# 14. Error handling

An invalid configuration must fail safely.

Do not deploy a Worker that silently routes mail to an unintended destination.

Prefer:
```
configuration validation failure
→ deployment failure
```

over:
```
invalid configuration
→ silently use fallback mailbox
```

# 15. No-match behavior

The no-match action must be explicit.

Recommended default:
```
no_match:
  action: reject
```

Do not silently add catch-all forwarding.

# 16. Changes to configuration

When changing a rule:
```
Add/update the rule.

Add tests.

Run validation.

Update documentation if behavior changed.

Inspect the diff.
```

# 17. Changes to architecture

Architecture changes require updates to:
```
README.md
DESIGN.md
AGENTS.md
PROMPT.md
docs/decisions.md
```

where applicable.

Architecture changes should include migration notes.

# 18. Git workflow

Decompose all modifications into small, single-purpose, self-contained atomic commits. Never bundle unrelated changes (such as dependency upgrades and documentation guides) into a single monolithic commit. Each commit must compile cleanly, pass tests independently, and be individually revertible without collateral regressions.

When branch protection is active on `main`, changes must be developed on feature branches and merged via Pull Requests after passing automated status checks.

Before finishing or committing:
```
git status
git diff
```

Then run the pre-flight gate:
```
npm run check
```

Do not commit generated credentials or local environment files.

# 19. Completion criteria

A task is complete when:

- implementation is correct;
- atomic commit standards are respected;
- tests pass;
- configuration validates;
- documentation is current;
- diagrams are current;
- no secrets are exposed;
- no unrelated behavior was changed.

# 20. Preferred implementation style

Favor:
```
small functions
typed configuration
deterministic routing
explicit error handling
unit tests
```

Avoid:
```
global mutable state
hidden routing behavior
hard-coded aliases
large dependencies
unnecessary abstractions
```

# 21. In-repository file placement

Agents must ALWAYS only create files inside this repository.

Never create files outside this repository (such as in `/tmp` or arbitrary paths in `$HOME`) while working on this repository.

All temporary scripts, scratch files, artifacts, plans, notes, and documentation must reside strictly within the repository boundary (for example, in `scratch/`, `scripts/`, `docs/`, or `plans/`).

# 22. Pre-implementation planning

Agents must ALWAYS create a plan or design document and include it in the repository (e.g. in `docs/` or `plans/`) before making any code changes for the repository.

Do not start implementing or editing code without an in-repository design or implementation plan document committed or staged within the repository.

# 23. Remote website instructions

If the user needs to make changes on a remote website (such as Cloudflare Dashboard setup, email routing destination verification, DNS provider records, external SMTP relay configuration like Brevo, or GitHub repository branch protection and rulesets), ALWAYS create a separate markdown document in `docs/` with those step-by-step instructions.

Do not leave remote configuration steps only in ephemeral chat messages.

# 24. Model and tooling neutrality

Do not cite, name, or reference specific Large Language Models (LLMs), foundation models, AI providers, or agentic runtime harnesses within the repository (including code, comments, documentation, commit messages, and issues), unless strictly required for a technical integration.

Prefer vendor-neutral, implementation-focused terminology (e.g., "automated agents", "assistants", "code generators", "static analyzers", or "tooling").

Keep the repository clean of model branding, harness-specific metadata, or runtime prompt leaks.


