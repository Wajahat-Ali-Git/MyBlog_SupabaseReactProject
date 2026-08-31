-- ============================================================
-- Let a user delete their own draft posts.
--
-- posts has no direct DELETE RLS policy (20260730000004 locked
-- direct writes down entirely — all mutations go through RPCs), and
-- no existing RPC could remove a post at all. Drafts can pile up
-- (e.g. from insufficient-balance publishes) with no way to clear
-- them out except eventually publishing them.
--
-- Scoped to DRAFT only — a PUBLISHED post is left alone here
-- (deleting live content is a bigger decision than clearing a draft
-- and isn't part of this request).
-- ============================================================

CREATE OR REPLACE FUNCTION public.post_delete_draft(p_post_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_owner  UUID;
    v_status TEXT;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    SELECT user_id, status INTO v_owner, v_status
    FROM public.posts WHERE id = p_post_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Post % not found', p_post_id; END IF;
    IF v_owner <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: you do not own this post';
    END IF;
    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only draft posts can be deleted';
    END IF;

    DELETE FROM public.posts WHERE id = p_post_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_delete_draft(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_delete_draft(BIGINT) TO authenticated;
