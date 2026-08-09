import { useRef } from 'react';
import { Box, Button, Stack, paperClasses } from '@mui/material';
import MuiAppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import { useBreakpoints } from 'providers/BreakpointsProvider';
import { useSettingsContext } from 'providers/SettingsProvider';
import IconifyIcon from 'components/base/IconifyIcon';
import Logo from 'components/common/Logo';
import AppbarActionItems from '../common/AppbarActionItems';

const AppBar = () => {
  const {
    config: { drawerWidth, sidenavType },
    handleDrawerToggle,
  } = useSettingsContext();

  const { up } = useBreakpoints();
  const upSm = up('sm');

  const prevSidenavTypeRef = useRef(sidenavType);

  return (
    <MuiAppBar
      position="fixed"
      sx={[
        {
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          borderBottom: `1px solid`,
          borderColor: 'divider',
          [`&.${paperClasses.root}`]: {
            outline: 'none',
          },
        },
        sidenavType === 'stacked' &&
          sidenavType === prevSidenavTypeRef.current &&
          ((theme) => ({
            transition: theme.transitions.create(['width'], {
              duration: theme.transitions.duration.standard,
            }),
          })),
      ]}
    >
      <Toolbar variant="appbar" sx={{ px: { xs: 3, md: 5 } }}>
        <Box
          sx={{
            display: { xs: 'flex', md: 'none' },
            alignItems: 'center',
            gap: 1,
            pr: 2,
          }}
        >
          <Button
            color="neutral"
            variant="soft"
            shape="circle"
            aria-label="open drawer"
            onClick={handleDrawerToggle}
          >
            <IconifyIcon icon="material-symbols:menu-rounded" sx={{ fontSize: 20 }} />
          </Button>

          <Box>
            <Logo showName={upSm} />
          </Box>
        </Box>

        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            flex: 1,
          }}
        >
          <AppbarActionItems />
        </Stack>
      </Toolbar>
    </MuiAppBar>
  );
};

export default AppBar;
