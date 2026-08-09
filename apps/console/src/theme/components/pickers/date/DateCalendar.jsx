import { Button, Stack } from '@mui/material';
import {
  PickersDay,
  dayCalendarClasses,
  pickersDayClasses,
  yearCalendarClasses,
} from '@mui/x-date-pickers';
import IconifyIcon from 'components/base/IconifyIcon';

const DateCalendar = {
  defaultProps: {
    slots: {
      calendarHeader: (props) => {
        const { currentMonth, onMonthChange, onViewChange, view } = props;

        const selectNextMonth = () => onMonthChange(currentMonth.add(1, 'month'));
        const selectPreviousMonth = () => onMonthChange(currentMonth.subtract(1, 'month'));
        const toggleYearView = () => {
          if (onViewChange) {
            const nextView = view === 'day' ? 'year' : 'day';
            onViewChange(nextView);
          }
        };

        return (
          <Stack sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Button shape="square" color="neutral" onClick={selectPreviousMonth}>
              <IconifyIcon
                flipOnRTL
                icon="material-symbols:chevron-left-rounded"
                sx={{ fontSize: 20 }}
              />
            </Button>

            <Button
              variant="text"
              color="neutral"
              onClick={toggleYearView}
              sx={{ fontWeight: 600 }}
            >
              {currentMonth.format('MMMM YYYY')}
            </Button>

            <Button shape="square" color="neutral" onClick={selectNextMonth}>
              <IconifyIcon
                flipOnRTL
                icon="material-symbols:chevron-right-rounded"
                sx={{ fontSize: 20 }}
              />
            </Button>
          </Stack>
        );
      },

      day: (props) => (
        <PickersDay
          {...props}
          sx={(theme) => ({
            height: 40,
            width: 40,
            borderRadius: theme.spacing(0.5),
            flexShrink: 0,
            margin: 0,
            fontSize: theme.typography.body1.fontSize,

            [`&.${pickersDayClasses.today}`]: {
              fontWeight: 700,
              border: 'none',
            },
          })}
        />
      ),
    },
  },

  styleOverrides: {
    root: ({ theme }) => ({
      padding: theme.spacing(3),
      width: 352,
      maxHeight: 'max-content',
      height: 'max-content',

      [`& .${yearCalendarClasses.root}`]: {
        width: '100%',
      },

      [`& .${dayCalendarClasses.root}`]: {
        [`& .${dayCalendarClasses.header}`]: {
          marginBottom: theme.spacing(2),
          background: theme.vars.palette.background.elevation2,
          borderRadius: theme.spacing(1),
          justifyContent: 'space-between',

          [`& .${dayCalendarClasses.weekDayLabel}`]: {
            width: 40,
            height: 32,
            margin: 0,
            color: theme.vars.palette.text.disabled,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: 500,
          },
        },

        [`& .${dayCalendarClasses.monthContainer}`]: {
          height: '100%',

          [`& .${dayCalendarClasses.weekContainer}`]: {
            justifyContent: 'space-between',
            margin: 0,
          },

          [`& .${pickersDayClasses.root}`]: {
            height: 40,
            width: 40,
            margin: 0,
            flexShrink: 0,
            fontSize: theme.typography.body1.fontSize,

            [`&.${pickersDayClasses.today}`]: {
              fontWeight: 700,
              border: 'none',
            },
          },
        },
      },
    }),
  },
};

export default DateCalendar;
