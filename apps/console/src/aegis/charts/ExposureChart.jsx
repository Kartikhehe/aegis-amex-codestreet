import { useMemo } from 'react';
import { formatCurrencyCompact } from 'aegis/format';
import ReactEchart from 'components/base/ReactEchart';
import { useChartPalette } from './useChartPalette';

/**
 * Approved exposure by operator.
 *
 * Horizontal bars because operator names are words, not categories -- reading
 * them along an x-axis would mean rotating labels, and a rotated label is a
 * label people skip.
 */
const ExposureChart = ({ data = [], height = 260 }) => {
  const c = useChartPalette();

  const option = useMemo(() => {
    const rows = [...data].sort((a, b) => a.exposure - b.exposure);

    return {
      grid: { top: 8, right: 72, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        ...c.tooltip,
        trigger: 'item',
        valueFormatter: (value) => formatCurrencyCompact(value),
      },
      xAxis: {
        type: 'value',
        // Axis ticks hidden: every bar is already labelled with its exact
        // value, and at lakh/crore magnitudes the ticks collide into an
        // unreadable smear.
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: c.divider, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((row) => row.operator_name || row.operator_id),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((row) => row.exposure),
          barMaxWidth: 18,
          itemStyle: {
            color: c.primary,
            borderRadius: [0, 4, 4, 0],
          },
          label: {
            show: true,
            position: 'right',
            formatter: (params) => formatCurrencyCompact(params.value),
            color: c.textSecondary,
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
          },
        },
      ],
    };
  }, [data, c]);

  return <ReactEchart option={option} sx={{ height, width: '100%' }} />;
};

export default ExposureChart;
