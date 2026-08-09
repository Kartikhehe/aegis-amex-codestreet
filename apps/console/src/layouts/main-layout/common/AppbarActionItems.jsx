import { Stack } from '@mui/material';
import TopbarReadouts from 'aegis/components/TopbarReadouts';
import NotificationMenu from './NotificationMenu';
import ProfileMenu from './ProfileMenu';
import ThemeToggler from './ThemeToggler';

const AppbarActionItems = ({ type = 'default', sx }) => {
  return (
    <Stack
      direction="row"
      className="action-items"
      spacing={1}
      sx={{
        alignItems: 'center',
        ml: 'auto',
        ...sx,
      }}
    >
      {/* AEGIS: live p99 / block rate / false-block / policy stage. */}
      <TopbarReadouts />
      <ThemeToggler />
      <NotificationMenu type={type} />
      <ProfileMenu type={type} />
    </Stack>
  );
};

export default AppbarActionItems;
