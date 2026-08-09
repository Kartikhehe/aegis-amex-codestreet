import { ButtonBase, Popper } from '@mui/material';
import { pickersLayoutClasses } from '@mui/x-date-pickers';
import IconifyIcon from 'components/base/IconifyIcon';

const TimePicker = {
  defaultProps: {
    enableAccessibleFieldDOMStructure: false,
    slots: {
      popper: (props) => (
        <Popper
          {...props}
          sx={{
            [`& .${pickersLayoutClasses.contentWrapper}`]: {
              gridColumn: '1 / -1',
            },
          }}
        />
      ),

      openPickerButton: (params) => (
        <ButtonBase {...params} sx={{ fontSize: 'inherit' }}>
          <IconifyIcon icon="material-symbols:schedule-outline-rounded" />
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

export default TimePicker;
