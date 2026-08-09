import { useTheme } from '@mui/material';
import { SnackbarProvider } from 'notistack';
import SnackbarCloseButton from 'components/snackbar/SnackbarCloseButton';
import SnackbarIcon from 'components/snackbar/SnackbarIcon';

const NotistackProvider = ({ children }) => {
  const theme = useTheme();

  return (
    <SnackbarProvider
      maxSnack={10}
      anchorOrigin={{
        horizontal: theme.direction === 'rtl' ? 'left' : 'right',
        vertical: 'top',
      }}
      iconVariant={{
        default: (
          <SnackbarIcon variant="default" icon="material-symbols:waving-hand-outline-rounded" />
        ),
        success: (
          <SnackbarIcon variant="success" icon="material-symbols:check-box-outline-rounded" />
        ),
        error: <SnackbarIcon variant="error" icon="material-symbols:info-outline-rounded" />,
        warning: <SnackbarIcon variant="warning" icon="material-symbols:warning-outline-rounded" />,
        info: <SnackbarIcon variant="info" icon="material-symbols:info-outline-rounded" />,
      }}
      action={(key) => <SnackbarCloseButton snackbarKey={key} />}
    >
      {children}
    </SnackbarProvider>
  );
};

export default NotistackProvider;
