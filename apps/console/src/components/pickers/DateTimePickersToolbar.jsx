import { buttonBaseClasses, typographyClasses } from '@mui/material';
import { DateTimePickerToolbar, dateTimePickerToolbarClasses } from '@mui/x-date-pickers';
import { pickersToolbarClasses } from '@mui/x-date-pickers/internals';

const DateTimePickersToolbar = (props) => {
  return (
    <DateTimePickerToolbar
      {...props}
      sx={(theme) => ({
        padding: theme.spacing(3, 3, 2, 3),
        [`& .${typographyClasses.overline}`]: {
          fontSize: theme.typography.caption.fontSize,
          color: 'text.primary',
          fontWeight: 700,
          mb: 3,
          textTransform: 'capitalize',
        },

        [`& .${pickersToolbarClasses.content}`]: {
          alignItems: 'flex-end',
          [`& .${dateTimePickerToolbarClasses.ampmLabel}`]: {
            color: theme.vars.palette.text.disabled,
            '&.Mui-selected': {
              color: theme.vars.palette.text.primary,
            },
          },
          [`& .${dateTimePickerToolbarClasses.dateContainer}`]: {
            [`& .${buttonBaseClasses.root}:first-of-type`]: {
              [`& .${typographyClasses.subtitle1}`]: {
                fontSize: theme.typography.caption.fontSize,
                color: 'text.primary',
                fontWeight: 700,
                mb: 0.5,
              },
            },
          },
        },
      })}
    />
  );
};

export default DateTimePickersToolbar;
