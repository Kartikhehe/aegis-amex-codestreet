import { createTheme as muiCreateTheme } from '@mui/material';
import * as locales from '@mui/material/locale';
import Accordion, { AccordionDetails, AccordionSummary } from './components/Accordion';
import Alert from './components/Alert';
import AppBar from './components/AppBar';
import Autocomplete from './components/Autocomplete';
import { Avatar, AvatarGroup } from './components/Avatar';
import Backdrop from './components/Backdrop';
import Breadcrumbs from './components/Breadcrumbs';
import Button, { ButtonBase } from './components/Button';
import ButtonGroup from './components/ButtonGroup';
import Checkbox from './components/Checkbox';
import Chip from './components/Chip';
import CssBaseline from './components/CssBaseline';
import DataGrid from './components/DataGrid';
import Dialog from './components/Dialog';
import Divider from './components/Divider';
import Drawer from './components/Drawer';
import Fab from './components/Fab';
import ImageList, { ImageListItem } from './components/ImageList';
import Link from './components/Link';
import List, { ListItemButton, ListItemIcon, ListItemText } from './components/List';
import { MenuItem } from './components/Menu';
import Pagination, { PaginationItem } from './components/Pagination';
import Paper from './components/Paper';
import Popover from './components/Popover';
import Popper from './components/Popper';
import { CircularProgress, LinearProgress } from './components/Progress';
import Radio from './components/Radio';
import Rating from './components/Rating';
import Select from './components/Select';
import Stack from './components/Stack';
import Stepper, {
  Step,
  StepConnector,
  StepContent,
  StepIcon,
  StepLabel,
} from './components/Stepper';
import Switch from './components/Switch';
import { Tab, Tabs } from './components/Tab';
import Table, {
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from './components/Table';
import TablePagination from './components/TablePagination';
import ToggleButton, { ToggleButtonGroup } from './components/ToggleButton';
import Toolbar from './components/Toolbar';
import Tooltip from './components/Tooltip';
import Typography from './components/Typography';
import DateTimePicker from './components/pickers/date-time/DateTimePicker';
import DesktopDateTimePicker from './components/pickers/date-time/DesktopDateTimePicker';
import MobileDateTimePicker from './components/pickers/date-time/MobileDateTimePicker';
import StaticDateTimePicker from './components/pickers/date-time/StaticDateTimePicker';
import DateCalendar from './components/pickers/date/DateCalendar';
import DateField from './components/pickers/date/DateField';
import DatePicker from './components/pickers/date/DatePicker';
import DesktopDatePicker from './components/pickers/date/DesktopDatePicker';
import MobileDatePicker from './components/pickers/date/MobileDatePicker';
import DesktopTimePicker from './components/pickers/time/DesktopTimePicker';
import MobileTimePicker from './components/pickers/time/MobileTimePicker';
import MultiSectionDigitalClock from './components/pickers/time/MultiSectionDigitalClock';
import StaticTimePicker from './components/pickers/time/StaticTimePicker';
import TimeClock from './components/pickers/time/TimeClock';
import TimePicker from './components/pickers/time/TimePicker';
import FilledInput from './components/text-fields/FilledInput';
import FormControl from './components/text-fields/FormControl';
import FormControlLabel from './components/text-fields/FormControlLabel';
import FormHelperText from './components/text-fields/FormHelperText';
import Input, { InputBase } from './components/text-fields/Input';
import InputAdornment from './components/text-fields/InputAdornment';
import InputLabel from './components/text-fields/InputLabel';
import OutlinedInput from './components/text-fields/OutlinedInput';
import TextField from './components/text-fields/TextField';
import mixins from './mixins';
import createPalette from './palette';
import shadows, { darkShadows } from './shadows';
import sxConfig from './sxConfig';
import typography from './typography';

export const createTheme = (direction = 'ltr', locale = 'en-US') => {
  const muiLocales = locales[locale.split('-').join('')];

  return muiCreateTheme(
    {
      cssVariables: { colorSchemeSelector: 'data-aegis-color-scheme', cssVarPrefix: 'aegis' },
      shadows: ['none', ...shadows],
      colorSchemes: {
        light: {
          palette: createPalette('light'),
          shadows: ['none', ...shadows],
        },
        dark: {
          palette: createPalette('dark'),
          shadows: ['none', ...Array(shadows.length).fill(darkShadows[0])],
        },
      },
      typography,
      direction,
      unstable_sxConfig: sxConfig,
      mixins,
      components: {
        MuiAppBar: AppBar,
        MuiPaper: Paper,
        MuiDivider: Divider,
        MuiAccordion: Accordion,
        MuiAccordionSummary: AccordionSummary,
        MuiButton: Button,
        MuiFab: Fab,
        MuiToggleButton: ToggleButton,
        MuiToggleButtonGroup: ToggleButtonGroup,
        MuiButtonBase: ButtonBase,
        MuiButtonGroup: ButtonGroup,
        // input fields
        MuiTextField: TextField,
        MuiFilledInput: FilledInput,
        MuiOutlinedInput: OutlinedInput,
        MuiInputLabel: InputLabel,
        MuiInputAdornment: InputAdornment,
        MuiFormHelperText: FormHelperText,
        MuiInput: Input,
        MuiInputBase: InputBase,
        MuiFormControl: FormControl,
        MuiFormControlLabel: FormControlLabel,
        MuiAutocomplete: Autocomplete,
        // ----------
        MuiBreadcrumbs: Breadcrumbs,
        MuiSelect: Select,
        MuiDialog: Dialog,
        MuiAlert: Alert,
        MuiStack: Stack,
        MuiCheckbox: Checkbox,
        MuiRadio: Radio,
        MuiPagination: Pagination,
        MuiPaginationItem: PaginationItem,
        MuiTablePagination: TablePagination,
        MuiChip: Chip,
        MuiSwitch: Switch,
        MuiList: List,
        MuiListItemButton: ListItemButton,
        MuiListItemIcon: ListItemIcon,
        MuiListItemText: ListItemText,
        MuiMenuItem: MenuItem,
        MuiToolbar: Toolbar,
        MuiTooltip: Tooltip,
        MuiTabs: Tabs,
        MuiTab: Tab,
        MuiTypography: Typography,
        MuiCircularProgress: CircularProgress,
        MuiLinearProgress: LinearProgress,
        MuiAvatar: Avatar,
        MuiAvatarGroup: AvatarGroup,
        MuiAccordionDetails: AccordionDetails,
        MuiTableContainer: TableContainer,
        MuiTable: Table,
        MuiTableRow: TableRow,
        MuiTableCell: TableCell,
        MuiDataGrid: DataGrid,
        MuiTableSortLabel: TableSortLabel,
        MuiCssBaseline: CssBaseline,
        MuiLink: Link,
        MuiRating: Rating,
        MuiBackdrop: Backdrop,
        MuiPopover: Popover,
        MuiPopper: Popper,
        MuiDrawer: Drawer,
        MuiStepper: Stepper,
        MuiStep: Step,
        MuiStepIcon: StepIcon,
        MuiStepContent: StepContent,
        MuiStepLabel: StepLabel,
        MuiStepConnector: StepConnector,
        MuiDateCalendar: DateCalendar,
        MuiDatePicker: DatePicker,
        MuiMobileDatePicker: MobileDatePicker,
        MuiDateField: DateField,
        MuiDesktopDatePicker: DesktopDatePicker,
        MuiTimeClock: TimeClock,
        MuiTimePicker: TimePicker,
        MuiDesktopTimePicker: DesktopTimePicker,
        MuiMobileTimePicker: MobileTimePicker,
        MuiStaticTimePicker: StaticTimePicker,
        MuiMultiSectionDigitalClock: MultiSectionDigitalClock,
        MuiDateTimePicker: DateTimePicker,
        MuiDesktopDateTimePicker: DesktopDateTimePicker,
        MuiMobileDateTimePicker: MobileDateTimePicker,
        MuiStaticDateTimePicker: StaticDateTimePicker,
        MuiTableHead: TableHead,
        MuiImageList: ImageList,
        MuiImageListItem: ImageListItem,
      },
    },
    muiLocales,
  );
};
