import { useState, useTransition, useCallback } from 'react';

export function useForm(initialValues = {}, options = {}) {
  const { validate, onSubmit } = options;
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState(null);

  const handleChange = useCallback((nameOrEvent, value) => {
    const name = typeof nameOrEvent === 'string' ? nameOrEvent : nameOrEvent.target.name;
    const newValue = typeof nameOrEvent === 'string' ? value : nameOrEvent.target.value;

    setValues(prev => ({ ...prev, [name]: newValue }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  }, [errors]);

  const handleSubmit = useCallback(async (e) => {
    if (e?.preventDefault) {
      e.preventDefault();
    }

    if (validate) {
      const validationErrors = validate(values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
    }

    if (onSubmit) {
      setSubmitError(null);
      try {
        const result = await onSubmit(values);
        startTransition(() => {
          setValues(initialValues);
        });
        return result;
      } catch (err) {
        setSubmitError(err.message || '提交失败');
        throw err;
      }
    }
  }, [values, validate, onSubmit, initialValues]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setSubmitError(null);
  }, [initialValues]);

  const setValue = useCallback((name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  return {
    values,
    errors,
    isPending,
    submitError,
    handleChange,
    handleSubmit,
    reset,
    setValue,
    setValues
  };
}
