import { useCallback, useEffect, useState } from "react";
import { supabase } from "../services/supabase";
import Header from "../components/header";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import {
  POST_CATEGORIES,
  POST_CATEGORY_COLORS,
  type PostStatus,
  type PostCategory,
} from "../services/postService";
import { getAvailableJobs, type SubscribableJob } from "../services/scheduledJobsService";

import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  type SelectChangeEvent,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import StarOutlineIcon from "@mui/icons-material/StarOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CategoryIcon from "@mui/icons-material/CategoryOutlined";
import StarIcon from "@mui/icons-material/Star";
import PersonIcon from "@mui/icons-material/Person";
import type { blogProps } from "../consts/interfaces";

// ─── Extended blog type that includes status ──────────────────────────────────
interface BlogItem extends blogProps {
  status?: PostStatus;
  user_id?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

const escapePostgrestFilter = (val: string) =>
  val.replace(/[\\%_(),]/g, "\\$&");

const fmtDateTime = (v?: string | null) => v ? new Date(v).toLocaleString(undefined, {
  dateStyle: "medium", timeStyle: "short",
}) : "";

function fmtInterval(minutes: number | null): string {
  if (minutes === null) return "One-time";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60}h`;
  if (minutes === 1440) return "Daily";
  if (minutes === 10080) return "Weekly";
  return `Every ${Math.round(minutes / 1440)}d`;
}

const BLOGS_PAGE_SIZE = 9;

// ─── Component ───────────────────────────────────────────────────────────────
const Home = () => {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PostCategory | "All">("All");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [myPostsOnly, setMyPostsOnly] = useState(false);
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [publishedBlogs, setPublishedBlogs] = useState<BlogItem[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);
  const [page, setPage] = useState(1);
  const [recurringFeeds, setRecurringFeeds] = useState<SubscribableJob[]>([]);

  const [prevSearch, setPrevSearch] = useState(search);
  const [prevCategoryFilter, setPrevCategoryFilter] = useState(categoryFilter);
  const [prevSortOrder, setPrevSortOrder] = useState(sortOrder);
  const [prevMyPostsOnly, setPrevMyPostsOnly] = useState(myPostsOnly);
  const [prevPremiumOnly, setPrevPremiumOnly] = useState(premiumOnly);
  const navigate = useNavigate();

  // ── Load recurring premium feeds (teaser for the Premium Feeds page) ────────

  const loadRecurringFeeds = useCallback(async () => {
    try {
      setRecurringFeeds(await getAvailableJobs());
    } catch (err) {
      console.error("Failed to load recurring feeds:", err);
    }
  }, []);

  useEffect(() => {
    const run = async () => { await loadRecurringFeeds(); };
    void run();
  }, [loadRecurringFeeds]);

  // ── Fetch blogs ────────────────────────────────────────────────────────────

  const fetchPublishedBlogs = useCallback(async () => {
    try {
      let query = supabase
        .from("posts")
        .select("*", { count: "exact" })
        .or("status.is.null,status.eq.PUBLISHED");
      if (categoryFilter !== "All") {
        query = query.eq("category", categoryFilter);
      }
      if (myPostsOnly && user?.id) {
        query = query.eq("user_id", user.id);
      }
      if (premiumOnly) {
        query = query.eq("is_recurring_feed", true);
      }
      if (search.trim() !== "") {
        const sanitized = escapePostgrestFilter(search.trim());
        query = query.or(
          `title.ilike.%${sanitized}%,content.ilike.%${sanitized}%`
        );
      }
      const from = (page - 1) * BLOGS_PAGE_SIZE;
      const to = from + BLOGS_PAGE_SIZE - 1;
      const { data, error, count } = await query
        .order("created_at", { ascending: sortOrder === "oldest" })
        .range(from, to);
      if (error) { console.error(error); return; }
      setPublishedBlogs((data as BlogItem[]) ?? []);
      setPublishedCount(count ?? 0);
    } catch (err) {
      console.error(err);
    }
  }, [search, page, categoryFilter, sortOrder, myPostsOnly, premiumOnly, user]);

  // Any time a filter changes, jump back to page 1 so a narrower result set
  // can't leave the user stranded on an out-of-range page. (Reset during
  // render, not in an effect, to avoid a cascading-render pass.)
  if (
    prevSearch !== search ||
    prevCategoryFilter !== categoryFilter ||
    prevSortOrder !== sortOrder ||
    prevMyPostsOnly !== myPostsOnly ||
    prevPremiumOnly !== premiumOnly
  ) {
    setPrevSearch(search);
    setPrevCategoryFilter(categoryFilter);
    setPrevSortOrder(sortOrder);
    setPrevMyPostsOnly(myPostsOnly);
    setPrevPremiumOnly(premiumOnly);
    if (page !== 1) setPage(1);
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchPublishedBlogs();
    }, 300);
    return () => window.clearTimeout(id);
  }, [fetchPublishedBlogs]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(publishedCount / BLOGS_PAGE_SIZE);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Header
        search={search}
        setSearch={setSearch}
      />

      <div>
        {/* ── Recurring premium feeds highlight ── */}
        {recurringFeeds.length > 0 && (
          <Container maxWidth="xl" sx={{ mt: 5 }}>
            <Box
              sx={{
                borderRadius: 4,
                p: { xs: 2.5, sm: 3.5 },
                background: "linear-gradient(135deg, #1e293b 0%, #1d4ed8 60%, #3b82f6 100%)",
                boxShadow: "0 16px 40px rgba(29,78,216,.25)",
              }}
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1.5, mb: 2.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <StarOutlineIcon sx={{ color: "#fde68a", fontSize: 30 }} />
                  <Box>
                    <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.2rem", sm: "1.4rem" }, color: "#ffffff", lineHeight: 1.2 }}>
                      Recurring Premium Feeds
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                      Automated content, delivered on a schedule — subscribe once, get every post.
                    </Typography>
                  </Box>
                </Box>
                <Button
                  onClick={() => navigate("/premium-subscriptions")}
                  endIcon={<ArrowForwardIcon />}
                  sx={{
                    fontWeight: 700, textTransform: "none", borderRadius: "12px",
                    color: "#1e293b", bgcolor: "#ffffff", px: 2.5,
                    "&:hover": { bgcolor: "#eff6ff" },
                  }}
                >
                  View all feeds
                </Button>
              </Box>

              <Grid container spacing={2}>
                {recurringFeeds.slice(0, 4).map((feed) => {
                  const isFree = Number(feed.subscription_fee) === 0;
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 3 }} key={feed.id}>
                      <Box
                        onClick={() => navigate("/premium-subscriptions")}
                        sx={{
                          cursor: "pointer",
                          borderRadius: "16px",
                          p: 2,
                          height: "100%",
                          bgcolor: "rgba(255,255,255,0.08)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          backdropFilter: "blur(6px)",
                          transition: "background 0.2s, transform 0.2s",
                          "&:hover": { bgcolor: "rgba(255,255,255,0.16)", transform: "translateY(-3px)" },
                        }}
                      >
                        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box sx={{ width: 34, height: 34, borderRadius: "10px", flexShrink: 0,
                              bgcolor: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <AutorenewIcon sx={{ color: "#ffffff", fontSize: 18 }} />
                            </Box>
                            <Typography sx={{ fontWeight: 800, fontSize: 16, color: "#ffffff" }}>
                              {isFree ? "Free" : fmt(Number(feed.subscription_fee))}
                              {!isFree && <Typography component="span" sx={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}> / cycle</Typography>}
                            </Typography>
                          </Box>
                          {feed.category && (
                            <Chip
                              label={feed.category}
                              size="small"
                              sx={{ height: 20, fontSize: 10, fontWeight: 700, flexShrink: 0,
                                bgcolor: "rgba(255,255,255,0.22)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.3)" }}
                            />
                          )}
                        </Box>

                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                          <PersonIcon sx={{ fontSize: 14, color: "#fde68a" }} />
                          <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#fde68a" }}>
                            {feed.author_display_name || "Unknown"}
                          </Typography>
                        </Box>

                        <Typography sx={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
                          {fmtInterval(feed.interval_minutes)}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.6)", mt: 0.5 }}>
                          Next: {new Date(feed.next_run_at).toLocaleDateString()}
                        </Typography>
                      </Box>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Container>
        )}

        {/* ── Published blogs grid ── */}
        <Container maxWidth="xl" sx={{ mt: 5, mb: 8 }}>
          <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, flexWrap: "wrap",
            alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between", gap: 2, mb: 3 }}>
            <Typography variant="h4" color="primary"
              sx={{ fontWeight: "bold", fontSize: { xs: "1.5rem", sm: "2rem", md: "2.125rem" } }}>
               Blogs
            </Typography>
            <Box sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(5, auto)" },
              alignItems: "center",
              gap: { xs: 1, sm: 1.5 },
            }}>
              <CategoryIcon sx={{ display: { xs: "none", sm: "block" }, color: "#94a3b8", fontSize: 20 }} />
              <Autocomplete
                size="small"
                disableClearable
                options={["All", ...POST_CATEGORIES] as const}
                value={categoryFilter}
                onChange={(_e, newValue) => setCategoryFilter(newValue as PostCategory | "All")}
                getOptionLabel={(opt) => (opt === "All" ? "All categories" : opt)}
                renderOption={(props, option) => {
                  const { key, ...rest } = props;
                  return (
                    <Box component="li" key={key} {...rest} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{
                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                        bgcolor: option === "All" ? "#cbd5e1" : POST_CATEGORY_COLORS[option].color,
                      }} />
                      {option === "All" ? "All categories" : option}
                    </Box>
                  );
                }}
                renderInput={(params) => <TextField {...params} label="Category" />}
                sx={{ width: { xs: "100%", sm: 200 } }}
              />

              <FormControl size="small" sx={{ width: { xs: "100%", sm: 150 } }}>
                <InputLabel id="sort-order-label">Sort</InputLabel>
                <Select
                  labelId="sort-order-label"
                  label="Sort"
                  value={sortOrder}
                  onChange={(e: SelectChangeEvent) => setSortOrder(e.target.value as "newest" | "oldest")}
                >
                  <MenuItem value="newest">Newest first</MenuItem>
                  <MenuItem value="oldest">Oldest first</MenuItem>
                </Select>
              </FormControl>

              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={myPostsOnly}
                    onChange={(e) => setMyPostsOnly(e.target.checked)}
                    color="primary"
                  />
                }
                label="My posts only"
              />

              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={premiumOnly}
                    onChange={(e) => setPremiumOnly(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <StarIcon sx={{ fontSize: 16, color: "#d97706" }} />
                    Premium only
                  </Box>
                }
              />
            </Box>
          </Box>

          <Grid container spacing={3}>
            {publishedBlogs.map((blog: BlogItem) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={blog.id}>
                <Card
                  sx={{
                    height: 320,
                    display: "flex",
                    flexDirection: "column",
                    borderRadius: 4,
                    border: "1px solid #E3F2FD",
                    boxShadow: "0 8px 24px rgba(25,118,210,.12)",
                    transition: "all .3s ease",
                    "&:hover": {
                      transform: "translateY(-8px)",
                      boxShadow: "0 16px 40px rgba(25,118,210,.25)",
                    },
                  }}
                >
                  <Box
                    sx={{
                      background: "linear-gradient(135deg,#1565C0,#42A5F5)",
                      color: "white",
                      p: 2,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      {blog.is_recurring_feed && (
                        <Tooltip title="Part of a recurring premium feed">
                          <StarIcon sx={{ color: "#fde68a", fontSize: 20, flexShrink: 0 }} />
                        </Tooltip>
                      )}
                      <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
                        {blog.title}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="white" sx={{ opacity: 0.8, display: "block" }}>
                      By {blog.author_display_name || "Unknown"}
                    </Typography>
                    <Typography variant="caption" color="white" sx={{ opacity: 0.8 }}>
                      {fmtDateTime(blog.created_at)}
                    </Typography>
                  </Box>
                  <CardContent sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                    {blog.category && (
                      <Chip
                        label={blog.category}
                        size="small"
                        sx={{ alignSelf: "flex-start", mb: 1, fontWeight: 600, bgcolor: "#eff6ff", color: "#1d4ed8" }}
                      />
                    )}
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        flexGrow: 1,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {blog.content}
                    </Typography>
                    <Button
                      variant="contained"
                      onClick={() => navigate(`/post/${blog.id}`)}
                      sx={{ mt: 3, alignSelf: "flex-start", borderRadius: 10, textTransform: "none" }}
                    >
                      Read More
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {publishedBlogs.length === 0 && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              No blogs found.
            </Typography>
          )}

          {totalPages > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_e, value) => setPage(value)}
                color="primary"
                shape="rounded"
              />
            </Box>
          )}
        </Container>
      </div>
    </>
  );
};

export default Home;
