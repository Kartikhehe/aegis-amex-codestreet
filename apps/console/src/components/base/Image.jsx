import { Box } from '@mui/material';
import { useThemeMode } from 'hooks/useThemeMode';

const Image = ({ src, ...props }) => {
  const { isDark } = useThemeMode();

  const imageSrc = !src ? undefined : typeof src === 'string' ? src : isDark ? src.dark : src.light;

  return <Box component="img" src={imageSrc} {...props} />;
};

export default Image;
