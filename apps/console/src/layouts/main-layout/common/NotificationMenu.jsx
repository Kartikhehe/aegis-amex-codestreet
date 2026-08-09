import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Box, Button, IconButton, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { formatRelative } from 'aegis/format';
import { useIncidents } from 'aegis/hooks';
import paths from 'routes/paths';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * The topbar bell, wired to REAL compliance events.
 *
 * Aurora shipped this as a static demo list. In a governance console a
 * notification bell that shows invented data is worse than no bell at all --
 * an operator learns to ignore it, and then ignores it on the day a breaker
 * actually trips. It now reads the same /incidents feed the Incidents screen
 * does, and injections are marked in red.
 */
const NotificationMenu = () => {
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const { data: incidents } = useIncidents({ limit: 8 });

  const items = incidents ?? [];
  const unread = items.filter((incident) => !incident.acknowledged).length;

  return (
    <>
      <Tooltip title="Compliance events">
        <IconButton onClick={(event) => setAnchor(event.currentTarget)} size="small">
          <Badge badgeContent={unread} color="error" max={99}>
            <IconifyIcon
              icon="material-symbols:notifications-outline-rounded"
              sx={{ fontSize: 22 }}
            />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: '100vw', mt: 1 } } }}
      >
        <Stack sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Compliance events
          </Typography>
        </Stack>

        <Box sx={{ maxHeight: 400, overflowY: 'auto', px: 1 }}>
          {items.length === 0 ? (
            <Stack alignItems="center" spacing={0.5} sx={{ py: 4, px: 2, textAlign: 'center' }}>
              <IconifyIcon
                icon="material-symbols:shield-outline-rounded"
                sx={{ fontSize: 28, color: 'text.disabled' }}
              />
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Nothing has tripped
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Circuit breakers appear here when an agent's behaviour degrades as a pattern.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={0.5} sx={{ pb: 1 }}>
              {items.map((incident) => (
                <Stack
                  key={incident.event_id}
                  direction="row"
                  spacing={1.25}
                  alignItems="flex-start"
                  onClick={() => {
                    navigate(paths.aegisIncidents);
                    setAnchor(null);
                  }}
                  sx={(theme) => ({
                    p: 1.25,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: theme.vars.palette.background.elevation2 },
                  })}
                >
                  <IconifyIcon
                    icon={
                      incident.suspected_prompt_injection
                        ? 'material-symbols:e911-emergency-rounded'
                        : 'material-symbols:electric-bolt-outline-rounded'
                    }
                    sx={{
                      fontSize: 18,
                      mt: 0.25,
                      flexShrink: 0,
                      color: incident.severity === 'critical' ? 'error.main' : 'warning.main',
                    }}
                  />
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 700,
                        color: incident.suspected_prompt_injection ? 'error.main' : 'text.primary',
                      }}
                    >
                      {incident.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {incident.agent_name || incident.operator_id} ·{' '}
                      {formatRelative(incident.created_at)}
                    </Typography>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        {items.length > 0 && (
          <Stack sx={{ p: 1.5, pt: 1 }}>
            <Button
              fullWidth
              variant="text"
              size="small"
              onClick={() => {
                navigate(paths.aegisIncidents);
                setAnchor(null);
              }}
            >
              View all incidents
            </Button>
          </Stack>
        )}
      </Popover>
    </>
  );
};

export default NotificationMenu;
