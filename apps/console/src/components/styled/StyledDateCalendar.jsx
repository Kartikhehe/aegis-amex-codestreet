import { styled } from '@mui/material/styles';
import { pickersDayClasses } from '@mui/x-date-pickers';
import {
  DateCalendar,
  dateCalendarClasses,
  dayCalendarClasses,
  pickersSlideTransitionClasses,
} from '@mui/x-date-pickers/DateCalendar';

const CustomDateCalendar = ({ ref, ...props }) => (
  <DateCalendar
    ref={ref}
    dayOfWeekFormatter={(date) => {
      const dayMap = {
        Su: 'Sun',
        Mo: 'Mon',
        Tu: 'Tue',
        We: 'Wed',
        Th: 'Thu',
        Fr: 'Fri',
        Sa: 'Sat',
      };

      return dayMap[date.format('dd')] || date.format('dd');
    }}
    {...props}
  />
);

CustomDateCalendar.displayName = 'CustomDateCalendar';

const StyledDateCalendar = styled(CustomDateCalendar)(({ theme }) => ({
  padding: 0,
  width: '100%',
  height: '100%',
  maxHeight: 'unset',
  [`& .${dateCalendarClasses.viewTransitionContainer}`]: {
    height: '100%',

    '& > div': {
      height: '100%',

      [`& .${dayCalendarClasses.root}`]: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',

        [`& .${dayCalendarClasses.header}`]: {
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          placeItems: 'center',
          gap: 0,
          padding: 0,
          marginBottom: `${theme.spacing(3)} !important`,
          background: 'none !important',

          [`& .${dayCalendarClasses.weekDayLabel}`]: {
            color: `${theme.vars.palette.text.primary} !important`,
            fontSize: theme.typography.body2.fontSize,
            height: 'auto !important',
          },
        },

        [`& .${pickersSlideTransitionClasses.root}`]: {
          height: '100%',

          [`& .${dayCalendarClasses.monthContainer}`]: {
            display: 'flex',
            flexDirection: 'column',
            gap: 8,

            [`& .${dayCalendarClasses.weekContainer}`]: {
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              placeItems: 'center',
              gap: 8,

              [`& .${pickersDayClasses.root}`]: {
                margin: 0,
                width: '100%',
                height: '100%',
                backgroundColor: theme.vars.palette.background.elevation1,
                borderRadius: theme.shape.borderRadius * 7.5,
                color: theme.vars.palette.text.secondary,
                fontSize: 14,
              },

              [`& .${pickersDayClasses.today}`]: {
                fontWeight: 500,
                color: theme.vars.palette.common.white,
                backgroundColor: theme.vars.palette.primary.main,
                border: `8px solid ${theme.vars.palette.background.elevation1}`,
              },
            },
          },
        },
      },
    },
  },
}));

export default StyledDateCalendar;
