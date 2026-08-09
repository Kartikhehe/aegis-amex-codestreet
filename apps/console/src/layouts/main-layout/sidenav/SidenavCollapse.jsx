import { Box, IconButton, Tooltip } from '@mui/material';
import { useSettingsContext } from 'providers/SettingsProvider';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * The sidebar collapse handle.
 *
 * Aurora animated this with a GSAP MorphSVG tween -- a whole animation library
 * and a premium plugin to bend one line into another. A chevron that rotates
 * says the same thing in one CSS transition.
 */
const SidenavCollapse = () => {
  const {
    config: { sidenavCollapsed },
    toggleNavbarCollapse,
  } = useSettingsContext();

  return (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        right: 0,
        transform: 'translate(50%, -50%)',
        zIndex: (theme) => theme.zIndex.drawer + 1,
        display: { xs: 'none', lg: 'block' },
      }}
    >
      <Tooltip title={sidenavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
        <IconButton
          onClick={toggleNavbarCollapse}
          size="small"
          sx={(theme) => ({
            width: 22,
            height: 22,
            border: '1px solid',
            borderColor: theme.vars.palette.divider,
            backgroundColor: theme.vars.palette.background.elevation2,
            color: theme.vars.palette.text.secondary,
            '&:hover': {
              backgroundColor: theme.vars.palette.background.elevation3,
              color: theme.vars.palette.text.primary,
            },
          })}
        >
          <IconifyIcon
            icon="material-symbols:chevron-left-rounded"
            sx={{
              fontSize: 16,
              transition: 'transform 200ms ease',
              transform: sidenavCollapsed ? 'rotate(180deg)' : 'none',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default SidenavCollapse;
