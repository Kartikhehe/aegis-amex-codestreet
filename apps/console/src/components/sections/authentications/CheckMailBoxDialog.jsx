import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Link,
  Stack,
  Typography,
  paperClasses,
} from '@mui/material';
import illustrationDark from 'assets/images/illustrations/3-dark.webp';
import illustration from 'assets/images/illustrations/3.webp';
import IconifyIcon from 'components/base/IconifyIcon';
import Image from 'components/base/Image';

const CheckMailBoxDialog = ({ open, handleClose, email, time, handleSendAgain }) => {
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      sx={{
        [`& .${paperClasses.root}`]: {
          borderRadius: 4,
          maxWidth: 515,
        },
      }}
    >
      <DialogContent sx={{ textAlign: 'center', p: 5 }}>
        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            position: 'absolute',
            right: 32,
            top: 24,
          }}
        >
          <IconifyIcon icon="material-symbols:close-rounded" sx={{ fontSize: 20 }} />
        </IconButton>
        {import.meta.env.VITE_BUILD_MODE === 'production' && (
          <Alert
            severity="info"
            icon={<IconifyIcon icon="material-symbols:info-outline-rounded" />}
            sx={{ mb: 6, mt: 5 }}
          >
            <Typography>
              <Box
                component="span"
                sx={{
                  fontWeight: 700,
                }}
              >
                Note:
              </Box>{' '}
              This is a demo feature.
            </Typography>
          </Alert>
        )}
        <Stack
          sx={{
            justifyContent: 'center',
            mb: 3,
          }}
        >
          <Image
            src={{ light: illustration, dark: illustrationDark }}
            alt=""
            width={320}
            height={240}
          />
        </Stack>
        <DialogTitle sx={{ typography: 'h5', fontWeight: 500 }}>Check your mailbox!</DialogTitle>
        <DialogContentText sx={{ typography: 'body1', color: 'text.primary' }}>
          An email containing a password reset link has been sent to your email address{' '}
          <Box component="span" sx={{ fontWeight: 500 }}>
            {email}
          </Box>
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', p: 5, pt: 0 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 500,
            color: 'text.secondary',
          }}
        >
          Didn’t receive the code?{' '}
          <Link href="#!" onClick={handleSendAgain} sx={[time > 0 && { pointerEvents: 'none' }]}>
            Send again
            {time > 0 ? ` in ${time} s` : ''}
          </Link>
        </Typography>
      </DialogActions>
    </Dialog>
  );
};

export default CheckMailBoxDialog;
