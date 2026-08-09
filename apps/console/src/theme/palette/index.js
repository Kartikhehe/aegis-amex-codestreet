import { darkPalette } from './darkPalette';
import { lightPalette } from './lightPalette';

const createPalette = (mode) => {
  if (mode === 'dark') {
    return darkPalette;
  }

  return lightPalette;
};

export default createPalette;
