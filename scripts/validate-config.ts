import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { EmailRulesConfig, RoutingRule } from '../src/types';

interface ValidationError {
  readonly file: string;
  readonly message: string;
}

interface ValidationWarning {
  readonly file: string;
  readonly message: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const DOMAIN_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const DANGEROUS_REDOS_PATTERNS = [
  /\([^)]*(\+|\*)[^)]*\)(\+|\*|\{\d+,?\d*\})/, // nested quantifiers like (a+)+ or (.*)*
];

export function validateConfigFile(filePath: string): {
  errors: ValidationError[];
  warnings: ValidationWarning[];
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    errors.push({
      file: filePath,
      message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { errors, warnings };
  }

  let parsed: unknown;
  try {
    parsed = parse(fileContent);
  } catch (err: unknown) {
    errors.push({
      file: filePath,
      message: `YAML syntax error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { errors, warnings };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push({
      file: filePath,
      message: 'Configuration root must be a YAML mapping/object.',
    });
    return { errors, warnings };
  }

  const config = parsed as Partial<EmailRulesConfig>;

  // 1. Validate domain
  if (!config.domain || typeof config.domain !== 'string') {
    errors.push({
      file: filePath,
      message: 'Missing or invalid "domain" field; must be a non-empty string.',
    });
  } else if (!DOMAIN_REGEX.test(config.domain.trim())) {
    errors.push({
      file: filePath,
      message: `Invalid domain syntax: "${config.domain}".`,
    });
  }

  // 2. Validate rules array
  if (!config.rules || !Array.isArray(config.rules)) {
    errors.push({
      file: filePath,
      message: 'Missing or invalid "rules" field; must be an array of routing rules.',
    });
    return { errors, warnings };
  }

  if (config.rules.length === 0) {
    warnings.push({
      file: filePath,
      message: 'Configuration defines 0 routing rules.',
    });
  }

  if (config.rules.length > 100) {
    errors.push({
      file: filePath,
      message: `Rule count (${config.rules.length}) exceeds maximum limit of 100.`,
    });
  }

  const seenRuleNames = new Set<string>();
  const seenPatterns = new Set<string>();

  config.rules.forEach((rule: RoutingRule, index: number) => {
    const prefix = `Rule #${index + 1}`;

    // Name checks
    if (!rule.name || typeof rule.name !== 'string' || rule.name.trim().length === 0) {
      errors.push({
        file: filePath,
        message: `${prefix}: Missing or empty "name".`,
      });
    } else {
      const trimmedName = rule.name.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
        errors.push({
          file: filePath,
          message: `${prefix} ("${trimmedName}"): Name must be alphanumeric with underscores or hyphens.`,
        });
      }
      if (seenRuleNames.has(trimmedName)) {
        errors.push({
          file: filePath,
          message: `${prefix}: Duplicate rule name "${trimmedName}".`,
        });
      }
      seenRuleNames.add(trimmedName);
    }

    // Pattern checks
    if (!rule.pattern || typeof rule.pattern !== 'string') {
      errors.push({
        file: filePath,
        message: `${prefix}: Missing or empty "pattern".`,
      });
    } else {
      const pattern = rule.pattern;
      if (pattern.length > 256) {
        errors.push({
          file: filePath,
          message: `${prefix} ("${rule.name}"): Pattern length (${pattern.length}) exceeds 256 characters.`,
        });
      }

      if (seenPatterns.has(pattern)) {
        errors.push({
          file: filePath,
          message: `${prefix} ("${rule.name}"): Duplicate pattern "${pattern}".`,
        });
      }
      seenPatterns.add(pattern);

      // Regex validity
      try {
        new RegExp(pattern, 'i');
      } catch (err: unknown) {
        errors.push({
          file: filePath,
          message: `${prefix} ("${rule.name}"): Invalid regex syntax: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }

      // ReDoS checks
      for (const dangerous of DANGEROUS_REDOS_PATTERNS) {
        if (dangerous.test(pattern)) {
          errors.push({
            file: filePath,
            message: `${prefix} ("${rule.name}"): Pattern contains potentially dangerous nested quantifiers (ReDoS risk).`,
          });
        }
      }

      // Anchoring check
      const isAnchored = pattern.startsWith('^') && pattern.endsWith('$');
      if (!isAnchored) {
        warnings.push({
          file: filePath,
          message: `${prefix} ("${rule.name}"): Pattern "${pattern}" is not anchored with ^ and $.`,
        });
      }
    }

    // Destination checks
    if (!rule.destination || typeof rule.destination !== 'string') {
      errors.push({
        file: filePath,
        message: `${prefix}: Missing or empty "destination".`,
      });
    } else {
      const destination = rule.destination.trim();
      if (!EMAIL_REGEX.test(destination)) {
        errors.push({
          file: filePath,
          message: `${prefix} ("${rule.name}"): Invalid destination email format "${destination}".`,
        });
      }
    }
  });

  // 3. Validate no_match
  if (config.no_match) {
    if (typeof config.no_match !== 'object') {
      errors.push({
        file: filePath,
        message: '"no_match" field must be a mapping.',
      });
    } else {
      const action = config.no_match.action;
      if (action !== 'reject' && action !== 'drop') {
        errors.push({
          file: filePath,
          message: `"no_match.action" must be "reject" or "drop", got "${action}".`,
        });
      }
    }
  }

  return { errors, warnings };
}

function run(): void {
  const targetFiles = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['config/email-rules.yaml', 'config/email-rules.example.yaml'];

  let totalErrors = 0;
  let totalWarnings = 0;

  console.log('[CONFIG VALIDATION] Starting configuration checks...');

  for (const relativePath of targetFiles) {
    const fullPath = resolve(process.cwd(), relativePath);
    console.log(`[CHECK] Validating: ${relativePath}`);
    const { errors, warnings } = validateConfigFile(fullPath);

    for (const w of warnings) {
      console.warn(`  [WARN] ${w.file}: ${w.message}`);
      totalWarnings++;
    }

    for (const e of errors) {
      console.error(`  [FAIL] ${e.file}: ${e.message}`);
      totalErrors++;
    }

    if (errors.length === 0) {
      console.log(`  [PASS] ${relativePath} is valid.`);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`[SUMMARY] Errors: ${totalErrors}, Warnings: ${totalWarnings}`);

  if (totalErrors > 0) {
    console.error('[FAIL] Configuration validation failed.');
    process.exit(1);
  } else {
    console.log('[PASS] All configuration files validated successfully.');
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
