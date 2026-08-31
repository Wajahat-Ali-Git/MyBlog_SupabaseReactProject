/**
 * TopUpRequestsPanel
 *
 * Admin component that lists all top-up requests with approve / reject actions.
 * Receives a live `requests` array from the parent (kept in sync via
 * useAdminTopUpNotifications) and calls back on approve/reject so the parent
 * can refresh state and show toasts.
 */

import { useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { approveTopUpRequest, rejectTopUpRequest, type TopUpRequest } from '../services/walletService';
import { getErrorMessage } from '../../utils/errors';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);

const fmtDate = (v: string) => new Date(v).toLocaleString();

function statusChip(status: string) {
  if (status === 'PENDING')
    return (
      <Chip
        icon={<HourglassEmptyIcon sx={{ fontSize: 13 }} />}
        label="Pending"
        size="small"
        sx={{ fontWeight: 600, bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}
      />
    );
  if (status === 'APPROVED')
    return (
      <Chip
        icon={<CheckCircleOutlinedIcon sx={{ fontSize: 13 }} />}
        label="Approved"
        size="small"
        sx={{ fontWeight: 600, bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}
      />
    );
  return (
    <Chip
      icon={<CancelOutlinedIcon sx={{ fontSize: 13 }} />}
      label="Rejected"
      size="small"
      sx={{ fontWeight: 600, bgcolor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }}
    />
  );
}

function memberInitials(memberId: string) {
  return memberId.slice(0, 2).toUpperCase();
}

// ─── Reject dialog ────────────────────────────────────────────────────────────

interface RejectDialogProps {
  open: boolean;
  amount: number;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function RejectDialog({ open, amount, onConfirm, onCancel, loading }: RejectDialogProps) {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '16px' } } }}
    >
      <DialogTitle sx={{ fontWeight: 700, color: '#0f172a' }}>Reject top-up request</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2 }}>
          You are about to reject a {fmt(amount)} top-up request. The user will be notified.
          Optionally provide a reason.
        </Typography>
        <TextField
          fullWidth
          size="small"
          label="Rejection note (optional)"
          placeholder="e.g. Duplicate request, invalid amount…"
          multiline
          minRows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} sx={{ fontWeight: 600 }} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => onConfirm(note)}
          disabled={loading}
          sx={{ borderRadius: '10px', fontWeight: 700 }}
        >
          {loading ? <CircularProgress size={18} color="inherit" /> : 'Reject'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TopUpRequestsPanelProps {
  requests: TopUpRequest[];
  loading: boolean;
  onApproved: (requestId: string, newBalance: number) => void;
  onRejected: (requestId: string) => void;
}

type FilterTab = 'pending' | 'all';

export default function TopUpRequestsPanel({
  requests,
  loading,
  onApproved,
  onRejected,
}: TopUpRequestsPanelProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TopUpRequest | null>(null);

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  const visible =
    filterTab === 'pending' ? requests.filter((r) => r.status === 'PENDING') : requests;

  const handleApprove = async (req: TopUpRequest) => {
    setActionLoading(req.id);
    setActionError(null);
    try {
      const newBalance = await approveTopUpRequest(req.id);
      onApproved(req.id, newBalance);
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Approval failed.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async (note: string) => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget.id);
    setActionError(null);
    try {
      await rejectTopUpRequest(rejectTarget.id, note || undefined);
      onRejected(rejectTarget.id);
      setRejectTarget(null);
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Rejection failed.'));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Box>
      {/* Filter tabs */}
      <Tabs
        value={filterTab}
        onChange={(_, v: FilterTab) => setFilterTab(v)}
        textColor="primary"
        indicatorColor="primary"
        sx={{ mb: 2, '& .MuiTab-root': { fontWeight: 600, textTransform: 'none', minHeight: 36 } }}
      >
        <Tab
          value="pending"
          label={
            <Badge badgeContent={pendingCount} color="warning" sx={{ pr: pendingCount > 0 ? 1.5 : 0 }}>
              Pending
            </Badge>
          }
        />
        <Tab value="all" label={`All (${requests.length})`} />
      </Tabs>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : visible.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <HourglassEmptyIcon sx={{ fontSize: 40, color: '#cbd5e1', mb: 1 }} />
          <Typography sx={{ color: '#94a3b8', fontSize: 14 }}>
            {filterTab === 'pending' ? 'No pending top-up requests.' : 'No requests yet.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {visible.map((req) => {
            const isActing = actionLoading === req.id;
            return (
              <Box
                key={req.id}
                sx={{
                  p: 2,
                  borderRadius: '14px',
                  bgcolor: '#f8fbff',
                  border: `1px solid ${req.status === 'PENDING' ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.12)'}`,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 1,
                    mb: 0.5,
                  }}
                >
                  {/* Left: member info */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar sx={{ width: 34, height: 34, fontSize: 12, bgcolor: '#2563eb' }}>
                      {memberInitials(req.member_id)}
                    </Avatar>
                    <Box>
                      <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
                        {fmt(req.amount, req.currency)}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                        Member {req.member_id.slice(0, 8)}… · {fmtDate(req.created_at)}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Right: status + actions */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    {statusChip(req.status)}
                    {req.status === 'PENDING' && (
                      <>
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          disabled={isActing}
                          onClick={() => void handleApprove(req)}
                          startIcon={
                            isActing ? (
                              <CircularProgress size={13} color="inherit" />
                            ) : (
                              <CheckCircleOutlinedIcon fontSize="small" />
                            )
                          }
                          sx={{ borderRadius: '10px', fontWeight: 700, textTransform: 'none', fontSize: 12 }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={isActing}
                          onClick={() => setRejectTarget(req)}
                          startIcon={<CancelOutlinedIcon fontSize="small" />}
                          sx={{ borderRadius: '10px', fontWeight: 700, textTransform: 'none', fontSize: 12 }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </Box>
                </Box>

                {/* Rejection note */}
                {req.status === 'REJECTED' && req.rejection_note && (
                  <Typography sx={{ fontSize: 12, color: '#dc2626', mt: 0.5 }}>
                    Note: {req.rejection_note}
                  </Typography>
                )}

                {/* Payment reference */}
                {req.payment_reference && (
                  <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.25 }}>
                    Ref: {req.payment_reference}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Reject confirmation dialog */}
      {rejectTarget && (
        <RejectDialog
          open
          amount={rejectTarget.amount}
          loading={actionLoading === rejectTarget.id}
          onConfirm={(note) => void handleRejectConfirm(note)}
          onCancel={() => setRejectTarget(null)}
        />
      )}
    </Box>
  );
}
