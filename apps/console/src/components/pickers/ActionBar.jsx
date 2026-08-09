import { Button, DialogActions, buttonClasses } from '@mui/material';
import { usePickerActionsContext } from '@mui/x-date-pickers';

const ActionBar = () => {
  const { cancelValueChanges, acceptValueChanges } = usePickerActionsContext();

  return (
    <DialogActions
      sx={(theme) => ({
        gridArea: '3 / 1 / auto / 4',
        padding: theme.spacing(0, 3, 2, 0),
        [`& .${buttonClasses.root}:last-of-type`]: { m: 0 },
      })}
    >
      <Button color="neutral" onClick={cancelValueChanges}>
        Cancel
      </Button>
      <Button onClick={acceptValueChanges}>Confirm</Button>
    </DialogActions>
  );
};

export default ActionBar;
