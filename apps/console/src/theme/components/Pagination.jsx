import { paginationItemClasses } from '@mui/material';
import { cssVarRgba } from 'lib/utils';
import IconifyIcon from 'components/base/IconifyIcon';

const paginationSolidColors = [
  'neutral',
  'primary',
  'secondary',
  'info',
  'success',
  'warning',
  'error',
];

const FirstIcon = () => (
  <IconifyIcon icon="material-symbols:keyboard-double-arrow-left-rounded" fontSize={20} />
);
const LastIcon = () => (
  <IconifyIcon icon="material-symbols:keyboard-double-arrow-right-rounded" fontSize={20} />
);
const NextIcon = () => <IconifyIcon icon="material-symbols:chevron-right-rounded" fontSize={20} />;
const previousIcon = () => (
  <IconifyIcon icon="material-symbols:chevron-left-rounded" fontSize={20} />
);

const paginationCustomVariants = paginationSolidColors.map((color) => ({
  props: { variant: 'solid', color: color },
  style: ({ theme }) => {
    const paletteColor = theme.vars.palette[color];

    return {
      [`&.${paginationItemClasses.selected}, &.${paginationItemClasses.selected}:hover`]: {
        backgroundColor: paletteColor.dark,
        color: paletteColor.contrastText,
      },
      [`&.${paginationItemClasses.colorPrimary}`]: {
        [`&.${paginationItemClasses.selected}`]: {
          color: theme.vars.palette.common.white,
          backgroundColor: theme.vars.palette.primary.main,
        },
      },
    };
  },
}));

const Pagination = {
  defaultProps: {
    shape: 'rounded',
  },
};

export const PaginationItem = {
  variants: [...paginationCustomVariants],
  defaultProps: {
    slots: {
      next: NextIcon,
      previous: previousIcon,
      first: FirstIcon,
      last: LastIcon,
    },
  },
  styleOverrides: {
    root: ({ theme }) => {
      return {
        variants: [
          {
            props: ({ color }) => {
              return color !== 'standard';
            },
            style: (props) => {
              const { theme, color } = props;
              const colorKey = color;
              const paletteColor = theme.vars.palette[colorKey];

              return {
                [`&.${paginationItemClasses.selected}, &.${paginationItemClasses.selected}:hover`]:
                  {
                    backgroundColor: cssVarRgba(paletteColor.mainChannel, 0.36),
                    color: paletteColor.main,
                  },
              };
            },
          },
        ],
        borderRadius: 8,
        '&:hover': {
          backgroundColor: theme.vars.palette.neutral.lighter,
        },
        [`&.${paginationItemClasses.selected}, &.${paginationItemClasses.selected}:hover`]: {
          backgroundColor: theme.vars.palette.action.focus,
          color: theme.vars.palette.text.primary,
        },
      };
    },
    sizeSmall: {
      height: 24,
      minWidth: 24,
      borderRadius: 6,
    },
  },
};
export default Pagination;
