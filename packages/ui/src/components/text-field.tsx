import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import type { ReactElement } from 'react';

export interface TextFieldProps extends AriaTextFieldProps {
  label: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
}

export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  ...props
}: TextFieldProps): ReactElement {
  return (
    <AriaTextField {...props} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-ink-strong-secondary">{label}</Label>
      <Input
        {...(placeholder !== undefined ? { placeholder } : {})}
        className={
          'rounded-inner border border-border bg-surface px-3.5 py-2.5 text-sm text-ink ' +
          'placeholder:text-muted user-invalid:border-red'
        }
      />
      {description !== undefined ? (
        <Text slot="description" className="text-xs text-secondary">
          {description}
        </Text>
      ) : null}
      <FieldError className="text-xs font-medium text-red">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
