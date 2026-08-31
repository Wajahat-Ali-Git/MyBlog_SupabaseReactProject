import {
  Box,
  Button,
  Chip,
  Skeleton,
  Tooltip,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import CallMadeIcon from '@mui/icons-material/CallMade';
import type { Transaction } from '../services/walletService';

interface TransactionHistoryProps {
  transactions: Transaction[];
  loading: boolean;
  currency?: string;
  page?: number;
  hasMore?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
}

// One entry per value in Transaction['transaction_type'] (walletService.ts) —
// every real transaction type must have a label/color here, or it renders
// as invisible white-on-white (the bug this fixes: the fallback colors
// were white text on a near-transparent white chip).
const TYPE_META: Record<
  Transaction['transaction_type'],
  { label: string; bg: string; color: string; border: string; icon: string }
> = {
  TOP_UP:              { label: 'Top Up',        bg: '#dcfce7', color: '#166534', border: '#bbf7d0', icon: '↓' },
  TRANSFER:             { label: 'Transfer',      bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', icon: '↔' },
  ADMIN_ADJUSTMENT:      { label: 'Adjustment',    bg: '#fef3c7', color: '#92400e', border: '#fde68a', icon: '⚙' },
  POST_PUBLISH_FEE:      { label: 'Publish Fee',   bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', icon: '📝' },
  SUBSCRIPTION_CHARGE:   { label: 'Subscription',  bg: '#f3e8ff', color: '#7c3aed', border: '#e9d5ff', icon: '📦' },
  RECURRING_POST_FEE:    { label: 'Annual Fee',    bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', icon: '📅' },
};

function DirectionIcon({ direction }: { direction: 'CREDIT' | 'DEBIT' }) {
  const isCredit = direction === 'CREDIT';
  return (
    <Tooltip title={isCredit ? 'Money In' : 'Money Out'}>
      <Box
        sx={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isCredit ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
          border: `2px solid ${isCredit ? '#86efac' : '#fca5a5'}`,
          transition: 'all 0.2s ease',
        }}
      >
        {isCredit ? (
          <CallReceivedIcon sx={{ fontSize: 20, color: '#16a34a', fontWeight: 700 }} />
        ) : (
          <CallMadeIcon sx={{ fontSize: 20, color: '#dc2626', fontWeight: 700 }} />
        )}
      </Box>
    </Tooltip>
  );
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function TransactionHistory({
  transactions,
  loading,
  currency,
  page = 1,
  hasMore = false,
  onPrevPage,
  onNextPage,
}: TransactionHistoryProps) {
  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>
            Transaction History
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#94a3b8', mt: 0.25 }}>
            All wallet activity in chronological order
          </Typography>
        </Box>
        {!loading && (
          <Chip
            label={`${transactions.length} record${transactions.length !== 1 ? 's' : ''}`}
            size="small"
            sx={{
              fontWeight: 700,
              bgcolor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              height: 28,
            }}
          />
        )}
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              height={72}
              sx={{ borderRadius: '14px', bgcolor: '#eff6ff' }}
            />
          ))}
        </Box>
      ) : transactions.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            textAlign: 'center',
            py: 8,
            borderRadius: '16px',
            border: '2px dashed rgba(59,130,246,0.25)',
            bgcolor: '#f8fbff',
          }}
        >
          <AdminPanelSettingsIcon sx={{ fontSize: 48, color: 'rgba(37,99,235,0.3)', mb: 1.5 }} />
          <Typography sx={{ color: '#0f172a', fontSize: '15px', fontWeight: 700, mb: 0.5 }}>
            No transactions yet
          </Typography>
          <Typography sx={{ color: '#64748b', fontSize: '13px' }}>
            Your transaction history will appear here
          </Typography>
        </Paper>
      ) : (
        <>
        {/* Mobile card list — the 4-column table below is unreadable/cramped
            under ~600px, so narrow screens get a stacked-card layout instead
            of a horizontally-squeezed table. */}
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1.25 }}>
          {transactions.map((tx) => {
            const isCredit = tx.direction === 'CREDIT';
            const activeCurrency = currency || 'USD';
            const amountFormatted = new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: activeCurrency,
            }).format(tx.amount);
            const balanceFormatted = new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: activeCurrency,
            }).format(tx.balance_after);
            const meta = TYPE_META[tx.transaction_type];

            return (
              <Box
                key={tx.transaction_id}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  p: 1.75,
                  borderRadius: '14px',
                  bgcolor: '#ffffff',
                  border: '1px solid rgba(59,130,246,0.15)',
                }}
              >
                <DirectionIcon direction={tx.direction} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                    <Chip
                      label={meta.label}
                      size="small"
                      sx={{
                        height: 20, fontSize: '10.5px', fontWeight: 700, flexShrink: 0, maxWidth: 'none',
                        bgcolor: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
                        '& .MuiChip-label': { px: 0.75, overflow: 'visible', textOverflow: 'clip' },
                      }}
                    />
                    <Typography sx={{ fontSize: '10.5px', color: '#94a3b8' }}>
                      {formatRelativeTime(tx.created_at)}
                    </Typography>
                  </Box>
                  {tx.reason && (
                    <Typography sx={{ fontSize: '12.5px', color: '#334155', fontWeight: 500, mb: 0.25 }}>
                      {tx.reason}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: '11px', color: '#94a3b8' }}>
                    Balance: {balanceFormatted}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    fontWeight: 800, fontSize: '13.5px', flexShrink: 0,
                    color: isCredit ? '#16a34a' : '#dc2626', fontFamily: 'monospace',
                  }}
                >
                  {isCredit ? '+' : '-'}{amountFormatted}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* Desktop/tablet table */}
        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            display: { xs: 'none', sm: 'block' },
            borderRadius: '16px',
            bgcolor: '#ffffff',
            border: '1px solid rgba(59,130,246,0.15)',
            overflow: 'hidden',
            '&:hover': { boxShadow: '0 8px 24px rgba(37,99,235,0.1)' },
            transition: 'box-shadow 0.2s ease',
          }}
        >
          <Table sx={{ '& tbody tr': { borderBottom: '1px solid rgba(59,130,246,0.08)' } }}>
            <TableHead>
              <TableRow sx={{ bgcolor: '#5b9cf1', borderBottom: '2px solid rgba(59,130,246,0.15)' }}>
                <TableCell sx={{ fontWeight: 800, color: '#0f172a', fontSize: '12px', py: 1.5, pl: 2 }}>
                  TYPE
                </TableCell>
                <TableCell sx={{ fontWeight: 800, color: '#0f172a', fontSize: '12px', py: 1.5 }}>
                  DESCRIPTION
                </TableCell>
                <TableCell sx={{ fontWeight: 800, color: '#0f172a', fontSize: '12px', py: 1.5, textAlign: 'right' }}>
                  AMOUNT
                </TableCell>
                <TableCell sx={{ fontWeight: 800, color: '#0f172a', fontSize: '12px', py: 1.5, textAlign: 'right', pr: 2 }}>
                  TIME
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map((tx, idx) => {
                const isCredit = tx.direction === 'CREDIT';
                const activeCurrency = currency || 'USD';
                const amountFormatted = new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: activeCurrency,
                }).format(tx.amount);
                const meta = TYPE_META[tx.transaction_type];
                const isLast = idx === transactions.length - 1;

                return (
                  <TableRow
                    key={tx.transaction_id}
                    sx={{
                      transition: 'background 0.15s ease',
                      '&:hover': { bgcolor: '#f8fbff' },
                      ...(isLast && { borderBottom: 'none' }),
                    }}
                  >
                    {/* Type chip */}
                    <TableCell sx={{ py: 1.75, pl: 2, pr: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <DirectionIcon direction={tx.direction} />
                        <Chip
                          label={meta.label}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '11px',
                            fontWeight: 700,
                            bgcolor: meta.bg,
                            color: meta.color,
                            border: `1px solid ${meta.border}`,
                            '& .MuiChip-label': { px: 0.75 },
                          }}
                        />
                      </Box>
                    </TableCell>

                    {/* Description / Reason */}
                    <TableCell sx={{ py: 1.75, pr: 1 }}>
                      <Box>
                        {tx.reason && (
                          <Typography sx={{ fontSize: '13px', color: '#000000', fontWeight: 500, mb: 0.25 }}>
                            {tx.reason}
                          </Typography>
                        )}
                        <Tooltip title={new Date(tx.created_at).toLocaleString()} arrow>
                          <Typography sx={{ fontSize: '11px', color: '#6f7885', cursor: 'default' }}>
                            {formatRelativeTime(tx.created_at)}
                          </Typography>
                        </Tooltip>
                      </Box>
                    </TableCell>

                    {/* Amount */}
                    <TableCell sx={{ py: 1.75, pr: 1, textAlign: 'right' }}>
                      <Typography
                        sx={{
                          fontWeight: 800,
                          fontSize: '14px',
                          color: isCredit ? '#16a34a' : '#dc2626',
                          fontFamily: 'monospace',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {isCredit ? '+' : '-'}{amountFormatted}
                      </Typography>
                    </TableCell>

                    {/* Time / Balance */}
                    <TableCell sx={{ py: 1.75, pr: 2, textAlign: 'right' }}>
                      <Box>
                        <Typography sx={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                          {new Date(tx.created_at).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Typography>
                        <Typography sx={{ fontSize: '10px', color: '#000000', mt: 0.25 }}>
                          Balance: {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: activeCurrency,
                          }).format(tx.balance_after)}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        </>
      )}

      {/* Pagination */}
      {!loading && (onPrevPage || onNextPage) && transactions.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            mt: 3,
          }}
        >
          <Button
            size="small"
            variant="outlined"
            disabled={!onPrevPage || page <= 1}
            onClick={onPrevPage}
            startIcon={<ChevronLeftIcon sx={{ fontSize: 16 }} />}
            sx={{
              borderRadius: '10px',
              fontWeight: 700,
              textTransform: 'none',
              fontSize: 12,
              borderColor: 'rgba(59,130,246,0.4)',
              color: '#2563eb',
              transition: 'all 0.2s ease',
              '&:hover:not(:disabled)': {
                borderColor: '#2563eb',
                bgcolor: '#eff6ff',
                boxShadow: '0 4px 12px rgba(37,99,235,0.15)',
              },
            }}
          >
            Previous
          </Button>
          <Typography sx={{ fontSize: '12px', color: '#64748b', fontWeight: 700, minWidth: 60, textAlign: 'center' }}>
            Page {page}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            disabled={!onNextPage || !hasMore}
            onClick={onNextPage}
            endIcon={<ChevronRightIcon sx={{ fontSize: 16 }} />}
            sx={{
              borderRadius: '10px',
              fontWeight: 700,
              textTransform: 'none',
              fontSize: 12,
              borderColor: 'rgba(59,130,246,0.4)',
              color: '#2563eb',
              transition: 'all 0.2s ease',
              '&:hover:not(:disabled)': {
                borderColor: '#2563eb',
                bgcolor: '#eff6ff',
                boxShadow: '0 4px 12px rgba(37,99,235,0.15)',
              },
            }}
          >
            Next
          </Button>
        </Box>
      )}
    </Box>
  );
}
