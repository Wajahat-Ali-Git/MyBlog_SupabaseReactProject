import { Box, Chip, CircularProgress, Skeleton, Typography } from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import type { WalletInfo } from '../services/walletService';

interface BalanceCardProps {
  wallet: WalletInfo | null;
  balance: number | null;
  loading: boolean;
}

const statusColor: Record<string, string> = {
  ACTIVE: '#22c55e',
  SUSPENDED: '#f59e0b',
  CLOSED: '#ef4444',
};

export default function BalanceCard({ wallet, balance, loading }: BalanceCardProps) {
  const formatted =
    balance !== null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: wallet?.currency ?? 'USD' }).format(balance)
      : null;

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: '24px',
        p: { xs: '28px 24px', sm: '36px 40px' },
        background: '#ffffff',
        border: '1px solid rgba(59,130,246,0.18)',
        boxShadow: '0 24px 60px rgba(59,130,246,0.15)',
        overflow: 'hidden',
        color: '#0f172a',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '-40px',
          right: '-40px',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'rgba(59,130,246,0.70)',
          pointerEvents: 'none',
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          bottom: '-60px',
          left: '-20px',
          width: '220px',
          height: '220px',
          borderRadius: '50%',
          background: 'rgba(96,165,250,0.18)',
          pointerEvents: 'none',
        },
      }}
    >
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: { xs: 2, sm: 3 } }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '12px',
            background: 'rgba(59,130,246,0.98)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AccountBalanceWalletIcon sx={{ fontSize: 24, color: '#ffffff' }} />
        </Box>
        <Box>
          <Typography sx={{ color:"#000000", fontSize: '14px', fontWeight: 600, opacity: 0.95, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Total Balance
          </Typography>
          {wallet && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
              <Chip
                label={wallet.status}
                size="small"
                sx={{
                  height: 18,
                  fontSize: '10px',
                  fontWeight: 700,
                  bgcolor: statusColor[wallet.status] ?? '#6b7280',
                  color: '#fff',
                  '& .MuiChip-label': { px: 1 },
                }}
              />
              <Typography sx={{ fontSize: '11px', opacity: 0.85, color: '#000000' }}>{wallet.currency}</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Balance amount */}
      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 1 }}>
          <CircularProgress size={20} sx={{ color: '#2563eb' }} />
          <Skeleton variant="text" width={160} height={56} sx={{ bgcolor: '#e2e8f0', borderRadius: 2 }} />
        </Box>
      ) : (
        <Typography
          sx={{
            fontSize: { xs: '30px', sm: '48px' },
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontFamily: '"Inter", "Roboto", monospace',
            mb: 1,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          }}
        >
          {formatted ?? '$0.00'}
        </Typography>
      )}

      {/* Wallet ID hint */}
      {wallet && !loading && (
        <Typography sx={{ fontSize: '11px', opacity: 0.9, mt: 1, fontFamily: 'monospace', letterSpacing: '0.04em', color: '#000000' }}>
          ID: {wallet.id.slice(0, 8)}…
        </Typography>
      )}
    </Box>
  );
}
