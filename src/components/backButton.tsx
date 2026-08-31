import { Button } from "@mui/material";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from "react-router-dom";

// No Container/margin of its own — the only caller (wallet.tsx) already
// wraps its content in a Container with its own gutters, so this rendered
// its own separate default-gutter Container as a sibling, misaligning the
// button against the page content below it (especially on mobile, where
// the two Containers' gutters don't match).
const BackButton = () => {
  const navigate = useNavigate();
  return (
    <Button
      onClick={() => navigate("/")}
      sx={{ mb: { xs: 1.5, sm: 2 }, fontWeight: 600, textTransform: "none" }}
      startIcon={<ArrowBackIcon />}
    >
      Back to Home
    </Button>
  );
};
export default BackButton;
