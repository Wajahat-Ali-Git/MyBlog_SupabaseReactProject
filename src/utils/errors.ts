/**
 * Extracts a human-readable message from a caught error.
 *
 * supabase-js does not throw real Error instances by default — the app's
 * `if (error) throw error` pattern throws the plain PostgrestError-shaped
 * object returned in `{ data, error }`, which is never `instanceof Error`
 * unless the query chained `.throwOnError()` (there is no client-level
 * option for this in the installed version — `db: { throwOnError: true }`
 * is not read by PostgrestClient). Checking `.message` directly, rather
 * than `instanceof Error`, works for both real Errors and these plain
 * error-shaped objects.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string' &&
    (err as { message: string }).message.length > 0
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
