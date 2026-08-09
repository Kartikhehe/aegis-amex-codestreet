import dayjs from 'dayjs';

export const parseRoutePath = (path) => path.split('/').pop() || '/';

export const getItemFromStore = (key, defaultValue, store = localStorage) => {
  try {
    return store.getItem(key) === null ? defaultValue : JSON.parse(store.getItem(key));
  } catch {
    return store.getItem(key) || defaultValue;
  }
};

export const setItemToStore = (key, payload, store = localStorage) => store.setItem(key, payload);

export const removeItemFromStore = (key, store = localStorage) => store.removeItem(key);

export const getDates = (startDate, endDate, interval = 1000 * 60 * 60 * 24) => {
  const duration = +endDate - +startDate;
  const steps = duration / interval;

  return Array.from({ length: steps + 1 }, (v, i) => new Date(startDate.valueOf() + interval * i));
};

export const getPastDates = (duration) => {
  let days;

  switch (duration) {
    case 'week':
      days = 7;
      break;
    case 'month':
      days = 30;
      break;
    case 'year':
      days = 365;
      break;

    default:
      days = duration;
  }

  const date = new Date();
  const endDate = date;
  const startDate = new Date(new Date().setDate(date.getDate() - (days - 1)));

  return getDates(startDate, endDate);
};

export const getPreviousMonths = (length = 12) => {
  return Array.from({ length }, (_, i) =>
    dayjs()
      .subtract(i + 1, 'month')
      .format('MMMM'),
  ).reverse();
};

export const currencyFormat = (amount, locale = 'en-US', options = {}) => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'usd',
    maximumFractionDigits: 2,
    ...options,
  }).format(amount);
};

export const getCurrencySymbol = (currency, locale = 'en-US') => {
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  })
    .formatToParts(0)
    .find((x) => x.type === 'currency');

  return parts ? parts.value : '$';
};

export const getNumbersInRange = (startAt, endAt) => {
  return [...Array(endAt + 1 - startAt).keys()].map((i) => i + startAt);
};

export const numberFormat = (
  number,
  locale = 'en-US',
  options = {
    notation: 'standard',
  },
) =>
  new Intl.NumberFormat(locale, {
    ...options,
  }).format(number);

/* Get Random Number */
export const getRandomNumber = (min, max) => {
  return Math.floor(Math.random() * (max - min) + min);
};

export const calculatePercentageIncrement = (current, previous) => {
  if (previous === 0) return 0;

  return Math.round(((current - previous) / previous) * 100);
};
export const getPercentage = (value, total) => {
  return Math.round((value / total) * 100);
};

export const getPercentageStr = (value, total = 100) => {
  return `${getPercentage(value, total)}%`;
};

export const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return [r, g, b];
};

export const rgbaColor = (color = '#fff', alpha = 0.5) => `rgba(${hexToRgb(color)}, ${alpha})`;

export const capitalize = (string) =>
  (string.charAt(0).toUpperCase() + string.slice(1)).replace(/-/g, ' ');

export const getFileNameFromUrl = (fileName) => {
  return fileName.split('/').pop()?.split('.')[0] || 'unknown';
};

export const getFileExtensionFromUrl = (fileName, separator = '.') =>
  fileName.split(separator).pop() || 'unknown';

export const convertSpacesToTabs = (str) => {
  return str
    .split('\n')
    .map((line) => {
      return line.replace(/^ +/g, (match) => '\t'.repeat(match.length / 2));
    })
    .join('\n');
};

export const kebabCase = (string) =>
  string
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();

export const kebabToSentenceCase = (str) => {
  return str
    .toLowerCase()
    .split('-')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
};

export const kebabToTitleCase = (str) => {
  return str
    .toLowerCase()
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export const toSentenceCase = (str) => {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
};

export const toTitleCase = (str) => {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export const getFileExtension = (fileName, separator = '.') =>
  fileName.split(separator).pop() || 'unknown';

export const isImageFile = (file) => {
  const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];

  return imageMimeTypes.includes(file.type);
};

export const convertFileToAttachment = (file) => ({
  name: file.name,
  size: `${(file.size / 1024).toFixed(2)} KB`,
  format: getFileExtension(file.name),
  preview: isImageFile(file) ? URL.createObjectURL(file) : undefined,
});
export const maskCardNumber = (cardNumber) =>
  cardNumber
    .split(' ')
    .map((group, index, array) => (index === array.length - 1 ? group : '****'))
    .join(' ');

export const formatNumber = (num) => {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(num % 1_000_000_000 < 10 ? 0 : 1) + 'B';
  } else if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(num % 1_000_000 < 10 ? 0 : 1) + 'M';
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(num % 1_000 < 10 ? 0 : 1) + 'K';
  } else {
    return num.toString();
  }
};

export const getFileIcon = (fileFormat) => {
  switch (fileFormat) {
    case 'zip':
    case 'rar':
      return 'material-symbols:folder-zip-outline-rounded';
    case 'bat':
      return 'material-symbols:code-blocks-outline-rounded';
    case 'txt':
      return 'material-symbols:text-snippet-outline-rounded';
    case 'csv':
      return 'material-symbols:csv-outline-rounded';
    case 'wav':
    case 'mp3':
    case 'ogg':
    case 'm4a':
      return 'material-symbols:audio-file-outline-rounded';
    case 'mp4':
    case 'mkv':
    case 'avi':
      return 'material-symbols:video-file-outline-rounded';
    case 'pdf':
      return 'material-symbols:picture-as-pdf-outline-rounded';
    case 'jpg':
    case 'png':
    case 'jpeg':
      return 'material-symbols:imagesmode-outline-rounded';
    default:
      return 'material-symbols:lab-profile-outline-rounded';
  }
};

export const generateUniqueId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomChars = Math.random().toString(36).substring(2, 10).toUpperCase();

  return `${timestamp}${randomChars}`;
};

export const secondsToHms = (d) => {
  d = Math.max(0, Math.floor(d)); // Ensure non-negative integer

  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;

  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const secondsToMs = (seconds) => {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export const convertSize = (size, options = { from: 'kb', to: 'gb', reversible: false }) => {
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let { from, to } = options;
  const { reversible } = options;

  if (!reversible) {
    [from, to] = [to, from];
  }

  const fromIndex = units.indexOf(from.toLowerCase());
  const toIndex = units.indexOf(to.toLowerCase());

  if (fromIndex === -1 || toIndex === -1) {
    throw new Error(`Invalid units. Supported units are: ${units.join(', ')}`);
  }

  const factor = Math.pow(1024, toIndex - fromIndex);

  return size * factor;
};

const hexToRgbChannel = (hexColor) => {
  const r = parseInt(hexColor.substring(1, 3), 16);
  const g = parseInt(hexColor.substring(3, 5), 16);
  const b = parseInt(hexColor.substring(5, 7), 16);

  return `${r} ${g} ${b}`;
};

export const generatePaletteChannel = (palette) => {
  const channels = {};

  Object.entries(palette).forEach(([colorName, colorValue]) => {
    if (colorValue) {
      channels[`${colorName}Channel`] = hexToRgbChannel(colorValue);
    }
  });

  return { ...palette, ...channels };
};

export const cssVarRgba = (color, alpha) => {
  return `rgba(${color} / ${alpha})`;
};

export const getRangeLabel = (value) => {
  if (value < 50) return '0-50';
  if (value < 100) return '50-100';
  if (value < 250) return '100-250';
  if (value < 500) return '250-500';

  return '500+';
};
