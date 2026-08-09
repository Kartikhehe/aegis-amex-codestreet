import { Box } from '@mui/material';
import SimpleBarReact from 'simplebar-react';

const SimpleBar = ({ disableHorizontal, sx, ...rest }) => {
  return (
    <Box
      component={SimpleBarReact}
      autoHide
      {...rest}
      sx={[
        {
          height: 1,
          '& .simplebar-content': {
            height: 1,
          },
        },
        !!disableHorizontal && {
          '& .simplebar-horizontal': {
            display: 'none',
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
};

export default SimpleBar;
