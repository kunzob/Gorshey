export interface Origins {
  media: string[];
  artwork: string[];
  presence: string[];
}
export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
export function deriveOrigins(dist?: string): Origins;
export function contentSecurityPolicy(origins: Origins): string;
export function headerRules(origins?: Origins): HeaderRule[];
export function headersFor(path: string, rules: HeaderRule[]): Record<string, string>;
export function serve(port?: number, dist?: string): Promise<import('node:http').Server>;
