import { Button, Stack, Typography } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * Empty states name the space and the next action.
 *
 * "No data" tells the reader nothing they did not already know. An empty state
 * should say what would live here, why it is empty, and what to do about it --
 * otherwise it reads as a broken screen rather than a quiet one.
 */
const EmptyState = ({
  icon = 'material-symbols:inbox-rounded',
  title,
  body,
  action,
  onAction,
  dense = false,
}) => (
  <Stack
    alignItems="center"
    justifyContent="center"
    spacing={1.25}
    sx={{ py: dense ? 4 : 8, px: 3, textAlign: 'center' }}
  >
    <IconifyIcon icon={icon} sx={{ fontSize: dense ? 28 : 36, color: 'text.disabled' }} />
    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
      {title}
    </Typography>
    {body && (
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
        {body}
      </Typography>
    )}
    {action && onAction && (
      <Button variant="outlined" size="small" onClick={onAction} sx={{ mt: 0.5 }}>
        {action}
      </Button>
    )}
  </Stack>
);

export default EmptyState;
