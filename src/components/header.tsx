import { useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Avatar,
  Badge,
  Box,
  Divider,
  Drawer,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  useMediaQuery,
} from "@mui/material";
import WalletIcon from '@mui/icons-material/Wallet';
import StarOutlineIcon from "@mui/icons-material/StarOutlined";
import { useTheme } from "@mui/material/styles";

import SearchIcon from "@mui/icons-material/Search";
import MenuIcon from "@mui/icons-material/Menu";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import LogoutIcon from "@mui/icons-material/Logout";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SecurityIcon from "@mui/icons-material/Security";
import { signOut } from "../services/authService";
import { useNavigate } from "react-router-dom";
import type { HeaderProps } from "../consts/interfaces";
import { useAuth } from "../contexts/authContext";
import { useUnseenTopUpCount } from "../wallet/hooks/useUnseenTopUpCount";
import { getErrorMessage } from "../utils/errors";

const Header = ({ search, setSearch }: HeaderProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { unseenCount } = useUnseenTopUpCount(user?.id ?? null);

  const getAvatarLetter = () => {
    if (!user) return "U";
    const name = user.user_metadata?.full_name || user.user_metadata?.username || user.email || "U";
    return name.trim()[0].toUpperCase();
  };

  const getDisplayName = () => {
    if (!user) return "Account";
    return user.user_metadata?.full_name || user.user_metadata?.username || user.email || "Account";
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Unexpected error during logout");
      console.error("Unexpected error during logout:", message);
    }
  };

  const goTo = (path: string) => {
    setDrawerOpen(false);
    navigate(path);
  };

  return (
    <AppBar
      position="sticky"
      elevation={2}
      sx={{
        bgcolor: "white",
        color: "#1976d2",
      }}
    >
      {isMobile && isMobileSearchOpen ? (
        /* Mobile Search Active View */
        <Toolbar sx={{ px: { xs: 1.5, sm: 2 } }}>
          <IconButton
            color="primary"
            onClick={() => setIsMobileSearchOpen(false)}
            sx={{ mr: 1, p: 1 }}
            aria-label="back to menu"
          >
            <ArrowBackIcon />
          </IconButton>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              bgcolor: "#F5F8FF",
              borderRadius: 2,
              px: 1.5,
              py: 0.5,
              flexGrow: 1,
            }}
          >
            <SearchIcon color="primary" />
            <InputBase
              placeholder="Search blogs..."
              autoFocus
              sx={{
                width: "100%",
                ml: 1,
                color: "#1976d2",
              }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Box>
        </Toolbar>
      ) : (
        /* Standard / Mobile Search Inactive View */
        <Toolbar
          sx={{
            justifyContent: "space-between",
            gap: { xs: 0.5, sm: 1.5 },
            px: { xs: 1.5, sm: 2 },
          }}
        >
          {/* Logo */}
          <Typography
            variant="h5"
            noWrap
            sx={{
              fontWeight: "bold",
              flexGrow: 1,
              fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.5rem" },
              cursor: "pointer",
            }}
            onClick={() => navigate("/")}
          >
            MyBlog
          </Typography>

          {/* Desktop Search */}
          <Box
            sx={{
              display: { xs: "none", sm: "flex" },
              alignItems: "center",
              bgcolor: "#F5F8FF",
              borderRadius: 2,
              px: 1.5,
              py: 0.5,
              mr: { sm: 1.5, md: 3 },
            }}
          >
            <SearchIcon color="primary" />
            <InputBase
              placeholder="Search blogs..."
              sx={{
                width: { sm: 90, md: 140, lg: 220 },
                ml: 1,
              }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Box>

          {/* Mobile Search Toggle Button */}
          <IconButton
            color="primary"
            onClick={() => setIsMobileSearchOpen(true)}
            sx={{
              display: { xs: "inline-flex", sm: "none" },
            }}
            aria-label="open search"
          >
            <SearchIcon />
          </IconButton>

          {/* My Posts / Wallet / Premium Feeds — icon-only on tablets and
              small laptops (sm-md), full labeled buttons from lg up. Full
              text buttons at sm/md overflowed the toolbar on tablet and
              small-laptop widths (~600-1200px). */}
          <Tooltip title="My Posts">
            <IconButton
              color="primary"
              onClick={() => navigate("/my-posts")}
              sx={{ display: { xs: "none", sm: "inline-flex", lg: "none" }, width: 40, height: 40, mr: 1 }}
              aria-label="my posts"
            >
              <DynamicFeedIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<DynamicFeedIcon />}
            sx={{
              display: { xs: "none", lg: "inline-flex" },
              mr: { lg: 2 },
              borderRadius: 5,
              textTransform: "none",
              whiteSpace: "nowrap",
            }}
            onClick={() => navigate("/my-posts")}
          >
            My Posts
          </Button>

          <Tooltip title="Wallet">
            <Badge
              badgeContent={unseenCount} color="error" overlap="circular"
              sx={{ display: { xs: "none", sm: "inline-flex", lg: "none" }, mr: 1 }}
            >
              <IconButton
                color="primary"
                onClick={() => navigate("/wallet")}
                sx={{ width: 40, height: 40 }}
                aria-label="wallet"
              >
                <WalletIcon />
              </IconButton>
            </Badge>
          </Tooltip>
          <Badge
            badgeContent={unseenCount} color="error" overlap="rectangular"
            sx={{ display: { xs: "none", lg: "inline-flex" } }}
          >
            <Button
              variant="contained"
              endIcon={<WalletIcon />}
              onClick={() => navigate("/wallet")}
              sx={{
                mr: { lg: 2 },
                borderRadius: 5,
                textTransform: "none",
                whiteSpace: "nowrap",
              }}
            >
              Wallet
            </Button>
          </Badge>

          <Tooltip title="Premium Feeds">
            <IconButton
              color="primary"
              onClick={() => navigate("/premium-subscriptions")}
              sx={{ display: { xs: "none", sm: "inline-flex", lg: "none" }, width: 40, height: 40, mr: 1 }}
              aria-label="premium feeds"
            >
              <StarOutlineIcon />
            </IconButton>
          </Tooltip>
          {/* Premium Feeds button (Desktop) */}
          <Button
            variant="outlined"
            startIcon={<StarOutlineIcon />}
            onClick={() => navigate("/premium-subscriptions")}
            sx={{
              display: { xs: "none", lg: "inline-flex" },
              mr: { lg: 2 },
              borderRadius: 5,
              textTransform: "none",
              whiteSpace: "nowrap",
              borderColor: "#1976d2",
              color: "#1976d2",
              "&:hover": { bgcolor: "#f0f7ff" },
            }}
          >
            Premium Feeds
          </Button>

          {/* 2FA Security Button (Desktop/Tablet) */}
          <IconButton
            color="primary"
            onClick={() => navigate("/mfa-setup")}
            sx={{ display: { xs: "none", sm: "inline-flex" }, width: 40, height: 40 }}
            aria-label="two-factor authentication settings"
            title="Manage 2FA"
          >
            <SecurityIcon />
          </IconButton>

          {/* User (Desktop/Tablet) */}
          <Avatar
            sx={{
              display: { xs: "none", sm: "flex" },
              bgcolor: "#1976d2",
              width: 40,
              height: 40,
              fontSize: "1rem",
              mr: { sm: 1.5, md: 2 },
            }}
          >
            {getAvatarLetter()}
          </Avatar>

          {/* Logout (Desktop/Tablet) */}
          <IconButton
            color="primary"
            onClick={() => handleLogout()}
            sx={{ display: { xs: "none", sm: "inline-flex" }, width: 40, height: 40 }}
            aria-label="logout"
          >
            <LogoutIcon />
          </IconButton>

          {/* Hamburger menu (Mobile only) — consolidates My Posts, Wallet,
              Premium Feeds, 2FA, and Logout into a drawer so the toolbar
              doesn't overflow on small screens. */}
          <Badge
            badgeContent={unseenCount} color="error" overlap="circular"
            sx={{ display: { xs: "inline-flex", sm: "none" } }}
          >
            <IconButton
              color="primary"
              onClick={() => setDrawerOpen(true)}
              sx={{ width: 36, height: 36 }}
              aria-label="open menu"
            >
              <MenuIcon />
            </IconButton>
          </Badge>
        </Toolbar>
      )}

      {/* Mobile navigation drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: 260 } } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2 }}>
          <Avatar sx={{ bgcolor: "#1976d2", width: 40, height: 40 }}>
            {getAvatarLetter()}
          </Avatar>
          <Typography noWrap sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
            {getDisplayName()}
          </Typography>
        </Box>
        <Divider />
        <List sx={{ py: 0 }}>
          <ListItemButton onClick={() => goTo("/my-posts")}>
            <ListItemIcon sx={{ minWidth: 40, color: "#1976d2" }}><DynamicFeedIcon /></ListItemIcon>
            <ListItemText primary="My Posts" />
          </ListItemButton>
          <ListItemButton onClick={() => goTo("/wallet")}>
            <ListItemIcon sx={{ minWidth: 40, color: "#1976d2" }}>
              <Badge badgeContent={unseenCount} color="error" overlap="circular">
                <WalletIcon />
              </Badge>
            </ListItemIcon>
            <ListItemText primary="Wallet" />
          </ListItemButton>
          <ListItemButton onClick={() => goTo("/premium-subscriptions")}>
            <ListItemIcon sx={{ minWidth: 40, color: "#1976d2" }}><StarOutlineIcon /></ListItemIcon>
            <ListItemText primary="Premium Feeds" />
          </ListItemButton>
          <Divider sx={{ my: 1 }} />
          <ListItemButton onClick={() => goTo("/mfa-setup")}>
            <ListItemIcon sx={{ minWidth: 40, color: "#1976d2" }}><SecurityIcon /></ListItemIcon>
            <ListItemText primary="Manage 2FA" />
          </ListItemButton>
          <ListItemButton onClick={() => { setDrawerOpen(false); void handleLogout(); }}>
            <ListItemIcon sx={{ minWidth: 40, color: "#1976d2" }}><LogoutIcon /></ListItemIcon>
            <ListItemText primary="Logout" />
          </ListItemButton>
        </List>
      </Drawer>
    </AppBar>
  );
};

export default Header;
