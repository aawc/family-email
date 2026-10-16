import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('config/email-rules.yaml', () => {
  const content = readFileSync(resolve(process.cwd(), 'config/email-rules.yaml'), 'utf-8');
  return { default: content };
});

import worker from '../src/index';
import {
  normalizeAddress,
  extractLocalPart,
  compileRules,
  matchRules,
} from '../src/router';
import type { RoutingRule, CompiledRoutingRule, ForwardableEmailMessage } from '../src/types';

describe('Router Unit Tests', () => {
  describe('normalizeAddress', () => {
    it('trims leading and trailing whitespace and lowercases', () => {
      const result = normalizeAddress('  User.Name@Example.COM  ');
      expect(result.localPart).toBe('user.name');
      expect(result.domain).toBe('example.com');
    });

    it('handles email without domain safely', () => {
      const result = normalizeAddress('   SoleLocalPart   ');
      expect(result.localPart).toBe('solelocalpart');
      expect(result.domain).toBe('');
    });

    it('handles multiple @ symbols by splitting at last @', () => {
      const result = normalizeAddress('weird@local@domain.com');
      expect(result.localPart).toBe('weird@local');
      expect(result.domain).toBe('domain.com');
    });

    it('handles empty, null or non-string inputs safely', () => {
      // @ts-expect-error testing invalid runtime input
      expect(normalizeAddress(null)).toEqual({ localPart: '', domain: '' });
      // @ts-expect-error testing invalid runtime input
      expect(normalizeAddress(undefined)).toEqual({ localPart: '', domain: '' });
      expect(normalizeAddress('')).toEqual({ localPart: '', domain: '' });
    });
  });

  describe('extractLocalPart', () => {
    it('extracts local part from standard email', () => {
      expect(extractLocalPart('alice.bin@example.net')).toBe('alice.bin');
    });

    it('handles subaddressing with plus tags', () => {
      expect(extractLocalPart('bob.service+newsletter@example.net')).toBe('bob.service+newsletter');
    });

    it('returns lowercase trimmed local part', () => {
      expect(extractLocalPart('  FOO.BAR@EXAMPLE.NET  ')).toBe('foo.bar');
    });
  });

  describe('compileRules', () => {
    it('compiles valid anchored regular expressions with case-insensitive flag', () => {
      const rawRules: RoutingRule[] = [
        {
          name: 'bin-rule',
          pattern: '^.+\\.bin$',
          destination: 'bin@example.net',
        },
      ];

      const compiled = compileRules(rawRules);
      expect(compiled).toHaveLength(1);
      expect(compiled[0].regex).toBeInstanceOf(RegExp);
      expect(compiled[0].regex.flags).toContain('i');
      expect(compiled[0].regex.test('test.bin')).toBe(true);
      expect(compiled[0].regex.test('TEST.BIN')).toBe(true);
    });

    it('warns on unanchored pattern but compiles successfully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rawRules: RoutingRule[] = [
        {
          name: 'unanchored',
          pattern: '\\.bin',
          destination: 'bin@example.net',
        },
      ];

      const compiled = compileRules(rawRules);
      expect(compiled).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('is not fully anchored'));
      warnSpy.mockRestore();
    });

    it('throws descriptive error on invalid regex syntax', () => {
      const rawRules: RoutingRule[] = [
        {
          name: 'broken-regex',
          pattern: '^(broken[a-z',
          destination: 'admin@example.net',
        },
      ];

      expect(() => compileRules(rawRules)).toThrowError(
        /Invalid regular expression in rule "broken-regex"/
      );
    });

    it('throws when rule definition is missing required fields', () => {
      // @ts-expect-error testing invalid runtime rule
      expect(() => compileRules([{ name: 'test' }])).toThrowError(
        /Invalid rule definition/
      );
    });
  });

  describe('matchRules', () => {
    const rules: CompiledRoutingRule[] = compileRules([
      {
        name: 'backup-bin',
        pattern: '^backup\\.bin$',
        destination: 'admin-bin@example.net',
        description: 'Specific exception for backup.bin',
      },
      {
        name: 'general-bin',
        pattern: '^.+\\.bin$',
        destination: 'bin@example.net',
        description: 'General matcher for all other .bin aliases',
      },
      {
        name: 'version',
        pattern: '^.+\\.v$',
        destination: 'vvvv@example.net',
      },
      {
        name: 'family',
        pattern: '^family$',
        destination: 'family@example.net',
      },
    ]);

    it('matches general .bin pattern (foo.bin -> bin@example.net)', () => {
      const result = matchRules('foo.bin', rules);
      expect(result.match).toBe(true);
      if (result.match) {
        expect(result.ruleName).toBe('general-bin');
        expect(result.destination).toBe('bin@example.net');
        expect(result.action).toBe('forward');
      }
    });

    it('matches general .bin pattern (bar.bin -> bin@example.net)', () => {
      const result = matchRules('bar.bin', rules);
      expect(result.match).toBe(true);
      if (result.match) {
        expect(result.ruleName).toBe('general-bin');
        expect(result.destination).toBe('bin@example.net');
      }
    });

    it('matches version pattern (foo.v -> vvvv@example.net)', () => {
      const result = matchRules('foo.v', rules);
      expect(result.match).toBe(true);
      if (result.match) {
        expect(result.ruleName).toBe('version');
        expect(result.destination).toBe('vvvv@example.net');
      }
    });

    it('matches family exact alias (family -> family@example.net)', () => {
      const result = matchRules('family', rules);
      expect(result.match).toBe(true);
      if (result.match) {
        expect(result.ruleName).toBe('family');
        expect(result.destination).toBe('family@example.net');
      }
    });

    it('enforces first-match-wins ordering (backup.bin matches backup-bin, not general-bin)', () => {
      const result = matchRules('backup.bin', rules);
      expect(result.match).toBe(true);
      if (result.match) {
        expect(result.ruleName).toBe('backup-bin');
        expect(result.destination).toBe('admin-bin@example.net');
      }
    });

    it('handles case-insensitivity cleanly (Foo.Bin -> bin@example.net)', () => {
      const result = matchRules('Foo.Bin', rules);
      expect(result.match).toBe(true);
      if (result.match) {
        expect(result.ruleName).toBe('general-bin');
        expect(result.destination).toBe('bin@example.net');
      }
    });

    it('rejects unmatched recipient (unknown@example.net -> reject)', () => {
      const result = matchRules('unknown', rules, { action: 'reject', reason: 'Unrecognized mailbox' });
      expect(result.match).toBe(false);
      if (!result.match) {
        expect(result.action).toBe('reject');
        expect(result.reason).toBe('Unrecognized mailbox');
      }
    });

    it('rejects bare "bin" because ^.+\\.bin$ requires prefix character', () => {
      const result = matchRules('bin', rules);
      expect(result.match).toBe(false);
      if (!result.match) {
        expect(result.action).toBe('reject');
      }
    });

    it('handles empty and malformed localPart cleanly with safe rejection', () => {
      const result = matchRules('', rules);
      expect(result.match).toBe(false);
      if (!result.match) {
        expect(result.action).toBe('reject');
      }
    });
  });

  describe('Worker Email Event Consumer', () => {
    it('forwards matching incoming email to correct destination', async () => {
      const forwardSpy = vi.fn().mockResolvedValue(undefined);
      const setRejectSpy = vi.fn();
      const mockMessage = {
        to: 'shopping.bin@example.net',
        from: 'sender@external.com',
        forward: forwardSpy,
        setReject: setRejectSpy,
      } as unknown as ForwardableEmailMessage;

      await worker.email(mockMessage, {}, {} as ExecutionContext);
      expect(forwardSpy).toHaveBeenCalledWith('bin@example.net');
      expect(setRejectSpy).not.toHaveBeenCalled();
    });

    it('rejects unmatched incoming email with rejection reason', async () => {
      const forwardSpy = vi.fn().mockResolvedValue(undefined);
      const setRejectSpy = vi.fn();
      const mockMessage = {
        to: 'unmatched-user@example.net',
        from: 'sender@external.com',
        forward: forwardSpy,
        setReject: setRejectSpy,
      } as unknown as ForwardableEmailMessage;

      await worker.email(mockMessage, {}, {} as ExecutionContext);
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(setRejectSpy).toHaveBeenCalledWith('Address not recognized');
    });

    it('catches unexpected error and rejects safely', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const forwardSpy = vi.fn().mockRejectedValue(new Error('Network error'));
      const setRejectSpy = vi.fn();
      const mockMessage = {
        to: 'shopping.bin@example.net',
        from: 'sender@external.com',
        forward: forwardSpy,
        setReject: setRejectSpy,
      } as unknown as ForwardableEmailMessage;

      await worker.email(mockMessage, {}, {} as ExecutionContext);
      expect(setRejectSpy).toHaveBeenCalledWith('Internal mail delivery error');
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
