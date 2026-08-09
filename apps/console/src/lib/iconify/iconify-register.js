import { addCollection } from '@iconify/react';
import icons from 'lib/iconify/icon-datasets';

const isIconData = (obj) => {
  return typeof obj === 'object' && obj !== null && 'body' in obj;
};

const collections = Object.entries(
  Object.entries(icons).reduce((acc, [key, value]) => {
    const [prefix, iconName] = key.split(':');
    if (!acc[prefix]) acc[prefix] = {};

    if (isIconData(value)) {
      acc[prefix][iconName] = value;
    } else {
      console.warn(`Invalid icon data for ${prefix}:${iconName}`);
    }

    return acc;
  }, {}),
).map(([prefix, icons]) => ({
  prefix,
  icons,
  width: prefix === 'twemoji' ? 36 : 24,
  height: prefix === 'twemoji' ? 36 : 24,
}));

export const allIconNames = Object.keys(icons);

export const registerIcons = () => {
  collections.forEach((collection) => addCollection(collection));
};
