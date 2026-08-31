import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { signOut } from "../services/authService";
import LogoutIcon from "@mui/icons-material/Logout";
import SecurityIcon from "@mui/icons-material/Security";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import WalletIcon from "@mui/icons-material/Wallet";
import ScheduleIcon from "@mui/icons-material/Schedule";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { useAdminTopUpNotifications } from "../wallet/hooks/useAdminTopUpNotifications";
import { useAdminJobNotifications } from "../hooks/useAdminJobNotifications";
import type { TopUpRequest } from "../wallet/services/walletService";
import type { ScheduledJob } from "../services/scheduledJobsService";
import { getErrorMessage } from "../utils/errors";

// ─── Styles (matching cronJobs.tsx's blue-white palette) ──────────────────────

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

const sidebarCardSx = {
  borderRadius: "18px",
  bgcolor: "#ffffff",
  border: "1px solid rgba(59,130,246,0.18)",
  boxShadow: "0 12px 32px rgba(59,130,246,0.06)",
  p: 2,
};

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

const fmtTime = (v: string) => new Date(v).toLocaleTimeString(undefined, { hour12: false });

const ACTIVITY_LIMIT = 10;

// ─── Data types ────────────────────────────────────────────────────────────────

interface WalletTxRow {
  id: string;
  wallet_id: string;
  transaction_type: string;
  direction: "CREDIT" | "DEBIT";
  amount: number;
  reason: string | null;
  created_at: string;
}

interface PostRow {
  id: number;
  title: string;
  author_display_name: string | null;
  status: string;
  category: string;
  created_at: string;
}

// Raw fields, not prose — this mirrors how Supabase's own log explorer
// shows entries (timestamp + source table + event type + raw payload)
// rather than a synthesized sentence.
interface ActivityItem {
  key: string;
  timestamp: string;
  table: "wallet_transactions" | "posts";
  type: string;
  direction?: "CREDIT" | "DEBIT";
  amount?: number;
  details: string;
}

const shortId = (id: string) => id.slice(0, 8);

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1.5,
        py: 0.85,
        borderRadius: "8px",
        bgcolor: "#f8fbff",
        border: "1px solid rgba(59,130,246,0.1)",
        fontFamily: "monospace",
        fontSize: 11.5,
        flexWrap: "wrap",
      }}
    >
      <Typography sx={{ fontFamily: "inherit", fontSize: "inherit", color: "#94a3b8", width: 76, flexShrink: 0 }}>
        {fmtTime(item.timestamp)}
      </Typography>
      <Box sx={{ width: 76, flexShrink: 0 }}>
        <Chip
          label={item.table}
          size="small"
          sx={{
            fontFamily: "inherit", fontSize: 10, height: 20,
            bgcolor: item.table === "posts" ? "#f3e8ff" : "#eff6ff",
            color: item.table === "posts" ? "#7c3aed" : "#1d4ed8",
            border: `1px solid ${item.table === "posts" ? "#e9d5ff" : "#bfdbfe"}`,
          }}
        />
      </Box>
      <Typography sx={{ fontFamily: "inherit", fontSize: "inherit", fontWeight: 700, color: "#0f172a", width: 180, flexShrink: 0 }}>
        {item.type}
      </Typography>
      <Typography
        sx={{
          fontFamily: "inherit", fontSize: "inherit", width: 68, flexShrink: 0,
          color: item.direction === "DEBIT" ? "#dc2626" : item.direction === "CREDIT" ? "#16a34a" : "#cbd5e1",
        }}
      >
        {item.direction ?? "—"}
      </Typography>
      <Typography sx={{ fontFamily: "inherit", fontSize: "inherit", fontWeight: 700, color: "#0f172a", width: 84, flexShrink: 0 }}>
        {item.amount !== undefined ? fmtCurrency(item.amount) : "—"}
      </Typography>
      
    </Box>
  );
}

