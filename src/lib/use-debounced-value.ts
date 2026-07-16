"use client";

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 250) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [delay, value]);

  return debouncedValue;
}
