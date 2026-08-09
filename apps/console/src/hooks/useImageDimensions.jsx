import { useState } from 'react';

const useImageDimensions = (defaultMaxWidth) => {
  const [dimensions, setDimensions] = useState(null);

  const handleImageLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setDimensions({ width: naturalWidth, height: naturalHeight });
  };

  const maxWidth = dimensions ? Math.min(defaultMaxWidth, dimensions.width) : defaultMaxWidth;
  const aspectRatio = dimensions ? dimensions.width / dimensions.height : 1;

  return { handleImageLoad, maxWidth, aspectRatio };
};

export default useImageDimensions;
