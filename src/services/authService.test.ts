import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignInWithPassword = vi.fn();
const mockGetAAL = vi.fn();
const mockListFactors = vi.fn();
const mockChallenge = vi.fn();
const mockVerify = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      mfa: {
        getAuthenticatorAssuranceLevel: (...args: unknown[]) => mockGetAAL(...args),
        listFactors: (...args: unknown[]) => mockListFactors(...args),
        challenge: (...args: unknown[]) => mockChallenge(...args),
        verify: (...args: unknown[]) => mockVerify(...args),
      },
    },
    from: (...args: unknown[]) => {
      mockFrom(...args);
      return {
        select: (...selectArgs: unknown[]) => {
          mockSelect(...selectArgs);
          return {
            eq: (...eqArgs: unknown[]) => {
              mockEq(...eqArgs);
              return {
                single: (...singleArgs: unknown[]) => mockSingle(...singleArgs),
              };
            },
          };
        },
      };
    },
  },
}));

import { signIn, verifyMFA, fetchUserRole } from "./authService";

describe("signIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the user, session, and role when no MFA step-up is required", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "token" } },
      error: null,
    });
    mockGetAAL.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { is_admin: false }, error: null });

    const result = await signIn("user@example.com", "password123");

    expect(result).toEqual({
      mfaRequired: false,
      user: { id: "user-1" },
      session: { access_token: "token" },
      role: "user",
    });
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockSelect).toHaveBeenCalledWith("is_admin");
    expect(mockEq).toHaveBeenCalledWith("id", "user-1");
  });

  it("returns challenge details when the account requires an MFA step-up", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "token" } },
      error: null,
    });
    mockGetAAL.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    mockListFactors.mockResolvedValue({
      data: { totp: [{ id: "factor-1" }] },
      error: null,
    });
    mockChallenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });

    const result = await signIn("user@example.com", "password123");

    expect(result).toEqual({
      mfaRequired: true,
      factorId: "factor-1",
      challengeId: "challenge-1",
    });
    expect(mockChallenge).toHaveBeenCalledWith({ factorId: "factor-1" });
  });

  it("throws when the password sign-in itself fails", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error("Invalid login credentials"),
    });

    await expect(signIn("user@example.com", "wrong-password")).rejects.toThrow(
      "Invalid login credentials"
    );
    expect(mockGetAAL).not.toHaveBeenCalled();
  });

  it("throws when an MFA step-up is required but no TOTP factor exists", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "token" } },
      error: null,
    });
    mockGetAAL.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    mockListFactors.mockResolvedValue({ data: { totp: [] }, error: null });

    await expect(signIn("user@example.com", "password123")).rejects.toThrow(
      "No MFA factor found"
    );
  });
});

describe("verifyMFA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the verification data on success", async () => {
    mockVerify.mockResolvedValue({ data: { access_token: "new-token" }, error: null });

    const result = await verifyMFA("factor-1", "challenge-1", "123456");

    expect(result).toEqual({ access_token: "new-token" });
    expect(mockVerify).toHaveBeenCalledWith({
      factorId: "factor-1",
      challengeId: "challenge-1",
      code: "123456",
    });
  });

  it("throws when the code is invalid", async () => {
    mockVerify.mockResolvedValue({
      data: null,
      error: new Error("Invalid TOTP code"),
    });

    await expect(verifyMFA("factor-1", "challenge-1", "000000")).rejects.toThrow(
      "Invalid TOTP code"
    );
  });
});

describe("fetchUserRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns admin when the profile is flagged as admin", async () => {
    mockSingle.mockResolvedValue({ data: { is_admin: true }, error: null });

    await expect(fetchUserRole("user-1")).resolves.toBe("admin");
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockSelect).toHaveBeenCalledWith("is_admin");
    expect(mockEq).toHaveBeenCalledWith("id", "user-1");
  });

  it("returns user when the profile is not flagged as admin", async () => {
    mockSingle.mockResolvedValue({ data: { is_admin: false }, error: null });

    await expect(fetchUserRole("user-1")).resolves.toBe("user");
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockSelect).toHaveBeenCalledWith("is_admin");
    expect(mockEq).toHaveBeenCalledWith("id", "user-1");
  });

  it("throws when the profile lookup fails", async () => {
    mockSingle.mockResolvedValue({ data: null, error: new Error("Not found") });

    await expect(fetchUserRole("user-1")).rejects.toThrow("Not found");
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });
});
