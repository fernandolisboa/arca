/** Creation options as the server answers them, for route tests whose services are fakes. */
export const creationOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'arca.test', name: 'Arca' },
  user: { id: 'dXNlcg', name: 'owner@example.com', displayName: 'owner@example.com' },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  authenticatorSelection: {
    residentKey: 'required' as const,
    requireResidentKey: true as const,
    userVerification: 'required' as const,
  },
  extensions: { prf: {} },
};

/** An attestation shaped as the contract takes it; the fakes never verify it. */
export const attestation = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'oA' },
  clientExtensionResults: { prf: { enabled: true } },
};
