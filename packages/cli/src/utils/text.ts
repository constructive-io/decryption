/** "1 file", "3 files": a number with its noun, pluralised the regular way. */
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
