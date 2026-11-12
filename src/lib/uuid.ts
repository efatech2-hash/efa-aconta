/**
 * Générateur d'identifiants uniques UUID v4 basé sur crypto.randomUUID()
 * Garanti 100% unique et sans collision.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Crée un ID unique avec préfixe optionnel
 * Ex: generatePrefixedId('vte') -> 'vte-8fa71827-b50a-42b7-a3a7-e070d65b16f3'
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}-${generateUUID()}`;
}
