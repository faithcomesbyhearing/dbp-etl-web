import { useEffect, useState } from "react";

export function useAsync<T>(
  f: () => Promise<T>
):
  | {
      loading: true;
      error: null;
      value: undefined;
    }
  | {
      loading: false;
      error: null;
      value: T;
    }
  | {
      loading: false;
      error: Error;
      value: undefined;
    } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    f()
      .then((value) => {
        setValue(value);
        setLoading(false);
      })
      .catch((error: Error) => {
        setError(error);
        setLoading(false);
      });
  }, []);

  return { loading, error, value } as any;
}
