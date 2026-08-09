import { ButtonBase } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';
import ActionBar from 'components/pickers/ActionBar';
import DatePickersToolbar from 'components/pickers/DatePickersToolbar';

const MobileDatePicker = {
  defaultProps: {
    enableAccessibleFieldDOMStructure: false,
    slotProps: {
      mobilePaper: {
        variant: 'elevation',
        elevation: 3,
      },
    },
    slots: {
      toolbar: DatePickersToolbar,
      actionBar: ActionBar,
      openPickerButton: (params) => (
        <ButtonBase {...params} sx={{ fontSize: 'inherit' }}>
          <IconifyIcon icon="material-symbols:calendar-today-outline-rounded" />
        </ButtonBase>
      ),
    },
  },
};

export default MobileDatePicker;
