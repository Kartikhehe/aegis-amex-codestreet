import { isValidElement } from 'react';
import { Stack, Typography } from '@mui/material';

const SectionHeader = ({ title, subTitle, actionComponent, ...rest }) => {
  return (
    <Stack
      spacing={2}
      {...rest}
      sx={[
        {
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          mb: 4,
        },
        ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx]),
      ]}
    >
      <div>
        <Typography variant="h6" sx={{ mb: 1, whiteSpace: 'nowrap' }}>
          {title}
        </Typography>
        {typeof subTitle === 'string' && (
          <Typography variant="subtitle2" component="p" fontWeight="regular" color="text.secondary">
            {subTitle}
          </Typography>
        )}
        {isValidElement(subTitle) && subTitle}
      </div>
      {actionComponent}
    </Stack>
  );
};

export default SectionHeader;
