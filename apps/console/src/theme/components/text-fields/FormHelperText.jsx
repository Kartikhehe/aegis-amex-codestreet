import { formHelperTextClasses } from '@mui/material';

const FormHelperText = {
  styleOverrides: {
    root: ({ theme }) => ({
      [`&.${formHelperTextClasses.error}`]: {
        color: theme.vars.palette.error.light,
      },
    }),
  },
};

export default FormHelperText;
