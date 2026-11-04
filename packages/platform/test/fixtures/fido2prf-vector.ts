/**
 * A `fido2prf` envelope sealed once at adoption (2026-11-04) with age-encryption 0.3.1 and the
 * software authenticator in `fake-prf-authenticator.ts`, and opened with the Go plugin from
 * typage v0.2.4 (spec 0005, R5). Every value is synthetic. Never regenerate it: a change here
 * means the encoding changed.
 */
export const fido2prfVector = {
  relyingPartyId: 'example.com',
  credentialId: 'synthetic-credential-one',
  authenticatorSecret: 'synthetic credRandom, 32 bytes!!',
  identityString:
    'AGE-PLUGIN-FIDO2PRF-1Q9FTX20DSH4KYUL89DUA0FAKY6JL4ZW7DDJHSCTDWPKX2TNRDAKCQH6M5ME',
  sealed: 'synthetic vault identity for the fido2prf vector',
  envelope: `-----BEGIN AGE ENCRYPTED FILE-----
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IGFnZS1lbmNyeXB0aW9uLm9yZy9maWRv
MnByZiAyTXA1NlVIaVk5Tk9ueG9hWG1PTS9nCk12NU1reGNuUlRjWTlwWENKNXdC
OFpDdVBoSGd6eDJoMkx1dmVGZTFNaEUKLS0tIHhvcWlKRVRVL0d0bjZyMzVrUzNv
RDdGN1JkU0tObnV5eDZ4bnVMTUlZWHMKXagEnWZtYb1gPFdcqnta60Udj7Z8R2xR
cCzXMGQGg5Vigos1tGdbJZt1WspQrDAOHpSp6ljy72TRY4dUJZ+EVUAh6Ba8f+4m
WYazANIdP/4=
-----END AGE ENCRYPTED FILE-----
`,
} as const;
