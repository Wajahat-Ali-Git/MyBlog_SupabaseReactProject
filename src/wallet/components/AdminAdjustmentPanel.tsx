import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import PersonIcon from '@mui/icons-material/Person';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  adminAdjustWallet,
  reconcileWallet,
  type LookupResult,
  type ReconcileResult,
} from '../services/walletService';
import { validateAdjustmentReason } from '../utils/ledgerBalance';
import { getErrorMessage } from '../../utils/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

type WalletOption = {
  id: string;
  label: string;
  balance: number;
  currency: string;
};

interface AdminAdjustmentPanelProps {
  wallets: WalletOption[];
  selectedWalletId: string;
  onSelectedWalletChange: (walletId: string) => void;
  onSuccess: () => void;
  /** When provided the wallet picker is hidden and this user's info is shown instead */
  searchUser?: LookupResult | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(result: LookupResult) {
  const name = result.full_name ?? result.username;
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

const fmt = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);

// ─── Confirmation dialog ──────────────────────────────────────────────────────
// Module-level component — never nested inside AdminAdjustmentPanel, so it
// cannot cause the "component defined inside a component" hook violation.

interface ConfirmDialogProps {
  open: boolean;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  currency: string;
  reason: string;
  targetLabel: string;      // wallet label or user name
  balanceBefore: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function ConfirmDialog({
  open,
  direction,
  amount,
  currency,
  reason,
  targetLabel,
  balanceBefore,
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogProps) {
  const isCredit = direction === 'CREDIT';
  const balanceAfter = isCredit ? balanceBefore + amount : balanceBefore - amount;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '20px' } } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          bgcolor: isCredit ? '#f0fdf4' : '#fff7ed',
          borderBottom: `1px solid ${isCredit ? '#bbf7d0' : '#fed7aa'}`,
          px: 3,
          py: 2,
        }}
      >
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: '10px',
            bgcolor: isCredit ? 'rgba(22,163,74,0.12)' : 'rgba(234,88,12,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isCredit
            ? <ArrowDownwardIcon sx={{ color: '#16a34a', fontSize: 20 }} />
            : <ArrowUpwardIcon  sx={{ color: '#ea580c', fontSize: 20 }} />}
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>
            Confirm {isCredit ? 'credit' : 'debit'}
          </Typography>
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>
            Review before applying — this action is recorded on the ledger
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 2.5, pb: 1 }}>
        {/* Warning banner for debits */}
        {!isCredit && (
          <Alert
            severity="warning"
            icon={<WarningAmberIcon fontSize="small" />}
            sx={{ mb: 2, borderRadius: '10px', fontSize: 13 }}
          >
            You are about to <strong>remove funds</strong> from this wallet. This cannot be undone
            without a separate credit adjustment.
          </Alert>
        )}

        {/* Summary table */}
        <Box
          sx={{
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            mb: 2,
          }}
        >
          {(
            [
              ['Target', targetLabel],
              ['Direction', isCredit ? 'Credit (+)' : 'Debit (−)'],
              ['Amount', fmt(amount, currency)],
              ['Balance before', fmt(balanceBefore, currency)],
              ['Balance after', fmt(balanceAfter, currency)],
            ] as [string, string][]
          ).map(([label, value], i, arr) => (
            <Box key={label}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  px: 2,
                  py: 1.25,
                  bgcolor: i % 2 === 0 ? '#f8fafc' : '#ffffff',
                }}
              >
                <Typography sx={{ fontSize: 13, color: '#64748b' }}>{label}</Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 700,
                    color:
                      label === 'Amount'
                        ? isCredit ? '#16a34a' : '#ea580c'
                        : label === 'Balance after'
                        ? balanceAfter < 0 ? '#dc2626' : '#0f172a'
                        : '#0f172a',
                    fontFamily: label.startsWith('Balance') || label === 'Amount'
                      ? 'monospace'
                      : 'inherit',
                  }}
                >
                  {label === 'Amount'
                    ? `${isCredit ? '+' : '−'}${fmt(amount, currency)}`
                    : value}
                </Typography>
              </Box>
              {i < arr.length - 1 && <Divider sx={{ borderColor: '#f1f5f9' }} />}
            </Box>
          ))}
        </Box>

        {/* Reason */}
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Ledger reason
          </Typography>
          <Typography sx={{ fontSize: 13, color: '#334155' }}>{reason}</Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button
          fullWidth
          variant="outlined"
          onClick={onCancel}
          disabled={loading}
          sx={{ borderRadius: '12px', fontWeight: 600, textTransform: 'none', borderColor: '#cbd5e1', color: '#475569' }}
        >
          Go back
        </Button>
        <Button
          fullWidth
          variant="contained"
          onClick={onConfirm}
          disabled={loading}
          sx={{
            borderRadius: '12px',
            fontWeight: 700,
            textTransform: 'none',
            background: isCredit
              ? 'linear-gradient(90deg,#16a34a,#22c55e)'
              : 'linear-gradient(90deg,#ea580c,#f97316)',
            '&:hover': {
              background: isCredit
                ? 'linear-gradient(90deg,#15803d,#16a34a)'
                : 'linear-gradient(90deg,#c2410c,#ea580c)',
            },
          }}
        >
          {loading
            ? <CircularProgress size={20} color="inherit" />
            : `Confirm ${isCredit ? 'credit' : 'debit'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function AdminAdjustmentPanel({
  wallets,
  selectedWalletId,
  onSelectedWalletChange,
  onSuccess,
  searchUser = null,
}: AdminAdjustmentPanelProps) {
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount]   = useState('');
  const [reason, setReason]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);
  const [confirming, setConfirming] = useState(false);  // dialog open

  const parsedAmount = parseFloat(amount);
  const reasonError  = reason.length > 0 ? validateAdjustmentReason(reason) : null;
  const hasExcessDecimals =
    !isNaN(parsedAmount) && parsedAmount !== Math.round(parsedAmount * 100) / 100;

  const canReview =
    !!selectedWalletId &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    !hasExcessDecimals &&
    validateAdjustmentReason(reason) === null &&
    !loading;

  // Selected wallet metadata (for the confirmation summary)
  const selectedWallet = wallets.find((w) => w.id === selectedWalletId);

  // ── Open the dialog (no RPC yet) ─────────────────────────────────────────

  const handleReview = () => {
    const validation = validateAdjustmentReason(reason);
    if (!selectedWalletId || validation) {
      setError(validation ?? 'Select a wallet.');
      return;
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    if (hasExcessDecimals) {
      setError('Amount must have at most 2 decimal places.');
      return;
    }
    setError(null);
    setReconcile(null);
    setConfirming(true);
  };

  // ── Actually apply (called from dialog Confirm) ──────────────────────────

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const newBalance = await adminAdjustWallet(
        selectedWalletId,
        parsedAmount,
        direction,
        reason.trim(),
      );
      const reconcileResult = await reconcileWallet(selectedWalletId);
      setReconcile(reconcileResult);
      setConfirming(false);
      if (!reconcileResult.matches) {
        setError(
          `Adjustment applied (balance ${newBalance}) but reconciliation failed. ` +
          `Cached ${reconcileResult.cached_balance}, ledger ${reconcileResult.ledger_balance}.`,
        );
      } else {
        setAmount('');
        setReason('');
        onSuccess();
      }
    } catch (err: unknown) {
      setConfirming(false);
      setError(getErrorMessage(err, 'Adjustment failed.'));
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TuneIcon sx={{ color: '#2563eb' }} />
        <Typography sx={{ fontWeight: 700, color: '#0f172a' }}>Admin adjustment</Typography>
      </Box>
      <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2 }}>
        Credit or debit a member wallet (refund, correction, promo). A reason is required and stored
        on the ledger as ADMIN_ADJUSTMENT.
      </Typography>

      {wallets.length === 0 ? (
        <Typography sx={{ color: '#64748b' }}>
          {searchUser ? 'This user has no wallet yet.' : 'No wallets available.'}
        </Typography>
      ) : (
        <>
          {/* ── Wallet picker ── */}
          {searchUser ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.5,
                mb: 2,
                borderRadius: '12px',
                bgcolor: '#eff6ff',
                border: '1px solid rgba(59,130,246,0.25)',
              }}
            >
              <Avatar sx={{ width: 38, height: 38, fontSize: 14, bgcolor: '#2563eb' }}>
                {initials(searchUser)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  {searchUser.full_name ?? searchUser.username}
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#64748b', wordBreak: 'break-all' }}>
                  @{searchUser.username}
                </Typography>
              </Box>
              {wallets[0] && (
                <Chip
                  label={fmt(wallets[0].balance, wallets[0].currency)}
                  size="small"
                  icon={<PersonIcon sx={{ fontSize: 14 }} />}
                  sx={{ fontWeight: 700, bgcolor: '#dbeafe', color: '#1d4ed8' }}
                />
              )}
            </Box>
          ) : (
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel id="adjust-wallet-label">Wallet</InputLabel>
              <Select
                labelId="adjust-wallet-label"
                label="Wallet"
                value={selectedWalletId}
                onChange={(e) => onSelectedWalletChange(e.target.value)}
                sx={{ borderRadius: '12px', bgcolor: '#f8fbff' }}
              >
                {wallets.map((w) => (
                  <MenuItem key={w.id} value={w.id}>
                    {w.label} — {fmt(w.balance, w.currency)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* ── Direction toggle ── */}
          <ToggleButtonGroup
            exclusive
            value={direction}
            onChange={(_, v: 'CREDIT' | 'DEBIT' | null) => v && setDirection(v)}
            sx={{ mb: 2 }}
            fullWidth
          >
            <ToggleButton value="CREDIT" sx={{ fontWeight: 600, textTransform: 'none' }}>
              Credit (+)
            </ToggleButton>
            <ToggleButton value="DEBIT" sx={{ fontWeight: 600, textTransform: 'none' }}>
              Debit (−)
            </ToggleButton>
          </ToggleButtonGroup>

          {/* ── Amount ── */}
          <TextField
            fullWidth
            size="small"
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={hasExcessDecimals}
            helperText={hasExcessDecimals ? 'Max 2 decimal places (e.g. 5.00)' : undefined}
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
            sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: '#f8fbff' } }}
          />

          {/* ── Reason ── */}
          <TextField
            fullWidth
            size="small"
            label="Reason (required)"
            placeholder="e.g. Refund for duplicate charge, promotional credit"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            multiline
            minRows={2}
            error={!!reasonError}
            helperText={reasonError ?? 'Visible on the ledger entry'}
            sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: '#f8fbff' } }}
          />

          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
              {error}
            </Alert>
          )}

          {reconcile?.matches && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: '12px' }}>
              Reconciliation passed — cached balance matches ledger (
              {reconcile.cached_balance.toFixed(2)}).
            </Alert>
          )}

          {/* ── Review button (opens dialog) ── */}
          <Button
            variant="contained"
            disabled={!canReview}
            onClick={handleReview}
            sx={{
              borderRadius: '14px',
              fontWeight: 700,
              background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
              '&:hover': { background: 'linear-gradient(90deg, #1d4ed8, #2563eb)' },
            }}
          >
            Review adjustment
          </Button>
        </>
      )}

      {/* ── Confirmation dialog ── */}
      {confirming && selectedWallet && (
        <ConfirmDialog
          open={confirming}
          direction={direction}
          amount={parsedAmount}
          currency={selectedWallet.currency}
          reason={reason}
          targetLabel={
            searchUser
              ? searchUser.full_name
                ? `${searchUser.full_name} (@${searchUser.username})`
                : `@${searchUser.username}`
              : selectedWallet.label
          }
          balanceBefore={selectedWallet.balance}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setConfirming(false)}
          loading={loading}
        />
      )}
    </Box>
  );
}
