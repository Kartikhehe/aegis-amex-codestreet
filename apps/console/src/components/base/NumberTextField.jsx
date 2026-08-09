import { TextField, inputBaseClasses } from '@mui/material';
import StyledTextField from 'components/styled/StyledTextField';

const NumberTextField = ({ ref, onChange, variant, sx, hideSpinButton = true, ...rest }) => {
  const Component = variant === 'custom' ? StyledTextField : TextField;

  return (
    <Component
      ref={ref}
      type="number"
      variant={variant === 'custom' ? 'filled' : variant}
      onChange={(event) => {
        event.target.value = event.target.value.replace(/^0+(?=\d)/, '');
        if (onChange) {
          onChange(event);
        }
      }}
      sx={[
        hideSpinButton && {
          '& ::-webkit-inner-spin-button': {
            WebkitAppearance: 'none',
            margin: 0,
            display: 'none',
          },
          [`& .${inputBaseClasses.input}`]: {
            MozAppearance: 'textfield',
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    />
  );
};

NumberTextField.displayName = 'NumberTextField';

export default NumberTextField;
