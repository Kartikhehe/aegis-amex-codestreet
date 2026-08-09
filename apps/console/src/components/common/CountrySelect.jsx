import { Autocomplete, Box, TextField } from '@mui/material';
import { countries } from 'data/countries';
import IconifyIcon from 'components/base/IconifyIcon';

const CountrySelect = ({
  ref,
  options = countries,
  fields = { flag: true, name: true, phone: false, code: false },
  renderInput = (params) => <TextField {...params} />,
  ...props
}) => {
  return (
    <Autocomplete
      ref={ref}
      id="country-select"
      options={options}
      autoHighlight
      getOptionLabel={(option) => option.label}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;

        return (
          <Box
            key={option.code}
            component="li"
            sx={{ '& > img': { mr: 2, flexShrink: 0 } }}
            {...optionProps}
          >
            {fields?.flag && <IconifyIcon icon={option.flag} sx={{ mr: 1 }} />}
            {fields?.name && option.label} {fields?.code && `(${option.code})`}{' '}
            {fields?.phone && '+' + option.phone}
          </Box>
        );
      }}
      renderInput={renderInput}
      {...props}
    />
  );
};

CountrySelect.displayName = 'CountrySelect';

export default CountrySelect;
