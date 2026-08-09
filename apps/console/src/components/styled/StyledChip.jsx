import { Chip, chipClasses, styled } from '@mui/material';

const StyledChip = styled((props) => <Chip {...props} />, {
  shouldForwardProp: (prop) => prop !== 'iconPosition',
})(({ iconPosition }) => ({
  ...(iconPosition === 'end' && {
    [`& .${chipClasses.icon}`]: {
      order: 1,
    },
  }),
}));

export default StyledChip;
