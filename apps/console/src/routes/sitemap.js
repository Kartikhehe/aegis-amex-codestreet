import paths from './paths';

/**
 * The console navigation.
 *
 * Four screens, one question each. A governance console that also carries a
 * kanban board and an email client teaches the operator that most of what they
 * see is decoration -- which is exactly the wrong instinct when one of these
 * screens is the fleet emergency stop.
 */
const sitemap = [
  {
    id: 'aegis',
    subheader: 'Governance',
    key: 'aegis',
    icon: 'material-symbols:security-rounded',
    items: [
      {
        name: 'Fleet overview',
        key: 'fleet',
        path: paths.aegisFleet,
        pathName: 'fleet',
        icon: 'material-symbols:monitor-heart-outline-rounded',
        active: true,
      },
      {
        name: 'Agents',
        key: 'agents',
        path: paths.aegisAgents,
        pathName: 'agents',
        icon: 'material-symbols:smart-toy-outline-rounded',
        active: true,
      },
      {
        name: 'Policy studio',
        key: 'policy',
        path: paths.aegisPolicy,
        pathName: 'policy',
        icon: 'material-symbols:rule-settings-rounded',
        active: true,
      },
      {
        name: 'Incidents & disputes',
        key: 'incidents',
        path: paths.aegisIncidents,
        pathName: 'incidents',
        icon: 'material-symbols:gavel-rounded',
        active: true,
      },
    ],
  },
];

export default sitemap;
