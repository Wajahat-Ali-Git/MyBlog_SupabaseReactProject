import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import { supabase } from "../services/supabase";
import {
  getPlatformSettings,
  publishPost,
  publishDraft,
  deleteDraft,
  POST_CATEGORIES,
  POST_CATEGORY_COLORS,
  type PostCategory,
} from "../services/postService";
import {
  createScheduledJob,
  updateScheduledJobDraft,
  cancelMyScheduledJob,
  type ScheduledJob,
  type CreateScheduledJobParams,
} from "../services/scheduledJobsService";
import { getMyWallet } from "../wallet/services/walletService";
import { getErrorMessage } from "../utils/errors";
import { useJobApprovalNotifications } from "../hooks/useJobApprovalNotifications";
import type { blogProps } from "../consts/interfaces";

import {
  Alert,
  Autocomplete,
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
  FormControlLabel,
  InputAdornment,
  Pagination,
  Paper,
  Snackbar,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import DraftIcon from "@mui/icons-material/EditNoteOutlined";
import PublicIcon from "@mui/icons-material/PublicOutlined";
import ScheduleIcon from "@mui/icons-material/Schedule";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import RepeatIcon from "@mui/icons-material/Repeat";
import LooksOneIcon from "@mui/icons-material/LooksOne";
import EditIcon from "@mui/icons-material/Edit";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import ReadMoreIcon from "@mui/icons-material/ReadMore";

// ─── Types ─────────────────────────────────────────────────────────────────

interface BlogItem extends blogProps {
  status?: "PUBLISHED" | "DRAFT";
  created_at?: string;
}

// ─── Design tokens (matches manageJobs / premium-subscriptions palette) ─────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

const fmtDate = (v: string) => new Date(v).toLocaleString();

function fmtInterval(minutes: number | null): string {
  if (minutes === null) return "One-time";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60}h`;
  if (minutes === 1440) return "Daily";
  if (minutes === 10080) return "Weekly";
  return `Every ${Math.round(minutes / 1440)}d`;
}

function JobStatusChip({ status }: { status: ScheduledJob["status"] }) {
  const map: Record<ScheduledJob["status"], { label: string; bg: string; color: string; border: string }> = {
    PENDING_APPROVAL: { label: "Pending approval", bg: "#fef9c3", color: "#854d0e", border: "#fde68a" },
    ACTIVE:            { label: "Active",          bg: "#dcfce7", color: "#166534", border: "#bbf7d0" },
    PAUSED:            { label: "Paused",           bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
    CANCELLED:         { label: "Cancelled",        bg: "#f1f5f9", color: "#475569", border: "#cbd5e1" },
    COMPLETED:         { label: "Completed",        bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    REJECTED:          { label: "Rejected",         bg: "#fee2e2", color: "#991b1b", border: "#fecaca" },
  };
  const s = map[status];
  return (
    <Chip
      label={s.label}
      size="small"
      sx={{ fontWeight: 700, bgcolor: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const TAB_CREATE    = 0;
const TAB_DRAFTS    = 1;
const TAB_SCHEDULED = 2;

const DRAFTS_PAGE_SIZE = 5;
const JOBS_PAGE_SIZE   = 5;

interface DetailView {
  title: string;
  content: string;
  meta: { label: string; bg: string; color: string }[];
}

const MyPosts = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState(TAB_CREATE);

  // Fee/wallet (publish-now info bar + drafts insufficient-balance messaging)
  const [fee, setFee] = useState(0);
  const [annualFee, setAnnualFee] = useState(0);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  // Drafts
  const [myDrafts, setMyDrafts] = useState<BlogItem[]>([]);
  const [draftsTotal, setDraftsTotal] = useState(0);
  const [draftsPage, setDraftsPage] = useState(1);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [publishingDraftId, setPublishingDraftId] = useState<number | null>(null);
  const [deletingDraftId, setDeletingDraftId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Scheduled & recurring — paginated client-side (myJobs below is already
  // fully loaded and kept live by realtime, see useJobApprovalNotifications)
  const [jobsPage, setJobsPage] = useState(1);

  // Shared "view full post" dialog — content is line-clamped in both list
  // views, this is where the untruncated text lives
  const [detailView, setDetailView] = useState<DetailView | null>(null);

  // Create form (simple, scheduled, or recurring)
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<PostCategory | null>(null);
  const [scheduleForLater, setScheduleForLater] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [endsAt, setEndsAt] = useState("");
  const [subscriptionFee, setSubscriptionFee] = useState("0");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Scheduled & recurring list — live via realtime, not a one-shot fetch
  const { jobs: myJobs, loading: jobsLoading } = useJobApprovalNotifications({
    userId: user?.id ?? null,
    onApproved: () => showToast("A scheduled post was approved and is now active.", "success"),
    onRejected: () => showToast("A scheduled post was rejected by admin.", "warning"),
  });
  const [actionLoading, setActionLoading] = useState(false);

  const [editJob, setEditJob] = useState<ScheduledJob | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<PostCategory>("Uncategorized");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [cancelJobId, setCancelJobId] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    open: boolean; message: string; severity: "success" | "error" | "info" | "warning";
  }>({ open: false, message: "", severity: "success" });

  const showToast = (message: string, severity: typeof toast.severity) =>
    setToast({ open: true, message, severity });

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadFeeAndBalance = useCallback(async () => {
    try {
      const [settings, wallet] = await Promise.all([
        getPlatformSettings(),
        user?.id ? getMyWallet() : Promise.resolve(null),
      ]);
      setFee(settings.post_publish_fee);
      setAnnualFee(settings.recurring_post_annual_fee);
      if (wallet) setWalletBalance(Number(wallet.balance_cached));
    } catch (err) {
      console.error("Failed to load fee/balance:", err);
    }
  }, [user]);

  useEffect(() => {
    const run = async () => { await loadFeeAndBalance(); };
    void run();
  }, [loadFeeAndBalance]);

  const loadDrafts = useCallback(async (page: number) => {
    if (!user?.id) { setMyDrafts([]); setDraftsTotal(0); setDraftsLoading(false); return; }
    setDraftsLoading(true);
    try {
      const from = (page - 1) * DRAFTS_PAGE_SIZE;
      const to = from + DRAFTS_PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("posts")
        .select("*", { count: "exact" })
        .eq("status", "DRAFT")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) { console.error(error); return; }
      setMyDrafts((data as BlogItem[]) ?? []);
      setDraftsTotal(count ?? 0);
    } finally {
      setDraftsLoading(false);
    }
  }, [user]);

  // Refetches on every visit to the tab (not just the first) and whenever
  // the page changes — cheap enough (one page of rows) and keeps drafts
  // fresh if the user switches away and back.
  useEffect(() => {
    if (tab !== TAB_DRAFTS) return;
    const run = async () => { await loadDrafts(draftsPage); };
    void run();
  }, [tab, draftsPage, loadDrafts]);

  const draftsTotalPages = Math.max(1, Math.ceil(draftsTotal / DRAFTS_PAGE_SIZE));

  // ── Derived ────────────────────────────────────────────────────────────────

  const insufficientBalance = fee > 0 && walletBalance !== null && walletBalance < fee;
  const parsedInterval = parseInt(intervalMinutes, 10);
  const parsedFee      = parseFloat(subscriptionFee);

  const canSubmitCreate =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    category !== null &&
    (!scheduleForLater || (!!scheduledFor && new Date(scheduledFor) > new Date())) &&
    (!scheduleForLater || !recurring || (!isNaN(parsedInterval) && parsedInterval >= 1)) &&
    (!scheduleForLater || !recurring || (!isNaN(parsedFee) && parsedFee >= 0)) &&
    !createLoading;

  const resetCreateForm = () => {
    setTitle("");
    setContent("");
    setCategory(null);
    setScheduleForLater(false);
    setScheduledFor("");
    setRecurring(false);
    setIntervalMinutes("60");
    setEndsAt("");
    setSubscriptionFee("0");
    setCreateError(null);
  };

  const isJobEditable = (status: ScheduledJob["status"]) =>
    status === "PENDING_APPROVAL" || status === "ACTIVE" || status === "PAUSED";
  const cancelJob = myJobs.find((j) => j.id === cancelJobId);
  const deleteConfirmDraft = myDrafts.find((d) => Number(d.id) === deleteConfirmId);

  // myJobs is already fully loaded (kept live by realtime) — paginate the
  // rendering rather than the fetch. Clamp at render time instead of a
  // separate effect so a shrinking list (e.g. cancelling the last job on
  // the last page) can't strand jobsPage past the new end.
  const jobsTotalPages = Math.max(1, Math.ceil(myJobs.length / JOBS_PAGE_SIZE));
  const currentJobsPage = Math.min(jobsPage, jobsTotalPages);
  const pagedJobs = myJobs.slice(
    (currentJobsPage - 1) * JOBS_PAGE_SIZE,
    currentJobsPage * JOBS_PAGE_SIZE,
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSubmitCreate = async () => {
    if (!canSubmitCreate || !category) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      if (!scheduleForLater) {
        const result = await publishPost(title.trim(), content.trim(), category);
        resetCreateForm();
        void loadFeeAndBalance();
        if (result.status === "PUBLISHED") {
          showToast(
            result.fee_charged > 0
              ? `Post published! ${fmt(result.fee_charged)} fee charged.`
              : "Post published successfully!",
            "success",
          );
        } else {
          setDraftsPage(1);
          await loadDrafts(1);
          showToast(
            `Insufficient balance — post saved as draft. You need ${fmt(fee)} to publish.`,
            "warning",
          );
        }
      } else {
        const params: CreateScheduledJobParams = {
          title: title.trim(),
          content: content.trim(),
          category,
          scheduledFor: new Date(scheduledFor).toISOString(),
          intervalMinutes: recurring ? parsedInterval : undefined,
          subscriptionFee: recurring ? parsedFee : 0,
          endsAt: recurring && endsAt ? new Date(endsAt).toISOString() : undefined,
        };
        await createScheduledJob(params);
        resetCreateForm();
        setTab(TAB_SCHEDULED);
        showToast("Submitted for admin approval.", "success");
      }
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err, "Failed to submit."));
    } finally {
      setCreateLoading(false);
    }
  };

  const handlePublishDraft = async (postId: number) => {
    setPublishingDraftId(postId);
    try {
      const result = await publishDraft(postId);
      void loadFeeAndBalance();
      // If this was the only draft left on the current (non-first) page,
      // step back a page instead of reloading into an empty one — setting
      // draftsPage triggers the load effect itself.
      const backAPage = myDrafts.length === 1 && draftsPage > 1;
      if (backAPage) setDraftsPage(draftsPage - 1);
      else await loadDrafts(draftsPage);
      showToast(
        result.fee_charged > 0
          ? `Post published! ${fmt(result.fee_charged)} fee charged.`
          : "Post published successfully!",
        "success",
      );
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Could not publish this draft."), "error");
    } finally {
      setPublishingDraftId(null);
    }
  };

  const handleDeleteDraft = async () => {
    if (deleteConfirmId === null) return;
    setDeletingDraftId(deleteConfirmId);
    try {
      await deleteDraft(deleteConfirmId);
      setDeleteConfirmId(null);
      const backAPage = myDrafts.length === 1 && draftsPage > 1;
      if (backAPage) setDraftsPage(draftsPage - 1);
      else await loadDrafts(draftsPage);
      showToast("Draft deleted.", "info");
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Could not delete this draft."), "error");
    } finally {
      setDeletingDraftId(null);
    }
  };

  const openEdit = (job: ScheduledJob) => {
    setEditJob(job);
    setEditTitle(job.title);
    setEditContent(job.content);
    setEditCategory(job.category);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editJob || editTitle.trim().length === 0 || editContent.trim().length === 0) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await updateScheduledJobDraft(editJob.id, editTitle.trim(), editContent.trim(), editCategory);
      setEditJob(null);
      showToast("Draft updated.", "success");
    } catch (err: unknown) {
      setEditError(getErrorMessage(err, "Failed to update draft."));
    } finally {
      setEditLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!cancelJobId) return;
    setActionLoading(true);
    try {
      await cancelMyScheduledJob(cancelJobId);
      setCancelJobId(null);
      showToast("Post cancelled.", "info");
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Failed to cancel post."), "error");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box sx={pageBg}>
      <Container maxWidth="lg" disableGutters sx={{ px: { xs: 2, sm: 3, md: 0 } }}>

        {/* ── Page header ── */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <Button
            onClick={() => navigate("/")}
            startIcon={<ArrowBackIcon />}
            sx={{ fontWeight: 600, color: "#2563eb", textTransform: "none" }}
          >
            Back
          </Button>
          <DynamicFeedIcon sx={{ color: "#3b82f6", fontSize: 32 }} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.4rem", sm: "1.75rem" }, color: "#0f172a", lineHeight: 1.2 }}>
              Manage Posts
            </Typography>
            <Typography sx={{ fontSize: 13, color: "#64748b" }}>
              Create, draft, schedule, and manage your posts
            </Typography>
          </Box>
        </Box>

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
                  <AddCircleOutlinedIcon sx={{ fontSize: 16 }} />
                  Create
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <DraftIcon sx={{ fontSize: 16 }} />
                  Drafts
                  {draftsTotal > 0 && (
                    <Box component="span" sx={{ ml: 0.5, px: 0.75, py: 0.1, borderRadius: "8px",
                      bgcolor: "#d97706", color: "#fff", fontSize: 11, fontWeight: 800, lineHeight: "18px" }}>
                      {draftsTotal}
                    </Box>
                  )}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <ScheduleIcon sx={{ fontSize: 16 }} />
                  Scheduled &amp; Recurring
                  {myJobs.filter((j) => j.status === "PENDING_APPROVAL").length > 0 && (
                    <Box component="span" sx={{ ml: 0.5, px: 0.75, py: 0.1, borderRadius: "8px",
                      bgcolor: "#d97706", color: "#fff", fontSize: 11, fontWeight: 800, lineHeight: "18px" }}>
                      {myJobs.filter((j) => j.status === "PENDING_APPROVAL").length}
                    </Box>
                  )}
                </Box>
              }
            />
          </Tabs>

          <Box sx={{ p: { xs: 2, sm: 3 } }}>

            {/* ── Tab: Create ── */}
            {tab === TAB_CREATE && (
              <Box sx={{ maxWidth: 640 }}>
                {createError && (
                  <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }}>{createError}</Alert>
                )}

                <TextField
                  fullWidth size="small" label="Post title" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  sx={{ mb: 2 }}
                />
                <TextField
                  fullWidth size="small" label="Post content" value={content}
                  onChange={(e) => setContent(e.target.value)}
                  multiline minRows={4}
                  sx={{ mb: 2 }}
                />
                <Autocomplete
                  fullWidth size="small"
                  options={POST_CATEGORIES}
                  value={category}
                  onChange={(_e, newValue) => setCategory(newValue)}
                  renderOption={(props, option) => {
                    const { key, ...rest } = props;
                    return (
                      <Box component="li" key={key} {...rest} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, bgcolor: POST_CATEGORY_COLORS[option].color }} />
                        {option}
                      </Box>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Category" placeholder="Select a category" required />
                  )}
                  sx={{ mb: 2 }}
                />

                <Divider sx={{ mb: 2 }} />

                <FormControlLabel
                  control={
                    <Switch
                      checked={scheduleForLater}
                      onChange={(e) => setScheduleForLater(e.target.checked)}
                      color="primary"
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
                      Schedule for later
                    </Typography>
                  }
                  sx={{ mb: scheduleForLater ? 1.5 : 2 }}
                />

                {!scheduleForLater ? (
                  <Box
                    sx={{
                      display: "flex", alignItems: "center", gap: 1.5, p: 1.5, mb: 3, borderRadius: "10px",
                      bgcolor: insufficientBalance ? "#fff7ed" : "#f0fdf4",
                      border: `1px solid ${insufficientBalance ? "#fed7aa" : "#bbf7d0"}`,
                    }}
                  >
                    <AccountBalanceWalletIcon sx={{ color: insufficientBalance ? "#ea580c" : "#16a34a", fontSize: 20 }} />
                    <Box sx={{ flex: 1 }}>
                      {fee > 0 ? (
                        <Typography sx={{ fontSize: 13, color: "#0f172a" }}>
                          Publish fee: <strong>{fmt(fee)}</strong>
                          {walletBalance !== null && (
                            <> · Your balance: <strong>{fmt(walletBalance)}</strong></>
                          )}
                        </Typography>
                      ) : (
                        <Typography sx={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>
                          Publishing is free right now
                        </Typography>
                      )}
                      {insufficientBalance && (
                        <Typography sx={{ fontSize: 12, color: "#ea580c" }}>
                          Insufficient balance — post will be saved as draft.{" "}
                          <Box component="span" onClick={() => navigate("/wallet")}
                            sx={{ cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}>
                            Top up wallet →
                          </Box>
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ) : (
                  <>
                    <TextField
                      fullWidth size="small" label="Scheduled for" type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ mb: 2 }}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={recurring}
                          onChange={(e) => setRecurring(e.target.checked)}
                          color="primary"
                        />
                      }
                      label={
                        <Typography sx={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
                          Recurring post
                        </Typography>
                      }
                      sx={{ mb: recurring ? 1.5 : 2 }}
                    />
                    {!recurring && (
                      <Box
                        sx={{
                          display: "flex", alignItems: "center", gap: 1.5, p: 1.5, mb: 3, borderRadius: "10px",
                          bgcolor: "#f0fdf4", border: "1px solid #bbf7d0",
                        }}
                      >
                        <AccountBalanceWalletIcon sx={{ color: "#16a34a", fontSize: 20 }} />
                        <Box sx={{ flex: 1 }}>
                          {fee > 0 ? (
                            <Typography sx={{ fontSize: 13, color: "#0f172a" }}>
                              Publish fee: <strong>{fmt(fee)}</strong>, charged when it publishes at the scheduled time
                              {walletBalance !== null && (
                                <> · Your balance: <strong>{fmt(walletBalance)}</strong></>
                              )}
                            </Typography>
                          ) : (
                            <Typography sx={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>
                              Publishing is free right now
                            </Typography>
                          )}
                          {fee > 0 && walletBalance !== null && walletBalance < fee && (
                            <Typography sx={{ fontSize: 12, color: "#ea580c" }}>
                              If your balance is still short at publish time, it'll be saved as a draft instead.{" "}
                              <Box component="span" onClick={() => navigate("/wallet")}
                                sx={{ cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}>
                                Top up wallet →
                              </Box>
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    )}
                    {recurring && (
                      <>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
                          <TextField
                            size="small" label="Interval (minutes)" type="number" value={intervalMinutes}
                            onChange={(e) => setIntervalMinutes(e.target.value)}
                            slotProps={{ htmlInput: { min: 1 } }}
                            helperText="How often it republishes."
                            sx={{ flex: "1 1 160px" }}
                          />
                          <TextField
                            size="small" label="Ends at (optional)" type="datetime-local" value={endsAt}
                            onChange={(e) => setEndsAt(e.target.value)}
                            slotProps={{ inputLabel: { shrink: true } }}
                            helperText="Leave blank for indefinite recurrence."
                            sx={{ flex: "1 1 200px" }}
                          />
                        </Box>
                        <TextField
                          fullWidth size="small" label="Subscription fee per cycle (USD)"
                          type="number" value={subscriptionFee}
                          onChange={(e) => setSubscriptionFee(e.target.value)}
                          slotProps={{
                            htmlInput: { min: 0, step: 0.01 },
                            input: {
                              startAdornment: (
                                <InputAdornment position="start">
                                  <AttachMoneyIcon sx={{ fontSize: 18, color: "#94a3b8" }} />
                                </InputAdornment>
                              ),
                            },
                          }}
                          helperText="What other users pay per cycle to subscribe to this feed. 0 = free."
                          sx={{ mb: 2 }}
                        />
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, mb: 3, borderRadius: "10px",
                          bgcolor: "#eff6ff", border: "1px solid #bfdbfe" }}>
                          <AttachMoneyIcon sx={{ color: "#2563eb", fontSize: 20 }} />
                          <Typography sx={{ fontSize: 13, color: "#0f172a" }}>
                            {annualFee > 0 ? (
                              <>Recurring posts have a platform annual fee of <strong>{fmt(annualFee)}</strong>,
                              charged when this is approved and again every year it stays active.</>
                            ) : (
                              <>Running a recurring post is <strong>free</strong> right now — no annual fee.</>
                            )}
                            {walletBalance !== null && (
                              <> · Your balance: <strong>{fmt(walletBalance)}</strong></>
                            )}
                            {" "}Whatever subscribers pay you above is entirely yours.
                          </Typography>
                        </Box>
                      </>
                    )}
                    <Alert severity="info" sx={{ mb: 3, borderRadius: "12px", fontSize: 13 }}>
                      Submitted for admin approval before it publishes. You can edit it any time
                      before then from the Scheduled &amp; Recurring tab.
                    </Alert>
                  </>
                )}

                <Button
                  variant="contained"
                  size="large"
                  disabled={!canSubmitCreate}
                  onClick={() => void handleSubmitCreate()}
                  startIcon={
                    createLoading
                      ? <CircularProgress size={18} color="inherit" />
                      : scheduleForLater
                      ? <ScheduleIcon />
                      : insufficientBalance
                      ? <DraftIcon />
                      : <PublicIcon />
                  }
                  sx={{ borderRadius: "12px", fontWeight: 700, textTransform: "none" }}
                >
                  {createLoading
                    ? "Submitting…"
                    : scheduleForLater
                    ? "Submit for Approval"
                    : insufficientBalance
                    ? "Save as Draft"
                    : fee > 0
                    ? `Publish for ${fmt(fee)}`
                    : "Publish Now"}
                </Button>
              </Box>
            )}

            {/* ── Tab: Drafts ── */}
            {tab === TAB_DRAFTS && (
              <Box>
                {draftsLoading ? (
                  <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={28} /></Box>
                ) : myDrafts.length === 0 ? (
                  <Box sx={{ textAlign: "center", py: 8 }}>
                    <DraftIcon sx={{ fontSize: 48, color: "#bfdbfe", mb: 2 }} />
                    <Typography sx={{ fontWeight: 700, color: "#0f172a", mb: 0.5 }}>
                      No drafts yet
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: "#64748b" }}>
                      Posts saved as drafts (e.g. from insufficient balance) will appear here.
                    </Typography>
                  </Box>
                ) : (
                  <>
                    {fee > 0 && (
                      <Alert severity="warning" icon={<AccountBalanceWalletIcon fontSize="small" />}
                        sx={{ mb: 2.5, borderRadius: "12px" }}>
                        These posts were saved as drafts because your balance was below the{" "}
                        <strong>{fmt(fee)}</strong> publish fee. Top up your wallet to publish them.
                      </Alert>
                    )}
                    <Grid container spacing={2}>
                      {myDrafts.map((blog) => {
                        const draftId = Number(blog.id);
                        return (
                          <Grid size={{ xs: 12 }} key={blog.id}>
                            <Box sx={{ ...rowSx, border: "1px dashed #fde68a", bgcolor: "#fffbeb" }}>
                              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 1, mb: 1 }}>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
                                    <Typography sx={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                                      {blog.title}
                                    </Typography>
                                    {blog.category && (
                                      <Chip
                                        label={blog.category}
                                        size="small"
                                        sx={{ fontWeight: 600, bgcolor: "#eff6ff", color: "#1d4ed8" }}
                                      />
                                    )}
                                  </Box>
                                  <Typography
                                    sx={{ fontSize: 13, color: "#475569",
                                      overflow: "hidden", display: "-webkit-box",
                                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                                  >
                                    {blog.content}
                                  </Typography>
                                  <Button
                                    size="small"
                                    onClick={() => setDetailView({
                                      title: blog.title ?? "Untitled",
                                      content: blog.content ?? "",
                                      meta: blog.category ? [{ label: blog.category, bg: "#eff6ff", color: "#1d4ed8" }] : [],
                                    })}
                                    startIcon={<ReadMoreIcon sx={{ fontSize: 15 }} />}
                                    sx={{ mt: 0.25, px: 0, minWidth: 0, fontSize: 11.5, fontWeight: 700, textTransform: "none", color: "#2563eb", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}
                                  >
                                    View full post
                                  </Button>
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                                  {insufficientBalance ? (
                                    <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                                      Awaiting publish fee payment
                                    </Typography>
                                  ) : (
                                    <Button
                                      variant="contained"
                                      size="small"
                                      disabled={publishingDraftId === draftId}
                                      onClick={() => void handlePublishDraft(draftId)}
                                      sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none" }}
                                    >
                                      {publishingDraftId === draftId
                                        ? <CircularProgress size={16} sx={{ color: "#fff" }} />
                                        : "Publish now"}
                                    </Button>
                                  )}
                                  <Button
                                    size="small" variant="outlined" color="error"
                                    disabled={deletingDraftId === draftId}
                                    onClick={() => setDeleteConfirmId(draftId)}
                                    startIcon={deletingDraftId === draftId ? <CircularProgress size={14} /> : <DeleteOutlinedIcon sx={{ fontSize: 16 }} />}
                                    sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none" }}
                                  >
                                    Delete
                                  </Button>
                                </Box>
                              </Box>
                            </Box>
                          </Grid>
                        );
                      })}
                    </Grid>
                    {draftsTotalPages > 1 && (
                      <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
                        <Pagination
                          count={draftsTotalPages}
                          page={draftsPage}
                          onChange={(_e, page) => setDraftsPage(page)}
                          color="primary"
                          shape="rounded"
                        />
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}

            {/* ── Tab: Scheduled & Recurring ── */}
            {tab === TAB_SCHEDULED && (
              <Box>
                {jobsLoading ? (
                  <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={28} /></Box>
                ) : myJobs.length === 0 ? (
                  <Box sx={{ textAlign: "center", py: 8 }}>
                    <ScheduleIcon sx={{ fontSize: 48, color: "#bfdbfe", mb: 2 }} />
                    <Typography sx={{ fontWeight: 700, color: "#0f172a", mb: 0.5 }}>
                      No scheduled posts yet
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: "#64748b", mb: 2.5 }}>
                      Create a draft to publish at a scheduled time, one-time or recurring.
                    </Typography>
                    <Button
                      variant="outlined"
                      onClick={() => { resetCreateForm(); setScheduleForLater(true); setTab(TAB_CREATE); }}
                      sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none",
                        borderColor: "rgba(59,130,246,0.4)", color: "#2563eb" }}
                    >
                      Schedule a Post
                    </Button>
                  </Box>
                ) : (
                  <Grid container spacing={2}>
                    {pagedJobs.map((job) => {
                      const isRecurring = job.interval_minutes !== null;
                      const editable    = isJobEditable(job.status);

                      return (
                        <Grid size={{ xs: 12 }} key={job.id}>
                          <Box sx={job.status === "PENDING_APPROVAL" ? { ...rowSx, bgcolor: "#fffbeb", border: "1px solid #fde68a" } : rowSx}>
                            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, mb: 1 }}>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
                                  <Typography sx={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                                    {job.title}
                                  </Typography>
                                  <JobStatusChip status={job.status} />
                                  <Chip
                                    icon={isRecurring ? <RepeatIcon sx={{ fontSize: 12 }} /> : <LooksOneIcon sx={{ fontSize: 12 }} />}
                                    label={isRecurring ? "Recurring" : "One-time"}
                                    size="small"
                                    sx={{ fontWeight: 600, bgcolor: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}
                                  />
                                  {isRecurring && job.subscription_fee > 0 && (
                                    <Chip
                                      icon={<AttachMoneyIcon sx={{ fontSize: 12 }} />}
                                      label={`${fmt(job.subscription_fee)} / cycle`}
                                      size="small"
                                      sx={{ fontWeight: 600, bgcolor: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}
                                    />
                                  )}
                                  {job.category && (
                                    <Chip
                                      label={job.category}
                                      size="small"
                                      sx={{ fontWeight: 600, bgcolor: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0" }}
                                    />
                                  )}
                                </Box>
                                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                                  <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                    {job.status === "PENDING_APPROVAL" ? "Requested for" : "Next run"}: <strong>{fmtDate(job.next_run_at)}</strong>
                                  </Typography>
                                  {isRecurring && (
                                    <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                                      {fmtInterval(job.interval_minutes)}
                                    </Typography>
                                  )}
                                  {job.ends_at && (
                                    <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                                      Ends: {fmtDate(job.ends_at)}
                                    </Typography>
                                  )}
                                </Box>
                              </Box>

                              {isRecurring && job.next_annual_fee_at && (
                                <Typography sx={{ fontSize: 12, color: "#64748b", mb: 1 }}>
                                  Next annual fee: <strong>{fmtDate(job.next_annual_fee_at)}</strong>
                                </Typography>
                              )}
                              {job.annual_fee_failures > 0 && (
                                <Alert severity="warning" sx={{ mb: 1.5, borderRadius: "10px", py: 0.5, fontSize: 12 }}>
                                  {job.annual_fee_failures >= 2
                                    ? "One more failed annual fee charge will pause this post. Top up your wallet."
                                    : "Last annual fee charge failed. Ensure your wallet has enough balance before the retry."}
                                </Alert>
                              )}

                              {editable && (
                                <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexShrink: 0 }}>
                                  <Button
                                    size="small" variant="outlined"
                                    onClick={() => openEdit(job)}
                                    startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                                    sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12,
                                      borderColor: "rgba(59,130,246,0.4)", color: "#2563eb" }}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="small" variant="outlined" color="error"
                                    onClick={() => setCancelJobId(job.id)}
                                    startIcon={<CancelOutlinedIcon sx={{ fontSize: 14 }} />}
                                    sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12 }}
                                  >
                                    Cancel
                                  </Button>
                                </Box>
                              )}
                            </Box>

                            <Box sx={{ p: 1.5, borderRadius: "10px", bgcolor: "#ffffff", border: "1px solid rgba(59,130,246,0.1)" }}>
                              <Typography
                                sx={{ fontSize: 13, color: "#475569",
                                  overflow: "hidden", display: "-webkit-box",
                                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                              >
                                {job.content}
                              </Typography>
                              <Button
                                size="small"
                                onClick={() => setDetailView({
                                  title: job.title,
                                  content: job.content,
                                  meta: [
                                    ...(job.category ? [{ label: job.category, bg: "#f8fafc", color: "#475569" }] : []),
                                    { label: isRecurring ? "Recurring" : "One-time", bg: "#eff6ff", color: "#1d4ed8" },
                                  ],
                                })}
                                startIcon={<ReadMoreIcon sx={{ fontSize: 15 }} />}
                                sx={{ mt: 0.5, px: 0, minWidth: 0, fontSize: 11.5, fontWeight: 700, textTransform: "none", color: "#2563eb", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}
                              >
                                View full post
                              </Button>
                            </Box>

                            {job.status === "PENDING_APPROVAL" && (
                              <Typography sx={{ fontSize: 12, color: "#854d0e", mt: 1 }}>
                                Awaiting admin approval — you can still edit this draft while it waits.
                              </Typography>
                            )}
                            {job.status === "REJECTED" && (
                              <Typography sx={{ fontSize: 12, color: "#991b1b", mt: 1 }}>
                                Rejected by admin. Create a new post to try again.
                              </Typography>
                            )}
                          </Box>
                        </Grid>
                      );
                    })}
                  </Grid>
                )}
                {jobsTotalPages > 1 && (
                  <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
                    <Pagination
                      count={jobsTotalPages}
                      page={currentJobsPage}
                      onChange={(_e, page) => setJobsPage(page)}
                      color="primary"
                      shape="rounded"
                    />
                  </Box>
                )}
              </Box>
            )}

          </Box>
        </Paper>

        {/* ── Edit draft dialog ── */}
        <Dialog
          open={!!editJob}
          onClose={() => !editLoading && setEditJob(null)}
          slotProps={{ paper: { sx: { borderRadius: "20px", maxWidth: 480, width: "100%" } } }}
        >
          <DialogTitle sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#0f172a", pt: 3, pb: 1 }}>
            Edit Draft
          </DialogTitle>
          <DialogContent>
            {editError && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }}>{editError}</Alert>
            )}
            <TextField
              fullWidth size="small" label="Post title" value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              sx={{ mb: 2, mt: 1 }}
            />
            <TextField
              fullWidth size="small" label="Post content" value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              multiline minRows={4}
              sx={{ mb: 2 }}
            />
            <Autocomplete
              fullWidth size="small" disableClearable
              options={POST_CATEGORIES}
              value={editCategory}
              onChange={(_e, newValue) => setEditCategory(newValue)}
              renderOption={(props, option) => {
                const { key, ...rest } = props;
                return (
                  <Box component="li" key={key} {...rest} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, bgcolor: POST_CATEGORY_COLORS[option].color }} />
                    {option}
                  </Box>
                );
              }}
              renderInput={(params) => <TextField {...params} label="Category" />}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button
              onClick={() => setEditJob(null)} disabled={editLoading}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", color: "#64748b" }}
            >
              Cancel
            </Button>
            <Button
              variant="contained" onClick={() => void handleSaveEdit()}
              disabled={editLoading || editTitle.trim().length === 0 || editContent.trim().length === 0}
              startIcon={editLoading ? <CircularProgress size={15} color="inherit" /> : null}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none" }}
            >
              {editLoading ? "Saving…" : "Save changes"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Cancel post confirm dialog ── */}
        <Dialog
          open={!!cancelJobId}
          onClose={() => !actionLoading && setCancelJobId(null)}
          slotProps={{ paper: { sx: { borderRadius: "20px", maxWidth: 420 } } }}
        >
          <DialogTitle sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#dc2626", pt: 3, pb: 1 }}>
            Cancel This Post?
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ fontSize: 13, color: "#64748b", mb: 2 }}>
              This withdraws the request — it will never be published, and any active subscribers
              stop being billed for it.
            </DialogContentText>
            {cancelJob && (
              <Box sx={{ p: 2, borderRadius: "14px", bgcolor: "#fff1f2", border: "1px solid #fecaca" }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {cancelJob.title}
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button
              onClick={() => setCancelJobId(null)} disabled={actionLoading}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", color: "#64748b" }}
            >
              Keep Post
            </Button>
            <Button
              variant="contained" color="error" onClick={() => void handleCancelJob()} disabled={actionLoading}
              startIcon={actionLoading ? <CircularProgress size={15} color="inherit" /> : null}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none" }}
            >
              {actionLoading ? "Cancelling…" : "Yes, Cancel"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Delete draft confirm dialog ── */}
        <Dialog
          open={deleteConfirmId !== null}
          onClose={() => !deletingDraftId && setDeleteConfirmId(null)}
          slotProps={{ paper: { sx: { borderRadius: "20px", maxWidth: 420 } } }}
        >
          <DialogTitle sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#dc2626", pt: 3, pb: 1 }}>
            Delete This Draft?
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ fontSize: 13, color: "#64748b", mb: 2 }}>
              This permanently removes the draft. This action cannot be undone.
            </DialogContentText>
            {deleteConfirmDraft && (
              <Box sx={{ p: 2, borderRadius: "14px", bgcolor: "#fff1f2", border: "1px solid #fecaca" }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {deleteConfirmDraft.title}
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button
              onClick={() => setDeleteConfirmId(null)} disabled={deletingDraftId !== null}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", color: "#64748b" }}
            >
              Keep Draft
            </Button>
            <Button
              variant="contained" color="error" onClick={() => void handleDeleteDraft()} disabled={deletingDraftId !== null}
              startIcon={deletingDraftId !== null ? <CircularProgress size={15} color="inherit" /> : null}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none" }}
            >
              {deletingDraftId !== null ? "Deleting…" : "Yes, Delete"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── View full post dialog ── */}
        <Dialog
          open={!!detailView}
          onClose={() => setDetailView(null)}
          maxWidth="sm"
          fullWidth
          slotProps={{ paper: { sx: { borderRadius: "20px" } } }}
        >
          <DialogTitle sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#0f172a", pt: 3, pb: 1 }}>
            {detailView?.title}
          </DialogTitle>
          <DialogContent>
            {!!detailView?.meta.length && (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
                {detailView.meta.map((m) => (
                  <Chip
                    key={m.label}
                    label={m.label}
                    size="small"
                    sx={{ fontWeight: 600, bgcolor: m.bg, color: m.color }}
                  />
                ))}
              </Box>
            )}
            <Typography sx={{ whiteSpace: "pre-wrap", color: "#334155", fontSize: 14, lineHeight: 1.6 }}>
              {detailView?.content}
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button
              onClick={() => setDetailView(null)}
              sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", color: "#64748b" }}
            >
              Close
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

export default MyPosts;
