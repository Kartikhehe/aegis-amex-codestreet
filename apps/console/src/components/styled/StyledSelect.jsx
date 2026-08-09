import { Select, inputBaseClasses } from '@mui/material';
import { styled } from '@mui/material/styles';

const StyledSelect = styled(({ ref, ...props }) => <Select ref={ref} {...props} />)(
  ({ theme }) => ({
    [`&.${inputBaseClasses.root}`]: {
      [`& .${inputBaseClasses.input}`]: {
        paddingTop: 8,
        paddingBottom: 8,
        minHeight: '1.25rem',
        lineHeight: 1.2,
        fontSize: 14,
        '&::-webkit-input-placeholder': {
          opacity: '1 !important',
          color: theme.vars.palette.text.secondary,
        },
        '&::-moz-placeholder': {
          opacity: '1 !important',
          color: theme.vars.palette.text.secondary,
        },
      },
      [`&.${inputBaseClasses.sizeSmall} > .${inputBaseClasses.input}`]: {
        paddingTop: 6,
        paddingBottom: 6,
        minHeight: '1.125rem',
        fontSize: 14,
      },
      '&.MuiInputBase-sizeLarge': {
        [`& .${inputBaseClasses.input}`]: {
          paddingTop: 6,
          paddingBottom: 6,
          minHeight: '1.875rem',
          fontSize: 16,
        },
      },
      [`&.${inputBaseClasses.focused}`]: {
        boxShadow: 'none !important',
        backgroundColor: theme.vars.palette.primary.lighter,
      },
    },
  }),
);

export default StyledSelect;