function QuickActionRow({
  to, icon, label, count,
}: {
  to: string; icon: React.ReactNode; label: string; count?: number;
}) {
  return (
    <Box
      component={Link}
      to={to}
      sx={{
        display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1.25,
        borderRadius: "12px", bgcolor: "#f8fbff", border: "1px solid rgba(59,130,246,0.12)",
        textDecoration: "none", transition: "background 0.2s, box-shadow 0.2s",
        "&:hover": { bgcolor: "#eef4ff", boxShadow: "0 6px 16px rgba(37,99,235,0.1)" },
      }}
    >
      <Box
        sx={{
          width: 34, height: 34, borderRadius: "10px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          bgcolor: "rgba(37,99,235,0.1)", color: "#2563eb",
        }}
      >
        {icon}
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a", flex: 1 }}>{label}</Typography>
      {!!count && (
        <Chip
          label={count}
          size="small"
          sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a" }}
        />
      )}
      <ChevronRightIcon sx={{ fontSize: 18, color: "#94a3b8" }} />
    </Box>
  );
}

function StatCard({
  label, subtitle, value, color, bg,
}: {
  label: string; subtitle: string; value: number; color: string; bg: string;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        flex: "1 1 200px", p: 2, borderRadius: "16px", bgcolor: "#ffffff",
        border: "1px solid rgba(59,130,246,0.15)",
      }}
    >
      <Typography sx={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
        {value}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#334155" }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: 11, color: "#94a3b8", mt: 0.25 }}>{subtitle}</Typography>
      <Box sx={{ height: 4, borderRadius: "2px", bgcolor: bg, mt: 1 }} />
    </Paper>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

const AdminHome = () => {
  const [postCount, setPostCount] = useState(0);
  const [walletCount, setWalletCount] = useState(0);
  const [txCount, setTxCount] = useState(0);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [jobsBannerDismissed, setJobsBannerDismissed] = useState(false);
  const navigate = useNavigate();
  const isMobile = window.innerWidth < 600;

  // Live pending top-up count — fires onNewRequest when a new one arrives
  const { pendingCount: topUpPendingCount } = useAdminTopUpNotifications({
    isAdmin: true,
    onNewRequest: (_req: TopUpRequest) => {
      // Re-show the banner if it was dismissed (new request came in)
      setBannerDismissed(false);
    },
  });

  // Live pending scheduled-job count — fires onNewRequest when a new one arrives
  const { pendingCount: pendingJobsCount } = useAdminJobNotifications({
    isAdmin: true,
    onNewRequest: (_job: ScheduledJob) => {
      setJobsBannerDismissed(false);
    },
  });

  const fetchStats = useCallback(async () => {
    try {
      const [postsRes, walletsRes, txRes] = await Promise.all([
        supabase.from("posts").select("id", { count: "exact", head: true }),
        supabase.from("wallets").select("id", { count: "exact", head: true }),
        supabase.from("wallet_transactions").select("id", { count: "exact", head: true }),
      ]);
      setPostCount(postsRes.count ?? 0);
      setWalletCount(walletsRes.count ?? 0);
      setTxCount(txRes.count ?? 0);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
    }
  }, []);

  // Unified feed: wallet transactions (top-ups, transfers, adjustments, publish
  // fees, subscription charges, recurring fees) merged with published posts —
  // not limited to wallet activity. wallet_id -> member_id -> profile is
  // resolved client-side (mirrors manageWallet.tsx's join pattern) since
  // there's no RPC for a cross-user admin feed.
  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const [txRes, postsRes, walletsRes] = await Promise.all([
        supabase
          .from("wallet_transactions")
          .select("id, wallet_id, transaction_type, direction, amount, reason, created_at")
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        supabase
          .from("posts")
          .select("id, title, author_display_name, status, category, created_at")
          .eq("status", "PUBLISHED")
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
        supabase.from("wallets").select("id, member_id"),
      ]);

      const walletToMember = new Map<string, string>(
        ((walletsRes.data ?? []) as { id: string; member_id: string }[]).map((w) => [w.id, w.member_id]),
      );

      const txItems: ActivityItem[] = ((txRes.data ?? []) as WalletTxRow[]).map((tx) => {
        const memberId = walletToMember.get(tx.wallet_id);
        return {
          key: `tx-${tx.id}`,
          timestamp: tx.created_at,
          table: "wallet_transactions",
          type: tx.transaction_type,
          direction: tx.direction,
          amount: tx.amount,
          details: `id=${shortId(tx.id)} wallet_id=${shortId(tx.wallet_id)} member_id=${memberId ? shortId(memberId) : "—"}${tx.reason ? ` reason="${tx.reason}"` : ""}`,
        };
      });

      const postItems: ActivityItem[] = ((postsRes.data ?? []) as PostRow[]).map((p) => ({
        key: `post-${p.id}`,
        timestamp: p.created_at,
        table: "posts",
        type: "INSERT",
        details: `id=${p.id} status=${p.status} category=${p.category} author="${p.author_display_name ?? "—"}" title="${p.title}"`,
      }));

      const merged = [...txItems, ...postItems]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, ACTIVITY_LIMIT);
      setActivity(merged);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    void fetchStats();
    void fetchActivity();
  }, [fetchStats, fetchActivity]);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Unexpected error during logout");
      console.error("Unexpected error during logout:", message);
    }
  };

  return (
    <Box sx={pageBg}>
      <Container maxWidth="xl" disableGutters sx={{ px: { xs: 2, sm: 3, md: 4 } }}>
        {/* Header */}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, mb: 3 }}>
          <DashboardIcon sx={{ color: "#3A7FF1", fontSize: { xs: 30, sm: 36 } }} />
          <Box sx={{ flex: "1 1 260px" }}>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.5rem", sm: "1.8rem" }, color: "#0f172a", lineHeight: 1.2 }}>
              Admin Dashboard
            </Typography>
            <Typography sx={{ fontSize: 12, color: "rgba(15,23,42,0.65)" }}>
              Platform overview — posts, wallets, and recent activity
            </Typography>
          </Box>
          <Tooltip title="Two-factor authentication settings">
            <IconButton
              onClick={() => navigate("/mfa-setup")}
              sx={{ color: "#2563eb", width: { xs: 36, sm: 40 }, height: { xs: 36, sm: 40 } }}
              aria-label="two-factor authentication settings"
            >
              <SecurityIcon fontSize={isMobile ? "small" : "medium"} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Logout">
            <IconButton
              onClick={() => void handleLogout()}
              sx={{ color: "#2563eb", width: { xs: 36, sm: 40 }, height: { xs: 36, sm: 40 } }}
              aria-label="logout"
            >
              <LogoutIcon fontSize={isMobile ? "small" : "medium"} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Pending top-up alert banner */}
        <Collapse in={topUpPendingCount > 0 && !bannerDismissed}>
          <Alert
            severity="warning"
            icon={<NotificationsActiveIcon fontSize="small" />}
            onClose={() => setBannerDismissed(true)}
            action={
              <Box
                component={Link}
                to="/manage-wallets"
                onClick={() => setBannerDismissed(true)}
                sx={{ fontWeight: 700, fontSize: 13, color: "#92400e", textDecoration: "underline", whiteSpace: "nowrap", mr: 1 }}
              >
                Review now
              </Box>
            }
            sx={{ mb: 2, borderRadius: "12px", bgcolor: "#fffbeb", border: "1px solid #fde68a" }}
          >
            <strong>{topUpPendingCount} pending top-up request{topUpPendingCount > 1 ? "s" : ""}</strong> awaiting your approval.
          </Alert>
        </Collapse>

        {/* Pending scheduled jobs banner */}
        <Collapse in={pendingJobsCount > 0 && !jobsBannerDismissed}>
          <Alert
            severity="info"
            icon={<HourglassEmptyIcon fontSize="small" />}
            onClose={() => setJobsBannerDismissed(true)}
            action={
              <Box
                component={Link}
                to="/manage-jobs"
                onClick={() => setJobsBannerDismissed(true)}
                sx={{ fontWeight: 700, fontSize: 13, color: "#1e40af", textDecoration: "underline", whiteSpace: "nowrap", mr: 1 }}
              >
                Review now
              </Box>
            }
            sx={{ mb: 2, borderRadius: "12px", bgcolor: "#eff6ff", border: "1px solid #bfdbfe" }}
          >
            <strong>{pendingJobsCount} scheduled job request{pendingJobsCount > 1 ? "s" : ""}</strong> awaiting your approval.
          </Alert>
        </Collapse>

        {/* Stat cards */}
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
          <StatCard label="Total Posts" subtitle="Published and drafts" value={postCount} color="#2563eb" bg="rgba(37,99,235,0.15)" />
          <StatCard label="Total Wallets" subtitle="Registered members" value={walletCount} color="#16a34a" bg="rgba(22,163,74,0.15)" />
          <StatCard label="Total Transactions" subtitle="All-time ledger entries" value={txCount} color="#7c3aed" bg="rgba(124,58,237,0.15)" />
          <StatCard
            label="Pending Reviews"
            subtitle="Top-ups + job requests"
            value={topUpPendingCount + pendingJobsCount}
            color="#d97706"
            bg="rgba(217,119,6,0.15)"
          />
        </Box>

        {/* Main content: activity feed + quick actions sidebar */}
        <Box sx={{ display: "flex", gap: 2.5, alignItems: "flex-start", flexDirection: { xs: "column", lg: "row" } }}>
          <Paper elevation={0} sx={{ ...cardSx, flex: "1 1 0%", minWidth: 0, width: "100%" }}>
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: "#0f172a", mb: 0.25 }}>
              Recent activity
            </Typography>
            <Typography sx={{ fontSize: 12, color: "#64748b", mb: 1.5 }}>
              Latest {ACTIVITY_LIMIT} raw log entries — wallet_transactions and posts, newest first
            </Typography>

            {activityLoading && (
              <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={28} /></Box>
            )}

            {!activityLoading && activity.length === 0 && (
              <Typography sx={{ fontSize: 13, color: "#94a3b8", py: 2 }}>No recent activity yet.</Typography>
            )}

            {!activityLoading && activity.length > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, fontFamily: "monospace", fontSize: 10.5, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <Box sx={{ width: 76, flexShrink: 0 }}>Time</Box>
                  <Box sx={{ width: 76, flexShrink: 0 }}>Table</Box>
                  <Box sx={{ width: 180, flexShrink: 0 }}>Type</Box>
                  <Box sx={{ width: 68, flexShrink: 0 }}>Dir</Box>
                  <Box sx={{ width: 84, flexShrink: 0 }}>Amount</Box>
                  <Box sx={{ flex: 1 }}>Details</Box>
                </Box>
                {activity.map((item) => (
                  <ActivityRow key={item.key} item={item} />
                ))}
              </Box>
            )}
          </Paper>

          <Box sx={{ width: { xs: "100%", lg: 320 }, flexShrink: 0 }}>
            <Paper elevation={0} sx={sidebarCardSx}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a", mb: 1.5 }}>
                Quick actions
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <QuickActionRow to="/manage-posts" icon={<DynamicFeedIcon fontSize="small" />} label="Manage posts" />
                <QuickActionRow to="/manage-wallets" icon={<WalletIcon fontSize="small" />} label="Manage wallets" count={topUpPendingCount} />
                <QuickActionRow to="/manage-jobs" icon={<ScheduleIcon fontSize="small" />} label="Scheduled jobs" count={pendingJobsCount} />
                <QuickActionRow to="/cron-jobs" icon={<MonitorHeartIcon fontSize="small" />} label="Cron monitor" />
              </Box>
            </Paper>
          </Box>
        </Box>
      </Container>
    </Box>
  );
};

export default AdminHome;
