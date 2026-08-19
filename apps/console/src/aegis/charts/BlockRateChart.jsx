import { useMemo } from 'react';
import ReactEchart from 'components/base/ReactEchart';
import { useChartPalette } from './useChartPalette';

/**
 * Block rate vs false-block rate over time.
 *
 * These two lines are the central tension of the product. Blocking more is
 * trivially easy; the question is what it costs in friction on purchases the
 * card member actually wanted. Plotting them together is what makes a policy
 * change honest -- you cannot admire the block rate without seeing its price.
 */
const BlockRateChart = ({ series = [], height = 260 }) => {
  const c = useChartPalette();

  const option = useMemo(() => {
    const times = series.map((point) =>
      new Date(point.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    );

    return {
      grid: { top: 32, right: 16, bottom: 28, left: 44 },
      legend: {
        show: true,
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        icon: 'roundRect',
        textStyle: { color: c.textSecondary, fontSize: 11 },
      },
      tooltip: {
        ...c.tooltip,
        trigger: 'axis',
        valueFormatter: (value) => `${(Number(value) * 100).toFixed(2)}%`,
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: c.divider } },
        axisTick: { show: false },
        axisLabel: {
          color: c.textDisabled,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: c.textDisabled,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (value) => `${Math.round(value * 100)}%`,
        },
        splitLine: { lineStyle: { color: c.divider, type: 'dashed' } },
      },
      series: [
        {
          name: 'Blocked',
          type: 'line',
          smooth: 0.35,
          symbol: 'none',
          data: series.map((point) => point.block_rate ?? 0),
          lineStyle: { width: 2, color: c.error },
          itemStyle: { color: c.error },
          areaStyle: { color: c.errorAlpha(0.1) },
        },
        {
          name: 'False blocks',
          type: 'line',
          smooth: 0.35,
          symbol: 'none',
          data: series.map((point) => point.false_block_rate ?? 0),
          lineStyle: { width: 2, color: c.warning, type: 'dashed' },
          itemStyle: { color: c.warning },
        },
      ],
    };
  }, [series, c]);

  return <ReactEchart option={option} sx={{ height, width: '100%' }} />;
};

export default BlockRateChart;
