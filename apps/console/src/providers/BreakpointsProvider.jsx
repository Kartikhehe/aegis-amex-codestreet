import { createContext, use, useEffect, useState } from 'react';
import { useMediaQuery } from '@mui/material';

export const BreakpointContext = createContext({});

const BreakpointsProvider = ({ children }) => {
  const [currentBreakpoint, setCurrentBreakpoint] = useState('xs');
  const up = (key) => useMediaQuery((theme) => theme.breakpoints.up(key));

  const down = (key) => useMediaQuery((theme) => theme.breakpoints.down(key));

  const only = (key) => useMediaQuery((theme) => theme.breakpoints.only(key));

  const between = (start, end) => useMediaQuery((theme) => theme.breakpoints.between(start, end));

  const isXs = between('xs', 'sm');
  const isSm = between('sm', 'md');
  const isMd = between('md', 'lg');
  const isLg = between('lg', 'xl');
  const isXl = up('xl');

  useEffect(() => {
    if (isXs) {
      setCurrentBreakpoint('xs');
    }
    if (isSm) {
      setCurrentBreakpoint('sm');
    }
    if (isMd) {
      setCurrentBreakpoint('md');
    }
    if (isLg) {
      setCurrentBreakpoint('lg');
    }
    if (isXl) {
      setCurrentBreakpoint('xl');
    }
  }, [isXs, isSm, isMd, isLg, isXl]);

  return (
    <BreakpointContext value={{ currentBreakpoint, up, down, only, between }}>
      {children}
    </BreakpointContext>
  );
};

export const useBreakpoints = () => use(BreakpointContext);

export default BreakpointsProvider;
