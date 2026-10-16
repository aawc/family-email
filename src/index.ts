import { parse } from 'yaml';
import rawRulesYaml from 'config/email-rules.yaml';
import { extractLocalPart, compileRules, matchRules } from './router';
import type {
  EmailRulesConfig,
  CompiledRoutingRule,
  ForwardableEmailMessage,
} from './types';

let cachedConfig: EmailRulesConfig | null = null;
let cachedRules: CompiledRoutingRule[] | null = null;

/**
 * Parses and compiles routing rules, caching them in memory across worker invocations.
 */
export function getCompiledRules(): {
  config: EmailRulesConfig;
  rules: CompiledRoutingRule[];
} {
  if (!cachedConfig || !cachedRules) {
    const parsed = parse(rawRulesYaml) as EmailRulesConfig;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Failed to parse email-rules.yaml: result is not an object.');
    }
    if (!Array.isArray(parsed.rules)) {
      throw new Error('Failed to parse email-rules.yaml: rules must be an array.');
    }
    cachedConfig = parsed;
    cachedRules = compileRules(parsed.rules);
  }
  return { config: cachedConfig, rules: cachedRules };
}

/**
 * Cloudflare Email Worker handler.
 */
export default {
  async email(
    message: ForwardableEmailMessage,
    env: unknown,
    ctx: ExecutionContext
  ): Promise<void> {
    try {
      const recipient = message.to;
      const localPart = extractLocalPart(recipient);
      const { config, rules } = getCompiledRules();
      const result = matchRules(localPart, rules, config.no_match);

      if (result.matched) {
        await message.forward(result.destination);
      } else {
        message.setReject(result.reason || 'Address rejected');
      }
    } catch (err: unknown) {
      console.error(
        `[CRITICAL] Unhandled email routing error for recipient "${message?.to}":`,
        err
      );
      message.setReject('Internal mail delivery error');
    }
  },
};
