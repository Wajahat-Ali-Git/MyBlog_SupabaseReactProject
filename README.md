# MyBlog — React + Supabase Platform

A full-featured **blog & wallet platform** built with React 19, TypeScript, Vite, MUI v9, and Supabase. Users can publish posts (with an optional platform fee deducted from their in-app wallet), manage funds via a two-step top-up approval flow, and transfer balances peer-to-peer — all secured by Row Level Security, MFA enforcement at the database layer, and an append-only ledger.

---

## ✨ Features

### Blog
- Create, publish, and browse posts
- Platform publish fee (set by admin); posts saved as **DRAFT** when balance is insufficient
- Admin can publish drafts for free via `post_publish_free` RPC
- RLS-enforced visibility: drafts are private to their author and admins

### Wallet System
- **Balance card** with real-time updates (Supabase Realtime)
- **Top-up request flow** — users submit requests, admins approve/reject; no direct credit from the client
- **Peer-to-peer transfers** with a 3-step confirmation modal
- **Transaction history** ordered by sequence number (append-only ledger)
- **Admin adjustment panel** — credit/debit any wallet with a mandatory reason
- Real-time notifications for users (approved/rejected) and admins (new pending requests)
- Unseen badge count persisted to `localStorage`

### Authentication & Security
- Email/password sign-up & sign-in
- Password reset via email
- **TOTP MFA** — enrollment and step-up verification
- All money-moving RPCs require **AAL2** (MFA-verified session)
- All security guards live at the **PostgreSQL layer** — cannot be bypassed through the UI

### Admin Dashboard
- Live wallet stats
- Manage posts (list, fee settings tab)
- Manage wallets (balances, transactions, top-up requests, adjustments)

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8 |
| UI | MUI v9 (Material UI), Tailwind CSS v4, Emotion |
| Forms | React Hook Form + Zod |
| Routing | React Router v7 |
| Backend | Supabase (PostgreSQL, Auth, Realtime, RLS) |
| Testing | Vitest, Testing Library |
| Linting | ESLint, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` |

---

## 📁 Project Structure

```
src/
├── components/          # Shared UI (Header, BackButton, ErrorBoundary)
├── contexts/            # React contexts (authContext — user, role, loading)
├── consts/              # Shared TypeScript interfaces
├── pages/               # Route-level pages
│   ├── home.tsx         # Blog feed + create post
│   ├── post.tsx         # Single post view
│   ├── myPosts.tsx      # User's own posts
│   ├── adminHome.tsx    # Admin dashboard
│   ├── managePosts.tsx  # Admin: posts list + fee settings
│   ├── manageWallet.tsx # Admin: wallets, transactions, top-up requests
│   ├── login.tsx / signup.tsx / forgetPassword.tsx / resetPassword.tsx
│   └── mfaSetup.tsx / mfaVerify.tsx / authCallback.tsx
├── services/
│   ├── authService.ts   # signIn, signOut, getCurrentUser, fetchUserRole
│   ├── postService.ts   # getPlatformSettings, setPlatformFee, publishPost, etc.
│   └── supabase.ts      # Supabase client singleton
└── wallet/
    ├── adapters/        # PaymentTopUpPort implementations (stub — reserved for future payment rail)
    ├── components/      # Wallet UI components
    │   ├── BalanceCard.tsx
    │   ├── ActionButtons.tsx
    │   ├── TopUpModal.tsx
    │   ├── TopUpRequestsPanel.tsx
    │   ├── TransferModal.tsx
    │   ├── TransactionHistory.tsx
    │   ├── AdminAdjustmentPanel.tsx
    │   └── UserSearchBox.tsx
    ├── hooks/
    │   ├── useTopUpNotifications.ts       # User-side realtime (approved/rejected)
    │   ├── useAdminTopUpNotifications.ts  # Admin-side realtime (new pending)
    │   └── useUnseenTopUpCount.ts         # Header badge count
    ├── pages/
    │   └── wallet.tsx   # User wallet page
    ├── ports/
    │   └── PaymentTopUpPort.ts  # Adapter interface
    ├── services/
    │   └── walletService.ts     # All wallet RPC wrappers + types
    └── utils/
        ├── ledgerBalance.ts             # Pure ledger math
        ├── ledgerBalance.test.ts        # Unit tests
        └── walletTransfer.test.ts       # RPC guard regression tests

