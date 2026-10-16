import type {
  RoutingRule,
  CompiledRoutingRule,
  NoMatchAction,
  NoMatchConfig,
  RoutingResult,
} from './types';

export interface NormalizedAddress {
  readonly localPart: string;
  readonly domain: string;
}

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 * Separates local-part and domain safely.
 */
export function normalizeAddress(address: string): NormalizedAddress {
  if (!address || typeof address !== 'string') {
    return { localPart: '', domain: '' };
  }
  const trimmed = address.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex === -1) {
    return { localPart: trimmed, domain: '' };
  }
  return {
    localPart: trimmed.slice(0, atIndex),
    domain: trimmed.slice(atIndex + 1),
  };
}

/**
 * Extracts and normalizes the local part before '@' from an email address.
 */
export function extractLocalPart(address: string): string {
  return normalizeAddress(address).localPart;
}

/**
 * Compiles an array of raw routing rules into executable regex rules.
 * Enforces case-insensitive matching ('i') and checks pattern syntax.
 */
export function compileRules(rawRules: readonly RoutingRule[]): CompiledRoutingRule[] {
  return rawRules.map((rule) => {
    if (!rule || typeof rule.name !== 'string' || typeof rule.pattern !== 'string') {
      throw new Error(`Invalid rule definition: must contain string name and pattern.`);
    }

    try {
      const regex = new RegExp(rule.pattern, 'i');
      const isAnchored = rule.pattern.startsWith('^') && rule.pattern.endsWith('$');
      if (!isAnchored) {
        console.warn(
          `[WARN] Rule "${rule.name}" pattern "${rule.pattern}" is not fully anchored with ^ and $.`
        );
      }
      return {
        ...rule,
        regex,
      };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Invalid regular expression in rule "${rule.name}" ("${rule.pattern}"): ${detail}`
      );
    }
  });
}

/**
 * Evaluates a local-part against compiled rules in strict first-match-wins order.
 * Fails safely on any regex or execution errors.
 */
export function matchRules(
  localPart: string,
  compiledRules: readonly CompiledRoutingRule[],
  noMatch?: NoMatchAction | NoMatchConfig
): RoutingResult {
  const defaultReason =
    typeof noMatch === 'object' && noMatch?.reason
      ? noMatch.reason
      : 'Address not recognized';

  if (!localPart || typeof localPart !== 'string') {
    return {
      match: false,
      matched: false,
      action: 'reject',
      reason: defaultReason,
    };
  }

  try {
    for (const rule of compiledRules) {
      if (rule.regex.test(localPart)) {
        return {
          match: true,
          matched: true,
          rule,
          ruleName: rule.name,
          destination: rule.destination,
          action: 'forward',
        };
      }
    }

    return {
      match: false,
      matched: false,
      action: 'reject',
      reason: defaultReason,
    };
  } catch (err: unknown) {
    console.error(`[ERROR] Regex evaluation failed for localPart "${localPart}":`, err);
    return {
      match: false,
      matched: false,
      action: 'reject',
      reason: 'Safe rejection due to rule evaluation error',
    };
  }
}
