import { Avatar } from '@mui/material';
import { getFileIcon } from 'lib/utils';
import IconifyIcon from 'components/base/IconifyIcon';

const FilePreview = ({ preview }) => {
  if (preview.preview) {
    return (
      <Avatar
        src={preview.preview}
        variant="rounded"
        sx={{
          width: 56,
          height: 56,
          borderRadius: 2,
          border: (theme) => `1px solid ${theme.vars.palette.dividerLight}`,
        }}
      />
    );
  }

  return (
    <Avatar
      variant="rounded"
      sx={{
        width: 56,
        height: 56,
        borderRadius: 2,
        bgcolor: 'background.elevation2',
      }}
    >
      <IconifyIcon
        icon={getFileIcon(preview.format)}
        sx={{ fontSize: 20, color: 'text.secondary' }}
      />
    </Avatar>
  );
};

export default FilePreview;
