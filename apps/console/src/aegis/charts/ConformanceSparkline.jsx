import { useMemo } from 'react';
import ReactEchart from 'components/base/ReactEchart';
import { useChartPalette } from './useChartPalette';

/**
 * Conformance over time for one agent, with the decision thresholds drawn in.
 *
 * The two reference lines are the reason this chart exists. A score means
 * nothing without the boundaries it is judged against -- 0.72 is comfortable
 * under a 0.70 review floor and a failure under 0.85. Drawing the floors turns
 * a squiggle into a judgement you can check.
 */
const ConformanceSparkline = ({
  series = [],
  height = 200,
  reviewFloor = 0.7,
  denyFloor = 0.45,
}) => {
  const c = useChartPalette();

  const option = useMemo(
    () => ({
      grid: { top: 16, right: 12, bottom: 24, left: 36 },
      tooltip: {
        ...c.tooltip,
        trigger: 'axis',
        valueFormatter: (value) => Number(value).toFixed(2),
      },
      xAxis: {
        type: 'category',
        data: series.map((point) =>
          new Date(point.t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        ),
        boundaryGap: false,
        axisLine: { lineStyle: { color: c.divider } },
        axisTick: { show: false },
        axisLabel: {
          color: c.textDisabled,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          showMaxLabel: true,
          interval: Math.max(Math.floor(series.length / 5), 0),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        axisLabel: {
          color: c.textDisabled,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (value) => value.toFixed(1),
        },
        splitLine: { lineStyle: { color: c.divider, type: 'dashed' } },
      },
      series: [
        {
          type: 'line',
          smooth: 0.3,
          symbol: 'circle',
          symbolSize: 4,
          data: series.map((point) => point.score),
          lineStyle: { width: 2, color: c.primary },
          itemStyle: { color: c.primary },
          areaStyle: { color: c.primaryAlpha(0.12) },
          markLine: {
            silent: true,
            symbol: 'none',
            label: {
              position: 'insideEndTop',
              fontFamily: 'JetBrains Mono',
              fontSize: 10,
            },
            data: [
              {
                yAxis: reviewFloor,
                lineStyle: { color: c.warning, type: 'dashed', width: 1 },
                label: { formatter: 'review 0.70', color: c.warning },
              },
              {
                yAxis: denyFloor,
                lineStyle: { color: c.error, type: 'dashed', width: 1 },
                label: { formatter: 'deny 0.45', color: c.error },
              },
            ],
          },
        },
      ],
    }),
    [series, c, reviewFloor, denyFloor],
  );

  return <ReactEchart option={option} sx={{ height, width: '100%' }} />;
};

export default ConformanceSparkline;
