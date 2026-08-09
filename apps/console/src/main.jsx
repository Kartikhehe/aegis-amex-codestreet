import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import BreakpointsProvider from 'providers/BreakpointsProvider';
import NotistackProvider from 'providers/NotistackProvider';
import SettingsProvider from 'providers/SettingsProvider';
import ThemeProvider from 'providers/ThemeProvider';
import router from 'routes/router';
import SWRConfiguration from 'services/configuration/SWRConfiguration';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SWRConfiguration>
      <SettingsProvider>
        <ThemeProvider>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <NotistackProvider>
              <BreakpointsProvider>
                <RouterProvider router={router} />
              </BreakpointsProvider>
            </NotistackProvider>
          </LocalizationProvider>
        </ThemeProvider>
      </SettingsProvider>
    </SWRConfiguration>
  </React.StrictMode>,
);
