import ActionBar from 'components/pickers/ActionBar';
import DatePickersToolbar from 'components/pickers/DatePickersToolbar';

const StaticDatePicker = {
  defaultProps: {
    slots: {
      toolbar: DatePickersToolbar,
      actionBar: ActionBar,
    },
  },
};

export default StaticDatePicker;
