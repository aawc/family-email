# Dependabot Security Vulnerabilities Remediation Plan

## 1. Overview & Context

A automated security audit identified 25 open Dependabot vulnerability alerts in `package-lock.json` for the `family-email` repository. All 25 vulnerabilities originate exclusively within development toolchains and transitive dependencies:

1. **Vitest test runner toolchain** (`vitest`, `@vitest/mocker`, `tinypool`, `rollup`, `vite`, `postcss`, `launch-editor`).
2. **Wrangler / Miniflare Cloudflare Worker toolchain** (`wrangler`, `miniflare`, `sharp`, `undici`, `ws`, `@fastify/busboy`).

The production Worker runtime code in `src/` does not bundle or execute these vulnerable libraries in production because Cloudflare Email Workers run natively on the V8 isolate edge platform without external Node.js dependencies (`yaml` is the only production dependency, parsed at deploy/build time). However, local development environments, CI runners, and pre-flight check pipelines must remain hermetic and secure against path traversal, arbitrary code execution, prototype pollution, denial of service, and arbitrary file disclosure.

This plan details the systematic remediation, dependency tree upgrades, npm override pinning, and verification test gates required to resolve all 25 alerts.

---

## 2. Vulnerability Audit & Target Resolutions

The table below catalogs every identified Dependabot alert, its severity, the affected component, and the targeted resolution:

| Alert ID | Component | Severity | Vulnerability Mechanism | Target Remediation |
| :--- | :--- | :--- | :--- | :--- |
| **#12** | `vitest` | `[CRITICAL]` | Arbitrary file read & execution when Vitest UI server is listening | Upgrade root `vitest` to `^3.2.4` |
| **#3** | `rollup` | `[HIGH]` | Rollup 4 arbitrary file write via path traversal | Upgrade / override `rollup` to `>= 4.63.5` |
| **#34** | `tinypool` | `[CRITICAL]` | Prototype pollution gadget in worker options leads to RCE | Upgrade / override `tinypool` to `>= 2.2.0` |
| **#33** | `tinypool` | `[CRITICAL]` | Prototype pollution gadget to RCE in `run()` options | Upgrade / override `tinypool` to `>= 2.2.0` |
| **#35** | `sharp` | `[HIGH]` | Vulnerability in librsvg dependency (CVE-2026-96889) | Upgrade `wrangler` to `^4.23.0` & override `sharp` to `>= 0.35.5` |
| **#29** | `sharp` | `[HIGH]` | Vulnerabilities in libheif (GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545) | Upgrade `wrangler` to `^4.23.0` & override `sharp` to `>= 0.35.5` |
| **#20** | `sharp` | `[HIGH]` | Inherited vulnerabilities in libvips (CVE-2026-33327, CVE-2026-33328, etc.) | Upgrade `wrangler` to `^4.23.0` & override `sharp` to `>= 0.35.5` |
| **#14** | `vite` | `[HIGH]` | `server.fs.deny` bypass on Windows alternate paths | Upgrade / override `vite` to `>= 6.3.5` |
| **#9** | `vite` | `[MODERATE]` | Path traversal in optimized deps `.map` handling | Upgrade / override `vite` to `>= 6.3.5` |
| **#15** | `launch-editor` | `[MODERATE]` | NTLMv2 hash disclosure via UNC path handling on Windows | Upgrade / override `launch-editor` to `>= 2.14.1` |
| **#7** | `undici` | `[HIGH]` | Unbounded memory consumption in WebSocket permessage-deflate | Upgrade / override `undici` to `>= 7.29.0` |
| **#6** | `undici` | `[HIGH]` | Unhandled exception in WebSocket client via invalid window bits | Upgrade / override `undici` to `>= 7.29.0` |
| **#17** | `undici` | `[HIGH]` | WebSocket client denial of service via fragment count bypass | Upgrade / override `undici` to `>= 7.29.0` |
| **#4** | `undici` | `[MODERATE]` | HTTP request/response smuggling vulnerability | Upgrade / override `undici` to `>= 7.29.0` |
| **#2** | `undici` | `[MODERATE]` | Unbounded decompression chain on Fetch API via Content-Encoding | Upgrade / override `undici` to `>= 7.29.0` |
| **#18** | `undici` | `[MODERATE]` | HTTP header injection via Set-Cookie percent-decoding | Upgrade / override `undici` to `>= 7.29.0` |
| **#13** | `ws` | `[HIGH]` | Memory exhaustion DoS from tiny fragments and data chunks | Upgrade / override `ws` to `>= 8.21.3` |
| **#21** | `postcss` | `[HIGH]` | Arbitrary file read & info disclosure via sourceMappingURL | Upgrade / override `postcss` to `>= 8.5.28` |
| **#22** | `postcss` | `[HIGH]` | Path traversal in previous source map auto-loading | Upgrade / override `postcss` to `>= 8.5.28` |
| **#23** | `postcss` | `[MODERATE]` | Incomplete fix of GHSA-6g55-p6wh-862q when `from` is unset | Upgrade / override `postcss` to `>= 8.5.28` |
| **#10** | `postcss` | `[MODERATE]` | XSS via unescaped `</style>` in CSS stringify output | Upgrade / override `postcss` to `>= 8.5.28` |
| **#31** | `@fastify/busboy` | `[HIGH]` | Denial of Service via prototype-named multipart part header | Upgrade / override `@fastify/busboy` to `>= 3.2.2` |
| **#32** | `@fastify/busboy` | `[MODERATE]` | CRLF injection via multipart Content-Disposition filename/name | Upgrade / override `@fastify/busboy` to `>= 3.2.2` |
| **#28** | `vitest` | `[MODERATE]` | Path traversal / arbitrary file read via redirect mock | Upgrade root `vitest` to `^3.2.4` |
| **#27** | `@vitest/mocker` | `[MODERATE]` | Path traversal / arbitrary file read via redirect mock | Upgrade root `vitest` to `^3.2.4` (brings `@vitest/mocker@3.2.4`) |

