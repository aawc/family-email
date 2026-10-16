import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { validateConfigFile } from '../scripts/validate-config';
import { validateDocs } from '../scripts/validate-docs';
import { compileRules, matchRules, extractLocalPart } from '../src/router';
import type { EmailRulesConfig } from '../src/types';

describe('Configuration Rules Integration Tests', () => {
  const activeConfigPath = resolve(process.cwd(), 'config/email-rules.yaml');
  const exampleConfigPath = resolve(process.cwd(), 'config/email-rules.example.yaml');

  describe('Validation Script Checks', () => {
    it('validates config/email-rules.yaml with zero errors', () => {
      const { errors } = validateConfigFile(activeConfigPath);
      expect(errors).toEqual([]);
    });

    it('validates config/email-rules.example.yaml with zero errors', () => {
      const { errors } = validateConfigFile(exampleConfigPath);
      expect(errors).toEqual([]);
    });

    it('validates repository documentation and model neutrality with zero errors', () => {
      const { errors } = validateDocs(process.cwd());
      expect(errors).toEqual([]);
    });
  });

  describe('Active Rules Table-Driven Integration Tests', () => {
    const rawYaml = readFileSync(activeConfigPath, 'utf-8');
    const parsed = parse(rawYaml) as EmailRulesConfig;
    const compiled = compileRules(parsed.rules);

    const testCases = [
      {
        email: 'backup.bin@example.net',
        expectedMatched: true,
        expectedRule: 'backup-bin',
        expectedDestination: 'admin-bin@example.net',
      },
      {
        email: 'Backup.Bin@Example.Net',
        expectedMatched: true,
        expectedRule: 'backup-bin',
        expectedDestination: 'admin-bin@example.net',
      },
      {
        email: 'shopping.bin@example.net',
        expectedMatched: true,
        expectedRule: 'bin',
        expectedDestination: 'bin@example.net',
      },
      {
        email: 'newsletter.bin@example.net',
        expectedMatched: true,
        expectedRule: 'bin',
        expectedDestination: 'bin@example.net',
      },
      {
        email: 'service.v@example.net',
        expectedMatched: true,
        expectedRule: 'version',
        expectedDestination: 'vvvv@example.net',
      },
      {
        email: 'alerts.v@example.net',
        expectedMatched: true,
        expectedRule: 'version',
        expectedDestination: 'vvvv@example.net',
      },
      {
        email: 'family@example.net',
        expectedMatched: true,
        expectedRule: 'family',
        expectedDestination: 'family@example.net',
      },
      {
        email: 'bin@example.net',
        expectedMatched: false,
        expectedRule: undefined,
        expectedDestination: undefined,
      },
      {
        email: 'v@example.net',
        expectedMatched: false,
        expectedRule: undefined,
        expectedDestination: undefined,
      },
      {
        email: 'unknown-address@example.net',
        expectedMatched: false,
        expectedRule: undefined,
        expectedDestination: undefined,
      },
      {
        email: 'random.other@example.net',
        expectedMatched: false,
        expectedRule: undefined,
        expectedDestination: undefined,
      },
    ];

    testCases.forEach(({ email, expectedMatched, expectedRule, expectedDestination }) => {
      it(`routes "${email}" -> ${expectedMatched ? expectedDestination : 'reject'}`, () => {
        const localPart = extractLocalPart(email);
        const result = matchRules(localPart, compiled, parsed.no_match);

        expect(result.match).toBe(expectedMatched);
        if (expectedMatched) {
          expect(result.action).toBe('forward');
          if (result.match) {
            expect(result.ruleName).toBe(expectedRule);
            expect(result.destination).toBe(expectedDestination);
          }
        } else {
          expect(result.action).toBe('reject');
        }
      });
    });
  });
});
