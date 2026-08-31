import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TextField, Button, Paper, Typography, Alert } from "@mui/material";
import { verifyMFA, getCurrentUser, fetchUserRole } from "../services/authService";
import { getErrorMessage } from "../utils/errors";

interface MFALocationState {
  factorId: string;
  challengeId: string;
}

const MFAVerify = () => {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const state = location.state as MFALocationState | null;

  useEffect(() => {
    if (!state?.factorId || !state?.challengeId) {
      navigate("/login", { replace: true });
    }
  }, [state, navigate]);

  const handleVerify = async () => {
    if (!state) return;

    setError("");
    setSubmitting(true);
    try {
      await verifyMFA(state.factorId, state.challengeId, code);

      const user = await getCurrentUser();
      if (!user) {
        throw new Error("Verification succeeded but no session was found.");
      }
      const role = await fetchUserRole(user.id);

      navigate(role === "admin" ? "/admin" : "/", { replace: true });
    } catch (err) {
      const message = getErrorMessage(err, "Invalid code. Please try again.");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper sx={{ p: 4, maxWidth: 400, mx: "auto", mt: 10 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Two-Factor Authentication
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter the 6-digit code from your authenticator app.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TextField
        fullWidth
        label="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && code.length === 6 && !submitting) {
            handleVerify();
          }
        }}
      />

      <Button
        sx={{ mt: 3 }}
        variant="contained"
        fullWidth
        disabled={submitting || code.length !== 6}
        onClick={handleVerify}
      >
        {submitting ? "Verifying..." : "Verify"}
      </Button>
    </Paper>
  );
};

export default MFAVerify;
