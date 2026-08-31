import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Snackbar,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import VerifiedIcon from "@mui/icons-material/Verified";
import CloseIcon from "@mui/icons-material/Close";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";

import { supabase } from "../services/supabase";
import AdminAdjustmentPanel from "../wallet/components/AdminAdjustmentPanel";
import UserSearchBox from "../wallet/components/UserSearchBox";
import TopUpRequestsPanel from "../wallet/components/TopUpRequestsPanel";
import { reconcileWallet, type LookupResult } from "../wallet/services/walletService";
import { useAdminTopUpNotifications } from "../wallet/hooks/useAdminTopUpNotifications";
import type { TopUpRequest } from "../wallet/services/walletService";
import { getErrorMessage } from "../utils/errors";

// ─── Types ────────────────────────────────────────────────────────────────────

type WalletRow = {
  id: string;
  member_id: string;
  balance_cached: number;
  currency: string;
  status: string;
  created_at: string;
};

type WalletTransactionRow = {
  id: string;
  wallet_id: string;
  transaction_type: string;
  direction: string;
  amount: number;
  balance_after: number;
  reason: string | null;
  actor_type: string | null;
  actor_id: string | null;
  created_at: string;
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const pageBg = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f8fbff 0%, #e8f0ff 50%, #ffffff 100%)",
  py: { xs: 3, sm: 5 },
  px: 2,
};

const cardSx = {
  borderRadius: "20px",
  bgcolor: "#ffffff",
  border: "1px solid rgba(59,130,246,0.18)",
  boxShadow: "0 16px 40px rgba(59,130,246,0.08)",
  p: { xs: 2, sm: 2.5 },
};

const rowSx = {
  p: 2,
  borderRadius: "14px",
  bgcolor: "#f8fbff",
  border: "1px solid rgba(59,130,246,0.12)",
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 1,
  alignItems: "center",
  justifyContent: "space-between",
};

const statusColor = (status: string): "success" | "warning" | "default" => {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "warning";
  return "default";
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function initials(result: LookupResult) {
  const name = result.full_name ?? result.username;
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const formatMoney = (amount: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);

const formatDate = (value: string) => new Date(value).toLocaleString();

const shortId = (id: string) => `${id.slice(0, 8)}…`;

// ─── SearchBanner ────────────────────────────────────────────────────────────

interface SearchBannerProps {
  searchUser: LookupResult;
  onClear: () => void;
}

function SearchBanner({ searchUser, onClear }: SearchBannerProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1,
        mb: 2,
        borderRadius: "12px",
        bgcolor: "#eff6ff",
        border: "1px solid rgba(59,130,246,0.25)",
      }}
    >
      <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: "#2563eb" }}>
        {initials(searchUser)}
      </Avatar>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
          {searchUser.full_name ?? searchUser.username}
        </Typography>
        <Typography sx={{ fontSize: 12, color: "#64748b" }}>
          @{searchUser.username}
        </Typography>
      </Box>
      <Button
        size="small"
        startIcon={<CloseIcon fontSize="small" />}
        onClick={onClear}
        sx={{ fontWeight: 600, color: "#64748b", textTransform: "none" }}
      >
        Clear
      </Button>
    </Box>
  );
}

// ─── Tab indices ──────────────────────────────────────────────────────────────
const TAB_WALLETS = 0;
const TAB_TRANSACTIONS = 1;
const TAB_REQUESTS = 2;
const TAB_ADJUST = 3;

// ─── Page component ───────────────────────────────────────────────────────────

