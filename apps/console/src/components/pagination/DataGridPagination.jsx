import { TablePagination, useEventCallback } from '@mui/material';
import DataGridPaginationAction from './DataGridPaginationAction';
import TableLabelDisplayedRows from './TableLabelDisplayedRows';

const DataGridPagination = function BasePagination({ ref, ...props }) {
  const { onRowsPerPageChange, disabled, showFullPagination = false, showAllHref, ...rest } = props;

  return (
    <TablePagination
      showFirstButton
      showLastButton
      component="div"
      ActionsComponent={(props) => (
        <DataGridPaginationAction showFullPagination={showFullPagination} {...props} />
      )}
      onRowsPerPageChange={useEventCallback((event) => {
        onRowsPerPageChange?.(Number(event.target.value));
      })}
      labelDisplayedRows={TableLabelDisplayedRows}
      {...rest}
      ref={ref}
    />
  );
};

export default DataGridPagination;
