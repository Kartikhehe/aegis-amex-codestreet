import { Box, Typography } from '@mui/material';

const TableLabelDisplayedRows = ({ from, to, count }) => {
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-block' } }}>
        Showing
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 'bold', mx: 0.5 }}>
        {from}-{to} out of {count}
      </Typography>
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-block' } }}>
        items
      </Box>
    </Typography>
  );
};

export default TableLabelDisplayedRows;
