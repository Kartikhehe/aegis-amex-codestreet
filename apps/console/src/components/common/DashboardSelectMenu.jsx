import { MenuItem } from '@mui/material';
import StyledFormControl from 'components/styled/StyledFormControl';
import StyledTextField from 'components/styled/StyledTextField';

const defaultOptions = [
  {
    value: 1,
    label: 'Last month',
  },
  {
    value: 6,
    label: 'Last 6 months',
  },
  {
    value: 12,
    label: 'Last 12 months',
  },
];

const DashboardSelectMenu = ({
  options = defaultOptions,
  onChange,
  defaultValue,
  size = 'small',
  sx,
}) => {
  const handleChange = (value) => {
    if (onChange) {
      onChange(value);
    }
  };

  return (
    <StyledFormControl sx={{ width: 150, minWidth: 120, ...sx }} size="small" variant="filled">
      <StyledTextField
        select
        defaultValue={defaultValue}
        size={size}
        onChange={({ target: { value } }) => handleChange(value)}
      >
        {options.map((option) => (
          <MenuItem value={option.value} key={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </StyledTextField>
    </StyledFormControl>
  );
};

export default DashboardSelectMenu;
