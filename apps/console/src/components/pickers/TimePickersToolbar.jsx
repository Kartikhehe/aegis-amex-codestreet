import { Box, Typography, typographyClasses } from '@mui/material';
import { TimePickerToolbar } from '@mui/x-date-pickers';
import { pickersToolbarClasses } from '@mui/x-date-pickers/internals';

const TimePickersToolbar = ({ className, ...other }) => {
  return (
    <Box sx={{ p: 3, width: 200 }} className={className}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 2 }}>
        Pick Time
      </Typography>
      <TimePickerToolbar
        {...other}
        sx={(theme) => ({
          p: 0,
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

export default TimePickersToolbar;
