-- ============================================================
-- Lock down direct client writes to posts.
--
-- post_publish() (and the admin-only post_publish_free()) are the only
-- fee-aware paths for creating/publishing a post — both are SECURITY
-- DEFINER and bypass RLS by design. But the original "Users can create
-- posts" / "Users can update own posts" RLS policies
-- (20260722000000_create_schema.sql) were never tightened once the
-- publish-fee system was added on top, so a client could bypass
-- post_publish entirely and never pay the fee:
--
--   supabase.from('posts').insert({ user_id, title, content, status: 'PUBLISHED' })
--
--   -- worse: post_publish's insufficient-funds fallback creates a DRAFT
--   -- the caller owns, and the UPDATE policy had no WITH CHECK clause —
--   -- Postgres defaults WITH CHECK to the same expression as USING for
--   -- UPDATE, so ANY column including status could be changed on any
--   -- row the user owns:
--   supabase.from('posts').update({ status: 'PUBLISHED' }).eq('id', myDraftId)
--
-- No code in src/ performs a direct insert/update on posts — every
-- create/publish path goes through supabase.rpc('post_publish' /
-- 'post_publish_free'). Removing direct write access entirely is safe
-- and closes the bypass completely. Read access (the "Published posts
-- are public" policy) and delete access are unaffected — this migration
-- only removes INSERT/UPDATE for the authenticated role.
-- ============================================================

DROP POLICY IF EXISTS "Users can create posts" ON public.posts;
DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
