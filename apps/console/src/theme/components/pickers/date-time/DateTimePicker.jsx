import { ButtonBase, Popper, dividerClasses } from '@mui/material';
import { multiSectionDigitalClockClasses, pickersLayoutClasses } from '@mui/x-date-pickers';
import IconifyIcon from 'components/base/IconifyIcon';
import ActionBar from 'components/pickers/ActionBar';

const DateTimePicker = {
  defaultProps: {
    enableAccessibleFieldDOMStructure: false,
    slotProps: {
      desktopPaper: {
        variant: 'elevation',
        elevation: 3,
      },
    },
    slots: {
      openPickerButton: (params) => (
        <ButtonBase {...params} sx={{ fontSize: 'inherit' }}>
          <IconifyIcon icon="material-symbols:calendar-today-outline-rounded" />
        </ButtonBase>
      ),
      popper: (props) => (
        <Popper
          {...props}
          sx={(theme) => ({
            zIndex: 10,
            [`& .${pickersLayoutClasses.root}`]: {
              width: 536,

              [`& .${dividerClasses.root}`]: {
                display: 'none',
              },

              [`& .${multiSectionDigitalClockClasses.root}`]: {
                width: 184,
                maxHeight: 388,
                p: theme.spacing(3),
              },
            },
          })}
        />
      ),
      actionBar: ActionBar,
    },
  },
  styleOverrides: {
    root: {
      width: 536,
    },
  },
};

export default DateTimePicker;
