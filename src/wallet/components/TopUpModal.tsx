import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineOutlined';
import CloseIcon from '@mui/icons-material/Close';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { useState } from 'react';
import { submitTopUpRequest, type TopUpRequestStatus } from '../services/walletService';
import { getErrorMessage } from '../../utils/errors';

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
  walletId: string;
  memberId: string;
  /**
   * Live status of the most-recently-submitted request.
   * Passed in from the parent so the modal reacts to realtime changes
   * without needing its own subscription.
   * undefined = no request submitted yet in this session.
   */
  submittedRequestStatus?: TopUpRequestStatus;
  /** Called after the request row is created — passes back the new request UUID */
  onRequestSubmitted: (requestId: string) => void;
}

const PRESETS = [10, 25, 50, 100, 250, 500];

// ─── Post-submission status screens ──────────────────────────────────────────

function PendingScreen({ amount, onClose }: { amount: number; onClose: () => void }) {
  return (
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <HourglassEmptyIcon sx={{ fontSize: 52, color: '#f59e0b', mb: 1.5 }} />
      <Typography sx={{ fontWeight: 700, fontSize: 17, color: '#0f172a', mb: 1 }}>
        Request submitted!
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2.5 }}>
        Your top-up of <strong>${amount.toFixed(2)}</strong> is pending admin approval.
        You'll be notified as soon as it's reviewed.
      </Typography>
      <Chip
        icon={<HourglassEmptyIcon sx={{ fontSize: 14 }} />}
        label="Pending approval"
        size="small"
        sx={{ fontWeight: 600, bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
      />
      <Box sx={{ mt: 3 }}>
        <Button variant="outlined" onClick={onClose} sx={{ borderRadius: '12px', fontWeight: 600 }}>
          Close
        </Button>
      </Box>
    </Box>
  );
}

function ApprovedScreen({ amount, onClose }: { amount: number; onClose: () => void }) {
  return (
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <CheckCircleOutlinedIcon sx={{ fontSize: 52, color: '#16a34a', mb: 1.5 }} />
      <Typography sx={{ fontWeight: 700, fontSize: 17, color: '#0f172a', mb: 1 }}>
        Top-up approved!
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2.5 }}>
        Your wallet has been credited <strong>${amount.toFixed(2)}</strong>.
        Your balance has been updated.
      </Typography>
      <Chip
        icon={<CheckCircleOutlinedIcon sx={{ fontSize: 14 }} />}
        label="Approved"
        size="small"
        sx={{ fontWeight: 600, bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}
      />
      <Box sx={{ mt: 3 }}>
        <Button
          variant="contained"
          onClick={onClose}
          sx={{
            borderRadius: '12px',
            fontWeight: 600,
            background: 'linear-gradient(90deg,#16a34a,#22c55e)',
            '&:hover': { background: 'linear-gradient(90deg,#15803d,#16a34a)' },
          }}
        >
          Done
        </Button>
      </Box>
    </Box>
  );
}

