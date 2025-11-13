import { useState, useTransition, useCallback } from 'react';

export function useAsyncOperation() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const execute = useCallback(async (asyncFn) => {
    setError(null);
    try {
      const result = await asyncFn();
      startTransition(() => {
        setData(result);
      });
      return result;
    } catch (err) {
      setError(err.message || '操作失败');
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setData(null);
  }, []);

  return {
    isPending,
    error,
    data,
    execute,
    reset
  };
}
