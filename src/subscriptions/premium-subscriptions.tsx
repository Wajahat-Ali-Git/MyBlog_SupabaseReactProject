import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Paper,
  Snackbar,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import ScheduleIcon from "@mui/icons-material/Schedule";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import StarOutlineIcon from "@mui/icons-material/StarOutlined";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";

import {
  getAvailableJobs,
  getMySubscriptions,
  getMyJobCharges,
  subscribeToJob,
  unsubscribeFromJob,
  type SubscribableJob,
  type JobSubscription,
  type JobCharge,
} from "../services/scheduledJobsService";
import { getMyWallet, createWallet, type WalletInfo } from "../wallet/services/walletService";

// ─── Design tokens (matches manageWallet / manageJobs blue-white palette) ────

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
};

const rowSx = {
  p: 2,
  borderRadius: "14px",
  bgcolor: "#f8fbff",
  border: "1px solid rgba(59,130,246,0.12)",
};

const subscribedRowSx = {
  ...rowSx,
  bgcolor: "#eff6ff",
  border: "1px solid rgba(59,130,246,0.30)",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const fmtDate = (v: string) => new Date(v).toLocaleString();
const fmtDateShort = (v: string) => new Date(v).toLocaleDateString();

function fmtInterval(minutes: number | null): string {
  if (minutes === null) return "One-time";
  if (minutes === 1) return "Every minute";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60}h`;
  if (minutes === 1440) return "Daily";
  if (minutes === 10080) return "Weekly";
  return `Every ${Math.round(minutes / 1440)}d`;
}

// ─── Sub-status chip ─────────────────────────────────────────────────────────

function SubStatusChip({ status }: { status: JobSubscription["status"] }) {
  if (status === "ACTIVE")
    return (
      <Chip
        label="Active"
        size="small"
        sx={{ fontWeight: 700, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }}
      />
    );
  if (status === "CANCELLED")
    return (
      <Chip
        label="Cancelled"
        size="small"
        sx={{ fontWeight: 700, bgcolor: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}
      />
    );
  return (
    <Chip
      label="Payment failed"
      size="small"
      sx={{ fontWeight: 700, bgcolor: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const TAB_DISCOVER = 0;
const TAB_MINE     = 1;
const TAB_BILLING  = 2;

const PremiumSubscriptions = () => {
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [wallet, setWallet]               = useState<WalletInfo | null>(null);
  const [availableJobs, setAvailableJobs] = useState<SubscribableJob[]>([]);
  const [subscriptions, setSubscriptions] = useState<JobSubscription[]>([]);
  const [charges, setCharges]             = useState<JobCharge[]>([]);

  const [tab, setTab]                   = useState(TAB_DISCOVER);
  const [pageLoading, setPageLoading]   = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [enablingWallet, setEnabling]   = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Lazy-load guards (refs so they don't trigger re-renders)
  const subsLoadedRef    = useRef(false);
  const billingLoadedRef = useRef(false);

  // Dialogs
  const [subConfirmId,   setSubConfirmId]   = useState<string | null>(null);
  const [unsubConfirmId, setUnsubConfirmId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{
    open: boolean; message: string; severity: "success" | "error" | "info" | "warning";
  }>({ open: false, message: "", severity: "success" });

  const showToast = (message: string, severity: typeof toast.severity) =>
    setToast({ open: true, message, severity });

  // ── Data loaders ───────────────────────────────────────────────────────────

  const loadWallet = useCallback(async () => {
    try {
      setWallet(await getMyWallet());
    } catch (err) {
      console.error("wallet:", err);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      setAvailableJobs(await getAvailableJobs());
    } catch (err) {
      console.error("jobs:", err);
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    try {
      setSubscriptions(await getMySubscriptions());
    } catch (err) {
      console.error("subs:", err);
    }
  }, []);

  const loadCharges = useCallback(async () => {
    try {
      setCharges(await getMyJobCharges());
    } catch (err) {
      console.error("charges:", err);
    }
  }, []);

  // Initial page load: wallet + discover feed only
  useEffect(() => {
    const run = async () => {
      await Promise.all([loadWallet(), loadJobs()]);
      setPageLoading(false);
    };
    void run();
  }, [loadWallet, loadJobs]);

  // Lazy-load subscriptions on first visit to My Subscriptions tab
  useEffect(() => {
    if (tab === TAB_MINE && !subsLoadedRef.current) {
      subsLoadedRef.current = true;
      void loadSubscriptions();
    }
  }, [tab, loadSubscriptions]);

  // Lazy-load billing on first visit to Billing History tab
  useEffect(() => {
    if (tab === TAB_BILLING && !billingLoadedRef.current) {
      billingLoadedRef.current = true;
      void loadCharges();
    }
  }, [tab, loadCharges]);

  // Full refresh (called after subscribe/unsubscribe)
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadWallet(), loadJobs(), loadSubscriptions(), loadCharges()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadWallet, loadJobs, loadSubscriptions, loadCharges]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleEnableWallet = async () => {
    setEnabling(true);
    try {
      await createWallet();
      await loadWallet();
      showToast("Wallet created! You can now subscribe to feeds.", "success");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create wallet.", "error");
    } finally {
      setEnabling(false);
    }
  };

  const handleSubscribe = async () => {
    if (!subConfirmId) return;
    setActionLoading(true);
    try {
      await subscribeToJob(subConfirmId);
      setSubConfirmId(null);
      subsLoadedRef.current = true; // mark loaded so refresh updates it
      await refreshAll();
      showToast("Subscribed! Automatic billing cycle started.", "success");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to subscribe.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (!unsubConfirmId) return;
    setActionLoading(true);
    try {
      await unsubscribeFromJob(unsubConfirmId);
      setUnsubConfirmId(null);
      await refreshAll();
      showToast("Subscription cancelled.", "info");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to cancel.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeSubCount = subscriptions.filter((s) => s.status === "ACTIVE").length;
  const getActiveSub   = (jobId: string) =>
    subscriptions.find((s) => s.job_id === jobId && s.status === "ACTIVE");
  const hasActiveWallet = wallet?.status === "ACTIVE";

  const confirmSubJob   = availableJobs.find((j) => j.id === subConfirmId);
  const confirmUnsubSub = subscriptions.find(
    (s) => s.job_id === unsubConfirmId && s.status === "ACTIVE"
  );
  const confirmUnsubJob = availableJobs.find((j) => j.id === unsubConfirmId);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <Box sx={{ ...pageBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress sx={{ color: "#2563eb" }} />
      </Box>
    );
  }

  return (
    <Box sx={pageBg}>
      <Container maxWidth="lg" disableGutters sx={{ px: { xs: 2, sm: 3, md: 0 } }}>

        {/* ── Page header ── */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3, flexWrap: "wrap", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Button
              onClick={() => navigate("/")}
              startIcon={<ArrowBackIcon />}
              sx={{ fontWeight: 600, color: "#2563eb", textTransform: "none" }}
            >
              Back
            </Button>
            <StarOutlineIcon sx={{ color: "#3b82f6", fontSize: 32 }} />
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.4rem", sm: "1.75rem" }, color: "#0f172a", lineHeight: 1.2 }}>
                Premium Feeds
              </Typography>
              <Typography sx={{ fontSize: 13, color: "#64748b" }}>
                Subscribe to automated content feeds from other creators
              </Typography>
            </Box>
          </Box>

          <Button
            onClick={() => void refreshAll()}
            disabled={refreshing}
            startIcon={refreshing ? <CircularProgress size={15} sx={{ color: "#2563eb" }} /> : <RefreshIcon />}
            sx={{ fontWeight: 600, color: "#2563eb", textTransform: "none", borderRadius: "10px" }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </Box>

        <Grid container spacing={3}>

          {/* ── Left: Wallet card ── */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper elevation={0} sx={{ ...cardSx, p: { xs: 2.5, sm: 3 } }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
                <Box sx={{ width: 38, height: 38, borderRadius: "10px", bgcolor: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <AccountBalanceWalletIcon sx={{ color: "#2563eb", fontSize: 20 }} />
                </Box>
                <Typography sx={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>
                  Billing Wallet
                </Typography>
              </Box>
              <Divider sx={{ mb: 2.5, borderColor: "rgba(59,130,246,0.12)" }} />

              {!wallet ? (
                /* No wallet yet */
                <Box>
                  <Typography sx={{ fontSize: 13, color: "#64748b", mb: 2.5, lineHeight: 1.6 }}>
                    You need a wallet to subscribe to premium feeds. Subscription fees are charged
                    automatically each billing cycle.
                  </Typography>
                  <Button
                    fullWidth variant="contained" onClick={() => void handleEnableWallet()}
                    disabled={enablingWallet}
                    startIcon={enablingWallet ? <CircularProgress size={15} color="inherit" /> : <AccountBalanceWalletIcon />}
                    sx={{ borderRadius: "12px", fontWeight: 700, textTransform: "none", py: 1.25,
                      background: "linear-gradient(135deg, #2563eb, #3b82f6)",
                      "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #2563eb)" } }}
                  >
                    {enablingWallet ? "Creating…" : "Enable Wallet"}
                  </Button>
                </Box>
              ) : (
                /* Wallet exists */
                <Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>STATUS</Typography>
                    <Chip
                      label={wallet.status}
                      size="small"
                      sx={{
                        fontWeight: 700, fontSize: 11,
                        bgcolor: wallet.status === "ACTIVE" ? "#dcfce7" : "#fee2e2",
                        color:   wallet.status === "ACTIVE" ? "#166534" : "#991b1b",
                        border: `1px solid ${wallet.status === "ACTIVE" ? "#bbf7d0" : "#fecaca"}`,
                      }}
                    />
                  </Box>

                  <Box sx={{ p: 2, borderRadius: "14px", bgcolor: "#eff6ff", border: "1px solid rgba(59,130,246,0.2)", mb: 2.5 }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748b", mb: 0.5 }}>AVAILABLE BALANCE</Typography>
                    <Typography sx={{ fontSize: "1.75rem", fontWeight: 800, color: "#2563eb" }}>
                      {fmt(wallet.balance_cached)}
                    </Typography>
                  </Box>

                  {wallet.status !== "ACTIVE" && (
                    <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}
                      sx={{ mb: 2, borderRadius: "12px", fontSize: 12 }}>
                      Wallet is <strong>{wallet.status}</strong>. Subscriptions cannot charge an inactive wallet.
                    </Alert>
                  )}

                  <Button
                    fullWidth variant="outlined" onClick={() => navigate("/wallet")}
                    sx={{ borderRadius: "12px", fontWeight: 700, textTransform: "none",
                      borderColor: "rgba(59,130,246,0.4)", color: "#2563eb",
                      "&:hover": { bgcolor: "#eff6ff", borderColor: "#2563eb" } }}
                  >
                    Manage Wallet &amp; Top Up
                  </Button>

                  {activeSubCount > 0 && (
                    <Box sx={{ mt: 2.5, p: 1.5, borderRadius: "12px", bgcolor: "#f8fbff", border: "1px solid rgba(59,130,246,0.12)" }}>
                      <Typography sx={{ fontSize: 12, color: "#64748b", mb: 0.25 }}>Active subscriptions</Typography>
                      <Typography sx={{ fontSize: "1.35rem", fontWeight: 800, color: "#2563eb" }}>
                        {activeSubCount}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Paper>
          </Grid>

          {/* ── Right: Tabs panel ── */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper elevation={0} sx={{ ...cardSx, overflow: "hidden" }}>
              <Tabs
                value={tab}
                onChange={(_, v: number) => setTab(v)}
                variant="fullWidth"
                sx={{
                  bgcolor: "#f8fbff",
                  borderBottom: "1px solid rgba(59,130,246,0.12)",
                  "& .MuiTab-root": { fontWeight: 700, fontSize: 13, textTransform: "none", py: 2 },
                  "& .Mui-selected": { color: "#2563eb" },
                  "& .MuiTabs-indicator": { bgcolor: "#2563eb", height: 3, borderRadius: "3px 3px 0 0" },
                }}
              >
                <Tab
                  label={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <StarOutlineIcon sx={{ fontSize: 16 }} />
                      Discover
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <AutorenewIcon sx={{ fontSize: 16 }} />
                      My Subscriptions
                      {activeSubCount > 0 && (
                        <Box component="span" sx={{ ml: 0.5, px: 0.75, py: 0.1, borderRadius: "8px",
                          bgcolor: "#2563eb", color: "#fff", fontSize: 11, fontWeight: 800, lineHeight: "18px" }}>
                          {activeSubCount}
                        </Box>
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <ReceiptLongIcon sx={{ fontSize: 16 }} />
                      Billing History
                    </Box>
                  }
                />
              </Tabs>

              <Box sx={{ p: { xs: 2, sm: 3 } }}>

                {/* ── Tab 0: Discover ── */}
                {tab === TAB_DISCOVER && (
                  <Box>
                    {availableJobs.length === 0 ? (
                      <Box sx={{ textAlign: "center", py: 8 }}>
                        <StarOutlineIcon sx={{ fontSize: 48, color: "#bfdbfe", mb: 2 }} />
                        <Typography sx={{ fontWeight: 700, color: "#0f172a", mb: 0.5 }}>
                          No feeds available right now
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: "#64748b" }}>
                          Check back later — new automated feeds are added regularly.
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        {!hasActiveWallet && wallet && (
                          <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}
                            sx={{ mb: 2.5, borderRadius: "12px", fontSize: 13 }}>
                            Your wallet is <strong>{wallet.status}</strong>. Top up and reactivate it to subscribe.
                          </Alert>
                        )}
                        {!wallet && (
                          <Alert severity="info" icon={<AccountBalanceWalletIcon fontSize="small" />}
                            sx={{ mb: 2.5, borderRadius: "12px", fontSize: 13 }}>
                            Enable your wallet on the left panel to start subscribing to feeds.
                          </Alert>
                        )}

                        <Grid container spacing={2}>
                          {availableJobs.map((job) => {
                            const activeSub = getActiveSub(job.id);
                            const isFree    = Number(job.subscription_fee) === 0;

                            return (
                              <Grid size={{ xs: 12 }} key={job.id}>
                                <Box sx={activeSub ? subscribedRowSx : rowSx}>
                                  <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>

                                    {/* Left: fee + frequency */}
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
                                      <Box sx={{ width: 44, height: 44, borderRadius: "12px", flexShrink: 0,
                                        bgcolor: isFree ? "#dcfce7" : "#eff6ff",
                                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        {isFree
                                          ? <CheckCircleOutlinedIcon sx={{ color: "#16a34a", fontSize: 22 }} />
                                          : <AttachMoneyIcon sx={{ color: "#2563eb", fontSize: 22 }} />}
                                      </Box>
                                      <Box>
                                        <Typography sx={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                                          {isFree ? "Free Feed" : `${fmt(Number(job.subscription_fee))} / cycle`}
                                        </Typography>
                                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.25 }}>
                                          <ScheduleIcon sx={{ fontSize: 13, color: "#64748b" }} />
                                          <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                            {fmtInterval(job.interval_minutes)}
                                          </Typography>
                                        </Box>
                                      </Box>
                                    </Box>

                                    {/* Right: next run + action */}
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                                      <Box sx={{ textAlign: "right" }}>
                                        <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>
                                          NEXT RUN
                                        </Typography>
                                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
                                          {fmtDate(job.next_run_at)}
                                        </Typography>
                                      </Box>

                                      {activeSub ? (
                                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                          <Chip
                                            icon={<CheckCircleOutlinedIcon sx={{ fontSize: "14px !important" }} />}
                                            label="Subscribed"
                                            size="small"
                                            sx={{ fontWeight: 700, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }}
                                          />
                                          <Button
                                            size="small" variant="outlined" color="error"
                                            onClick={() => setUnsubConfirmId(job.id)}
                                            startIcon={<CancelOutlinedIcon sx={{ fontSize: 14 }} />}
                                            sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12 }}
                                          >
                                            Unsubscribe
                                          </Button>
                                        </Box>
                                      ) : (
                                        <Button
                                          size="small" variant="contained"
                                          disabled={!hasActiveWallet}
                                          onClick={() => setSubConfirmId(job.id)}
                                          sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none",
                                            background: "linear-gradient(135deg, #2563eb, #3b82f6)",
                                            "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #2563eb)" },
                                            "&.Mui-disabled": { bgcolor: "#e2e8f0", color: "#94a3b8" } }}
                                        >
                                          Subscribe
                                        </Button>
                                      )}
                                    </Box>
                                  </Box>

                                  {/* Category + author — what topic, who writes it */}
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 1 }}>
                                    {job.category && (
                                      <Chip
                                        label={job.category}
                                        size="small"
                                        sx={{ fontWeight: 600, bgcolor: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0" }}
                                      />
                                    )}
                                    <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                      By <strong>{job.author_display_name || "Unknown"}</strong>
                                    </Typography>
                                  </Box>

                                  {/* Subscribed since info */}
                                  {activeSub && (
                                    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid rgba(59,130,246,0.12)",
                                      display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                      <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                        Subscribed since <strong>{fmtDateShort(activeSub.subscribed_at)}</strong>
                                      </Typography>
                                      <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                        Next charge: <strong>{fmtDate(activeSub.next_charge_at)}</strong>
                                      </Typography>
                                      {activeSub.consecutive_failures > 0 && (
                                        <Chip
                                          icon={<WarningAmberIcon sx={{ fontSize: "13px !important" }} />}
                                          label={`${activeSub.consecutive_failures} failed charge${activeSub.consecutive_failures > 1 ? "s" : ""}`}
                                          size="small"
                                          sx={{ fontWeight: 700, bgcolor: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
                                        />
                                      )}
                                    </Box>
                                  )}
                                </Box>
                              </Grid>
                            );
                          })}
                        </Grid>
                      </>
                    )}
                  </Box>
                )}

                {/* ── Tab 1: My Subscriptions ── */}
                {tab === TAB_MINE && (
                  <Box>
                    {subscriptions.length === 0 ? (
                      <Box sx={{ textAlign: "center", py: 8 }}>
                        <AutorenewIcon sx={{ fontSize: 48, color: "#bfdbfe", mb: 2 }} />
                        <Typography sx={{ fontWeight: 700, color: "#0f172a", mb: 0.5 }}>
                          No subscriptions yet
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: "#64748b", mb: 2.5 }}>
                          Head over to Discover to find feeds you'd like to subscribe to.
                        </Typography>
                        <Button
                          variant="outlined"
                          onClick={() => setTab(TAB_DISCOVER)}
                          sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none",
                            borderColor: "rgba(59,130,246,0.4)", color: "#2563eb" }}
                        >
                          Browse Feeds
                        </Button>
                      </Box>
                    ) : (
                      <Grid container spacing={2}>
                        {subscriptions.map((sub) => {
                          const job       = availableJobs.find((j) => j.id === sub.job_id);
                          const isActive  = sub.status === "ACTIVE";
                          const hasIssues = sub.consecutive_failures > 0 && isActive;

                          return (
                            <Grid size={{ xs: 12 }} key={sub.id}>
                              <Box sx={{
                                ...rowSx,
                                ...(hasIssues ? { bgcolor: "#fffbeb", border: "1px solid #fde68a" } : {}),
                                ...(sub.status === "CANCELLED_PAYMENT_FAILED" ? { bgcolor: "#fff1f2", border: "1px solid #fecaca" } : {}),
                              }}>
                                {/* Row header: fee + status chip */}
                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                    <Box sx={{ width: 40, height: 40, borderRadius: "10px", bgcolor: "#eff6ff",
                                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                      <AutorenewIcon sx={{ color: "#2563eb", fontSize: 20 }} />
                                    </Box>
                                    <Box>
                                      <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                                        {job ? fmt(Number(job.subscription_fee)) + " / cycle" : "Subscription"}
                                      </Typography>
                                      <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                        {job ? fmtInterval(job.interval_minutes) : "—"}
                                        {" · "}Subscribed {fmtDateShort(sub.subscribed_at)}
                                      </Typography>
                                      {job && (
                                        <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.25 }}>
                                          {job.category && <>{job.category} · </>}
                                          By <strong>{job.author_display_name || "Unknown"}</strong>
                                        </Typography>
                                      )}
                                    </Box>
                                  </Box>
                                  <SubStatusChip status={sub.status} />
                                </Box>

                                <Divider sx={{ borderColor: "rgba(59,130,246,0.10)", mb: 1.5 }} />

                                {/* Detail grid */}
                                <Grid container spacing={1.5} sx={{ mb: isActive ? 1.5 : 0 }}>
                                  <Grid size={{ xs: 6, sm: 3 }}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748b", mb: 0.25 }}>NEXT CHARGE</Typography>
                                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                                      {isActive ? fmtDate(sub.next_charge_at) : "—"}
                                    </Typography>
                                  </Grid>
                                  <Grid size={{ xs: 6, sm: 3 }}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748b", mb: 0.25 }}>LAST CHARGED</Typography>
                                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                                      {sub.last_charged_at ? fmtDateShort(sub.last_charged_at) : "Never"}
                                    </Typography>
                                  </Grid>
                                  <Grid size={{ xs: 6, sm: 3 }}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748b", mb: 0.25 }}>FAILURES</Typography>
                                    <Typography sx={{ fontSize: 13, fontWeight: 700,
                                      color: sub.consecutive_failures >= 2 ? "#dc2626" : sub.consecutive_failures === 1 ? "#f59e0b" : "#0f172a" }}>
                                      {sub.consecutive_failures} / 3
                                    </Typography>
                                  </Grid>
                                  <Grid size={{ xs: 6, sm: 3 }}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748b", mb: 0.25 }}>CANCELLED</Typography>
                                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                                      {sub.cancelled_at ? fmtDateShort(sub.cancelled_at) : "—"}
                                    </Typography>
                                  </Grid>
                                </Grid>

                                {/* Warning for consecutive failures */}
                                {hasIssues && (
                                  <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}
                                    sx={{ mb: 1.5, borderRadius: "10px", py: 0.5, fontSize: 12 }}>
                                    {sub.consecutive_failures === 2
                                      ? "One more failed charge will permanently cancel this subscription. Top up your wallet."
                                      : "Last charge failed. Ensure your wallet has enough balance before the next cycle."}
                                  </Alert>
                                )}

                                {sub.status === "CANCELLED_PAYMENT_FAILED" && (
                                  <Alert severity="error" icon={<ErrorOutlinedIcon fontSize="small" />}
                                    sx={{ mb: 1.5, borderRadius: "10px", py: 0.5, fontSize: 12 }}>
                                    Auto-cancelled after 3 consecutive payment failures. Top up your wallet and re-subscribe from Discover.
                                  </Alert>
                                )}

                                {/* Action row */}
                                {isActive && (
                                  <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                                    <Button
                                      size="small" variant="outlined" color="error"
                                      onClick={() => setUnsubConfirmId(sub.job_id)}
                                      startIcon={<CancelOutlinedIcon sx={{ fontSize: 14 }} />}
                                      sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12 }}
                                    >
                                      Cancel Subscription
                                    </Button>
                                  </Box>
                                )}
                              </Box>
                            </Grid>
                          );
                        })}
                      </Grid>
                    )}
                  </Box>
                )}

                {/* ── Tab 2: Billing History ── */}
                {tab === TAB_BILLING && (
                  <Box>
                    {charges.length === 0 ? (
                      <Box sx={{ textAlign: "center", py: 8 }}>
                        <ReceiptLongIcon sx={{ fontSize: 48, color: "#bfdbfe", mb: 2 }} />
                        <Typography sx={{ fontWeight: 700, color: "#0f172a", mb: 0.5 }}>
                          No charges yet
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: "#64748b" }}>
                          Billing records will appear here once your subscriptions are charged.
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        {/* Summary strip */}
                        <Box sx={{ display: "flex", gap: 2, mb: 2.5, flexWrap: "wrap" }}>
                          <Box sx={{ px: 2, py: 1.25, borderRadius: "12px", bgcolor: "#dcfce7", border: "1px solid #bbf7d0", flex: 1, minWidth: 120 }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#166534" }}>TOTAL PAID</Typography>
                            <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#166534" }}>
                              {fmt(charges.filter(c => c.status === "SUCCESS").reduce((s, c) => s + Number(c.amount), 0))}
                            </Typography>
                          </Box>
                          <Box sx={{ px: 2, py: 1.25, borderRadius: "12px", bgcolor: "#fee2e2", border: "1px solid #fecaca", flex: 1, minWidth: 120 }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#991b1b" }}>FAILED</Typography>
                            <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#991b1b" }}>
                              {charges.filter(c => c.status === "FAILED").length}
                            </Typography>
                          </Box>
                          <Box sx={{ px: 2, py: 1.25, borderRadius: "12px", bgcolor: "#eff6ff", border: "1px solid rgba(59,130,246,0.25)", flex: 1, minWidth: 120 }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#1d4ed8" }}>TOTAL CHARGES</Typography>
                            <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#1d4ed8" }}>
                              {charges.length}
                            </Typography>
                          </Box>
                        </Box>

                        <TableContainer sx={{ borderRadius: "14px", border: "1px solid rgba(59,130,246,0.12)", overflow: "hidden" }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow sx={{ bgcolor: "#f8fbff" }}>
                                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: "#64748b", py: 1.5 }}>DATE</TableCell>
                                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: "#64748b" }}>AMOUNT</TableCell>
                                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: "#64748b" }} align="center">STATUS</TableCell>
                                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: "#64748b" }}>DETAILS</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {charges.map((charge) => (
                                <TableRow
                                  key={charge.id}
                                  sx={{ "&:hover": { bgcolor: "#f8fbff" }, "&:last-child td": { border: 0 } }}
                                >
                                  <TableCell sx={{ fontSize: 13, py: 1.5, color: "#0f172a" }}>
                                    {fmtDate(charge.charged_at)}
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                                    {fmt(Number(charge.amount))}
                                  </TableCell>
                                  <TableCell align="center">
                                    {charge.status === "SUCCESS" ? (
                                      <Chip
                                        icon={<CheckCircleOutlinedIcon sx={{ fontSize: "13px !important" }} />}
                                        label="Paid"
                                        size="small"
                                        sx={{ fontWeight: 700, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", height: 22 }}
                                      />
                                    ) : (
                                      <Chip
                                        icon={<ErrorOutlinedIcon sx={{ fontSize: "13px !important" }} />}
                                        label="Failed"
                                        size="small"
                                        sx={{ fontWeight: 700, bgcolor: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", height: 22 }}
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell sx={{ fontSize: 12 }}>
                                    {charge.status === "SUCCESS" && charge.wallet_transaction_id ? (
                                      <Typography sx={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                                        TX: {charge.wallet_transaction_id.slice(0, 8)}…
                                      </Typography>
                                    ) : charge.error ? (
                                      <Typography sx={{ fontSize: 11, color: "#dc2626" }}>
                                        {charge.error}
                                      </Typography>
                                    ) : (
                                      <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>
                                        Insufficient balance
                                      </Typography>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </>
                    )}
                  </Box>
                )}

              </Box>{/* end tab content Box */}
            </Paper>
          </Grid>
        </Grid>{/* end main Grid */}

        {/* ── Subscribe confirm dialog ── */}
        <Dialog
          open={!!subConfirmId}
          onClose={() => !actionLoading && setSubConfirmId(null)}
          slotProps={{ paper: { sx: { borderRadius: "20px", maxWidth: 440 } } }}
        >
          <DialogTitle sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#0f172a", pt: 3, pb: 1 }}>
            Confirm Subscription
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ fontSize: 13, color: "#64748b", mb: 2 }}>
              You are subscribing to an automated content feed. Your wallet will be charged
              each billing cycle as long as your subscription is active.
            </DialogContentText>
            {confirmSubJob && (
              <Box sx={{ p: 2, borderRadius: "14px", bgcolor: "#eff6ff", border: "1px solid rgba(59,130,246,0.25)", mb: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>AUTHOR</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {confirmSubJob.author_display_name || "Unknown"}
                  </Typography>
                </Box>
                {confirmSubJob.category && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>CATEGORY</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      {confirmSubJob.category}
                    </Typography>
                  </Box>
                )}
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>FREQUENCY</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {fmtInterval(confirmSubJob.interval_minutes)}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>CYCLE FEE</Typography>
                  <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#2563eb" }}>
                    {fmt(Number(confirmSubJob.subscription_fee))}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>FIRST RUN</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {fmtDate(confirmSubJob.next_run_at)}
                  </Typography>
                </Box>
              </Box>
            )}
            <DialogContentText sx={{ fontSize: 12, color: "#94a3b8" }}>
              After 3 consecutive failed charges the subscription is permanently cancelled.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button
              onClick={() => setSubConfirmId(null)} disabled={actionLoading}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", color: "#64748b" }}
            >
              Cancel
            </Button>
            <Button
              variant="contained" onClick={() => void handleSubscribe()} disabled={actionLoading}
              startIcon={actionLoading ? <CircularProgress size={15} color="inherit" /> : null}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none",
                background: "linear-gradient(135deg, #2563eb, #3b82f6)",
                "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #2563eb)" } }}
            >
              {actionLoading ? "Subscribing…" : "Confirm & Subscribe"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Unsubscribe confirm dialog ── */}
        <Dialog
          open={!!unsubConfirmId}
          onClose={() => !actionLoading && setUnsubConfirmId(null)}
          slotProps={{ paper: { sx: { borderRadius: "20px", maxWidth: 420 } } }}
        >
          <DialogTitle sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#dc2626", pt: 3, pb: 1 }}>
            Cancel Subscription?
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ fontSize: 13, color: "#64748b", mb: 2 }}>
              Billing stops immediately. You will no longer receive posts from this feed.
            </DialogContentText>
            {(confirmUnsubSub ?? confirmUnsubJob) && (
              <Box sx={{ p: 2, borderRadius: "14px", bgcolor: "#fff1f2", border: "1px solid #fecaca", mb: 2 }}>
                {confirmUnsubJob && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>CYCLE FEE</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>
                      {fmt(Number(confirmUnsubJob.subscription_fee))}
                    </Typography>
                  </Box>
                )}
                {confirmUnsubSub && (
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>SUBSCRIBED SINCE</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      {fmtDateShort(confirmUnsubSub.subscribed_at)}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
            <DialogContentText sx={{ fontSize: 12, color: "#94a3b8" }}>
              This action cannot be undone, but you can re-subscribe at any time from Discover.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button
              onClick={() => setUnsubConfirmId(null)} disabled={actionLoading}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", color: "#64748b" }}
            >
              Keep Subscription
            </Button>
            <Button
              variant="contained" color="error" onClick={() => void handleUnsubscribe()} disabled={actionLoading}
              startIcon={actionLoading ? <CircularProgress size={15} color="inherit" /> : null}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none" }}
            >
              {actionLoading ? "Cancelling…" : "Yes, Cancel"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Toast ── */}
        <Snackbar
          open={toast.open}
          autoHideDuration={6000}
          onClose={() => setToast((p) => ({ ...p, open: false }))}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert
            onClose={() => setToast((p) => ({ ...p, open: false }))}
            severity={toast.severity}
            variant="filled"
            sx={{ borderRadius: "12px", fontWeight: 600 }}
          >
            {toast.message}
          </Alert>
        </Snackbar>

      </Container>
    </Box>
  );
};

export default PremiumSubscriptions;
