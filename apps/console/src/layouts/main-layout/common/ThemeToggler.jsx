import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Tooltip } from '@mui/material';
import { useThemeMode } from 'hooks/useThemeMode';
import IconifyIcon from 'components/base/IconifyIcon';

const ThemeToggler = () => {
  const { isDark, setThemeMode } = useThemeMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const lastClickTimeRef = useRef(0);

  // Sun/moon rather than Aurora's lightbulb: the metaphor is universal, so
  // nobody has to hover a mystery icon to find out what it does.
  const icon = isDark
    ? 'material-symbols:light-mode-outline-rounded'
    : 'material-symbols:dark-mode-outline-rounded';

  const handleClick = useCallback(() => {
    if (searchParams.size > 0) {
      setSearchParams({}, { replace: true });
    }

    const now = Date.now();
    if (now - lastClickTimeRef.current < 300) return;

    lastClickTimeRef.current = now;
    setThemeMode();
  }, [setThemeMode]);

  return (
    <Tooltip title={isDark ? 'Switch to light' : 'Switch to dark'}>
      <Button color="neutral" variant="text" shape="circle" onClick={handleClick}>
        <IconifyIcon icon={icon} sx={{ fontSize: 22 }} />
      </Button>
    </Tooltip>
  );
};

export default ThemeToggler;
