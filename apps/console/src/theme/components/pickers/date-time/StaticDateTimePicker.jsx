import ActionBar from 'components/pickers/ActionBar';
import DateTimePickersToolbar from 'components/pickers/DateTimePickersToolbar';

const StaticDateTimePicker = {
  defaultProps: {
    slots: {
      toolbar: DateTimePickersToolbar,
      actionBar: ActionBar,
    },
  },
  styleOverrides: {
    root: {
      width: 536,
    },
  },
};

export default StaticDateTimePicker;
