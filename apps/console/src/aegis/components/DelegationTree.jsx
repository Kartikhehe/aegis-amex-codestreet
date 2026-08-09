import { Box, Chip, Stack, Typography } from '@mui/material';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { formatCurrency } from 'aegis/format';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';

/**
 * The delegation tree.
 *
 * Authority narrows as it flows down, and the tree has to make that legible at
 * a glance -- each child shows its own ceiling, so an operator can see the
 * narrowing rather than take it on faith. Revoked nodes are struck through and
 * kept in place: deleting them would hide that the authority ever existed,
 * which is exactly what an auditor needs to see.
 */

const statusColor = (status, breakerTripped) => {
  if (status === 'revoked') return 'error';
  if (status === 'suspended') return 'warning';
  if (breakerTripped) return 'error';
  return 'success';
};

const NodeLabel = ({ node, onSelect, selectedId }) => {
  const revoked = node.status === 'revoked';
  const selected = node.agent_id === selectedId;

  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(node.agent_id);
      }}
      sx={{
        py: 0.75,
        px: 1,
        borderRadius: 1.5,
        minWidth: 0,
        cursor: 'pointer',
        backgroundColor: selected ? 'background.elevation3' : 'transparent',
        '&:hover': { backgroundColor: 'background.elevation2' },
      }}
    >
      <Box
        sx={(theme) => ({
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: theme.vars.palette[statusColor(node.status, node.breaker_tripped)].main,
        })}
      />

      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 600,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(revoked && { textDecoration: 'line-through', color: 'text.disabled' }),
        }}
      >
        {node.name}
      </Typography>

      <Mono variant="monoCaption" sx={{ color: 'text.disabled', flexShrink: 0 }}>
        {formatCurrency(node.per_transaction_ceiling)}
      </Mono>

      {node.breaker_tripped && (
        <Chip size="small" variant="soft" color="error" label="breaker" sx={{ height: 18 }} />
      )}
      {revoked && (
        <Chip size="small" variant="soft" color="error" label="revoked" sx={{ height: 18 }} />
      )}
    </Stack>
  );
};

const renderNode = (node, onSelect, selectedId) => (
  <TreeItem
    key={node.agent_id}
    itemId={node.agent_id}
    label={<NodeLabel node={node} onSelect={onSelect} selectedId={selectedId} />}
  >
    {(node.children ?? []).map((child) => renderNode(child, onSelect, selectedId))}
  </TreeItem>
);

const collectIds = (node, acc = []) => {
  if (!node) return acc;
  acc.push(node.agent_id);
  (node.children ?? []).forEach((child) => collectIds(child, acc));
  return acc;
};

const DelegationTree = ({ tree, onSelect, selectedId }) => {
  if (!tree) return null;

  return (
    <SimpleTreeView
      defaultExpandedItems={collectIds(tree)}
      slots={{
        collapseIcon: () => (
          <IconifyIcon icon="material-symbols:expand-more-rounded" sx={{ fontSize: 18 }} />
        ),
        expandIcon: () => (
          <IconifyIcon icon="material-symbols:chevron-right-rounded" sx={{ fontSize: 18 }} />
        ),
      }}
      sx={(theme) => ({
        // Connector lines: the visual claim that authority descends.
        '& .MuiTreeItem-group': {
          marginLeft: 2,
          paddingLeft: 2,
          borderLeft: `1px dashed ${theme.vars.palette.divider}`,
        },
        '& .MuiTreeItem-content': { padding: 0 },
      })}
    >
      {renderNode(tree, onSelect, selectedId)}
    </SimpleTreeView>
  );
};

export default DelegationTree;
