import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import EventNoteIcon from "@mui/icons-material/EventNote";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

import {
  getCronJobs,
  getCronJobRuns,
  setCronJobActive,
  runCronJobNow,
  type CronJobSummary,
  type CronJobRun,
  type CronRunStatus,
  type CronRunSource,
  type CronRunDetailItem,
} from "../services/cronJobsService";
import { getErrorMessage } from "../utils/errors";

// ─── Styles (matching manageJobs / manageWallet blue-white palette) ──────────

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

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

// One line per affected post/subscriber/owner, for the "show full detail"
// expansion in run history — see CronRunDetailItem for why the shape
// varies by job type.
const formatDetailItem = (item: CronRunDetailItem): string => {
  const who = item.user ?? item.subscriber ?? item.owner ?? "unknown user";

  if (item.post_id !== undefined) {
    const post = item.title ? `"${item.title}" (#${item.post_id ?? "—"})` : `post #${item.post_id ?? "—"}`;
    return item.status === "SUCCESS"
      ? `${who} — ${post} published`
      : `${who} — publish failed${item.error ? `: ${item.error}` : ""}`;
  }

  const amount = item.amount !== undefined ? fmtCurrency(item.amount) : "";
  const job = item.job_title ? ` ("${item.job_title}")` : "";
  return item.status === "SUCCESS"
    ? `${who} — ${amount} charged${job}`
    : `${who} — charge failed${job}${item.error ? `: ${item.error}` : ""}`;
};

