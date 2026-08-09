import { CircularProgress, Stack } from '@mui/material';

const DefaultLoader = () => {
  return (
    <Stack
      sx={{
        justifyContent: 'center',
        alignItems: 'center',
        height: 1,
        width: 1,
      }}
    >
      <CircularProgress />
    </Stack>
  );
};

export default DefaultLoader;
