import { useEffect } from 'react';
import { useLocation } from 'react-router';

const useHashScrollIntoView = (
  scrollOptions = {
    block: 'center',
    behavior: 'smooth',
  },
  delay = 100,
) => {
  const { hash } = useLocation();

  useEffect(() => {
    setTimeout(() => {
      if (hash) {
        const id = hash.replace('#', '');
        const element = document.getElementById(id);

        if (element) {
          element.scrollIntoView(scrollOptions);
        }
      }
    }, delay);
  }, []);
};

export default useHashScrollIntoView;
