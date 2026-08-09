import { useMemo } from 'react';
import { Box, useTheme } from '@mui/material';
import * as echarts from 'echarts';
import { default as ReactEChartsCore } from 'echarts-for-react/lib/core';
import merge from 'lodash.merge';

/**
 * Theme-aware ECharts wrapper.
 *
 * `echarts-for-react/lib/core` deliberately does NOT bundle echarts -- it
 * expects the instance to be handed in, so an app can tree-shake to just the
 * chart types it uses. Aurora passed it from each demo page; that made every
 * caller responsible for remembering, and a caller that forgot got
 * `Cannot read properties of undefined (reading 'init')` at render time.
 * Registering it here once removes the trap.
 */
const ReactEchart = ({ option, ref, ...rest }) => {
  const theme = useTheme();

  const isTouchDevice = useMemo(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0, []);

  const defaultTooltip = useMemo(
    () => ({
      padding: [8, 10],
      axisPointer: { type: 'none' },
      textStyle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 400,
        fontSize: 12,
        color: theme.vars.palette.text.primary,
      },
      backgroundColor: theme.vars.palette.background.elevation2,
      borderWidth: 1,
      borderColor: theme.vars.palette.divider,
      extraCssText: 'box-shadow: none; border-radius: 8px;',
      transitionDuration: 0,
      confine: true,
      triggerOn: isTouchDevice ? 'click' : 'mousemove|click',
    }),
    [theme, isTouchDevice],
  );

  return (
    <Box
      component={ReactEChartsCore}
      echarts={echarts}
      ref={ref}
      notMerge
      lazyUpdate
      option={{ ...option, tooltip: merge(defaultTooltip, option.tooltip) }}
      {...rest}
    />
  );
};

ReactEchart.displayName = 'ReactEchart';

export default ReactEchart;
