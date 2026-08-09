import { ButtonBase } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';

const DesktopDatePicker = {
  defaultProps: {
    enableAccessibleFieldDOMStructure: false,
    slots: {
      openPickerButton: (params) => (
        <ButtonBase {...params} sx={{ fontSize: 'inherit' }}>
          <IconifyIcon icon="material-symbols:calendar-today-outline-rounded" />
        </ButtonBase>
      ),
    },
    slotProps: {
      textField: {
        inputProps: {
          sx: {
            '&::-webkit-input-placeholder': {
              opacity: '0 !important',
            },
            '&::-moz-placeholder': {
              opacity: '0 !important',
            },
          },
        },
      },
      desktopPaper: {
        variant: 'elevation',
        elevation: 3,
      },
    },
  },
};

export default DesktopDatePicker;
