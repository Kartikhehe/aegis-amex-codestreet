import { Stack, Typography } from '@mui/material';

/**
 * Screen header: the question the screen answers, then the detail.
 *
 * Each AEGIS screen exists to answer one operator question ("What is happening
 * now?", "What may this agent do?"). Putting that question in the header keeps
 * the screen honest about its job -- if a panel does not help answer it, it
 * belongs somewhere else.
 */
const PageHeader = ({ title, question, actions }) => (
  <Stack
    direction={{ xs: 'column', sm: 'row' }}
    spacing={2}
    alignItems={{ xs: 'flex-start', sm: 'center' }}
    justifyContent="space-between"
    sx={{ mb: 3 }}
  >
    {/* component="div" on both: as inline spans the subtitle wrapped onto the
        title's baseline instead of sitting under it. */}
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
        {title}
      </Typography>
      {question && (
        <Typography component="div" variant="body2" sx={{ color: 'text.secondary' }}>
          {question}
        </Typography>
      )}
    </Stack>
    {actions && (
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexShrink: 0 }}>
        {actions}
      </Stack>
    )}
  </Stack>
);

export default PageHeader;
