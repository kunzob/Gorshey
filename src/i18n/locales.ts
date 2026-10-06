// The only list to edit when adding a language. Adding a locale also needs a catalog file in catalogs/.
export const LOCALES = [
  { code: 'bo', label: 'བོད་ཡིག' },
  { code: 'en', label: 'English' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
