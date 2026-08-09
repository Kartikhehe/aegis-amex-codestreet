import { Box, Tooltip } from '@mui/material';
import { lookupTerm } from 'aegis/glossary';

/**
 * A technical term with its definition attached.
 *
 * AEGIS design law: every technical term has a tooltip from the shared
 * glossary. Wrapping the term rather than annotating it separately means the
 * definition travels with the word wherever it is used.
 *
 * The dotted underline is the affordance -- it marks the word as explainable
 * without the visual noise of an icon beside every label.
 */
const Term = ({ term, children, definition, underline = true, sx, ...rest }) => {
  const text = definition ?? lookupTerm(term);

  if (!text) {
    // An unknown term renders plainly rather than showing an empty tooltip.
    return <>{children ?? term}</>;
  }

  return (
    <Tooltip title={text} placement="top" enterDelay={300}>
      <Box
        component="span"
        sx={[
          {
            cursor: 'help',
            ...(underline && {
              borderBottom: '1px dotted',
              borderColor: 'text.disabled',
            }),
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...rest}
      >
        {children ?? term}
      </Box>
    </Tooltip>
  );
};

export default Term;
