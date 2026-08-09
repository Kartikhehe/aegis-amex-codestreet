import { checkboxClasses, formControlLabelClasses, radioClasses } from '@mui/material';

const FormControlLabel = {
  styleOverrides: {
    root: {
      marginLeft: -9,
      [`& .${checkboxClasses.root}, & .${radioClasses.root}, & .${formControlLabelClasses.label}`]:
        {
          alignSelf: 'flex-start',
        },
    },
    label: {
      fontSize: 14,
    },
  },
};

export default FormControlLabel;
