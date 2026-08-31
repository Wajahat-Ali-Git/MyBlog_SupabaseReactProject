import { useEffect, useRef, useState } from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { searchWalletUsers, type LookupResult } from '../services/walletService';

interface UserSearchBoxProps {
  /** Called when the user picks a result (or clears the field) */
  onSelect: (result: LookupResult | null) => void;
  /** Currently selected value (controlled) */
  value: LookupResult | null;
  label?: string;
  placeholder?: string;
}

function initials(result: LookupResult) {
  const name = result.full_name ?? result.username;
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function UserSearchBox({
  onSelect,
  value,
  label = 'Search user',
  placeholder = 'Type a username or name…',
}: UserSearchBoxProps) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<LookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Too short to search — nothing to debounce, options stay hidden via `visibleOptions` below.
    if (inputValue.trim().length < 3) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchWalletUsers(inputValue.trim());
        setOptions(results);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue]);

  const visibleOptions = inputValue.trim().length < 3 ? [] : options;

  return (
    <Autocomplete<LookupResult>
      options={visibleOptions}
      value={value}
      inputValue={inputValue}
      onInputChange={(_, v) => setInputValue(v)}
      onChange={(_, v) => {
        onSelect(v);
        if (!v) setOptions([]);
      }}
      loading={loading}
      filterOptions={(x) => x} // server-side filtering — don't re-filter on client
      getOptionLabel={(o) => o.full_name ? `${o.full_name} (@${o.username})` : `@${o.username}`}
      isOptionEqualToValue={(a, b) => a.wallet_id === b.wallet_id}
      noOptionsText={
        inputValue.trim().length < 3 ? 'Type at least 3 characters' : 'No users found'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          size="small"
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              startAdornment: (
                <>
                  <PersonSearchIcon sx={{ color: '#94a3b8', mr: 0.5, fontSize: 20 }} />
                  {params.slotProps.input.startAdornment}
                </>
              ),
              endAdornment: (
                <>
                  {loading && <CircularProgress size={16} sx={{ mr: 1 }} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: '#f8fbff' },
          }}
        />
      )}
      renderOption={(props, option) => (
        <Box
          component="li"
          {...props}
          key={option.wallet_id}
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, px: 2 }}
        >
          <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: '#2563eb' }}>
            {initials(option)}
          </Avatar>
          <Box>
            <Typography sx={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
              {option.full_name ?? option.username}
            </Typography>
            <Typography sx={{ fontSize: 12, color: '#64748b' }}>
              @{option.username}
            </Typography>
          </Box>
        </Box>
      )}
    />
  );
}
