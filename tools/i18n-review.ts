// Lists bo strings that no native speaker has reviewed. Exits 1 while any remain (the M11 release gate).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function unreviewedKeys(boKeys: string[], review: { reviewed: string[] }): string[] {
  return boKeys.filter((k) => !review.reviewed.includes(k));
}

function main(): void {
  const bo = JSON.parse(readFileSync('src/i18n/catalogs/bo.json', 'utf8')) as Record<string, unknown>;
  const review = JSON.parse(readFileSync('src/i18n/catalogs/bo.review.json', 'utf8')) as { reviewed: string[] };
  const missing = unreviewedKeys(Object.keys(bo), review);
  for (const key of missing) console.log(key);
  console.log(`${missing.length} unreviewed bo string(s)`);
  process.exit(missing.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
