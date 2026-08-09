import { Box, Typography, typographyClasses } from '@mui/material';
import { DatePickerToolbar } from '@mui/x-date-pickers';
import { usePickerContext } from '@mui/x-date-pickers/hooks';
import { pickersToolbarClasses } from '@mui/x-date-pickers/internals';

const DatePickersToolbar = ({ className, ...other }) => {
  const { value } = usePickerContext();

  return (
    <Box sx={(theme) => ({ p: theme.spacing(3, 3, 0, 3), width: 1 })} className={className}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 2 }}>
        Select Date
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
        {value?.year()}
      </Typography>
      <DatePickerToolbar
        {...other}
        sx={(theme) => ({
          padding: 0,
          [`& .${typographyClasses.overline}`]: {
            display: 'none',
          },
          [`& .${pickersToolbarClasses.content}`]: {
            margin: theme.spacing(0.5, 0, 0, 0),
            [`& .${typographyClasses.h4}`]: {
              ...theme.typography.h5,
              margin: 0,
            },
          },
        })}
      />
    </Box>
  );
};

export default DatePickersToolbar;