function RejectedScreen({
  amount,
  onClose,
  onRetry,
}: {
  amount: number;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <CancelOutlinedIcon sx={{ fontSize: 52, color: '#dc2626', mb: 1.5 }} />
      <Typography sx={{ fontWeight: 700, fontSize: 17, color: '#0f172a', mb: 1 }}>
        Request rejected
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2.5 }}>
        Your top-up request of <strong>${amount.toFixed(2)}</strong> was rejected by the admin.
        You can submit a new request if needed.
      </Typography>
      <Chip
        icon={<CancelOutlinedIcon sx={{ fontSize: 14 }} />}
        label="Rejected"
        size="small"
        sx={{ fontWeight: 600, bgcolor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }}
      />
      <Box sx={{ mt: 3, display: 'flex', gap: 1.5, justifyContent: 'center' }}>
        <Button variant="outlined" onClick={onClose} sx={{ borderRadius: '12px', fontWeight: 600 }}>
          Close
        </Button>
        <Button
          variant="contained"
          onClick={onRetry}
          sx={{
            borderRadius: '12px',
            fontWeight: 600,
            background: 'linear-gradient(90deg,#2563eb,#3b82f6)',
            '&:hover': { background: 'linear-gradient(90deg,#1d4ed8,#2563eb)' },
          }}
        >
          Try again
        </Button>
      </Box>
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TopUpModal({
  open,
  onClose,
  walletId,
  memberId: _memberId,
  submittedRequestStatus,
  onRequestSubmitted,
}: TopUpModalProps) {
  const [amount, setAmount] = useState('');
  const [submittedAmount, setSubmittedAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const parsedAmount = parseFloat(amount);
  // Mirror the DB guard: reject amounts with more than 2 decimal places.
  const hasExcessDecimals =
    !isNaN(parsedAmount) && parsedAmount !== Math.round(parsedAmount * 100) / 100;
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0 && !hasExcessDecimals;

  const handlePreset = (value: number) => {
    setAmount(String(value));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      const paymentReference = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestId = await submitTopUpRequest(walletId, parsedAmount, paymentReference);
      setSubmittedAmount(parsedAmount);
      setHasSubmitted(true);
      onRequestSubmitted(requestId);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to submit request. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setError(null);
    setHasSubmitted(false);
    setSubmittedAmount(0);
    onClose();
  };

  const handleRetry = () => {
    setHasSubmitted(false);
    setAmount('');
    setError(null);
    setSubmittedAmount(0);
  };

  // Header colour reflects current state
  const headerBg =
    hasSubmitted && submittedRequestStatus === 'APPROVED'
      ? '#16a34a'
      : hasSubmitted && submittedRequestStatus === 'REJECTED'
      ? '#dc2626'
      : '#2563eb';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: '20px',
            background: '#ffffff',
            color: '#0f172a',
            boxShadow: '0 24px 60px rgba(15,23,42,0.12)',
            margin: { xs: '16px', sm: '32px' },
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          background: headerBg,
          borderRadius: '20px 20px 0 0',
          color: '#fff',
          px: 3,
          py: 2,
          transition: 'background 0.3s ease',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '10px',
              bgcolor: 'rgba(255,255,255,0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AddCircleOutlineIcon sx={{ color: '#fff', fontSize: 20 }} />
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: '18px', color: '#fff' }}>
            Top Up Wallet
          </Typography>
        </Box>
        <IconButton onClick={handleClose} size="small" sx={{ color: 'rgba(255,255,255,0.85)' }} aria-label="close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {hasSubmitted ? (
          // ── Post-submission: live status display ────────────────────────
          submittedRequestStatus === 'APPROVED' ? (
            <ApprovedScreen amount={submittedAmount} onClose={handleClose} />
          ) : submittedRequestStatus === 'REJECTED' ? (
            <RejectedScreen
              amount={submittedAmount}
              onClose={handleClose}
              onRetry={handleRetry}
            />
          ) : (
            // PENDING (or status not yet received)
            <PendingScreen amount={submittedAmount} onClose={handleClose} />
          )
        ) : (
          // ── Input form ──────────────────────────────────────────────────
          <>
            <Alert severity="info" sx={{ mb: 2, borderRadius: '10px', fontSize: '13px' }}>
              Top-up requests require admin approval before your balance is credited.
            </Alert>

            {error && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: '10px', fontSize: '13px' }}>
                {error}
              </Alert>
            )}

            <Typography
              sx={{
                fontSize: '12px',
                fontWeight: 600,
                opacity: 0.6,
                mb: 1.5,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Quick Select
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {PRESETS.map((p) => (
                <Chip
                  key={p}
                  label={`$${p}`}
                  clickable
                  onClick={() => handlePreset(p)}
                  sx={{
                    fontWeight: 700,
                    fontSize: '13px',
                    bgcolor: parsedAmount === p ? '#2563eb' : 'rgba(224,231,255,0.65)',
                    color: parsedAmount === p ? '#fff' : '#1e293b',
                    border: `1px solid ${parsedAmount === p ? '#2563eb' : 'rgba(148,163,184,0.35)'}`,
                    transition: 'all 0.15s ease',
                    '&:hover': { bgcolor: '#2563eb', color: '#fff' },
                  }}
                />
              ))}
            </Box>

            <Divider sx={{ borderColor: 'rgba(226,232,240,0.4)', mb: 3 }}>
              <Typography sx={{ fontSize: '11px', color: 'rgba(71,85,105,0.65)', px: 1 }}>
                or enter custom
              </Typography>
            </Divider>

            <TextField
              fullWidth
              label="Amount"
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              error={hasExcessDecimals}
              helperText={hasExcessDecimals ? 'Max 2 decimal places (e.g. 10.00)' : undefined}
              slotProps={{
                htmlInput: { min: 0.01, step: 0.01 },
                formHelperText: { sx: { color: '#dc2626' } },
                input: {
                  startAdornment: (
                    <InputAdornment position="start" sx={{ color: '#2563eb' }}>
                      $
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                mb: 3,
                '& .MuiOutlinedInput-root': {
                  borderRadius: '12px',
                  color: '#0f172a',
                  bgcolor: '#f8fafc',
                  '& fieldset': { borderColor: 'rgba(96,165,250,0.4)' },
                  '&:hover fieldset': { borderColor: '#60a5fa' },
                  '&.Mui-focused fieldset': { borderColor: '#2563eb' },
                },
                '& .MuiInputLabel-root': { color: 'rgba(71,85,105,0.8)' },
                '& .MuiInputLabel-root.Mui-focused': { color: '#2563eb' },
              }}
            />

            <Button
              fullWidth
              variant="contained"
              disabled={!isValid || loading}
              onClick={() => void handleSubmit()}
              startIcon={
                loading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <AddCircleOutlineIcon />
                )
              }
              sx={{
                borderRadius: '12px',
                py: 1.5,
                fontWeight: 700,
                fontSize: '15px',
                textTransform: 'none',
                background: isValid
                  ? 'linear-gradient(90deg, #2563eb, #3b82f6)'
                  : 'rgba(59,130,246,0.16)',
                boxShadow: isValid ? '0 8px 24px rgba(59,130,246,0.25)' : 'none',
                '&:hover': {
                  background: isValid
                    ? 'linear-gradient(90deg, #1d4ed8, #2563eb)'
                    : 'rgba(59,130,246,0.16)',
                },
                '&:disabled': { color: 'rgba(15,23,42,0.4)' },
              }}
            >
              {loading
                ? 'Submitting…'
                : isValid
                ? `Request $${parsedAmount.toFixed(2)} top-up`
                : 'Enter an Amount'}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