---

## 3. Dependency Architecture & Strategy

### 3.1 Root Package Updates
* Update `devDependencies.vitest` from `^2.1.8` to `^3.2.4`.
* Update `devDependencies.wrangler` from `^3.88.0` to `^4.23.0` (eliminates legacy out-of-date CLI warnings and removes legacy sharp bindings).

### 3.2 Transitive Dependency Overrides
To ensure that all sub-dependencies across the dependency graph are strictly bounded to safe, patched releases without relying on loose semver ranges in third-party manifests, configure npm `overrides` in `package.json`:

```json
"overrides": {
  "@fastify/busboy": "^3.2.2",
  "launch-editor": "^2.14.1",
  "postcss": "^8.5.28",
  "rollup": "^4.63.5",
  "sharp": "^0.35.5",
  "tinypool": "^2.2.0",
  "undici": "^7.29.0",
  "vite": "^6.3.5",
  "ws": "^8.21.3"
}
```

---

## 4. Verification & Validation Steps

1. **Pre-Implementation Baseline Check**:
   - Run `corepack npm run check` on current branch (`[PASS]`).
2. **Apply Configuration Updates**:
   - Update `package.json` with updated devDependencies and `overrides`.
   - Run `corepack npm install` to regenerate `package-lock.json` cleanly.
3. **Dependency Tree Verification**:
   - Run `corepack npm explain` on all 9 affected package families to verify that every installed instance meets or exceeds the minimum safe version.
   - Confirm zero legacy instances of `vitest@2`, `rollup@4.46.0`, `tinypool@1.1.1`, `postcss@8.5.6`, `undici@5`, `ws@8.18.0`, `sharp@0.33.5`, `@fastify/busboy@2`.
4. **Automated Verification Pipeline**:
   - `corepack npm run typecheck` (`tsc --noEmit`)
   - `corepack npm run validate:config` (`scripts/validate-config.ts`)
   - `corepack npm run scan-secrets` (`scripts/scan-secrets.ts`)
   - `corepack npm run validate:docs` (`scripts/validate-docs.ts`)
   - `corepack npm test` (`vitest run`)
   - `corepack npm run build` (`wrangler deploy --dry-run`)
   - `corepack npm run check` (master pre-flight verification gate)
5. **Git Cleanliness & Review Description**:
   - Verify `git status` and `git diff`.
   - Prepare structured commit message for user review before committing.
