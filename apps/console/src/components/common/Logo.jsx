import { Box, Link } from '@mui/material';
import { useThemeMode } from 'hooks/useThemeMode';
import paths from 'routes/paths';

/**
 * The AEGIS lockup.
 *
 * Two artwork files, one per theme, each with an OPAQUE background baked in
 * (navy rgb(0,12,46) on the dark variant, white on the light one). Two
 * consequences drive this component:
 *
 *   1. The correct file must be chosen rather than the image recoloured --
 *      the dark lockup on a light sidebar would be a navy block.
 *   2. The container is painted the same colour as the artwork's background,
 *      so the edge where one ends and the other begins is invisible. Without
 *      this the logo reads as a rectangle pasted onto the sidebar, because
 *      rgb(0,12,46) and the sidebar's #0C1428 are close but not equal.
 *
 * Collapsed to the icon rail there is no room for the wordmark, so the artwork
 * is cropped to the shield with a fixed-width window. Scaling the whole lockup
 * down instead would render the tagline at two illegible pixels.
 */
const Logo = ({ showName = true, height = 30, sx, ...rest }) => {
  const { isDark } = useThemeMode();
  const src = isDark ? '/AEGIS_lockup_dark.png' : '/AEGIS_lockup_light.png';

  // The artwork is 980x480 and the shield occupies roughly its leftmost 30%.
  const fullWidth = height * (980 / 480);
  const SHIELD_FRACTION = 0.3;

  return (
    <Link
      href={paths.aegisFleet}
      underline="none"
      aria-label="AEGIS — not just permissions, proof"
      sx={{ display: 'inline-flex', alignItems: 'center', ...sx }}
      {...rest}
    >
      <Box
        sx={{
          height,
          width: showName ? fullWidth : fullWidth * SHIELD_FRACTION,
          // Match the artwork's own background so its edges disappear.
          backgroundColor: isDark ? 'rgb(0, 12, 46)' : '#FFFFFF',
          borderRadius: 1,
          backgroundImage: `url(${src})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'left center',
          backgroundSize: `${fullWidth}px ${height}px`,
          transition: 'width 200ms ease',
        }}
      />
    </Link>
  );
};

export default Logo;
