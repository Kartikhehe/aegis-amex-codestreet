import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Popover,
  Stack,
  Typography,
} from '@mui/material';
import { useAuth } from 'providers/AuthProvider';
import paths from 'routes/paths';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * The profile menu.
 *
 * Shows the signed-in role prominently, because in this console the role is
 * not a detail -- it decides what the operator can see and do. An
 * agent_operator looking at a fleet number they cannot act on should be able
 * to tell why at a glance.
 */

const ROLE_LABELS = {
  operator: 'Operator',
  agent_operator: 'Agent operator',
  card_member: 'Card member',
};

const ProfileMenu = () => {
  const [anchor, setAnchor] = useState(null);
  const { sessionUser, signout } = useAuth();
  const navigate = useNavigate();

  const name = sessionUser?.name ?? 'Signed out';
  const role = sessionUser?.role;

  const handleSignOut = () => {
    signout?.();
    setAnchor(null);
    navigate(paths.defaultJwtLogin);
  };

  return (
    <>
      <IconButton onClick={(event) => setAnchor(event.currentTarget)} size="small">
        <Avatar sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 700 }}>
          {name.slice(0, 1).toUpperCase()}
        </Avatar>
      </IconButton>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 280, mt: 1 } } }}
      >
        <Stack spacing={1} sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ width: 40, height: 40, fontWeight: 700 }}>
              {name.slice(0, 1).toUpperCase()}
            </Avatar>
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {name}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {sessionUser?.email ?? '—'}
              </Typography>
            </Stack>
          </Stack>

          {role && (
            <Box>
              <Chip
                size="small"
                variant="soft"
                color={role === 'operator' ? 'primary' : 'neutral'}
                label={ROLE_LABELS[role] ?? role}
              />
            </Box>
          )}
        </Stack>

        <Divider />

        <Stack sx={{ p: 1.5 }}>
          <Button
            fullWidth
            variant="text"
            color="neutral"
            startIcon={<IconifyIcon icon="material-symbols:logout-rounded" />}
            onClick={handleSignOut}
            sx={{ justifyContent: 'flex-start' }}
          >
            Sign out
          </Button>
        </Stack>
      </Popover>
    </>
  );
};

export default ProfileMenu;
