-- ============================================================
-- Fix: post_delete_draft (20260807000000, already pushed) fails with
-- a foreign-key violation for any draft that scheduled_jobs_run_due()
-- created — that function always inserts a scheduled_job_runs row
-- pointing at the post it produced, even when the post lands as
-- DRAFT (insufficient balance at run time). scheduled_job_runs.post_id
-- REFERENCES posts(id) with no ON DELETE clause (defaults to NO
-- ACTION), so deleting such a draft was blocked by Postgres before
-- post_delete_draft's own logic ever got a say.
--
-- Fix: detach the run-history row instead of letting the FK block the
-- delete. post_id is already nullable (failed runs already insert
-- with it omitted), so this preserves the audit trail (job_id,
-- status, error, ran_at all stay intact) while freeing the post row
-- to be deleted. Drafts created via post_publish (the simple-post
-- path, which never touches scheduled_job_runs) were never affected.
--
-- 20260807000000 is already applied, so this is a new migration
-- rather than an edit to that file, per the "never edit an
-- already-pushed migration" rule. Return type (VOID) is unchanged,
-- so CREATE OR REPLACE is correct here, not DROP + CREATE.
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

    UPDATE public.scheduled_job_runs SET post_id = NULL WHERE post_id = p_post_id;

    DELETE FROM public.posts WHERE id = p_post_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_delete_draft(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_delete_draft(BIGINT) TO authenticated;
