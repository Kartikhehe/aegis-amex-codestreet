import { useId } from 'react';
import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import { registerIcons } from 'lib/iconify/iconify-register';

export const IconifyIcon = ({ icon, flipOnRTL = false, color, sx, ...rest }) => {
  const uniqueId = useId();

  registerIcons();

  return (
    <Box
      component={Icon}
      className="iconify"
      sx={[
        flipOnRTL && {
          transform: (theme) => (theme.direction === 'rtl' ? 'scaleX(-1)' : 'none'),
        },
        { verticalAlign: 'baseline' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
      icon={icon}
      id={uniqueId}
      color={color}
      ssr
    />
  );
};

export default IconifyIcon;
