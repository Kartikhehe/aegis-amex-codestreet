import { SvgIcon, useTheme } from '@mui/material';

export const RadioCheckedIcon = (props) => {
  const theme = useTheme();

  return (
    <SvgIcon {...props}>
      <circle cx="8" cy="8" r="7.5" fill="currentColor" stroke="currentColor" />
      <circle cx="8" cy="8" r="3" fill={theme.palette.background.default} />
    </SvgIcon>
  );
};

export const RadioBlankIcon = ({ sx, ...rest }) => {
  return (
    <SvgIcon
      sx={{
        fill: 'transparent',
        ...sx,
      }}
      {...rest}
    >
      <circle cx="8" cy="8" r="7.5" stroke="currentColor" />
    </SvgIcon>
  );
};
