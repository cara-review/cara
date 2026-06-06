// Pure, DOM-free module so it stays unit-testable under node --test.
export const PACKAGE_ID = "@clear-diff/web";

export function greeting(): string {
  return "clear-diff";
}
