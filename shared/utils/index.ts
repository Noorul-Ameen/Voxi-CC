export * from './datetime';
export * from './fuzzy';

/** Small, dependency-free unique id (not cryptographic). */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
