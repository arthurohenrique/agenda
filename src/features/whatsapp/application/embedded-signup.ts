export interface EmbeddedSignupStartInput {
  tenantId: string;
  userId: string;
  returnPath: string;
}

export interface EmbeddedSignupStartResult {
  authorizationUrl: string;
  expiresAt: string;
  signedState: string;
}

export interface EmbeddedSignupFinalizeInput {
  tenantId: string;
  userId: string;
  authorizationCode: string;
  signedState: string;
}

export interface EmbeddedSignupAsset {
  businessAccountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
}

/**
 * Boundary for a future, documentation-versioned Embedded Signup adapter.
 * No implementation is registered while the feature flag is disabled.
 */
export interface EmbeddedSignupGateway {
  start(input: EmbeddedSignupStartInput): Promise<EmbeddedSignupStartResult>;
  finalize(input: EmbeddedSignupFinalizeInput): Promise<EmbeddedSignupAsset[]>;
  disconnect(input: { tenantId: string; phoneNumberId: string; userId: string }): Promise<void>;
}
