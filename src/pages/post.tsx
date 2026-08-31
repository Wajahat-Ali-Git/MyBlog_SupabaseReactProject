import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { Container, Typography, Card, CardContent, Button, Box, Chip, Tooltip } from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import type { blogProps } from "../consts/interfaces";
import Header from "../components/header";

const Post = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<blogProps | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPost = async () => {
      try {
        const { data, error } = await supabase
          .from("posts")
          .select("*")
          .eq("id", id)
          .single();

        if (error) {
          console.error(error);
          return;
        }

        setPost(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      void fetchPost();
    }
  }, [id]);

  if (loading) {
    return (
      <>
        <Header search="" setSearch={() => {}} />
        <Container maxWidth="md" sx={{ mt: 5 }}>
          <Typography>Loading...</Typography>
        </Container>
      </>
    );
  }

  if (!post) {
    return (
      <>
        <Header search="" setSearch={() => {}} />
        <Container maxWidth="md" sx={{ mt: 5 }}>
          <Typography>Post not found</Typography>
          <Button onClick={() => navigate("/")} sx={{ mt: 2 }}>Back to Home</Button>
        </Container>
      </>
    );
  }

  return (
    <>
      <Header search="" setSearch={() => {}} />
      <Container maxWidth="md" sx={{ mt: { xs: 2.5, sm: 5 }, mb: { xs: 5, sm: 10 }, px: { xs: 1.5, sm: 3 } }}>
        <Button onClick={() => navigate("/")} sx={{ mb: { xs: 1.5, sm: 3 } }}>
          &larr; Back to Home
        </Button>
        <Card sx={{ borderRadius: { xs: 3, sm: 4 }, boxShadow: "0 8px 24px rgba(0,0,0,.1)" }}>
          <Box sx={{ background: "linear-gradient(135deg,#1565C0,#42A5F5)", color: "white", p: { xs: 2.5, sm: 4 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {post.is_recurring_feed && (
                <Tooltip title="Part of a recurring premium feed">
                  <StarIcon sx={{ color: "#fde68a", fontSize: { xs: 20, sm: 28 }, flexShrink: 0 }} />
                </Tooltip>
              )}
              <Typography
                variant="h3"
                sx={{ fontWeight: 700, fontSize: { xs: "1.4rem", sm: "2.2rem", md: "3rem" }, lineHeight: 1.25, wordBreak: "break-word" }}
              >
                {post.title}
              </Typography>
            </Box>
          </Box>
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Typography sx={{ fontSize: { xs: 12, sm: 13 }, color: "#64748b", mb: 2 }}>
              By <strong>{post.author_display_name || "Unknown"}</strong>
              {post.created_at && (
                <> · {new Date(post.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>
              )}
            </Typography>
            {post.category && (
              <Chip
                label={post.category}
                size="small"
                sx={{ mb: 2, fontWeight: 600, bgcolor: "#eff6ff", color: "#1d4ed8" }}
              />
            )}
            <Typography
              variant="body1"
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: { xs: "0.95rem", sm: "1.1rem" }, lineHeight: { xs: 1.65, sm: 1.8 } }}
            >
              {post.content}
            </Typography>
          </CardContent>
        </Card>
      </Container>
    </>
  );
};

export default Post;
