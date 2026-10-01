import { isValid, monotonicFactory } from "ulidx";

const next = monotonicFactory();

/** A new ULID: sortable, random, safe in URLs. */
export const newId = (): string => next();

export const isId = (value: unknown): value is string => typeof value === "string" && isValid(value);
