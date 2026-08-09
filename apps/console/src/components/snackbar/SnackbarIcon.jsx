import { Stack, useTheme } from '@mui/material';
import { cssVarRgba } from 'lib/utils';
import IconifyIcon from 'components/base/IconifyIcon';

const SnackbarIcon = ({ variant, icon }) => {
  const { vars } = useTheme();

  const color =
    variant === 'default' ? vars.palette.action.hoverChannel : vars.palette[variant].mainChannel;

  return (
    <Stack
      direction="row"
      className="notistack-Icon"
      sx={[
        {
          justifyContent: 'center',
          alignItems: 'center',
        },
        {
          height: 40,
          width: 40,
          borderRadius: '50%',
          mr: 1.5,
          bgcolor: cssVarRgba(color, 0.1),
          color: cssVarRgba(color, 1),
        },
      ]}
    >
      <IconifyIcon
        icon={icon}
        sx={{
          fontSize: 20,
        }}
      />
    </Stack>
  );
};

export default SnackbarIcon;
