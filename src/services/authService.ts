import { supabase } from "./supabase";

/**
 * Fetches the role of a user from the profiles table.
 * Returns "admin" if is_admin is true, otherwise "user".
 */
export const fetchUserRole = async (userId: string): Promise<string> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data?.is_admin ? "admin" : "user";
};

/**
 * Signs up a new user with email, password, and metadata (username).
 */
export const signUp = async (email: string, password: string, username: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
      },
    },
  });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Signs in a user and retrieves their profile role. If the account has an
 * MFA factor enrolled, returns the challenge details instead of a role so
 * the caller can route to the MFA verification step.
 */
export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) {
    throw aalError;
  }

  if (aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) {
      throw factorsError;
    }

    const factor = factors.totp[0];
    if (!factor) {
      throw new Error("No MFA factor found for this account");
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    });
    if (challengeError) {
      throw challengeError;
    }

    return {
      mfaRequired: true as const,
      factorId: factor.id,
      challengeId: challenge.id,
    };
  }

  if (data.user && data.session) {
    const role = await fetchUserRole(data.user.id);
    return { mfaRequired: false as const, user: data.user, session: data.session, role };
  }

  throw new Error("No session created");
};

/**
 * Signs in a user with Google via Supabase OAuth. Redirects the browser to
 * Google's consent screen; the resulting session is picked up by the
 * onAuthStateChange listener in AuthContext after the redirect back.
 */
export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Signs out the current user.
 */
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  localStorage.removeItem("user_role");
  if (error) {
    throw error;
  }
};

/**
 * Retrieves the currently logged in user session.
 */
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  return user;
};


export const forgetPassword = async (email: string) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    throw error;
  }

  return data;
};

export const resetPassword = async (password: string) => {
  const { data, error } = await supabase.auth.updateUser({ password });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Verifies a 6-digit MFA code against an existing challenge, completing
 * sign-in and upgrading the session to aal2.
 */
export const verifyMFA = async (factorId: string, challengeId: string, code: string) => {
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Starts TOTP enrollment for the current user.
 * Returns the factor id, QR code data URI, and manual secret key.
 */
export const enrollTOTP = async () => {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
  });

  if (error) {
    throw error;
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,   // SVG data URI — render directly as <img src>
    secret: data.totp.secret,    // Manual entry fallback
  };
};

/**
 * Activates an enrolled TOTP factor by verifying the first 6-digit code.
 * Must be called immediately after enrollTOTP while the factor is still unverified.
 */
export const verifyEnrollment = async (factorId: string, code: string) => {
  // Create a challenge for the newly enrolled factor
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError) {
    throw challengeError;
  }

  // Verify the first code — this activates the factor
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Removes a TOTP factor from the user's account, disabling MFA.
 */
export const unenrollTOTP = async (factorId: string) => {
  const { data, error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Returns the currently enrolled TOTP factor for the user, or null if none.
 */
export const getEnrolledTOTPFactor = async () => {
  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error) {
    throw error;
  }

  return data.totp[0] ?? null;
};
