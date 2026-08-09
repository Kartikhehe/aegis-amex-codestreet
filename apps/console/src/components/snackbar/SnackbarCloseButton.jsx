import { IconButton } from '@mui/material';
import { useSnackbar } from 'notistack';
import IconifyIcon from 'components/base/IconifyIcon';

const SnackbarCloseButton = ({ snackbarKey }) => {
  const { closeSnackbar } = useSnackbar();

  return (
    <IconButton
      className="notistack-close-btn"
      onClick={() => closeSnackbar(snackbarKey)}
      sx={{ mr: 1 }}
    >
      <IconifyIcon
        icon="material-symbols:close-rounded"
        sx={{
          fontSize: 20,
        }}
      />
    </IconButton>
  );
};

export default SnackbarCloseButton;
