import { SvgIcon } from '@mui/material';

const CheckBoxBlankIcon = ({ sx, ...rest }) => {
  return (
    <SvgIcon
      sx={{
        fill: 'transparent',
        ...sx,
      }}
      {...rest}
    >
      <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="currentColor" />
    </SvgIcon>
  );
};

export default CheckBoxBlankIcon;
