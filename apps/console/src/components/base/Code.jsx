import { Box } from '@mui/material';

const Code = ({ sx, ...props }) => {
  return (
    <Box
      sx={[
        (theme) => ({
          bgcolor: theme.vars.palette.background.elevation1,
          py: 0.25,
          px: 0.75,
          fontSize: 10,
          verticalAlign: 'middle',
          borderRadius: 1,
          lineHeight: 1.4,
          fontFamily: 'Spline Sans Mono',
          border: `1px solid ${theme.vars.palette.background.elevation3}`,
          color: theme.vars.palette.chGrey[700],
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      component="code"
      {...props}
    />
  );
};

export default Code;
