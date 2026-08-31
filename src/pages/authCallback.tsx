import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import { supabase } from "../services/supabase";

const AuthCallback = () => {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      navigate("/login", { replace: true });
      return;
    }

    // After OAuth, check if this account requires MFA (aal2) before granting access.
    // Without this check, Google sign-in bypasses TOTP entirely.
    const checkMFA = async () => {
      const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (error) {
        console.error("AAL check failed:", error.message);
        navigate(role === "admin" ? "/admin" : "/", { replace: true });
        return;
      }

      if (aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        // User has TOTP enrolled but session is still aal1 — MFA required
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();

        if (factorsError || !factors.totp[0]) {
          navigate(role === "admin" ? "/admin" : "/", { replace: true });
          return;
        }

        const factor = factors.totp[0];
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: factor.id,
        });

        if (challengeError) {
          console.error("MFA challenge failed:", challengeError.message);
          navigate(role === "admin" ? "/admin" : "/", { replace: true });
          return;
        }

        // Redirect to the same MFA verify page used by email/password login
        navigate("/mfa-verify", {
          replace: true,
          state: { factorId: factor.id, challengeId: challenge.id },
        });
        return;
      }

      // Session already at aal2 or no MFA enrolled — navigate normally
      navigate(role === "admin" ? "/admin" : "/", { replace: true });
    };

    void checkMFA();
  }, [loading, user, role, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white">
      <p className="text-gray-600">Signing you in...</p>
    </div>
  );
};

export default AuthCallback;
