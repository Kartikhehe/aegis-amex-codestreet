export const ImageListItem = {
  defaultProps: {},
  styleOverrides: {
    root: {
      '& img': {
        objectFit: 'cover',
        width: '100%',
        display: 'block',
      },
    },
  },
};

const ImageList = {
  defaultProps: {},
  styleOverrides: {
    root: {
      marginTop: 0,
      marginBottom: 0,
    },
  },
};

export default ImageList;
