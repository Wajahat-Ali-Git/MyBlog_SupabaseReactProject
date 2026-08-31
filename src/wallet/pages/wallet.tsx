import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  Container,
  Snackbar,
  Typography,
} from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { useAuth } from '../../contexts/authContext';
import {
  getMyWallet,
  getBalance,
  getTransactionHistory,
  createWallet,
  reconcileWallet,
  type WalletInfo,
  type Transaction,
} from '../services/walletService';
import { supabase } from '../../services/supabase';
import { useTopUpNotifications } from '../hooks/useTopUpNotifications';
import { markAllSeen } from '../hooks/useUnseenTopUpCount';

import BalanceCard from '../components/BalanceCard';
import ActionButtons from '../components/ActionButtons';
import TopUpModal from '../components/TopUpModal';
import TransferModal from '../components/TransferModal';
import TransactionHistory from '../components/TransactionHistory';
import BackButton from '../../components/backButton';

// ─── Toast helper type ───────────────────────────────────────────────────────
interface Toast {
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
}

const TX_PAGE_SIZE = 10;

// ─── Component ───────────────────────────────────────────────────────────────
const Wallet = () => {
  const { user, loading: authLoading } = useAuth();

  // Wallet state
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txHasMore, setTxHasMore] = useState(false);

  // Loading states
  const [walletLoading, setWalletLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);

  // Modal visibility
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(true);

  // Enable-wallet flow
  const [enabling, setEnabling] = useState(false);

  // Track the request the user most recently submitted so the modal
  // can show its live approval/rejection status.
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<Toast | null>(null);

  // Realtime channel for wallet balance updates
  const walletChannelRef = useRef<RealtimeChannel | null>(null);

  // Keep a stable ref to the latest wallet so realtime callbacks
  // (which close over stale state) can always read the current value.
  const walletRef = useRef<WalletInfo | null>(null);
  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  // ─── Top-up request notifications ──────────────────────────────────────────

  const { requests: topUpRequests, pendingCount, refresh: refreshRequests } = useTopUpNotifications({
    userId: user?.id ?? null,
    onApproved: (_requestId, _balance) => {
      const currentWallet = walletRef.current;
      if (!currentWallet?.id) return;
      void getBalance(currentWallet.id).then((bal) => {
        setBalance(bal);
        setToast({
          message: `Your top-up was approved! New balance: $${bal.toFixed(2)}`,
          severity: 'success',
        });
        reloadFirstPage();
      });
    },
    onRejected: (_requestId, note) => {
      setToast({
        message: note
          ? `Your top-up request was rejected: ${note}`
          : 'Your top-up request was rejected by the admin.',
        severity: 'error',
      });
    },
  });

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadWallet = useCallback(async () => {
    if (authLoading || !user?.id) {
      if (!authLoading) setWalletLoading(false);
      return;
    }
    setWalletLoading(true);
    try {
      const walletData = await getMyWallet();
      setWallet(walletData);
      if (walletData) {
        const bal = await getBalance(walletData.id);
        setBalance(bal);
      }
    } catch (err: unknown) {
      console.error('Failed to load wallet:', err);
      setToast({ message: 'Failed to load wallet data.', severity: 'error' });
    } finally {
      setWalletLoading(false);
    }
  }, [authLoading, user?.id]);

  const loadTransactions = useCallback(async (page: number) => {
    if (!wallet?.id) return;
    setTxLoading(true);
    try {
      const txs = await getTransactionHistory(wallet.id, TX_PAGE_SIZE, (page - 1) * TX_PAGE_SIZE);
      setTransactions(txs);
      setTxHasMore(txs.length === TX_PAGE_SIZE);
    } catch (err: unknown) {
      console.error('Failed to load transactions:', err);
    } finally {
      setTxLoading(false);
    }
  }, [wallet]);

  // Jumps back to the first page and reloads it — used whenever new
  // transaction activity happens so the newest entry is visible.
  const reloadFirstPage = useCallback(() => {
    setTxPage(1);
    void loadTransactions(1);
  }, [loadTransactions]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadWallet();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadWallet]);

  useEffect(() => {
    if (!wallet?.id || !historyVisible) return;
    const timeoutId = window.setTimeout(() => {
      void loadTransactions(txPage);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [wallet?.id, historyVisible, txPage, loadTransactions]);

  // ─── Realtime: wallet balance updates ─────────────────────────────────────
  // Subscribes to changes on the user's wallet row. Supabase realtime already
  // has wallets in its publication so this fires as soon as the admin approves.

  useEffect(() => {
    if (!wallet?.id) return;

    const channel = supabase
      .channel(`wallet:balance:${wallet.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'wallets',
          filter: `id=eq.${wallet.id}`,
        },
        (payload) => {
          // Use the value straight from the realtime payload — no round trip.
          const updated = payload.new as { balance_cached: number };
          setBalance(Number(updated.balance_cached));
          reloadFirstPage();
        },
      )
      .subscribe();

    walletChannelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      walletChannelRef.current = null;
    };
  }, [wallet?.id, reloadFirstPage]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleRefresh = () => {
    void loadWallet();
    void refreshRequests();
    if (historyVisible) reloadFirstPage();
  };

  const runReconcileCheck = async (walletId: string) => {
    try {
      const result = await reconcileWallet(walletId);
      if (!result.matches) {
        console.error('Wallet reconciliation mismatch:', result);
        setToast({
          message: `Balance mismatch detected (balance $${result.cached_balance.toFixed(2)} vs ledger $${result.ledger_balance.toFixed(2)}). Please contact support.`,
          severity: 'error',
        });
      }
    } catch (err: unknown) {
      console.error('Failed to reconcile wallet:', err);
    }
  };

  const handleTopUpRequestSubmitted = (requestId: string) => {
    setActiveRequestId(requestId);
    void refreshRequests();
    setToast({
      message: 'Top-up request submitted! Waiting for admin approval.',
      severity: 'info',
    });
  };

  const handleTransferSuccess = (newBalance: number) => {
    setBalance(newBalance);
    setToast({
      message: `Transfer sent! New balance: $${newBalance.toFixed(2)}`,
      severity: 'success',
    });
    reloadFirstPage();
    if (wallet) void runReconcileCheck(wallet.id);
  };

  const handleToggleHistory = () => {
    setHistoryVisible((v) => {
      if (!v && wallet?.id) void loadTransactions(txPage);
      return !v;
    });
  };

  const handleTxPrevPage = () => setTxPage((p) => Math.max(1, p - 1));
  const handleTxNextPage = () => {
    if (txHasMore) setTxPage((p) => p + 1);
  };

  const handleEnableWallet = async () => {
    setEnabling(true);
    try {
      await createWallet();
      await loadWallet();
    } catch (err: unknown) {
      console.error('Failed to enable wallet:', err);
      setToast({ message: 'Failed to enable wallet. Please try again.', severity: 'error' });
    } finally {
      setEnabling(false);
    }
  };

  const walletActive = wallet?.status === 'ACTIVE';

  // Mark all top-up notifications as seen when landing on the wallet page
  useEffect(() => {
    if (user?.id) markAllSeen(user.id);
  }, [user?.id]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f8fbff 0%, #e8f0ff 50%, #ffffff 100%)',
        py: { xs: 3, sm: 5 },
        px: 2,
      }}
    >
      <Container maxWidth="md" sx={{ px: { xs: 2, sm: 3, md: 0 } }} disableGutters>
        <BackButton />
        {/* Page header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: { xs: 2, sm: 3 } }}>
          <AccountBalanceWalletIcon sx={{ color: '#3A7FF1', fontSize: { xs: 30, sm: 36 } }} />
          <Box>
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: { xs: '1.5rem', sm: '1.8rem', md: '2rem' },
                color: '#0f172a',
                lineHeight: 1.2,
                fontFamily: '"Inter", "Roboto", sans-serif',
              }}
            >
              My Wallet
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'rgba(15,23,42,0.65)' }}>
              Manage your balance &amp; transactions
            </Typography>
          </Box>
        </Box>

        {/* Pending top-up banner */}
        {pendingCount > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.5,
              mb: 2,
              borderRadius: '12px',
              bgcolor: '#fffbeb',
              border: '1px solid #fde68a',
            }}
          >
            <HourglassEmptyIcon sx={{ color: '#d97706', fontSize: 20 }} />
            <Typography sx={{ fontSize: 13, color: '#92400e', flex: 1 }}>
              You have{' '}
              <strong>
                {pendingCount} pending top-up request{pendingCount > 1 ? 's' : ''}
              </strong>{' '}
              awaiting admin approval.
            </Typography>
            <Chip
              label={pendingCount}
              size="small"
              sx={{ fontWeight: 700, bgcolor: '#f59e0b', color: '#fff', minWidth: 28 }}
            />
          </Box>
        )}

        {!walletLoading && !walletActive ? (
          <Box
            sx={{
              borderRadius: '24px',
              bgcolor: '#ffffff',
              border: '1px solid rgba(59,130,246,0.18)',
              boxShadow: '0 24px 60px rgba(59,130,246,0.12)',
              p: { xs: 2.5, sm: 4, md: 5 },
              textAlign: 'center',
            }}
          >
            {wallet ? (
              <>
                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  Wallet {wallet.status === 'SUSPENDED' ? 'Suspended' : 'Closed'}
                </Typography>
                <Typography sx={{ fontSize: '14px', color: '#475569' }}>
                  Your wallet is currently {wallet.status.toLowerCase()}. Please contact support to
                  reactivate it.
                </Typography>
              </>
            ) : (
              <>
                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  Enable Wallet
                </Typography>
                <Typography sx={{ fontSize: '14px', color: '#475569', mb: 3 }}>
                  Your wallet is not enabled yet. Enable it to start topping up, transferring, and
                  tracking transactions.
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => void handleEnableWallet()}
                  disabled={enabling}
                  sx={{
                    borderRadius: '14px',
                    background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
                    color: '#fff',
                    px: 4,
                    py: 1.5,
                    fontWeight: 700,
                    '&:hover': { background: 'linear-gradient(90deg, #1d4ed8, #2563eb)' },
                  }}
                >
                  {enabling ? 'Enabling…' : 'Enable Wallet'}
                </Button>
              </>
            )}
          </Box>
        ) : (
          <>
            {/* Balance card */}
            <Box sx={{ mb: 3 }}>
              <BalanceCard wallet={wallet} balance={balance} loading={walletLoading} />
            </Box>

            {/* Action buttons — Top Up badge shows pending count */}
            <Box sx={{ mb: 3 }}>
              <Badge
                badgeContent={pendingCount}
                color="warning"
                overlap="rectangular"
                sx={{ width: '100%', '& .MuiBadge-badge': { top: 8, right: 8 } }}
              >
                <ActionButtons
                  disabled={walletLoading || !wallet}
                  onTopUp={() => setTopUpOpen(true)}
                  onTransfer={() => setTransferOpen(true)}
                  onToggleHistory={handleToggleHistory}
                  onRefresh={handleRefresh}
                  historyVisible={historyVisible}
                />
              </Badge>
            </Box>

            {/* Transaction history */}
            <Collapse in={historyVisible} unmountOnExit>
              <Box
                sx={{
                  borderRadius: '20px',
                  bgcolor: '#ffffff',
                  border: '1px solid rgba(59,130,246,0.18)',
                  boxShadow: '0 16px 40px rgba(59,130,246,0.08)',
                  p: { xs: 2.5, sm: 3 },
                }}
              >
                <TransactionHistory
                  transactions={transactions}
                  loading={txLoading}
                  currency={wallet?.currency}
                  page={txPage}
                  hasMore={txHasMore}
                  onPrevPage={handleTxPrevPage}
                  onNextPage={handleTxNextPage}
                />
              </Box>
            </Collapse>
          </>
        )}
      </Container>

      {/* Modals */}
      {wallet && walletActive && (
        <>
          <TopUpModal
            open={topUpOpen}
            onClose={() => {
              setTopUpOpen(false);
              setActiveRequestId(null);
            }}
            walletId={wallet.id}
            memberId={user?.id ?? ''}
            submittedRequestStatus={
              activeRequestId
                ? topUpRequests.find((r) => r.id === activeRequestId)?.status
                : undefined
            }
            onRequestSubmitted={handleTopUpRequestSubmitted}
          />
          <TransferModal
            open={transferOpen}
            onClose={() => setTransferOpen(false)}
            senderWalletId={wallet.id}
            currentBalance={balance}
            onSuccess={handleTransferSuccess}
          />
        </>
      )}

      {/* Toast notifications */}
      <Snackbar
        open={!!toast}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setToast(null)}
          severity={toast?.severity ?? 'info'}
          variant="filled"
          sx={{ borderRadius: '12px' }}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Wallet;
