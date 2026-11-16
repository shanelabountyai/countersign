// Signature input limits (D-37), shared by the server check (signature.ts) and the browser pad. No Node imports.
export const SIGNATURE_LIMITS = { name: 120, path: 20_000, width: 600, height: 200 } as const;
