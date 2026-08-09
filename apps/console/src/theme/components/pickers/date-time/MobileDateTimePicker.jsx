import { ButtonBase } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';
import ActionBar from 'components/pickers/ActionBar';
import DateTimePickersToolbar from 'components/pickers/DateTimePickersToolbar';

const MobileDateTimePicker = {
  defaultProps: {
    enableAccessibleFieldDOMStructure: false,
    slotProps: {
      mobilePaper: {
        variant: 'elevation',
        elevation: 3,
        sx: {
          margin: 0,
        },
      },
    },
    slots: {
      toolbar: DateTimePickersToolbar,
      actionBar: ActionBar,
      openPickerButton: (params) => (
        <ButtonBase {...params} sx={{ fontSize: 'inherit' }}>
          <IconifyIcon icon="material-symbols:calendar-today-outline-rounded" />
        </ButtonBase>
      ),
    },
  },
  styleOverrides: {
    root: {
      width: 536,
    },
  },
};

export default MobileDateTimePicker;
