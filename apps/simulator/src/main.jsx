import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import { createTheme } from './theme/theme';

const theme = createTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider
      theme={theme}
      // Dark by default, and the SAME storage key as the console: a member who
      // chose light mode in one surface gets it in the other.
      defaultMode="dark"
      modeStorageKey="aegis-mode"
      disableTransitionOnChange
    >
      <CssBaseline enableColorScheme />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
