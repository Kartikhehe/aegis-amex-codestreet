import { useMemo } from 'react';
import { useTheme } from '@mui/material';
import { getColor } from 'helpers/echart-utils';
import { useThemeMode } from 'hooks/useThemeMode';

/**
 * Resolved colours for ECharts.
 *
 * MUI's CSS-variable theme hands back strings like `var(--aegis-palette-...)`.
 * The DOM resolves those; an ECharts <canvas> does not -- it paints the literal
 * string, which silently renders as black. Every chart therefore has to resolve
 * the variables to real values first.
 *
 * Keyed on the theme mode so the palette recomputes when the operator toggles
 * light/dark, rather than keeping the colours of the mode the chart mounted in.
 */
export const useChartPalette = () => {
  const theme = useTheme();
  const { mode, isDark } = useThemeMode();

  return useMemo(() => {
    const resolve = (value) => getColor(value);
    const alpha = (channelVar, a) => {
      const channel = getColor(channelVar);
      return channel ? `rgba(${channel.replace(/\s+/g, ' ')} / ${a})` : 'transparent';
    };

    return {
      isDark,
      primary: resolve(theme.vars.palette.primary.main),
      primaryAlpha: (a) => alpha(theme.vars.palette.primary.mainChannel, a),
      success: resolve(theme.vars.palette.success.main),
      warning: resolve(theme.vars.palette.warning.main),
      warningAlpha: (a) => alpha(theme.vars.palette.warning.mainChannel, a),
      error: resolve(theme.vars.palette.error.main),
      errorAlpha: (a) => alpha(theme.vars.palette.error.mainChannel, a),
      text: resolve(theme.vars.palette.text.primary),
      textSecondary: resolve(theme.vars.palette.text.secondary),
      textDisabled: resolve(theme.vars.palette.text.disabled),
      divider: resolve(theme.vars.palette.divider),
      surface: resolve(theme.vars.palette.background.elevation2),
    };
    // `mode` is the dependency that matters: it is what changes on a toggle.
  }, [theme, mode, isDark]);
};

export default useChartPalette;
