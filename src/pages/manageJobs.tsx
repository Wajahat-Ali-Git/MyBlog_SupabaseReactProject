import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ScheduleIcon from "@mui/icons-material/Schedule";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import CancelIcon from "@mui/icons-material/Cancel";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import RepeatIcon from "@mui/icons-material/Repeat";
import LooksOneIcon from "@mui/icons-material/LooksOne";
import PeopleIcon from "@mui/icons-material/People";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import EditIcon from "@mui/icons-material/Edit";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbDownOutlinedIcon from "@mui/icons-material/ThumbDownOutlined";

import {
  getJobRuns,
  getAllSubscriptions,
  getAllCharges,
  approveJob,
  rejectJob,
  setJobStatus,
  updateJobInterval,
  type ScheduledJob,
  type ScheduledJobRun,
  type JobSubscription,
  type JobCharge,
  type JobStatus,
} from "../services/scheduledJobsService";
import { useAdminJobNotifications } from "../hooks/useAdminJobNotifications";

// ─── Styles (matching manageWallet / adminHome blue-white palette) ────────────

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
};

const fmt = (n: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);

const fmtDate = (v: string) => new Date(v).toLocaleString();

const shortId = (id: string) => id.slice(0, 8) + "…";

// ─── Status chips ─────────────────────────────────────────────────────────────

