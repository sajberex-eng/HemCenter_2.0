import { Transform } from 'class-transformer';

/** Surrounding blanks are dropped before validation, so a value of spaces fails MinLength. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
