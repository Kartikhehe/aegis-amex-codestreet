import { useState } from 'react';

const useLightbox = () => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const openLightbox = (index = 0) => {
    setOpen(!open);
    setIndex(index);
  };

  const closeLightbox = () => {
    setOpen(false);
  };

  return {
    open,
    index,
    close: closeLightbox,
    openLightbox,
  };
};

export default useLightbox;
