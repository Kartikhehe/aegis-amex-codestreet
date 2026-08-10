import { Box, useColorScheme } from "@mui/material";

/**
 * The AEGIS lockup, for the card-member surface.
 *
 * The artwork files carry an OPAQUE background (navy on the dark variant,
 * white on the light one), so two things are handled here: the matching file
 * is chosen for the active theme, and the container is painted the same colour
 * as that background. Otherwise the logo shows as a rectangle sitting on top of
 * the header rather than part of it.
 *
 * `variant="mark"` crops to the shield for the app bar, where the wordmark
 * would crowd out the member's own name. Scaling the full lockup down instead
 * would make the tagline illegible on a phone.
 */
const Logo = ({ variant = "full", height = 30, sx }) => {
  const { mode, systemMode } = useColorScheme();
  const isDark = mode === "system" ? systemMode === "dark" : mode === "dark";
  const src = isDark ? "/AEGIS_lockup_dark.png" : "/AEGIS_lockup_light.png";

  // Artwork is 980x480; the shield occupies roughly the leftmost 30%.
  const fullWidth = height * (980 / 480);
  const width = variant === "mark" ? fullWidth * 0.3 : fullWidth;

  return (
    <Box
      role="img"
      aria-label="AEGIS"
      sx={{
        height,
        width,
        flexShrink: 0,
        // Callers may add padding to turn the lockup into a framed plate;
        // border-box keeps that padding from stretching the artwork window.
        boxSizing: "content-box",
        backgroundColor: isDark ? "rgb(0, 12, 46)" : "#FFFFFF",
        borderRadius: 1,
        backgroundImage: `url(${src})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
        backgroundSize: `${fullWidth}px ${height}px`,
        ...sx,
      }}
    />
  );
};

export default Logo;
