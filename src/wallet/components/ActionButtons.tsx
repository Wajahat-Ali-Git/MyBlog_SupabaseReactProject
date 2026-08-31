import { Box, Button, Tooltip } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineOutlined';
import SendIcon from '@mui/icons-material/Send';
import HistoryIcon from '@mui/icons-material/History';
import RefreshIcon from '@mui/icons-material/Refresh';

interface ActionButtonsProps {
  onTopUp: () => void;
  onTransfer: () => void;
  onToggleHistory: () => void;
  onRefresh: () => void;
  historyVisible: boolean;
  disabled?: boolean;
}

interface ActionBtn {
  area: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  gradient: string;
  shadow: string;
  tooltip?: string;
}

export default function ActionButtons({
  onTopUp,
  onTransfer,
  onToggleHistory,
  onRefresh,
  historyVisible,
  disabled,
}: ActionButtonsProps) {
  const buttons: ActionBtn[] = [
    {
      area: 'topup',
      label: 'Top Up',
      icon: <AddCircleOutlineIcon sx={{ fontSize: 20 }} />,
      onClick: onTopUp,
      gradient: 'linear-gradient(135deg, #2563eb, #3b82f6)',
      shadow: 'rgba(59,130,246,0.35)',
      tooltip: 'Add funds to your wallet',
    },
    {
      area: 'transfer',
      label: 'Transfer',
      icon: <SendIcon sx={{ fontSize: 18 }} />,
      onClick: onTransfer,
      gradient: 'linear-gradient(135deg, #38bdf8, #0ea5e9)',
      shadow: 'rgba(14,165,233,0.35)',
      tooltip: 'Send money to another user',
    },
    {
      area: 'history',
      label: historyVisible ? 'Hide History' : 'History',
      icon: <HistoryIcon sx={{ fontSize: 20 }} />,
      onClick: onToggleHistory,
      gradient: historyVisible
        ? 'linear-gradient(135deg, #bfdbfe, #93c5fd)'
        : 'linear-gradient(135deg, #60a5fa, #3b82f6)',
      shadow: historyVisible ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.35)',
      tooltip: 'View transaction history',
    },
  ];

  return (
    // 2x2 grid on narrow phones (Top Up/Transfer, then History/Refresh) so
    // no row ever needs to fit more than two buttons side by side; a single
    // row of four once there's room, from `sm` up.
    <Box
      sx={{
        display: 'grid',
        gap: { xs: 1, sm: 1.5 },
        gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr auto' },
        gridTemplateAreas: {
          xs: `"topup transfer" "history refresh"`,
          sm: `"topup transfer history refresh"`,
        },
      }}
    >
      {buttons.map((btn) => (
        <Tooltip key={btn.label} title={btn.tooltip ?? ''} arrow placement="top">
          <Box sx={{ gridArea: btn.area, minWidth: 0 }}>
            <Button
              fullWidth
              variant="contained"
              disabled={disabled}
              startIcon={btn.icon}
              onClick={btn.onClick}
              sx={{
                borderRadius: '14px',
                py: { xs: 1.2, sm: 1.4 },
                px: { xs: 1, sm: 2 },
                fontWeight: 700,
                fontSize: { xs: '12px', sm: '13px' },
                textTransform: 'none',
                background: btn.gradient,
                color: '#fff',
                boxShadow: `0 6px 20px ${btn.shadow}`,
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: `0 10px 28px ${btn.shadow}`,
                },
                '&:active': { transform: 'translateY(0)' },
                '&:disabled': {
                  background: 'rgba(59,130,246,0.16)',
                  color: 'rgba(15,23,42,0.4)',
                  boxShadow: 'none',
                },
                '&.MuiButton-contained': {
                  color: '#0f172a',
                },
              }}
            >
              {btn.label}
            </Button>
          </Box>
        </Tooltip>
      ))}

      {/* Refresh button */}
      <Tooltip title="Refresh balance & history" arrow placement="top">
        <Box sx={{ gridArea: 'refresh', minWidth: 0 }}>
          <Button
            fullWidth
            variant="outlined"
            disabled={disabled}
            onClick={onRefresh}
            sx={{
              borderRadius: '14px',
              py: { xs: 1.2, sm: 1.4 },
              minWidth: { xs: 0, sm: '48px' },
              width: { xs: '100%', sm: '48px' },
              borderColor: 'rgba(59,130,246,0.35)',
              color: '#2563eb',
              '&:hover': {
                borderColor: '#2563eb',
                color: '#1d4ed8',
                bgcolor: 'rgba(59,130,246,0.08)',
              },
              '& .refresh-icon': { transition: 'transform 0.25s ease' },
              '&:hover .refresh-icon': { transform: 'rotate(90deg)' },
              transition: 'all 0.25s ease',
              '&:disabled': { borderColor: 'rgba(96,165,250,0.16)', color: 'rgba(96,165,250,0.4)' },
            }}
          >
            <RefreshIcon className="refresh-icon" sx={{ fontSize: 20 }} />
          </Button>
        </Box>
      </Tooltip>
    </Box>
  );
}