supabase/
└── migrations/          # Timestamped SQL migration files
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for local dev / migrations)
- A Supabase project ([supabase.com](https://supabase.com))

### 1. Clone & Install

```bash
git clone https://github.com/your-username/MyBlog_SupabaseReactProject.git
cd MyBlog_SupabaseReactProject
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your Supabase project credentials:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

> **Never commit `.env.local`** — it is already in `.gitignore`.

### 3. Push Database Migrations

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push --include-all
```

### 4. Start the Dev Server

```bash
npm run dev
```

---

## 📜 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check + production bundle (`tsc -b && vite build`) |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests once (CI-safe) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run preview` | Preview production build locally |

> **Always run `npm run build` before committing.** A passing `tsc --noEmit` alone is not enough — Vite catches import errors TypeScript can miss (e.g., wrong MUI icon paths).

---

## 🗄 Database Migrations

All schema changes live in `supabase/migrations/` as timestamped SQL files.

**Never modify an already-pushed migration.** Always create a new one.

### Naming convention

```
YYYYMMDDHHMMSS_short_description.sql
```

### Key tables

| Table | Purpose |
|---|---|
| `profiles` | User profiles, `is_admin` flag |
| `posts` | Blog posts with `status` (`PUBLISHED` \| `DRAFT`) |
| `wallets` | One wallet per user, `status` (`ACTIVE` \| `SUSPENDED`) |
| `wallet_transactions` | Append-only ledger (guarded by trigger — no UPDATE/DELETE) |
| `top_up_requests` | Two-step top-up approval workflow |
| `platform_settings` | Key/value store for platform config (e.g., `post_publish_fee`) |

### Rules for new migrations

1. Every `SECURITY DEFINER` function must set `search_path = public, pg_temp`.
2. Every client-callable RPC must have `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.
3. Admin-only RPCs must check `profiles.is_admin`.
4. Money-moving RPCs must call `PERFORM public.assert_aal2()` after the auth check.
5. Use `DROP FUNCTION IF EXISTS` before `CREATE` when the return type changes.
6. Use `clock_timestamp()` for timestamp defaults, never `now()`.

---

## 🔒 Security Model

All critical guards are enforced **at the database layer**:

| Guard | Mechanism |
|---|---|
| Authentication | `auth.uid() IS NULL` check at the top of every RPC |
| MFA step-up (AAL2) | `assert_aal2()` in every money-moving RPC |
| Wallet ownership | `EXISTS (SELECT 1 FROM wallets WHERE id = p_wallet_id AND member_id = auth.uid())` |
| Admin role | `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)` |
| Wallet status | Active-only check before any credit/debit |
| 2-decimal-place amounts | Guard: `p_amount <> round(p_amount, 2)` |
| Adjustment reason | Function guard + DB-level `CHECK` constraint |
| Search path injection | `SET search_path = public, pg_temp` on all `SECURITY DEFINER` functions |

> **Note:** `ProtectedRoute` in the frontend is a UX convenience only — it does not replace database-level security.

---

## 💳 Top-Up Approval Flow

```
User submits request  →  wallet_submit_top_up_request RPC  →  PENDING row in top_up_requests
Admin approves        →  wallet_approve_top_up RPC          →  wallet credited atomically
Admin rejects         →  wallet_reject_top_up RPC           →  row marked REJECTED
```

Users receive real-time notifications when their request is approved or rejected. Admins see a live badge for new pending requests.

---

## 📝 Platform Publish Fee

- Stored in `platform_settings` (key: `post_publish_fee`, default: `0`)
- Admin sets it via the **Publish Fee** tab in `/manage-posts`
- `post_publish` RPC handles fee deduction atomically:
  - Fee `> 0` and sufficient balance → wallet debited, post `PUBLISHED`
  - Fee `> 0` and insufficient balance (or no active wallet) → post saved as `DRAFT`
- Admin can publish any draft for free via `post_publish_free`

---

## 🧪 Testing

```bash
npm run test          # single-pass (CI)
npm run test:watch    # watch mode
```

| Test file | What it covers |
|---|---|
| `src/wallet/utils/ledgerBalance.test.ts` | Pure ledger math & reconciliation |
| `src/wallet/utils/walletTransfer.test.ts` | `wallet_transfer` guard regressions |
| `src/services/authService.test.ts` | Auth service |
| `src/pages/mfaVerify.test.tsx` | MFA verify page |

---

## 🤝 Contributing

1. Fork the repository and create a feature branch.
2. Follow the component conventions in `AGENTS.md`.
3. Never modify already-pushed migrations — create a new one.
4. Run `npm run build` and `npm run test` before opening a PR.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
