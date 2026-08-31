import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import DeleteIcon from "@mui/icons-material/Delete";
import PublicIcon from "@mui/icons-material/PublicOutlined";
import DraftIcon from "@mui/icons-material/EditNoteOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import { supabase } from "../services/supabase";
import {
  getPlatformSettings,
  setPlatformFee,
  setRecurringPostFee,
  publishPostFree,
  type PostStatus,
} from "../services/postService";
import { getErrorMessage } from "../utils/errors";

type Post = {
  id: number;
  title: string;
  content: string;
  status: PostStatus;
  created_at?: string;
  user_id?: string;
};

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
  p: { xs: 2.5, sm: 3 },
  mb: 2,
};

const fmt = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

function StatusChip({ status }: { status: PostStatus }) {
  if (status === "PUBLISHED")
    return (
      <Chip
        icon={<PublicIcon sx={{ fontSize: 13 }} />}
        label="Published"
        size="small"
        sx={{ fontWeight: 600, bgcolor: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }}
      />
    );
  return (
    <Chip
      icon={<DraftIcon sx={{ fontSize: 13 }} />}
      label="Draft"
      size="small"
      sx={{ fontWeight: 600, bgcolor: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
    />
  );
}

const ManagePosts = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0); // 0=Posts, 1=Fee Settings
  const [posts, setPosts] = useState<Post[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | PostStatus>("ALL");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    severity: "success" | "error" | "info" | "warning";
  } | null>(null);

  // Fee settings state
  const [currentFee, setCurrentFee] = useState<number>(0);
  const [feeInput, setFeeInput] = useState("");
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeSettingsLoading, setFeeSettingsLoading] = useState(true);

  // Recurring post annual fee state
  const [currentAnnualFee, setCurrentAnnualFee] = useState<number>(0);
  const [annualFeeInput, setAnnualFeeInput] = useState("");
  const [annualFeeLoading, setAnnualFeeLoading] = useState(false);

  const escapePostgrestFilter = (val: string): string =>
    val.replace(/[\\%_(),]/g, "\\$&");

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from("posts").select("*");
      if (search.trim()) {
        const sanitized = escapePostgrestFilter(search.trim());
        query = query.or(`title.ilike.%${sanitized}%,content.ilike.%${sanitized}%`);
      }
      if (statusFilter !== "ALL") query = query.eq("status", statusFilter);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) { setToast({ message: "Failed to load posts.", severity: "error" }); return; }
      setPosts((data as Post[] | null) ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const id = window.setTimeout(() => { void fetchPosts(); }, 300);
    return () => window.clearTimeout(id);
  }, [fetchPosts]);

  const loadFeeSettings = useCallback(async () => {
    setFeeSettingsLoading(true);
    try {
      const settings = await getPlatformSettings();
      setCurrentFee(settings.post_publish_fee);
      setFeeInput(settings.post_publish_fee.toString());
      setCurrentAnnualFee(settings.recurring_post_annual_fee);
      setAnnualFeeInput(settings.recurring_post_annual_fee.toString());
    } catch (err) {
      console.error(err);
    } finally {
      setFeeSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    void loadFeeSettings();
  }, [loadFeeSettings]);

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this post permanently?")) return;
    setDeletingId(id);
    const { error } = await supabase.from("posts").delete().eq("id", id);
    setDeletingId(null);
    if (error) { setToast({ message: "Could not delete post.", severity: "error" }); return; }
    setToast({ message: "Post deleted.", severity: "success" });
    void fetchPosts();
  };

  const handlePublishFree = async (id: number) => {
    setPublishingId(id);
    try {
      await publishPostFree(id);
      setToast({ message: "Post published successfully (no fee charged).", severity: "success" });
      void fetchPosts();
    } catch (err: unknown) {
      setToast({
        message: getErrorMessage(err, "Could not publish post."),
        severity: "error",
      });
    } finally {
      setPublishingId(null);
    }
  };

  const handleSaveFee = async () => {
    const parsed = parseFloat(feeInput);
    if (isNaN(parsed) || parsed < 0) {
      setToast({ message: "Enter a valid non-negative fee.", severity: "warning" });
      return;
    }
    setFeeLoading(true);
    try {
      await setPlatformFee(parsed);
      setCurrentFee(parsed);
      setToast({
        message: parsed === 0
          ? "Publish fee removed — posts are now free."
          : `Publish fee set to ${fmt(parsed)}.`,
        severity: "success",
      });
    } catch (err: unknown) {
      setToast({
        message: getErrorMessage(err, "Failed to update fee."),
        severity: "error",
      });
    } finally {
      setFeeLoading(false);
    }
  };

  const handleSaveAnnualFee = async () => {
    const parsed = parseFloat(annualFeeInput);
    if (isNaN(parsed) || parsed < 0) {
      setToast({ message: "Enter a valid non-negative fee.", severity: "warning" });
      return;
    }
    setAnnualFeeLoading(true);
    try {
      await setRecurringPostFee(parsed);
      setCurrentAnnualFee(parsed);
      setToast({
        message: parsed === 0
          ? "Recurring post annual fee removed — free to run a recurring post."
          : `Recurring post annual fee set to ${fmt(parsed)}.`,
        severity: "success",
      });
    } catch (err: unknown) {
      setToast({
        message: getErrorMessage(err, "Failed to update annual fee."),
        severity: "error",
      });
    } finally {
      setAnnualFeeLoading(false);
    }
  };

  const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : "—";
  const draftCount = posts.filter((p) => p.status === "DRAFT").length;

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
          <DynamicFeedIcon sx={{ color: "#3A7FF1", fontSize: { xs: 30, sm: 36 } }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.5rem", sm: "1.8rem" }, color: "#0f172a", lineHeight: 1.2 }}>
              Manage Posts
            </Typography>
            <Typography sx={{ fontSize: "12px", color: "rgba(15,23,42,0.65)" }}>
              Review posts, publish drafts, and configure the platform fee
            </Typography>
          </Box>
          {currentFee > 0 && (
            <Chip
              icon={<AttachMoneyIcon sx={{ fontSize: 14 }} />}
              label={`Fee: ${fmt(currentFee)}`}
              size="small"
              sx={{ fontWeight: 700, bgcolor: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}
            />
          )}
        </Box>

        <Paper elevation={0} sx={{ ...cardSx, p: 0, overflow: "hidden" }}>
          <Tabs
            value={tab}
            onChange={(_, v: number) => setTab(v)}
            textColor="primary"
            indicatorColor="primary"
            sx={{ px: 2.5, pt: 1, "& .MuiTab-root": { fontWeight: 600, textTransform: "none" } }}
          >
            <Tab label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                Posts
                {draftCount > 0 && (
                  <Chip label={`${draftCount} drafts`} size="small"
                    sx={{ fontWeight: 700, fontSize: 11, height: 18, bgcolor: "#fef3c7", color: "#92400e" }} />
                )}
              </Box>
            } />
            <Tab icon={<TuneIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Publish Fee" />
          </Tabs>
        </Paper>

        {tab === 0 && (
          <>
            {/* Search + filter bar */}
            <Paper elevation={0} sx={{ ...cardSx, mb: 2 }}>
              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
                <TextField
                  size="small"
                  label="Search posts"
                  placeholder="Title or content…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ flex: 1, minWidth: 180, "& .MuiOutlinedInput-root": { borderRadius: "12px", bgcolor: "#f8fbff" } }}
                />
                {(["ALL", "PUBLISHED", "DRAFT"] as const).map((s) => (
                  <Chip
                    key={s}
                    label={s === "ALL" ? "All" : s === "PUBLISHED" ? "Published" : "Drafts"}
                    clickable
                    onClick={() => setStatusFilter(s)}
                    icon={s === "PUBLISHED" ? <PublicIcon sx={{ fontSize: 13 }} /> : s === "DRAFT" ? <DraftIcon sx={{ fontSize: 13 }} /> : undefined}
                    sx={{
                      fontWeight: 600,
                      bgcolor: statusFilter === s ? "#2563eb" : "#f1f5f9",
                      color: statusFilter === s ? "#fff" : "#475569",
                      border: "none",
                    }}
                  />
                ))}
              </Box>
              <Typography sx={{ mt: 1.5, fontSize: 13, color: "#64748b" }}>
                {loading ? "Loading…" : `${posts.length} post${posts.length === 1 ? "" : "s"} found`}
              </Typography>
            </Paper>

            {!loading && posts.length === 0 && (
              <Paper elevation={0} sx={{ ...cardSx, textAlign: "center" }}>
                <Typography sx={{ color: "#64748b" }}>No posts match your search.</Typography>
              </Paper>
            )}

            {posts.map((post) => (
              <Paper key={post.id} elevation={0} sx={{ ...cardSx, border: post.status === "DRAFT" ? "1px dashed #fde68a" : cardSx.border }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
                      <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", color: "#0f172a" }}>
                        {post.title}
                      </Typography>
                      <StatusChip status={post.status} />
                    </Box>
                    <Typography sx={{ fontSize: 12, color: "#64748b", mb: 1.5 }}>
                      {formatDate(post.created_at)}
                    </Typography>
                    <Typography sx={{ color: "#334155", whiteSpace: "pre-wrap" }}>
                      {post.content}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-end" }}>
                    {post.status === "DRAFT" && (
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        disabled={publishingId === post.id}
                        onClick={() => void handlePublishFree(post.id)}
                        startIcon={publishingId === post.id ? <CircularProgress size={13} color="inherit" /> : <PublicIcon fontSize="small" />}
                        sx={{ borderRadius: "10px", fontWeight: 700, textTransform: "none", fontSize: 12, whiteSpace: "nowrap" }}
                      >
                        Publish free
                      </Button>
                    )}
                    <IconButton
                      aria-label="delete post"
                      onClick={() => void handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      sx={{ color: "#dc2626", bgcolor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", "&:hover": { bgcolor: "rgba(239,68,68,0.14)" } }}
                    >
                      {deletingId === post.id ? <CircularProgress size={18} color="error" /> : <DeleteIcon />}
                    </IconButton>
                  </Box>
                </Box>
              </Paper>
            ))}
          </>
        )}

        {tab === 1 && (
          <Paper elevation={0} sx={cardSx}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <TuneIcon sx={{ color: "#2563eb" }} />
              <Typography sx={{ fontWeight: 700, color: "#0f172a" }}>Publish fee</Typography>
            </Box>
            <Typography sx={{ fontSize: 13, color: "#64748b", mb: 3 }}>
              Set the amount users must have in their wallet to publish a post.
              If their balance is below this amount, the post is saved as a draft instead.
              Set to <strong>0</strong> to make publishing free for everyone.
            </Typography>

            {feeSettingsLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            ) : (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, borderRadius: "12px", bgcolor: "#eff6ff", border: "1px solid #bfdbfe", mb: 3 }}>
                  <AttachMoneyIcon sx={{ color: "#2563eb", fontSize: 20 }} />
                  <Typography sx={{ fontSize: 14, color: "#1e40af" }}>
                    Current fee: <strong>{currentFee === 0 ? "Free (no fee)" : fmt(currentFee)}</strong>
                  </Typography>
                </Box>

                <TextField
                  fullWidth
                  size="small"
                  label="New publish fee (USD)"
                  type="number"
                  value={feeInput}
                  onChange={(e) => setFeeInput(e.target.value)}
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
                  sx={{ mb: 2, "& .MuiOutlinedInput-root": { borderRadius: "12px", bgcolor: "#f8fbff" } }}
                />

                <Button
                  variant="contained"
                  disabled={feeLoading || feeInput === currentFee.toString()}
                  onClick={() => void handleSaveFee()}
                  startIcon={feeLoading ? <CircularProgress size={16} color="inherit" /> : <TuneIcon />}
                  sx={{
                    borderRadius: "14px",
                    fontWeight: 700,
                    background: "linear-gradient(90deg,#2563eb,#3b82f6)",
                    "&:hover": { background: "linear-gradient(90deg,#1d4ed8,#2563eb)" },
                  }}
                >
                  {feeLoading ? "Saving…" : "Save fee"}
                </Button>
              </>
            )}
          </Paper>
        )}

        {tab === 1 && (
          <Paper elevation={0} sx={cardSx}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <AutorenewIcon sx={{ color: "#2563eb" }} />
              <Typography sx={{ fontWeight: 700, color: "#0f172a" }}>Recurring post annual fee</Typography>
            </Box>
            <Typography sx={{ fontSize: 13, color: "#64748b", mb: 3 }}>
              A separate platform fee charged to the owner of a recurring post — once when their
              job is approved, then automatically every year after while it stays active. This is
              independent of the publish fee above and does not touch what subscribers pay the
              owner (that money is entirely theirs). Set to <strong>0</strong> to make running a
              recurring post free.
            </Typography>

            {feeSettingsLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            ) : (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, borderRadius: "12px", bgcolor: "#eff6ff", border: "1px solid #bfdbfe", mb: 3 }}>
                  <AttachMoneyIcon sx={{ color: "#2563eb", fontSize: 20 }} />
                  <Typography sx={{ fontSize: 14, color: "#1e40af" }}>
                    Current annual fee: <strong>{currentAnnualFee === 0 ? "Free (no fee)" : fmt(currentAnnualFee)}</strong>
                  </Typography>
                </Box>

                <TextField
                  fullWidth
                  size="small"
                  label="New annual fee (USD)"
                  type="number"
                  value={annualFeeInput}
                  onChange={(e) => setAnnualFeeInput(e.target.value)}
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
                  sx={{ mb: 2, "& .MuiOutlinedInput-root": { borderRadius: "12px", bgcolor: "#f8fbff" } }}
                />

                <Button
                  variant="contained"
                  disabled={annualFeeLoading || annualFeeInput === currentAnnualFee.toString()}
                  onClick={() => void handleSaveAnnualFee()}
                  startIcon={annualFeeLoading ? <CircularProgress size={16} color="inherit" /> : <TuneIcon />}
                  sx={{
                    borderRadius: "14px",
                    fontWeight: 700,
                    background: "linear-gradient(90deg,#2563eb,#3b82f6)",
                    "&:hover": { background: "linear-gradient(90deg,#1d4ed8,#2563eb)" },
                  }}
                >
                  {annualFeeLoading ? "Saving…" : "Save annual fee"}
                </Button>
              </>
            )}
          </Paper>
        )}

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

export default ManagePosts;
