import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import { useEffect, useRef, useState } from 'react';
import { searchWalletUsers, transfer, type LookupResult } from '../services/walletService';
import { getErrorMessage } from '../../utils/errors';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  senderWalletId: string;
  currentBalance: number | null;
  onSuccess: (newBalance: number) => void;
}

type Step = 'search' | 'confirm' | 'review';

// ─── shared field style ────────────────────────────────────────────────────
const inputSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '12px',
    color: '#0f172a',
    bgcolor: '#f8fafc',
    '& fieldset': { borderColor: 'rgba(96,165,250,0.4)' },
    '&:hover fieldset': { borderColor: '#60a5fa' },
    '&.Mui-focused fieldset': { borderColor: '#2563eb' },
  },
  '& .MuiInputLabel-root': { color: 'rgba(71,85,105,0.85)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#2563eb' },
};

// ─── single result row ─────────────────────────────────────────────────────
function UserRow({ result, onSelect }: { result: LookupResult; onSelect: (r: LookupResult) => void }) {
  const initials = (result.full_name ?? result.username)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <ListItemButton
      onClick={() => onSelect(result)}
      sx={{
        borderRadius: '12px',
        px: 2,
        py: 1.25,
        gap: 1.5,
        '&:hover': { bgcolor: '#eff6ff' },
      }}
    >
      <Avatar sx={{ bgcolor: '#2563eb', width: 38, height: 38, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
        {initials}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', lineHeight: 1.3 }}>
          @{result.username}
          {result.full_name && (
            <Typography component="span" sx={{ fontWeight: 400, color: '#64748b', ml: 0.75, fontSize: '13px' }}>
              {result.full_name}
            </Typography>
          )}
        </Typography>
      </Box>
    </ListItemButton>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function TransferModal({
  open,
  onClose,
  senderWalletId,
  currentBalance,
  onSuccess,
}: TransferModalProps) {
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [selected, setSelected] = useState<LookupResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsedAmount = parseFloat(amount);
  // Mirror the DB guard: reject amounts with more than 2 decimal places.
  // parseFloat/toFixed round silently, so compare the raw string instead.
  const hasExcessDecimals =
    !isNaN(parsedAmount) && parsedAmount !== Math.round(parsedAmount * 100) / 100;
  const isAmountValid =
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    !hasExcessDecimals &&
    (currentBalance === null || parsedAmount <= currentBalance);

  // ── Live search with 350 ms debounce ──────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale results when the query is emptied
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchWalletUsers(query);
        setResults(data);
        setError(null);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Search failed.'));
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (result: LookupResult) => {
    setSelected(result);
    setStep('confirm');
    setError(null);
  };

  const handleReview = () => {
    if (!isAmountValid) return;
    setError(null);
    setStep('review');
  };

  const handleTransfer = async () => {
    if (!selected || !isAmountValid) return;
    setTransferLoading(true);
    setError(null);
    try {
      const result = await transfer(senderWalletId, selected.wallet_id, parsedAmount);
      onSuccess(result.sender_balance);
      handleClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Transfer failed.'));
    } finally {
      setTransferLoading(false);
    }
  };

  const handleClose = () => {
    setStep('search');
    setQuery('');
    setAmount('');
    setResults([]);
    setSelected(null);
    setError(null);
    onClose();
  };

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
            boxShadow: '0 24px 60px rgba(15,23,42,0.15)',
            overflow: 'hidden',
            margin: { xs: '16px', sm: '32px' },
          },
        },
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
          color: '#fff', px: 3, py: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SendIcon sx={{ color: '#fff', fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: '17px', lineHeight: 1.2 }}>Send Money</Typography>
            {(step === 'confirm' || step === 'review') && selected && (
              <Typography sx={{ fontSize: '11px', opacity: 0.75, mt: 0.25 }}>
                to @{selected.username}
              </Typography>
            )}
          </Box>
        </Box>
        <IconButton onClick={handleClose} size="small" sx={{ color: 'rgba(255,255,255,0.85)' }} aria-label="close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: '20px !important', pb: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: '10px', fontSize: '13px' }}>
            {error}
          </Alert>
        )}

        {/* ── Step 1: Search ── */}
        {step === 'search' && (
          <>
            <Typography sx={{ fontSize: '13px', color: '#64748b', mb: 2, lineHeight: 1.6 }}>
              Search by <strong>username</strong> or <strong>full name</strong> to find a recipient.
              Type at least 3 characters.
            </Typography>

            {/* Search input */}
            <TextField
              fullWidth
              autoFocus
              label="Search users"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setError(null); }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      {searching
                        ? <CircularProgress size={16} sx={{ color: '#2563eb' }} />
                        : <SearchIcon sx={{ color: '#2563eb' }} />}
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ ...inputSx, mb: 1.5 }}
            />

            {/* Results list */}
            {results.length > 0 && (
              <Box
                sx={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  bgcolor: '#fff',
                  boxShadow: '0 4px 16px rgba(15,23,42,0.07)',
                }}
              >
                <List disablePadding sx={{ p: 0.75 }}>
                  {results.map((r, i) => (
                    <Box key={r.wallet_id}>
                      {i > 0 && <Divider sx={{ my: 0.5, borderColor: '#f1f5f9' }} />}
                      <UserRow result={r} onSelect={handleSelect} />
                    </Box>
                  ))}
                </List>
              </Box>
            )}

            {/* No results state */}
            {!searching && query.trim().length > 0 && results.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 3, color: '#94a3b8' }}>
                <SearchIcon sx={{ fontSize: 36, opacity: 0.4, mb: 0.5 }} />
                <Typography sx={{ fontSize: '13px' }}>No users found for "{query}"</Typography>
              </Box>
            )}
          </>
        )}

        {/* ── Step 2: Confirm ── */}
        {step === 'confirm' && selected && (
          <>
            {/* Selected recipient card */}
            <Box
              sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 3,
                p: 2, borderRadius: '14px',
                bgcolor: '#eff6ff',
                border: '1px solid #bfdbfe',
              }}
            >
              <Avatar sx={{ bgcolor: '#2563eb', width: 44, height: 44, fontWeight: 700, fontSize: '15px' }}>
                {(selected.full_name ?? selected.username).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
                    @{selected.username}
                  </Typography>
                  <CheckCircleOutlineIcon sx={{ color: '#22c55e', fontSize: 16 }} />
                </Box>
                {selected.full_name && (
                  <Typography sx={{ fontSize: '12px', color: '#64748b' }}>{selected.full_name}</Typography>
                )}
              </Box>
              <Button
                size="small"
                onClick={() => { setStep('search'); setSelected(null); setError(null); setAmount(''); }}
                sx={{ ml: 'auto', color: '#2563eb', minWidth: 0, textTransform: 'none', fontSize: '12px', flexShrink: 0 }}
              >
                Change
              </Button>
            </Box>

            {/* Amount field */}
            <TextField
              fullWidth
              label="Amount"
              type="number"
              autoFocus
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleReview()}
              error={hasExcessDecimals}
              helperText={
                hasExcessDecimals
                  ? 'Max 2 decimal places (e.g. 1.50)'
                  : currentBalance !== null
                  ? `Available: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentBalance)}`
                  : undefined
              }
              slotProps={{
                htmlInput: { min: 0.01, step: 0.01 },
                formHelperText: { sx: { color: hasExcessDecimals ? '#dc2626' : '#94a3b8', mt: 0.5 } },
                input: {
                  startAdornment: <InputAdornment position="start" sx={{ color: '#2563eb' }}>$</InputAdornment>,
                },
              }}
              sx={{ ...inputSx, mb: 3 }}
            />

            {/* Continue button */}
            <Button
              fullWidth
              variant="contained"
              disabled={!isAmountValid}
              onClick={handleReview}
              sx={{
                borderRadius: '12px', py: 1.5, fontWeight: 700, fontSize: '15px', textTransform: 'none',
                background: isAmountValid
                  ? 'linear-gradient(90deg, #1d4ed8, #2563eb)'
                  : 'rgba(0,0,0,0.06)',
                boxShadow: isAmountValid ? '0 8px 24px rgba(37,99,235,0.3)' : 'none',
                color: isAmountValid ? '#fff' : '#94a3b8',
                '&:hover': { background: 'linear-gradient(90deg, #1e40af, #1d4ed8)' },
                '&:disabled': { color: '#94a3b8', background: 'rgba(0,0,0,0.06)' },
              }}
            >
              {isAmountValid ? 'Review Transfer' : 'Enter a Valid Amount'}
            </Button>
          </>
        )}

        {/* ── Step 3: Review & confirm ── */}
        {step === 'review' && selected && (
          <>
            <Typography sx={{ fontSize: '13px', color: '#64748b', mb: 2 }}>
              Please review the details below before sending.
            </Typography>

            <Box
              sx={{
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                bgcolor: '#f8fafc',
                mb: 3,
                overflow: 'hidden',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5 }}>
                <Typography sx={{ fontSize: '13px', color: '#64748b' }}>Recipient</Typography>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>@{selected.username}</Typography>
                  {selected.full_name && (
                    <Typography sx={{ fontSize: '12px', color: '#64748b' }}>{selected.full_name}</Typography>
                  )}
                </Box>
              </Box>
              <Divider sx={{ borderColor: '#e2e8f0' }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5 }}>
                <Typography sx={{ fontSize: '13px', color: '#64748b' }}>Amount</Typography>
                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  ${parsedAmount.toFixed(2)}
                </Typography>
              </Box>
              {currentBalance !== null && (
                <>
                  <Divider sx={{ borderColor: '#e2e8f0' }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5 }}>
                    <Typography sx={{ fontSize: '13px', color: '#64748b' }}>Balance after transfer</Typography>
                    <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                        currentBalance - parsedAmount,
                      )}
                    </Typography>
                  </Box>
                </>
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Button
                fullWidth
                variant="outlined"
                disabled={transferLoading}
                onClick={() => setStep('confirm')}
                sx={{
                  borderRadius: '12px', py: 1.5, fontWeight: 700, fontSize: '15px', textTransform: 'none',
                  borderColor: '#cbd5e1', color: '#475569',
                  '&:hover': { borderColor: '#94a3b8', bgcolor: '#f8fafc' },
                }}
              >
                Back
              </Button>
              <Button
                fullWidth
                variant="contained"
                disabled={transferLoading}
                onClick={handleTransfer}
                startIcon={transferLoading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                sx={{
                  borderRadius: '12px', py: 1.5, fontWeight: 700, fontSize: '15px', textTransform: 'none',
                  background: 'linear-gradient(90deg, #1d4ed8, #2563eb)',
                  boxShadow: '0 8px 24px rgba(37,99,235,0.3)',
                  color: '#fff',
                  '&:hover': { background: 'linear-gradient(90deg, #1e40af, #1d4ed8)' },
                }}
              >
                {transferLoading ? 'Sending…' : 'Confirm & Send'}
              </Button>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
