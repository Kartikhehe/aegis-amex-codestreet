import { ButtonBase } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';

const DesktopTimePicker = {
  defaultProps: {
    enableAccessibleFieldDOMStructure: false,
    slots: {
      openPickerButton: (params) => (
        <ButtonBase {...params} sx={{ fontSize: 'inherit' }}>
          <IconifyIcon icon="material-symbols:schedule-outline-rounded" />
        </ButtonBase>
      ),
    },
    slotProps: {
      desktopPaper: {
        variant: 'elevation',
        elevation: 3,
      },
    },
  },
};

export default DesktopTimePicker;
