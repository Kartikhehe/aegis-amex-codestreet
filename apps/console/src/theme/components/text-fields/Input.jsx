import { inputClasses } from '@mui/material';

const Input = {
  variants: [
    {
      props: { size: 'large' },
      style: {
        [`& .${inputClasses.input}`]: {
          paddingTop: 6,
          paddingBottom: 8,
          height: '1.375rem',
        },
      },
    },
  ],
  styleOverrides: {
    underline: ({ theme }) => ({
      '&::before': {
        borderBottom: `1px solid ${theme.vars.palette.text.secondary}`,
      },
      '&:hover, &:focus': {
        [`&:not(.${inputClasses.disabled}, .${inputClasses.error})`]: {
          '&::before': {
            borderBottom: `2px solid ${theme.vars.palette.primary.main}`,
          },
        },
      },
    }),
    sizeSmall: {
      fontSize: '14px',
    },
    input: {
      height: '1.375rem',
      padding: '6px 0 8px',
    },
    inputSizeSmall: {
      height: '1.125rem',
      padding: '6px 0 8px',
      lineHeight: 1.2,
    },
  },
};

export const InputBase = {
  defaultProps: {},
  // styleOverrides: {
  //   root: {
  //     borderRadius: 8,
  //   },
  //   sizeSmall: {
  //     borderRadius: 4,
  //   },
  // },
};

export default Input;
