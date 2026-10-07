export interface SecretHit {
  file: string;
  pattern: string;
}
export function findSecrets(dir: string): SecretHit[];
