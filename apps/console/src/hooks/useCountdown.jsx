import { useEffect, useRef, useState } from 'react';

const useCountdown = () => {
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const timerRef = useRef(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = null;
  };

  const startTimer = (seconds, onComplete) => {
    if (timerRef.current) {
      stopTimer();
    }
    setTime(seconds);
    timeRef.current = seconds;
    timerRef.current = setInterval(() => {
      if (timeRef.current > 0) {
        setTime((prev) => prev - 1);
        timeRef.current = timeRef.current - 1;
      } else {
        stopTimer();
        if (onComplete) {
          onComplete();
        }
      }
    }, 1000);
  };

  useEffect(() => {
    return () => stopTimer();
  }, []);

  return { time, startTimer, stopTimer };
};

export default useCountdown;
