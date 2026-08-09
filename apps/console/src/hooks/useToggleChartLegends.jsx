import { useCallback, useState } from 'react';

const useToggleChartLegends = (chartRef) => {
  const [legendState, setLegendState] = useState({});

  const handleLegendToggle = useCallback(
    (legendName) => {
      chartRef.current?.getEchartsInstance().dispatchAction({
        type: 'legendToggleSelect',
        name: legendName,
      });

      setLegendState((prev) => ({
        ...prev,
        [legendName]: !prev[legendName],
      }));
    },
    [chartRef],
  );

  return { legendState, handleLegendToggle };
};

export default useToggleChartLegends;
