-- ============================================================
-- Fix: assert_aal2() only checked for a verified TOTP factor
--
-- Problem:
--   assert_aal2() (added in 20260729400001) treats a user as "unenrolled"
--   (and therefore exempts them from the AAL2 step-up requirement) unless
--   they have a verified factor with factor_type = 'totp'. A user enrolled
--   with a non-TOTP factor (e.g. phone/SMS) has a verified MFA factor but
--   is silently waved through at aal1 — the step-up check never fires for
--   them. Proof: a caller with a verified phone factor can invoke
--   wallet_transfer at aal1 and it succeeds.
--
--   The posts table's RESTRICTIVE MFA policy checks for ANY verified
--   factor (no factor_type filter), so this brings assert_aal2() in line
--   with it.
--
-- Fix:
--   Drop the factor_type = 'totp' filter — any verified MFA factor,
--   regardless of type, requires AAL2 before a money-moving RPC proceeds.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_aal2()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_aal            TEXT;
    v_has_factor     BOOLEAN;
BEGIN
    v_aal := auth.jwt() ->> 'aal';

    -- If the session is already aal2, allow immediately
    IF v_aal = 'aal2' THEN
        RETURN;
    END IF;

    -- Check whether this user has any verified MFA factor, of any type
    SELECT EXISTS (
        SELECT 1
        FROM   auth.mfa_factors
        WHERE  user_id = auth.uid()
          AND  status  = 'verified'
    ) INTO v_has_factor;

    -- If no factor is enrolled, aal1 is fine — user hasn't set up MFA
    IF NOT v_has_factor THEN
        RETURN;
    END IF;

    -- Factor enrolled but session is only aal1 → require step-up
    RAISE EXCEPTION 'MFA step-up required: complete verification before performing this action'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_aal2() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.assert_aal2() TO authenticated;
