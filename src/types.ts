/**
 * Type definitions for the family-email serverless routing engine.
 */

export type NoMatchAction = 'reject' | 'drop';

export interface RoutingRule {
  readonly name: string;
  readonly pattern: string;
  readonly destination: string;
  readonly description?: string;
}

export interface CompiledRoutingRule extends RoutingRule {
  readonly regex: RegExp;
}

export interface NoMatchConfig {
  readonly action: NoMatchAction;
  readonly reason?: string;
}

export interface EmailRulesConfig {
  readonly domain: string;
  readonly rules: readonly RoutingRule[];
  readonly no_match?: NoMatchConfig;
}

export type RoutingResult =
  | {
      readonly match: true;
      readonly matched: true;
      readonly rule: CompiledRoutingRule;
      readonly ruleName: string;
      readonly destination: string;
      readonly action: 'forward';
    }
  | {
      readonly match: false;
      readonly matched: false;
      readonly action: 'reject';
      readonly reason: string;
    };

/**
 * Interface matching Cloudflare Workers ForwardableEmailMessage.
 */
export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  setReject(reason: string): void;
}

const defaultYamlContent: string = '';
export default defaultYamlContent;