const durationLabel = (start: string | null, end: string | null) => {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

// Short "N minutes/hours/days ago" — lets an admin gauge freshness at a
// glance without doing timestamp math against the absolute date next to it.
const timeAgo = (v: string | null) => {
  if (!v) return null;
  const ms = Date.now() - new Date(v).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};

// Forward-looking counterpart to timeAgo, for the "Upcoming Runs" panel.
const timeUntil = (d: Date) => {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "due now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h`;
  const day = Math.floor(hr / 24);
  return `in ${day}d`;
};

// Translates the small set of cron expressions this codebase actually
// schedules (every-N-minutes, or once daily) into plain English. Falls back
// to the raw expression for anything else rather than guessing.
const describeCronSchedule = (expr: string): string | null => {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;

  if (min === "*" && hour === "*") return "Every minute";

  const everyNMin = /^\*\/(\d+)$/.exec(min);
  if (everyNMin && hour === "*") return `Every ${everyNMin[1]} minutes`;

  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Daily at ${h12}:${String(m).padStart(2, "0")} ${period} (UTC)`;
  }

  return null;
};

// Computes the next real occurrence for the same small set of schedule
// shapes describeCronSchedule understands — powers the "Upcoming Runs"
// panel. Returns null for anything more complex rather than guessing.
const nextOccurrence = (expr: string, from: Date = new Date()): Date | null => {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;

  if (min === "*" && hour === "*") {
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next;
  }

  const everyNMin = /^\*\/(\d+)$/.exec(min);
  if (everyNMin && hour === "*") {
    const n = parseInt(everyNMin[1], 10);
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(Math.ceil((next.getMinutes() + 1) / n) * n);
    return next;
  }

  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, m, 0, 0));
    if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  return null;
};

// Human-readable label + description for the known jobs registered by the
// scheduled_jobs migrations. Falls back to the raw jobname for anything else
// registered later so this page never hides an unrecognized job.
const JOB_LABELS: Record<string, { label: string; description: string }> = {
  "scheduled-jobs-publish": {
    label: "Scheduled Post Publisher",
    description: "Publishes due one-time and recurring posts, charging the platform fee if one applies.",
  },
  "job-subscriptions-charge": {
    label: "Subscription Billing",
    description: "Charges subscribers of recurring jobs whose billing cycle is due.",
  },
  "scheduled-jobs-annual-fee": {
    label: "Annual Fee Billing",
    description: "Charges recurring-post owners their yearly platform fee when due.",
  },
  "cron-job-run-details-cleanup": {
    label: "Run-History Cleanup",
    description: "Prunes cron run-history older than 14 days so this page stays fast.",
  },
};

// What a run's item count actually means, per job — used instead of a
// generic "N item(s) processed" so the admin knows what happened without
// having to know the underlying schema.
const resultLabel = (jobname: string, count: number): string => {
  const n = count;
  switch (jobname) {
    case "scheduled-jobs-publish":
      return `${n} post${n === 1 ? "" : "s"} published`;
    case "job-subscriptions-charge":
      return `${n} subscriber${n === 1 ? "" : "s"} charged`;
    case "scheduled-jobs-annual-fee":
      return `${n} owner${n === 1 ? "" : "s"} charged the annual fee`;
    default:
      return `${n} item${n === 1 ? "" : "s"} processed`;
  }
};

// What to say when a run legitimately found nothing to do — distinct from
// "no data available" (an untracked job type, or a run that hasn't
// happened yet), which is handled separately.
const NO_ITEMS_LABEL: Record<string, string> = {
  "scheduled-jobs-publish": "No posts were due to publish",
  "job-subscriptions-charge": "No subscriptions were due to be charged",
  "scheduled-jobs-annual-fee": "No annual fees were due",
};

// The meaningful, job-specific log line for one run — "3 posts published",
// "No subscriptions were due to be charged", "2 owners charged, 1 failed" —
// built from the actual correlated items rather than pg_cron's raw
// return_message (typically just "1 row", which tells an admin nothing).
// Falls back to the raw message/error only when there's no item-level data
// to summarize: an untracked job type (the cleanup job), or a tick that
// failed outright before touching anything (gated on status, since a
// failed tick can still resolve to an empty items array via the same
// window correlation logic used for a normal empty run).
const buildRunSummary = (
  jobname: string,
  status: CronRunStatus | null,
  items: CronRunDetailItem[] | null,
  fallback: string | null,
): string | null => {
  if (items !== null && status !== "failed") {
    if (items.length === 0) return NO_ITEMS_LABEL[jobname] ?? "Nothing to process this run";
    const successCount = items.filter((i) => i.status === "SUCCESS").length;
    const failCount = items.length - successCount;
    const parts: string[] = [];
    if (successCount > 0) parts.push(resultLabel(jobname, successCount));
    if (failCount > 0) parts.push(`${failCount} item${failCount === 1 ? "" : "s"} failed`);
    return parts.join(", ");
  }
  return fallback;
};

// Plain-language hint for what a failure on this job usually means, shown
// under the raw error so a non-technical admin has a next step, not just a
// SQLERRM string.
const FAILURE_HINTS: Record<string, string> = {
  "scheduled-jobs-publish":
    "Usually means the post owner's wallet had insufficient balance for the platform fee — the post is saved as a draft instead of failing outright, so this is more likely an unexpected error.",
  "job-subscriptions-charge":
    "Usually means a subscriber's wallet has insufficient balance or is inactive. After 3 consecutive failures that subscription auto-cancels.",
  "scheduled-jobs-annual-fee":
    "Usually means the job owner's wallet has insufficient balance. After 3 consecutive failures the job auto-pauses until the admin resumes it.",
};

// Only the three money/publishing batch functions can be triggered manually
// (see admin_run_cron_job_now's whitelist) — the cleanup job is routine
// housekeeping an admin shouldn't need to force.
const RUNNABLE_JOBS = new Set([
  "scheduled-jobs-publish",
  "job-subscriptions-charge",
  "scheduled-jobs-annual-fee",
]);

type TabFilter = "all" | "enabled" | "disabled" | "failing" | "never";

function SourceChip({ source }: { source: CronRunSource }) {
  if (source === "manual")
    return (
      <Chip
        label="Manual"
        size="small"
        sx={{ fontWeight: 600, bgcolor: "#f3e8ff", color: "#7c3aed", border: "1px solid #e9d5ff" }}
      />
    );
  return null;
}

// ─── Status chips ─────────────────────────────────────────────────────────────

function CronRunStatusChip({ status }: { status: CronRunStatus | null }) {
  if (!status)
    return (
      <Chip
        icon={<HelpOutlineIcon sx={{ fontSize: 13 }} />}
        label="Never run"
        size="small"
        sx={{ fontWeight: 600, bgcolor: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}
      />
    );
  if (status === "succeeded")
    return (
      <Chip
        icon={<CheckCircleOutlinedIcon sx={{ fontSize: 13 }} />}
        label="Succeeded"
        size="small"
        sx={{ fontWeight: 600, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }}
      />
    );
  if (status === "failed")
    return (
      <Chip
        icon={<ErrorOutlinedIcon sx={{ fontSize: 13 }} />}
        label="Failed"
        size="small"
        sx={{ fontWeight: 600, bgcolor: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}
      />
    );
  return (
    <Chip
      icon={<HourglassEmptyIcon sx={{ fontSize: 13 }} />}
      label={status}
      size="small"
      sx={{ fontWeight: 600, bgcolor: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a" }}
    />
  );
}

// ─── Run history ──────────────────────────────────────────────────────────────

// The meaningful summary for one run row, plus whether it's a synthesized
// sentence (regular text) or pg_cron's own raw message (shown monospace,
// since it's effectively a log line rather than prose).
const runMessage = (r: CronJobRun, jobname: string): { text: string | null; isRaw: boolean } => {
  const synthesized = r.detail_items !== null && r.status !== "failed";
  return {
    text: buildRunSummary(jobname, r.status, r.detail_items, r.return_message),
    isRaw: !synthesized,
  };
};

function CronRunHistory({ jobname }: { jobname: string }) {
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunKey, setExpandedRunKey] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setRuns(await getCronJobRuns(jobname, 50));
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to load run history."));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [jobname]);

  if (loading)
    return <Box sx={{ py: 1, textAlign: "center" }}><CircularProgress size={20} /></Box>;

  if (error)
    return <Alert severity="error" sx={{ borderRadius: "10px" }}>{error}</Alert>;

  if (runs.length === 0)
    return <Typography sx={{ fontSize: 13, color: "#94a3b8", py: 1 }}>No runs recorded yet.</Typography>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {runs.map((r) => {
        const message = runMessage(r, jobname);
        const runKey = `${r.source}-${r.runid ?? r.start_time}`;
        const items = r.detail_items ?? [];
        const isExpanded = expandedRunKey === runKey;
        return (
          <Box
            key={runKey}
            sx={{
              borderRadius: "10px",
              bgcolor: "#f8fbff",
              border: "1px solid rgba(59,130,246,0.1)",
              overflow: "hidden",
            }}
          >
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, px: 2, py: 1 }}>
              <CronRunStatusChip status={r.status} />
              <SourceChip source={r.source} />
              <Typography sx={{ fontSize: 12, color: "#64748b" }}>
                {fmtDate(r.start_time)} <span style={{ color: "#94a3b8" }}>({timeAgo(r.start_time)})</span>
              </Typography>
              {durationLabel(r.start_time, r.end_time) && (
                <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>{durationLabel(r.start_time, r.end_time)}</Typography>
              )}
              {message.text && (
                <Typography
                  sx={{
                    fontSize: 11,
                    color: r.status === "failed" ? "#dc2626" : "#64748b",
                    flex: 1,
                    fontFamily: message.isRaw ? "monospace" : "inherit",
                  }}
                >
                  {message.text}
                </Typography>
              )}
              {items.length > 0 && (
                <Button
                  size="small"
                  onClick={() => setExpandedRunKey(isExpanded ? null : runKey)}
                  endIcon={isExpanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                  sx={{ fontSize: 11, textTransform: "none", color: "#2563eb", fontWeight: 700, py: 0, minWidth: 0, ml: "auto" }}
                >
                  {isExpanded ? "Hide" : "Show"} {items.length} detail{items.length === 1 ? "" : "s"}
                </Button>
              )}
            </Box>
            <Collapse in={isExpanded} unmountOnExit>
              <Box sx={{ px: 2, pb: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
                {items.map((item, i) => (
                  <Typography
                    key={i}
                    sx={{
                      fontSize: 11.5,
                      color: item.status === "FAILED" ? "#dc2626" : "#334155",
                      pl: 1,
                      borderLeft: `2px solid ${item.status === "FAILED" ? "#fecaca" : "#bbf7d0"}`,
                    }}
                  >
                    {formatDetailItem(item)}
                  </Typography>
                ))}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Job icon avatar (table cell + stat cards) ────────────────────────────────

function JobAvatar({ jobname, size = 40 }: { jobname: string; size?: number }) {
  const runnable = RUNNABLE_JOBS.has(jobname);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "12px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: runnable ? "rgba(37,99,235,0.1)" : "rgba(100,116,139,0.1)",
        color: runnable ? "#2563eb" : "#64748b",
      }}
    >
      <EventNoteIcon sx={{ fontSize: size * 0.5 }} />
    </Box>
  );
}

// ─── Job table row (main row + expandable run-history row) ────────────────────

function CronJobRow({
  job,
  expanded,
  onExpandToggle,
  onToggleActive,
  onRunNow,
  onToast,
}: {
  job: CronJobSummary;
  expanded: boolean;
  onExpandToggle: () => void;
  onToggleActive: (jobname: string, active: boolean) => Promise<void>;
  onRunNow: (jobname: string) => Promise<number>;
  onToast: (msg: string, severity: "success" | "error") => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const meta = JOB_LABELS[job.jobname];
  const isRunnable = RUNNABLE_JOBS.has(job.jobname);
  const lastRunSummary = buildRunSummary(job.jobname, job.last_run_status, job.last_run_detail_items, job.last_run_message);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggleActive(job.jobname, !job.active);
      onToast(`"${meta?.label ?? job.jobname}" ${job.active ? "paused" : "resumed"}.`, "success");
    } catch (err: unknown) {
      onToast(getErrorMessage(err, "Failed to update cron job."), "error");
    } finally {
      setToggling(false);
    }
  };

  const handleRunNow = async () => {
    setConfirmOpen(false);
    setRunning(true);
    try {
      const count = await onRunNow(job.jobname);
      onToast(`"${meta?.label ?? job.jobname}" ran successfully — ${resultLabel(job.jobname, count)}.`, "success");
    } catch (err: unknown) {
      onToast(getErrorMessage(err, "Manual run failed."), "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <TableRow hover sx={{ "& td": { borderBottom: expanded ? "none" : undefined } }}>
        <TableCell sx={{ maxWidth: 280 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <JobAvatar jobname={job.jobname} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                {meta?.label ?? job.jobname}
              </Typography>
              {meta?.description && (
                <Typography
                  sx={{
                    fontSize: 11.5, color: "#64748b",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220,
                  }}
                >
                  {meta.description}
                </Typography>
              )}
            </Box>
          </Box>
        </TableCell>

        <TableCell>
          <Tooltip title={`Raw cron expression: ${job.schedule}`}>
            <Typography sx={{ fontSize: 12.5, color: "#334155", fontWeight: 600 }}>
              {describeCronSchedule(job.schedule) ?? job.schedule}
            </Typography>
          </Tooltip>
        </TableCell>

        <TableCell sx={{ maxWidth: 220 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
            <CronRunStatusChip status={job.last_run_status} />
            {job.last_run_source && <SourceChip source={job.last_run_source} />}
          </Box>
          {job.last_run_started_at && (
            <Typography sx={{ fontSize: 11, color: "#94a3b8", mt: 0.5 }}>
              {timeAgo(job.last_run_started_at)}
            </Typography>
          )}
          {lastRunSummary && (
            <Tooltip title={lastRunSummary}>
              <Typography
                sx={{
                  fontSize: 11, mt: 0.25,
                  color: job.last_run_status === "failed" ? "#dc2626" : "#475569",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {lastRunSummary}
              </Typography>
            </Tooltip>
          )}
        </TableCell>

        <TableCell>
          <Typography sx={{ fontSize: 12.5, color: job.failures_last_24h > 0 ? "#dc2626" : "#334155", fontWeight: 600 }}>
            {job.runs_last_24h} run{job.runs_last_24h === 1 ? "" : "s"}
          </Typography>
          {job.failures_last_24h > 0 && (
            <Typography sx={{ fontSize: 11, color: "#dc2626" }}>{job.failures_last_24h} failed</Typography>
          )}
        </TableCell>

        <TableCell>
          <Chip
            label={job.active ? "Enabled" : "Disabled"}
            size="small"
            sx={{
              fontWeight: 600,
              bgcolor: job.active ? "#eff6ff" : "#f1f5f9",
              color: job.active ? "#1d4ed8" : "#475569",
              border: `1px solid ${job.active ? "#bfdbfe" : "#cbd5e1"}`,
            }}
          />
        </TableCell>

        <TableCell align="right">
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5 }}>
            {isRunnable && (
              <Tooltip title="Trigger this job immediately, outside its schedule">
                <span>
                  <IconButton
                    size="small"
                    disabled={running || !job.active}
                    onClick={() => setConfirmOpen(true)}
                    sx={{ color: "#2563eb" }}
                    aria-label="run now"
                  >
                    {running ? <CircularProgress size={16} color="inherit" /> : <PlayCircleIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title={job.active ? "Pause this cron job" : "Resume this cron job"}>
              <span>
                <Switch size="small" checked={job.active} disabled={toggling} onChange={() => void handleToggle()} />
              </span>
            </Tooltip>
            <IconButton size="small" onClick={onExpandToggle} sx={{ color: "#2563eb" }} aria-label={expanded ? "Collapse run history" : "Expand run history"}>
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Box>
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, borderBottom: expanded ? undefined : "none" }}>
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ py: 2 }}>
              {job.last_run_status === "failed" && job.last_run_message && (
                <Box sx={{ mb: 1.5, p: 1.5, borderRadius: "10px", bgcolor: "#fff5f5", border: "1px solid #fecaca" }}>
                  <Typography sx={{ fontSize: 12, color: "#dc2626", fontFamily: "monospace" }}>
                    Reason: {job.last_run_message}
                  </Typography>
                  {FAILURE_HINTS[job.jobname] && (
                    <Typography sx={{ fontSize: 11, color: "#94a3b8", mt: 0.5 }}>
                      {FAILURE_HINTS[job.jobname]}
                    </Typography>
                  )}
                </Box>
              )}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#2563eb", mb: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Run history
              </Typography>
              <CronRunHistory jobname={job.jobname} />
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Run "{meta?.label ?? job.jobname}" now?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {meta?.description ?? "This job."} It normally runs {describeCronSchedule(job.schedule)?.toLowerCase() ?? `on schedule "${job.schedule}"`},
            but this triggers it immediately instead. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button onClick={() => void handleRunNow()} variant="contained" sx={{ textTransform: "none", fontWeight: 700 }}>
            Run now
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  icon, label, subtitle, value, color, bg,
}: {
  icon: React.ReactNode; label: string; subtitle: string; value: number; color: string; bg: string;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        flex: "1 1 200px",
        p: 2,
        borderRadius: "16px",
        bgcolor: "#ffffff",
        border: "1px solid rgba(59,130,246,0.15)",
        display: "flex",
        alignItems: "flex-start",
        gap: 1.5,
      }}
    >
      <Box
        sx={{
          width: 44, height: 44, borderRadius: "12px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          bgcolor: bg, color,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#334155" }}>{label}</Typography>
        <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>{subtitle}</Typography>
      </Box>
    </Paper>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "enabled", label: "Enabled" },
  { key: "disabled", label: "Disabled" },
  { key: "failing", label: "Failing" },
  { key: "never", label: "Never Run" },
];

const CronJobs = () => {
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<CronJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await getCronJobs());
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load cron jobs."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    void loadJobs();
  }, [loadJobs]);

  const handleToggleActive = async (jobname: string, active: boolean) => {
    await setCronJobActive(jobname, active);
    await loadJobs();
  };

  const handleRunNow = async (jobname: string) => {
    const count = await runCronJobNow(jobname);
    await loadJobs();
    return count;
  };

  const totalJobs = jobs.length;
  const activeJobs = jobs.filter((j) => j.active).length;
  const disabledJobs = jobs.filter((j) => !j.active).length;
  const failingJobs = jobs.filter((j) => j.failures_last_24h > 0).length;
  const neverRun = jobs.filter((j) => j.last_run_status === null).length;

  const totalRuns24h = jobs.reduce((sum, j) => sum + j.runs_last_24h, 0);
  const totalFailures24h = jobs.reduce((sum, j) => sum + j.failures_last_24h, 0);
  const totalSuccess24h = totalRuns24h - totalFailures24h;

  const upcoming = useMemo(() => {
    const now = new Date();
    return jobs
      .filter((j) => j.active)
      .map((j) => ({ job: j, next: nextOccurrence(j.schedule, now) }))
      .filter((u): u is { job: CronJobSummary; next: Date } => u.next !== null)
      .sort((a, b) => a.next.getTime() - b.next.getTime())
      .slice(0, 5);
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (tab === "enabled") result = result.filter((j) => j.active);
    else if (tab === "disabled") result = result.filter((j) => !j.active);
    else if (tab === "failing") result = result.filter((j) => j.failures_last_24h > 0);
    else if (tab === "never") result = result.filter((j) => j.last_run_status === null);

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((j) => {
        const label = (JOB_LABELS[j.jobname]?.label ?? j.jobname).toLowerCase();
        const desc = (JOB_LABELS[j.jobname]?.description ?? "").toLowerCase();
        return label.includes(q) || desc.includes(q) || j.jobname.toLowerCase().includes(q);
      });
    }
    return result;
  }, [jobs, tab, search]);

  return (
    <Box sx={pageBg}>
      <Container maxWidth="xl" disableGutters sx={{ px: { xs: 2, sm: 3, md: 4 } }}>
        <Button
          onClick={() => navigate("/admin")}
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 2, fontWeight: 600, color: "#2563eb", textTransform: "none" }}
        >
          Back to Admin Dashboard
        </Button>

        {/* ── Header row ── */}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, mb: 3 }}>
          <MonitorHeartIcon sx={{ color: "#3A7FF1", fontSize: { xs: 30, sm: 36 } }} />
          <Box sx={{ flex: "1 1 260px" }}>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.5rem", sm: "1.8rem" }, color: "#0f172a", lineHeight: 1.2 }}>
              Cron Job Monitor
            </Typography>
            <Typography sx={{ fontSize: 12, color: "rgba(15,23,42,0.65)" }}>
              Whether each scheduled background job ran, when, and why it failed
            </Typography>
          </Box>
          <TextField
            size="small"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: "#94a3b8" }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: "100%", sm: 220 }, "& .MuiOutlinedInput-root": { borderRadius: "12px", bgcolor: "#ffffff" } }}
          />
          <Tooltip title="Refresh">
            <IconButton onClick={() => void loadJobs()} sx={{ color: "#2563eb" }} aria-label="refresh">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>

        {/* ── Stat cards ── */}
        {!loading && !error && (
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
            <StatCard
              icon={<EventNoteIcon />} label="Total Jobs" subtitle="Registered with pg_cron"
              value={totalJobs} color="#2563eb" bg="rgba(37,99,235,0.1)"
            />
            <StatCard
              icon={<PlayCircleIcon />} label="Enabled" subtitle="Running on schedule"
              value={activeJobs} color="#16a34a" bg="rgba(22,163,74,0.1)"
            />
            <StatCard
              icon={<PauseCircleIcon />} label="Disabled" subtitle="Temporarily paused"
              value={disabledJobs} color="#d97706" bg="rgba(217,119,6,0.1)"
            />
            <StatCard
              icon={<ErrorOutlinedIcon />} label="Failing (24h)" subtitle="Need attention"
              value={failingJobs} color="#dc2626" bg="rgba(220,38,38,0.1)"
            />
          </Box>
        )}

        {failingJobs > 0 && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: "12px", border: "1px solid #fecaca" }}>
            <strong>{failingJobs} job{failingJobs > 1 ? "s" : ""}</strong> had a failure in the last 24 hours. Expand a job below to see the reason for each failed run.
          </Alert>
        )}

        {/* ── Main content: table + sidebar ── */}
        <Box sx={{ display: "flex", gap: 2.5, alignItems: "flex-start", flexDirection: { xs: "column", lg: "row" } }}>
          {/* Main column */}
          <Paper elevation={0} sx={{ ...cardSx, flex: "1 1 0%", minWidth: 0, width: "100%" }}>
            <Tabs
              value={tab}
              onChange={(_, v: TabFilter) => setTab(v)}
              textColor="primary"
              indicatorColor="primary"
              variant="scrollable"
              scrollButtons="auto"
              sx={{ mb: 1.5, "& .MuiTab-root": { fontWeight: 600, textTransform: "none", minHeight: 40 } }}
            >
              {TABS.map((t) => (
                <Tab key={t.key} value={t.key} label={t.label} />
              ))}
            </Tabs>

            {loading && (
              <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={28} /></Box>
            )}

            {!loading && error && (
              <Alert severity="error" sx={{ borderRadius: "10px" }}>{error}</Alert>
            )}

            {!loading && !error && jobs.length === 0 && (
              <Box sx={{ textAlign: "center", py: 6 }}>
                <MonitorHeartIcon sx={{ fontSize: 48, color: "#cbd5e1", mb: 1 }} />
                <Typography sx={{ color: "#94a3b8", fontSize: 14 }}>
                  No cron jobs registered. Enable pg_cron and apply the scheduled-jobs migrations.
                </Typography>
              </Box>
            )}

            {!loading && !error && jobs.length > 0 && (
              <TableContainer sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: 720 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 12 }}>Job</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 12 }}>Schedule</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 12 }}>Last Run</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 12 }}>24h</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: "#64748b", fontSize: 12 }}>Status</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: "#64748b", fontSize: 12 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredJobs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography sx={{ fontSize: 13, color: "#94a3b8", py: 3, textAlign: "center" }}>
                            No jobs match this filter.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredJobs.map((job) => (
                      <CronJobRow
                        key={job.jobid}
                        job={job}
                        expanded={expandedJobId === job.jobid}
                        onExpandToggle={() => setExpandedJobId(expandedJobId === job.jobid ? null : job.jobid)}
                        onToggleActive={handleToggleActive}
                        onRunNow={handleRunNow}
                        onToast={(msg, sev) => setToast({ message: msg, severity: sev })}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          {/* Sidebar */}
          <Box sx={{ width: { xs: "100%", lg: 320 }, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {/* Upcoming runs */}
            <Paper elevation={0} sx={sidebarCardSx}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a", mb: 1.5, display: "flex", alignItems: "center", gap: 0.75 }}>
                <HourglassEmptyIcon sx={{ fontSize: 18, color: "#2563eb" }} /> Upcoming Runs
              </Typography>
              {loading && <CircularProgress size={18} />}
              {!loading && upcoming.length === 0 && (
                <Typography sx={{ fontSize: 12.5, color: "#94a3b8" }}>No enabled jobs with a predictable schedule.</Typography>
              )}
              {!loading && upcoming.length > 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {upcoming.map(({ job, next }) => (
                    <Box key={job.jobid} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <JobAvatar jobname={job.jobname} size={30} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {JOB_LABELS[job.jobname]?.label ?? job.jobname}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>
                          {next.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {timeUntil(next)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>

            {/* Cron health summary */}
            <Paper elevation={0} sx={sidebarCardSx}>
              <Typography component="div" sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a", mb: 1.5, display: "flex", alignItems: "center", gap: 0.75 }}>
                <TrendingUpIcon sx={{ fontSize: 18, color: "#2563eb" }} /> Health Summary
                <Chip label="Last 24h" size="small" sx={{ ml: "auto", fontSize: 10, height: 18, bgcolor: "#eff6ff", color: "#1d4ed8" }} />
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                <Box>
                  <Typography sx={{ fontSize: 11, color: "#64748b" }}>Successful</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#16a34a" }}>{totalSuccess24h}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: "#64748b" }}>Failed</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: totalFailures24h > 0 ? "#dc2626" : "#0f172a" }}>
                    {totalFailures24h}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: "#64748b" }}>Total Runs</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>{totalRuns24h}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: "#64748b" }}>Never Run</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>{neverRun}</Typography>
                </Box>
              </Box>
            </Paper>

            {/* Legend / help */}
            <Paper elevation={0} sx={sidebarCardSx}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a", mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
                <InfoOutlinedIcon sx={{ fontSize: 18, color: "#2563eb" }} /> What am I looking at?
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.6 }}>
                <strong style={{ color: "#7c3aed" }}>Manual</strong> tags a run you triggered with "Run now" — pg_cron
                never sees those, so they're logged separately and merged in here.{" "}
                <strong>Failing (24h)</strong> counts jobs with at least one failed run in the last day; expand a job
                to see the exact reason. Disabling a job pauses every tick platform-wide, not just one post.
              </Typography>
            </Paper>
          </Box>
        </Box>
      </Container>

      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setToast(null)} severity={toast?.severity ?? "info"} variant="filled" sx={{ borderRadius: "12px" }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CronJobs;
