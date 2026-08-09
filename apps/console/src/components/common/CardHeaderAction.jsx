import { Box } from '@mui/material';

const CardHeaderAction = ({ children, sx }) => {
  return <Box sx={{ mx: '-10px', ...sx }}>{children}</Box>;
};

export default CardHeaderAction;
