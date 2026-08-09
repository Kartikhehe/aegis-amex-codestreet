import { tableCellClasses, tableHeadClasses, tableRowClasses } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';

const Table = {
  styleOverrides: {
    root: ({ theme }) => ({
      '&.disable-edge-padding': {
        [`& .${tableHeadClasses.root}`]: {
          '& th': {
            backgroundColor: 'transparent',
          },
        },
        [`& .${tableCellClasses.head}`]: {
          borderBottom: `1px solid ${theme.vars.palette.dividerLight}`,
        },
        [`& .${tableRowClasses.root}`]: {
          '& td, & th': {
            '&:first-of-type': { paddingLeft: 0 },
            '&:last-of-type': { paddingRight: 0 },
          },
        },
      },
    }),
  },
};

export const TableContainer = {
  styleOverrides: {
    root: {
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
  },
};

export const TableRow = {
  defaultProps: {},
  styleOverrides: {
    root: () => ({
      '& td, & th': {
        '&:first-of-type': { paddingLeft: 24 },
        '&:last-of-type': { paddingRight: 24 },
      },
    }),
  },
};

export const TableHead = {
  styleOverrides: {
    root: ({ theme }) => ({
      '& th': {
        backgroundColor: theme.vars.palette.background.elevation1,
        borderBottom: 0,
        paddingTop: 12,
        paddingBottom: 12,
      },
    }),
  },
};

export const TableCell = {
  styleOverrides: {
    root: ({ theme }) => ({
      borderBottom: `1px solid ${theme.vars.palette.dividerLight}`,
      [`&.${tableCellClasses.body}`]: {
        color: theme.vars.palette.text.secondary,
        ...theme.typography.subtitle2,
        fontWeight: 400,
      },
    }),
    stickyHeader: {
      backgroundColor: 'transparent',
    },
  },
};
export const TableSortLabel = {
  defaultProps: {
    IconComponent: (props) => <IconifyIcon icon="material-symbols:sort-rounded" {...props} />,
  },
  styleOverrides: {
    icon: {
      transition: 'none',
    },
    iconDirectionAsc: {
      transform: 'rotateX(180deg)',
    },
  },
};

export default Table;