const ManageWallet = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState(TAB_WALLETS);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [transactions, setTransactions] = useState<WalletTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [reconcileAllLoading, setReconcileAllLoading] = useState(false);
  const [reconcileSummary, setReconcileSummary] = useState<{
    passed: number;
    failed: number;
  } | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    severity: "success" | "error" | "info" | "warning";
  } | null>(null);
  const [searchUser, setSearchUser] = useState<LookupResult | null>(null);

  // ── Admin top-up request notifications ────────────────────────────────────

  const {
    requests: topUpRequests,
    pendingCount: topUpPendingCount,
    loading: requestsLoading,
    refresh: refreshRequests,
  } = useAdminTopUpNotifications({
    isAdmin: true,
    onNewRequest: (req: TopUpRequest) => {
      setToast({
        message: `New top-up request: ${formatMoney(req.amount)} from member ${req.member_id.slice(0, 8)}…`,
        severity: "info",
      });
      // Auto-switch to requests tab so the admin sees it immediately
      setTab(TAB_REQUESTS);
    },
  });

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [walletsRes, txRes] = await Promise.all([
        supabase.from("wallets").select("*").order("created_at", { ascending: false }),
        supabase
          .from("wallet_transactions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (walletsRes.error) {
        console.error(walletsRes.error);
        setToast({ message: "Failed to load wallets.", severity: "error" });
      } else {
        const rows = (walletsRes.data as WalletRow[] | null) ?? [];
        setWallets(rows);
        setSelectedWalletId((prev) => {
          if (prev && rows.some((r) => r.id === prev)) return prev;
          return rows[0]?.id ?? "";
        });
      }

      if (txRes.error) {
        console.error(txRes.error);
        setToast({ message: "Failed to load transactions.", severity: "error" });
      } else {
        setTransactions((txRes.data as WalletTransactionRow[] | null) ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      await loadData();
    };
    void run();
  }, [loadData]);

  // ── Derived / filtered data ───────────────────────────────────────────────

  const walletById = useMemo(() => {
    const map = new Map<string, WalletRow>();
    wallets.forEach((w) => map.set(w.id, w));
    return map;
  }, [wallets]);

  const visibleWallets = useMemo(() => {
    if (!searchUser) return wallets;
    return wallets.filter((w) => w.member_id === searchUser.member_id);
  }, [wallets, searchUser]);

  const visibleTransactions = useMemo(() => {
    if (!searchUser) return transactions;
    const walletIds = new Set(
      wallets.filter((w) => w.member_id === searchUser.member_id).map((w) => w.id)
    );
    return transactions.filter((tx) => walletIds.has(tx.wallet_id));
  }, [transactions, wallets, searchUser]);

  const walletOptions = useMemo(
    () =>
      visibleWallets.map((w) => ({
        id: w.id,
        label: searchUser
          ? `${searchUser.full_name ?? searchUser.username} · ${w.currency}`
          : `Member ${w.member_id.slice(0, 8)}… · ${w.currency}`,
        balance: Number(w.balance_cached),
        currency: w.currency,
      })),
    [visibleWallets, searchUser]
  );

  // ── Reconcile all ─────────────────────────────────────────────────────────

  const runReconcileAll = async () => {
    const targets = visibleWallets.length > 0 ? visibleWallets : wallets;
    if (targets.length === 0) return;
    setReconcileAllLoading(true);
    setReconcileSummary(null);
    let passed = 0;
    let failed = 0;
    try {
      for (const wallet of targets) {
        const result = await reconcileWallet(wallet.id);
        if (result.matches) passed += 1;
        else failed += 1;
      }
      setReconcileSummary({ passed, failed });
      setToast({
        message:
          failed === 0
            ? `All ${passed} wallet(s) reconciled successfully.`
            : `${failed} wallet(s) failed reconciliation.`,
        severity: failed === 0 ? "success" : "error",
      });
    } catch (err: unknown) {
      setToast({
        message: getErrorMessage(err, "Reconciliation check failed."),
        severity: "error",
      });
    } finally {
      setReconcileAllLoading(false);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleUserSelect = (result: LookupResult | null) => {
    setSearchUser(result);
    if (result) {
      const userWallet = wallets.find((w) => w.member_id === result.member_id);
      if (userWallet) setSelectedWalletId(userWallet.id);
    }
  };

  const handleClearSearch = () => {
    setSearchUser(null);
    setSelectedWalletId(wallets[0]?.id ?? "");
  };

  const handleRequestApproved = (requestId: string, newBalance: number) => {
    setToast({
      message: `Top-up approved. New balance: ${formatMoney(newBalance)}`,
      severity: "success",
    });
    // Refresh wallets so balance_cached updates
    void loadData();
    void refreshRequests();
    // suppress unused-var warning — requestId used by callers
    void requestId;
  };

  const handleRequestRejected = (requestId: string) => {
    setToast({ message: "Top-up request rejected.", severity: "info" });
    void refreshRequests();
    void requestId;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={pageBg}>
      <Container maxWidth="md" disableGutters sx={{ px: { xs: 2, sm: 3, md: 0 } }}>
        <Button
          onClick={() => navigate("/admin")}
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 2, fontWeight: 600, color: "#2563eb" }}
        >
          Back to Admin Dashboard
        </Button>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <AccountBalanceWalletIcon sx={{ color: "#3A7FF1", fontSize: { xs: 30, sm: 36 } }} />
          <Box sx={{ flex: 1 }}>
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: { xs: "1.5rem", sm: "1.8rem" },
                color: "#0f172a",
                lineHeight: 1.2,
              }}
            >
              Manage Wallets
            </Typography>
            <Typography sx={{ fontSize: "12px", color: "rgba(15,23,42,0.65)" }}>
              View ledgers, run reconciliation, apply adjustments, and review top-up requests
            </Typography>
          </Box>
          {topUpPendingCount > 0 && (
            <Chip
              icon={<NotificationsActiveIcon sx={{ fontSize: 16 }} />}
              label={`${topUpPendingCount} pending`}
              color="warning"
              size="small"
              onClick={() => setTab(TAB_REQUESTS)}
              sx={{ fontWeight: 700, cursor: "pointer" }}
            />
          )}
        </Box>

        {/* ── Search card ── */}
        <Paper elevation={0} sx={{ ...cardSx, mb: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a", mb: 1.5 }}>
            Search user
          </Typography>
          <UserSearchBox value={searchUser} onSelect={handleUserSelect} />
          {!searchUser && (
            <Typography sx={{ fontSize: 12, color: "#94a3b8", mt: 1 }}>
              Search by username or full name to filter wallets and transactions below.
            </Typography>
          )}
        </Paper>

        {/* ── Main data card ── */}
        <Paper elevation={0} sx={{ ...cardSx, mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mb: 1,
            }}
          >
            <Tabs
              value={tab}
              onChange={(_, v: number) => setTab(v)}
              textColor="primary"
              indicatorColor="primary"
              sx={{ "& .MuiTab-root": { fontWeight: 600, textTransform: "none" } }}
            >
              <Tab
                label={
                  searchUser
                    ? `Wallets (${visibleWallets.length})`
                    : `Wallets (${wallets.length})`
                }
              />
              <Tab
                label={
                  searchUser
                    ? `Transactions (${visibleTransactions.length})`
                    : `Transactions (${transactions.length})`
                }
              />
              <Tab
                label={
                  <Badge badgeContent={topUpPendingCount} color="warning" sx={{ pr: topUpPendingCount > 0 ? 1.5 : 0 }}>
                    Top-up requests
                  </Badge>
                }
              />
              <Tab label="Adjust balance" />
            </Tabs>

            {tab !== TAB_REQUESTS && (
              <Button
                size="small"
                startIcon={<VerifiedIcon />}
                disabled={reconcileAllLoading || visibleWallets.length === 0}
                onClick={() => void runReconcileAll()}
                sx={{ fontWeight: 600, color: "#2563eb" }}
              >
                {reconcileAllLoading
                  ? "Checking…"
                  : searchUser
                  ? "Reconcile user"
                  : "Reconcile all"}
              </Button>
            )}
          </Box>

          {reconcileSummary && (
            <Typography
              sx={{
                fontSize: 13,
                color: reconcileSummary.failed ? "#dc2626" : "#16a34a",
                mb: 2,
              }}
            >
              Reconciliation: {reconcileSummary.passed} passed, {reconcileSummary.failed} failed
            </Typography>
          )}

          {searchUser && tab !== TAB_REQUESTS && (
            <SearchBanner searchUser={searchUser} onClear={handleClearSearch} />
          )}

          {/* ── Tab content ─────────────────────────────────────────────── */}

          {tab === TAB_REQUESTS ? (
            // ── Top-up requests tab ─────────────────────────────────────
            <TopUpRequestsPanel
              requests={topUpRequests}
              loading={requestsLoading}
              onApproved={handleRequestApproved}
              onRejected={handleRequestRejected}
            />
          ) : loading ? (
            <Typography sx={{ color: "#64748b", py: 2 }}>Loading…</Typography>
          ) : tab === TAB_ADJUST ? (
            // ── Adjust balance tab ──────────────────────────────────────
            <AdminAdjustmentPanel
              wallets={walletOptions}
              selectedWalletId={selectedWalletId}
              onSelectedWalletChange={setSelectedWalletId}
              searchUser={searchUser}
              onSuccess={() => {
                setToast({ message: "Adjustment applied successfully.", severity: "success" });
                void loadData();
              }}
            />
          ) : tab === TAB_WALLETS ? (
            // ── Wallets tab ─────────────────────────────────────────────
            visibleWallets.length === 0 ? (
              <Typography sx={{ color: "#64748b" }}>
                {searchUser ? "No wallets found for this user." : "No wallets yet."}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {visibleWallets.map((wallet) => {
                  const userLabel = searchUser
                    ? searchUser.full_name
                      ? `${searchUser.full_name} (@${searchUser.username})`
                      : `@${searchUser.username}`
                    : null;

                  return (
                    <Box key={wallet.id} sx={rowSx}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                        {searchUser && (
                          <Avatar sx={{ width: 36, height: 36, fontSize: 13, bgcolor: "#2563eb" }}>
                            {initials(searchUser)}
                          </Avatar>
                        )}
                        <Box>
                          {userLabel && (
                            <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                              {userLabel}
                            </Typography>
                          )}
                          <Typography sx={{ fontWeight: 700, color: "#2563eb", fontSize: 18 }}>
                            {formatMoney(Number(wallet.balance_cached), wallet.currency)}
                          </Typography>
                          <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                            Wallet {shortId(wallet.id)}
                            {!searchUser && ` · Member ${shortId(wallet.member_id)}`}
                          </Typography>
                          <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                            Created {formatDate(wallet.created_at)}
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <Chip
                          label={wallet.status}
                          color={statusColor(wallet.status)}
                          size="small"
                          sx={{ fontWeight: 600 }}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setSelectedWalletId(wallet.id);
                            setTab(TAB_ADJUST);
                          }}
                          sx={{ borderRadius: "10px", fontWeight: 600 }}
                        >
                          Adjust
                        </Button>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )
          ) : tab === TAB_TRANSACTIONS ? (
            // ── Transactions tab ────────────────────────────────────────
            visibleTransactions.length === 0 ? (
              <Typography sx={{ color: "#64748b" }}>
                {searchUser ? "No transactions found for this user." : "No transactions yet."}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {visibleTransactions.map((tx) => {
                  const wallet = walletById.get(tx.wallet_id);
                  const isCredit = tx.direction === "CREDIT";
                  return (
                    <Box
                      key={tx.id}
                      sx={{
                        p: 2,
                        borderRadius: "14px",
                        bgcolor: "#f8fbff",
                        border: "1px solid rgba(59,130,246,0.12)",
                      }}
                    >
                      {searchUser && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                          <Avatar sx={{ width: 22, height: 22, fontSize: 10, bgcolor: "#2563eb" }}>
                            {initials(searchUser)}
                          </Avatar>
                          <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                            {searchUser.full_name ? `${searchUser.full_name} (@${searchUser.username})` : `@${searchUser.username}`}
                          </Typography>
                        </Box>
                      )}
                      <Box
                        sx={{
                          display: "flex",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          gap: 1,
                          mb: 0.5,
                        }}
                      >
                        <Typography sx={{ fontWeight: 700, color: "#2563eb" }}>
                          {tx.transaction_type.replace(/_/g, " ")}
                        </Typography>
                        <Typography
                          sx={{ fontWeight: 700, color: isCredit ? "#16a34a" : "#dc2626" }}
                        >
                          {isCredit ? "+" : "−"}
                          {formatMoney(Number(tx.amount), wallet?.currency ?? "USD")}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: 13, color: "#475569" }}>
                        Balance after{" "}
                        {formatMoney(Number(tx.balance_after), wallet?.currency ?? "USD")}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: "#94a3b8", mt: 0.5 }}>
                        Wallet {shortId(tx.wallet_id)} · {formatDate(tx.created_at)}
                      </Typography>
                      {tx.reason && (
                        <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.5 }}>
                          Reason: {tx.reason}
                        </Typography>
                      )}
                      {tx.actor_id && (
                        <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.5 }}>
                          Actor: {tx.actor_type || "SYSTEM"} ({tx.actor_id})
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )
          ) : null}
        </Paper>
      </Container>

      <Snackbar
        open={!!toast}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setToast(null)}
          severity={toast?.severity ?? "info"}
          variant="filled"
          sx={{ borderRadius: "12px" }}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ManageWallet;
