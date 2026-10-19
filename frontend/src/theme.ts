import {
  Badge,
  Button,
  createTheme,
  Drawer,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  Text,
  Textarea,
  TextInput,
  type MantineColorsTuple,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';

const SANS = "'Instrument Sans Variable', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";
const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";

/** Single accent: #0A6CFF at shade 6 */
const blue: MantineColorsTuple = ['#E7F0FF', '#CFE0FF', '#9EC0FF', '#6A9EFF', '#3D82FF', '#1F71FF', '#0A6CFF', '#005BE0', '#0050C8', '#0043A8'];
/** Dark mode: body #121212 (7), cards #222 (6), text #EDEDED (0) */
const dark: MantineColorsTuple = ['#EDEDED', '#CFCFCF', '#A3A3A3', '#7A7A7A', '#3A3A3A', '#2C2C2C', '#222222', '#121212', '#0D0D0D', '#080808'];

const filled = { variant: 'filled', radius: 'md' } as const;

export const theme = createTheme({
  colors: { blue, dark },
  primaryColor: 'blue',
  primaryShade: { light: 6, dark: 5 },
  fontFamily: SANS,
  fontFamilyMonospace: "'Geist Mono', ui-monospace, Consolas, monospace",
  headings: { fontFamily: SERIF, fontWeight: '400' },
  radius: { xs: '6px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Text: Text.extend({ defaultProps: { size: 'sm' } }),
    Button: Button.extend({ defaultProps: { fw: 500, radius: 'md' } }),
    Badge: Badge.extend({ defaultProps: { variant: 'light', radius: 'xl' }, styles: { root: { textTransform: 'none', fontWeight: 500 } } }),
    TextInput: TextInput.extend({ defaultProps: filled }),
    PasswordInput: PasswordInput.extend({ defaultProps: filled }),
    Textarea: Textarea.extend({ defaultProps: filled }),
    Select: Select.extend({ defaultProps: { ...filled, comboboxProps: { radius: 'md', shadow: 'md' } } }),
    DatePickerInput: DatePickerInput.extend({ defaultProps: filled }),
    NumberInput: NumberInput.extend({ defaultProps: filled }),
    MultiSelect: MultiSelect.extend({ defaultProps: { ...filled, comboboxProps: { radius: 'md', shadow: 'md' } } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'md' } }),
    Menu: Menu.extend({ defaultProps: { radius: 'md', shadow: 'lg' } }),
    Modal: Modal.extend({ defaultProps: { centered: true, radius: 'xl', overlayProps: { backgroundOpacity: 0.45, blur: 2 } } }),
    Drawer: Drawer.extend({ defaultProps: { overlayProps: { backgroundOpacity: 0.5, blur: 2 } } }),
  },
});