function JobStatusChip({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; bg: string; color: string; border: string }> = {
    PENDING_APPROVAL: { label: "Pending approval", bg: "#fef9c3", color: "#854d0e", border: "#fde68a" },
    ACTIVE:    { label: "Active",    bg: "#dcfce7", color: "#166534", border: "#bbf7d0" },
    PAUSED:    { label: "Paused",    bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
    CANCELLED: { label: "Cancelled", bg: "#fee2e2", color: "#991b1b", border: "#fecaca" },
    COMPLETED: { label: "Completed", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    REJECTED:  { label: "Rejected",  bg: "#fee2e2", color: "#991b1b", border: "#fecaca" },
  };
  const s = map[status] ?? map.CANCELLED;
  return (
    <Chip
      label={s.label}
      size="small"
      sx={{ fontWeight: 700, bgcolor: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    />
  );
}

function RunStatusChip({ status }: { status: "PUBLISHED" | "FAILED" }) {
  return status === "PUBLISHED" ? (
    <Chip
      icon={<CheckCircleOutlinedIcon sx={{ fontSize: 13 }} />}
      label="Published"
      size="small"
      sx={{ fontWeight: 600, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }}
    />
  ) : (
    <Chip
      icon={<ErrorOutlinedIcon sx={{ fontSize: 13 }} />}
      label="Failed"
      size="small"
      sx={{ fontWeight: 600, bgcolor: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}
    />
  );
}

function SubStatusChip({ status }: { status: JobSubscription["status"] }) {
  if (status === "ACTIVE")
    return <Chip label="Active" size="small" sx={{ fontWeight: 600, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }} />;
  if (status === "CANCELLED")
    return <Chip label="Cancelled" size="small" sx={{ fontWeight: 600, bgcolor: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }} />;
  return <Chip label="Payment failed" size="small" sx={{ fontWeight: 600, bgcolor: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }} />;
}

// ─── Interval label ───────────────────────────────────────────────────────────

function intervalLabel(mins: number | null): string {
  if (mins === null) return "One-time";
  if (mins < 60) return `Every ${mins} min`;
  if (mins < 1440) return `Every ${mins / 60}h`;
  return `Every ${mins / 1440}d`;
}

// ─── Run history expandable row ───────────────────────────────────────────────

function JobRunHistory({ jobId }: { jobId: string }) {
  const [runs, setRuns] = useState<ScheduledJobRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        setRuns(await getJobRuns(jobId));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [jobId]);

  if (loading)
    return <Box sx={{ py: 1, textAlign: "center" }}><CircularProgress size={20} /></Box>;

  if (runs.length === 0)
    return <Typography sx={{ fontSize: 13, color: "#94a3b8", py: 1 }}>No runs yet.</Typography>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
      {runs.map((r) => (
        <Box
          key={r.id}
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 1,
            borderRadius: "10px",
            bgcolor: "#ffffff",
            border: "1px solid rgba(59,130,246,0.1)",
          }}
        >
          <RunStatusChip status={r.status} />
          <Typography sx={{ fontSize: 12, color: "#64748b" }}>{fmtDate(r.ran_at)}</Typography>
          {r.post_id && (
            <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>Post #{r.post_id}</Typography>
          )}
          {r.error && (
            <Typography sx={{ fontSize: 11, color: "#dc2626", flex: 1 }}>{r.error}</Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

// ─── Inline interval editor ───────────────────────────────────────────────────

function IntervalEditor({
  jobId,
  current,
  onSaved,
}: {
  jobId: string;
  current: number;
  onSaved: (newVal: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1) { setError("Must be ≥ 1 minute"); return; }
    setLoading(true);
    setError(null);
    try {
      await updateJobInterval(jobId, n);
      onSaved(n);
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update interval");
    } finally {
      setLoading(false);
    }
  };

  if (!open)
    return (
      <Tooltip title="Edit interval">
        <IconButton size="small" onClick={() => setOpen(true)} sx={{ color: "#2563eb" }}>
          <EditIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    );

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <TextField
        size="small"
        type="number"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        error={!!error}
        helperText={error}
        slotProps={{ htmlInput: { min: 1 } }}
        sx={{ width: 100, "& .MuiOutlinedInput-root": { borderRadius: "10px", fontSize: 13 } }}
      />
      <Button
        size="small"
        variant="contained"
        disabled={loading}
        onClick={() => void handleSave()}
        sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12 }}
      >
        {loading ? <CircularProgress size={14} color="inherit" /> : "Save"}
      </Button>
      <Button
        size="small"
        onClick={() => { setOpen(false); setError(null); setValue(String(current)); }}
        sx={{ color: "#64748b", textTransform: "none", fontSize: 12 }}
      >
        Cancel
      </Button>
    </Box>
  );
}

// ─── Jobs tab ─────────────────────────────────────────────────────────────────

function JobsTab({
  jobs,
  loading,
  onStatusChange,
  onIntervalChange,
  onToast,
}: {
  jobs: ScheduledJob[];
  loading: boolean;
  onStatusChange: (jobId: string, status: "ACTIVE" | "PAUSED" | "CANCELLED") => void;
  onIntervalChange: (jobId: string, newInterval: number) => void;
  onToast: (msg: string, severity: "success" | "error") => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const handleStatus = async (job: ScheduledJob, status: "ACTIVE" | "PAUSED" | "CANCELLED") => {
    setActingId(job.id);
    try {
      await setJobStatus(job.id, status);
      onStatusChange(job.id, status);
      onToast(`Job ${status.toLowerCase()} successfully.`, "success");
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Action failed.", "error");
    } finally {
      setActingId(null);
    }
  };

  if (loading)
    return <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={28} /></Box>;

  if (jobs.length === 0)
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <ScheduleIcon sx={{ fontSize: 48, color: "#cbd5e1", mb: 1 }} />
        <Typography sx={{ color: "#94a3b8", fontSize: 14 }}>No active jobs yet. Jobs appear here once user requests are approved.</Typography>
      </Box>
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {jobs.map((job) => {
        const isExpanded = expanded === job.id;
        const isActing = actingId === job.id;
        const isRecurring = job.interval_minutes !== null;

        return (
          <Box key={job.id} sx={rowSx}>
            {/* ── Header row ── */}
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1.5, mb: 1 }}>
              {/* Left: title + meta */}
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
                  {job.subscription_fee > 0 && (
                    <Chip
                      icon={<AttachMoneyIcon sx={{ fontSize: 12 }} />}
                      label={fmt(job.subscription_fee)}
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
                    Next run: <strong>{fmtDate(job.next_run_at)}</strong>
                  </Typography>
                  {job.last_run_at && (
                    <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                      Last run: {fmtDate(job.last_run_at)}
                    </Typography>
                  )}
                  {isRecurring && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                        Interval: <strong>{intervalLabel(job.interval_minutes)}</strong>
                      </Typography>
                      {(job.status === "ACTIVE" || job.status === "PAUSED") && (
                        <IntervalEditor
                          jobId={job.id}
                          current={job.interval_minutes!}
                          onSaved={(v) => onIntervalChange(job.id, v)}
                        />
                      )}
                    </Box>
                  )}
                  {job.ends_at && (
                    <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                      Ends: {fmtDate(job.ends_at)}
                    </Typography>
                  )}
                </Box>

                <Typography sx={{ fontSize: 12, color: "#94a3b8", mt: 0.5 }}>
                  User {shortId(job.user_id)} · Created {fmtDate(job.created_at)}
                </Typography>
              </Box>

              {/* Right: action buttons */}
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                {job.status === "ACTIVE" && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isActing}
                    onClick={() => void handleStatus(job, "PAUSED")}
                    startIcon={isActing ? <CircularProgress size={13} color="inherit" /> : <PauseIcon fontSize="small" />}
                    sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12, borderColor: "#fde68a", color: "#92400e", bgcolor: "#fffbeb", "&:hover": { bgcolor: "#fef3c7" } }}
                  >
                    Pause
                  </Button>
                )}
                {job.status === "PAUSED" && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isActing}
                    onClick={() => void handleStatus(job, "ACTIVE")}
                    startIcon={isActing ? <CircularProgress size={13} color="inherit" /> : <PlayArrowIcon fontSize="small" />}
                    sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12, borderColor: "#bbf7d0", color: "#166534", bgcolor: "#f0fdf4", "&:hover": { bgcolor: "#dcfce7" } }}
                  >
                    Resume
                  </Button>
                )}
                {(job.status === "ACTIVE" || job.status === "PAUSED") && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isActing}
                    onClick={() => void handleStatus(job, "CANCELLED")}
                    startIcon={isActing ? <CircularProgress size={13} color="inherit" /> : <CancelIcon fontSize="small" />}
                    sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12, borderColor: "#fecaca", color: "#991b1b", bgcolor: "#fff5f5", "&:hover": { bgcolor: "#fee2e2" } }}
                  >
                    Cancel
                  </Button>
                )}
                <IconButton
                  size="small"
                  onClick={() => setExpanded(isExpanded ? null : job.id)}
                  sx={{ color: "#2563eb" }}
                  aria-label={isExpanded ? "Collapse run history" : "Expand run history"}
                >
                  {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Box>
            </Box>

            {/* Content preview */}
            <Typography
              sx={{ fontSize: 13, color: "#475569", mb: 1,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
            >
              {job.content}
            </Typography>

            {/* Expandable run history */}
            <Collapse in={isExpanded} unmountOnExit>
              <Divider sx={{ mb: 1.5 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#2563eb", mb: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Run history
              </Typography>
              <JobRunHistory jobId={job.id} />
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Approval Queue tab ───────────────────────────────────────────────────────

function ApprovalQueueTab({
  jobs,
  loading,
  onApproved,
  onRejected,
  onToast,
}: {
  jobs: ScheduledJob[];
  loading: boolean;
  onApproved: (jobId: string) => void;
  onRejected: (jobId: string) => void;
  onToast: (msg: string, severity: "success" | "error") => void;
}) {
  const [actingId, setActingId] = useState<string | null>(null);

  const pendingJobs = jobs.filter((j) => j.status === "PENDING_APPROVAL");

  const handleApprove = async (job: ScheduledJob) => {
    setActingId(job.id);
    try {
      await approveJob(job.id);
      onApproved(job.id);
      onToast(`"${job.title}" approved and set to ACTIVE.`, "success");
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Approval failed.", "error");
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (job: ScheduledJob) => {
    setActingId(job.id);
    try {
      await rejectJob(job.id);
      onRejected(job.id);
      onToast(`"${job.title}" rejected.`, "success");
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Rejection failed.", "error");
    } finally {
      setActingId(null);
    }
  };

  if (loading)
    return <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={28} /></Box>;

  if (pendingJobs.length === 0)
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <HourglassEmptyIcon sx={{ fontSize: 48, color: "#cbd5e1", mb: 1 }} />
        <Typography sx={{ fontWeight: 700, color: "#0f172a", mb: 0.5 }}>
          No pending requests
        </Typography>
        <Typography sx={{ color: "#94a3b8", fontSize: 13 }}>
          All caught up — new user requests will appear here for review.
        </Typography>
      </Box>
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {pendingJobs.map((job) => {
        const isActing   = actingId === job.id;
        const isRecurring = job.interval_minutes !== null;

        return (
          <Box
            key={job.id}
            sx={{
              ...rowSx,
              bgcolor: "#fffbeb",
              border: "1px solid #fde68a",
            }}
          >
            {/* Header row */}
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1.5, mb: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {/* Title + type chips */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.75 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                    {job.title}
                  </Typography>
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

                {/* Meta */}
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                    Scheduled: <strong>{fmtDate(job.next_run_at)}</strong>
                  </Typography>
                  {isRecurring && (
                    <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                      Interval: <strong>{intervalLabel(job.interval_minutes)}</strong>
                    </Typography>
                  )}
                  {job.ends_at && (
                    <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                      Ends: {fmtDate(job.ends_at)}
                    </Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 12, color: "#94a3b8", mt: 0.25 }}>
                  Requested by user&nbsp;
                  <Box component="span" sx={{ fontFamily: "monospace" }}>{shortId(job.user_id)}</Box>
                  &nbsp;· {fmtDate(job.created_at)}
                </Typography>
              </Box>

              {/* Approve / Reject */}
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexShrink: 0 }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={isActing}
                  onClick={() => void handleApprove(job)}
                  startIcon={isActing ? <CircularProgress size={13} color="inherit" /> : <ThumbUpOutlinedIcon fontSize="small" />}
                  sx={{
                    borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12,
                    bgcolor: "#16a34a", "&:hover": { bgcolor: "#15803d" },
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={isActing}
                  onClick={() => void handleReject(job)}
                  startIcon={isActing ? <CircularProgress size={13} color="inherit" /> : <ThumbDownOutlinedIcon fontSize="small" />}
                  sx={{
                    borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12,
                    borderColor: "#fecaca", color: "#991b1b", bgcolor: "#fff5f5",
                    "&:hover": { bgcolor: "#fee2e2" },
                  }}
                >
                  Reject
                </Button>
              </Box>
            </Box>

            {/* Content preview */}
            <Box sx={{ p: 1.5, borderRadius: "10px", bgcolor: "#ffffff", border: "1px solid rgba(59,130,246,0.1)" }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748b", mb: 0.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Post content preview
              </Typography>
              <Typography
                sx={{
                  fontSize: 13, color: "#475569",
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                }}
              >
                {job.content}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Subscriptions tab ────────────────────────────────────────────────────────

function SubscriptionsTab({
  subscriptions,
  loading,
}: {
  subscriptions: JobSubscription[];
  loading: boolean;
}) {
  if (loading)
    return <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={28} /></Box>;

  if (subscriptions.length === 0)
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <PeopleIcon sx={{ fontSize: 48, color: "#cbd5e1", mb: 1 }} />
        <Typography sx={{ color: "#94a3b8", fontSize: 14 }}>No subscriptions yet.</Typography>
      </Box>
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {subscriptions.map((sub) => (
        <Box key={sub.id} sx={rowSx}>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <SubStatusChip status={sub.status} />
                {sub.consecutive_failures > 0 && (
                  <Chip
                    label={`${sub.consecutive_failures} failure${sub.consecutive_failures > 1 ? "s" : ""}`}
                    size="small"
                    sx={{ fontWeight: 600, bgcolor: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}
                  />
                )}
              </Box>
              <Typography sx={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>
                User {shortId(sub.user_id)}
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                Job {shortId(sub.job_id)}
              </Typography>
            </Box>

            <Box sx={{ textAlign: "right" }}>
              <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                Next charge: <strong>{fmtDate(sub.next_charge_at)}</strong>
              </Typography>
              {sub.last_charged_at && (
                <Typography sx={{ fontSize: 12, color: "#94a3b8" }}>
                  Last charged: {fmtDate(sub.last_charged_at)}
                </Typography>
              )}
              <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>
                Subscribed {fmtDate(sub.subscribed_at)}
              </Typography>
              {sub.cancelled_at && (
                <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>
                  Cancelled {fmtDate(sub.cancelled_at)}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ─── Charges tab ──────────────────────────────────────────────────────────────

function ChargesTab({
  charges,
  loading,
}: {
  charges: JobCharge[];
  loading: boolean;
}) {
  if (loading)
    return <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={28} /></Box>;

  if (charges.length === 0)
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <ReceiptLongIcon sx={{ fontSize: 48, color: "#cbd5e1", mb: 1 }} />
        <Typography sx={{ color: "#94a3b8", fontSize: 14 }}>No billing charges yet.</Typography>
      </Box>
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {charges.map((charge) => {
        const isSuccess = charge.status === "SUCCESS";
        return (
          <Box
            key={charge.id}
            sx={{
              ...rowSx,
              border: `1px solid ${isSuccess ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
            }}
          >
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box
                  sx={{
                    width: 36, height: 36, borderRadius: "10px", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    bgcolor: isSuccess ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                    border: `1px solid ${isSuccess ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                  }}
                >
                  {isSuccess
                    ? <CheckCircleOutlinedIcon sx={{ color: "#16a34a", fontSize: 18 }} />
                    : <ErrorOutlinedIcon sx={{ color: "#dc2626", fontSize: 18 }} />}
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 15, color: isSuccess ? "#16a34a" : "#dc2626", fontFamily: "monospace" }}>
                    {isSuccess ? "+" : "−"}{fmt(charge.amount)}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>
                    Sub {shortId(charge.subscription_id)}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ textAlign: "right" }}>
                <Chip
                  label={isSuccess ? "Success" : "Failed"}
                  size="small"
                  sx={{
                    fontWeight: 700, mb: 0.5,
                    bgcolor: isSuccess ? "#dcfce7" : "#fee2e2",
                    color: isSuccess ? "#166534" : "#991b1b",
                    border: `1px solid ${isSuccess ? "#bbf7d0" : "#fecaca"}`,
                  }}
                />
                <Typography sx={{ fontSize: 12, color: "#64748b", display: "block" }}>
                  {fmtDate(charge.charged_at)}
                </Typography>
                {charge.wallet_transaction_id && (
                  <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>
                    Tx {shortId(charge.wallet_transaction_id)}
                  </Typography>
                )}
              </Box>
            </Box>
            {charge.error && (
              <Typography sx={{ fontSize: 12, color: "#dc2626", mt: 1, px: 0.5 }}>
                {charge.error}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

const TAB_JOBS     = 0;
const TAB_APPROVAL = 1;
const TAB_SUBS     = 2;
const TAB_CHARGES  = 3;

const ManageJobs = () => {
  const navigate = useNavigate();

  const [tab, setTab] = useState(TAB_JOBS);

  const [subscriptions, setSubscriptions] = useState<JobSubscription[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  const [charges, setCharges] = useState<JobCharge[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  const [toast, setToast] = useState<{
    message: string;
    severity: "success" | "error" | "info";
  } | null>(null);

  // Live jobs list — kept in sync via realtime (new requests, approvals,
  // status changes) instead of a one-shot fetch that only updates on reload.
  const { jobs, loading: jobsLoading } = useAdminJobNotifications({
    isAdmin: true,
    onNewRequest: () =>
      setToast({ message: "New scheduled job request awaiting approval.", severity: "info" }),
  });

  // ── Stats derived from loaded data ─────────────────────────────────────────

  const pendingCount = jobs.filter((j) => j.status === "PENDING_APPROVAL").length;
  const activeCount  = jobs.filter((j) => j.status === "ACTIVE").length;
  const pausedCount  = jobs.filter((j) => j.status === "PAUSED").length;
  const activeSubs   = subscriptions.filter((s) => s.status === "ACTIVE").length;
  const failedSubs   = subscriptions.filter((s) => s.status === "CANCELLED_PAYMENT_FAILED").length;

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadSubs = useCallback(async () => {
    setSubsLoading(true);
    try {
      setSubscriptions(await getAllSubscriptions());
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to load subscriptions.", severity: "error" });
    } finally {
      setSubsLoading(false);
    }
  }, []);

  const loadCharges = useCallback(async () => {
    setChargesLoading(true);
    try {
      setCharges(await getAllCharges());
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to load charges.", severity: "error" });
    } finally {
      setChargesLoading(false);
    }
  }, []);

  // Track whether we've attempted to load each tab (prevents re-loading on every dependency change)
  const subsLoadedRef = useRef(false);
  const chargesLoadedRef = useRef(false);

  // Lazy-load subscriptions and charges on first visit to those tabs
  useEffect(() => {
    if (tab !== TAB_SUBS || subsLoadedRef.current) return;
    subsLoadedRef.current = true;
    const run = async () => { await loadSubs(); };
    void run();
  }, [tab, loadSubs]);

  useEffect(() => {
    if (tab !== TAB_CHARGES || chargesLoadedRef.current) return;
    chargesLoadedRef.current = true;
    const run = async () => { await loadCharges(); };
    void run();
  }, [tab, loadCharges]);

  // ── Post-action side effects ─────────────────────────────────────────────────
  // jobs now comes live from useAdminJobNotifications (realtime), so these no
  // longer need to hand-mutate local state — the child already fired its own
  // onToast for status/approve/reject (see JobsTab/ApprovalQueueTab). Interval
  // changes are the one case IntervalEditor doesn't toast itself, so that one
  // stays.

  const handleStatusChange = () => {};

  const handleIntervalChange = () => {
    setToast({ message: "Interval updated. Takes effect on the next tick.", severity: "success" });
  };

  const handleApproved = () => {};

  const handleRejected = () => {};

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box sx={pageBg}>
      <Container maxWidth="md" disableGutters sx={{ px: { xs: 2, sm: 3, md: 0 } }}>

        {/* Back button */}
        <Button
          onClick={() => navigate("/admin")}
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 2, fontWeight: 600, color: "#2563eb", textTransform: "none" }}
        >
          Back to Admin Dashboard
        </Button>

        {/* Page header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <ScheduleIcon sx={{ color: "#3A7FF1", fontSize: { xs: 30, sm: 36 } }} />
          <Box sx={{ flex: 1 }}>
            <Typography
              sx={{ fontWeight: 800, fontSize: { xs: "1.5rem", sm: "1.8rem" }, color: "#0f172a", lineHeight: 1.2 }}
            >
              Scheduled Jobs
            </Typography>
            <Typography sx={{ fontSize: 12, color: "rgba(15,23,42,0.65)" }}>
              Review user requests, manage active jobs, and monitor subscription billing
            </Typography>
          </Box>
        </Box>

        {/* ── Stats strip ── */}
        {!jobsLoading && (
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
            {[
              { label: "Pending review", value: pendingCount, color: "#854d0e",  bg: "#fef9c3", border: "#fde68a" },
              { label: "Active",         value: activeCount,  color: "#16a34a",  bg: "#dcfce7", border: "#bbf7d0" },
              { label: "Paused",         value: pausedCount,  color: "#d97706",  bg: "#fef3c7", border: "#fde68a" },
              { label: "Total jobs",     value: jobs.length,  color: "#2563eb",  bg: "#eff6ff", border: "#bfdbfe" },
              { label: "Subscribers",    value: activeSubs,   color: "#7c3aed",  bg: "#f3e8ff", border: "#e9d5ff" },
              { label: "Pay failures",   value: failedSubs,   color: "#dc2626",  bg: "#fee2e2", border: "#fecaca" },
            ].map(({ label, value, color, bg, border }) => (
              <Paper
                key={label}
                elevation={0}
                sx={{
                  flex: "1 1 72px",
                  p: 1.5,
                  borderRadius: "14px",
                  bgcolor: value > 0 ? bg : "#ffffff",
                  border: `1px solid ${value > 0 ? border : "rgba(59,130,246,0.15)"}`,
                  textAlign: "center",
                  cursor: label === "Pending review" && value > 0 ? "pointer" : "default",
                }}
                onClick={() => { if (label === "Pending review" && value > 0) setTab(TAB_APPROVAL); }}
              >
                <Typography sx={{ fontSize: "1.4rem", fontWeight: 800, color: value > 0 ? color : "#94a3b8", lineHeight: 1 }}>
                  {value}
                </Typography>
                <Typography sx={{ fontSize: 11, color: "#64748b", mt: 0.25 }}>{label}</Typography>
              </Paper>
            ))}
          </Box>
        )}

        {/* Pending approval alert banner */}
        {pendingCount > 0 && (
          <Alert
            severity="warning"
            icon={<HourglassEmptyIcon fontSize="small" />}
            action={
              <Button
                size="small"
                onClick={() => setTab(TAB_APPROVAL)}
                sx={{ fontWeight: 700, color: "#92400e", textTransform: "none", whiteSpace: "nowrap" }}
              >
                Review now
              </Button>
            }
            sx={{ mb: 2, borderRadius: "12px", bgcolor: "#fffbeb", border: "1px solid #fde68a" }}
          >
            <strong>{pendingCount} job request{pendingCount > 1 ? "s" : ""}</strong> awaiting your approval.
          </Alert>
        )}

        {/* ── Main card with tabs ── */}
        <Paper elevation={0} sx={cardSx}>
          <Tabs
            value={tab}
            onChange={(_, v: number) => setTab(v)}
            textColor="primary"
            indicatorColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 2, "& .MuiTab-root": { fontWeight: 600, textTransform: "none", minHeight: 40 } }}
          >
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <ScheduleIcon sx={{ fontSize: 16 }} />
                  Jobs ({jobs.filter((j) => j.status !== "PENDING_APPROVAL").length})
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <HourglassEmptyIcon sx={{ fontSize: 16 }} />
                  Approval Queue
                  {pendingCount > 0 && (
                    <Chip
                      label={pendingCount}
                      size="small"
                      sx={{ height: 16, fontSize: 10, fontWeight: 700, bgcolor: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a", ml: 0.25 }}
                    />
                  )}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <PeopleIcon sx={{ fontSize: 16 }} />
                  Subscriptions
                  {subsLoading ? null : activeSubs > 0 && (
                    <Chip label={activeSubs} size="small" sx={{ height: 16, fontSize: 10, fontWeight: 700, bgcolor: "#f3e8ff", color: "#7c3aed", ml: 0.25 }} />
                  )}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <ReceiptLongIcon sx={{ fontSize: 16 }} />
                  Charges
                </Box>
              }
            />
          </Tabs>

          {tab === TAB_JOBS && (
            <JobsTab
              jobs={jobs.filter((j) => j.status !== "PENDING_APPROVAL")}
              loading={jobsLoading}
              onStatusChange={handleStatusChange}
              onIntervalChange={handleIntervalChange}
              onToast={(msg, sev) => setToast({ message: msg, severity: sev })}
            />
          )}

          {tab === TAB_APPROVAL && (
            <ApprovalQueueTab
              jobs={jobs}
              loading={jobsLoading}
              onApproved={handleApproved}
              onRejected={handleRejected}
              onToast={(msg, sev) => setToast({ message: msg, severity: sev })}
            />
          )}

          {tab === TAB_SUBS && (
            <SubscriptionsTab
              subscriptions={subscriptions}
              loading={subsLoading}
            />
          )}

          {tab === TAB_CHARGES && (
            <ChargesTab
              charges={charges}
              loading={chargesLoading}
            />
          )}
        </Paper>
      </Container>

      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
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

export default ManageJobs;
