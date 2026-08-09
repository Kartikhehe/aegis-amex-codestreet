import ActionBar from 'components/pickers/ActionBar';
import TimePickersToolbar from 'components/pickers/TimePickersToolbar';

const StaticTimePicker = {
  defaultProps: {
    slots: {
      toolbar: TimePickersToolbar,
      actionBar: ActionBar,
    },
  },
};

export default StaticTimePicker;
