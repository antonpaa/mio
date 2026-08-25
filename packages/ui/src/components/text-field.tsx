import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import { useState, type ReactElement } from 'react';

export interface TextFieldProps extends AriaTextFieldProps {
  label: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  /** For password fields (L-series): the in-field Show/Hide toggle. The
   * caller passes localized labels; the field flips its own type. */
  reveal?: { show: string; hide: string };
}

export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  reveal,
  type,
  ...props
}: TextFieldProps): ReactElement {
  const [revealed, setRevealed] = useState(false);
  const effectiveType = reveal !== undefined && revealed ? 'text' : type;
  const input = (
    <Input
      {...(placeholder !== undefined ? { placeholder } : {})}
      className={
        'w-full rounded-inner border border-border bg-surface px-3.5 py-2.5 text-sm text-ink ' +
        'placeholder:text-muted user-invalid:border-red' +
        (reveal !== undefined ? ' pr-16' : '')
      }
    />
  );
  return (
    <AriaTextField
      {...props}
      {...(effectiveType !== undefined ? { type: effectiveType } : {})}
      className="flex flex-col gap-1.5"
    >
      <Label className="text-sm font-medium text-ink-strong-secondary">{label}</Label>
      {reveal !== undefined ? (
        <div className="relative">
          {input}
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            className="absolute inset-y-0 right-3.5 text-sm font-medium text-teal hover:text-teal-hover"
          >
            {revealed ? reveal.hide : reveal.show}
          </button>
        </div>
      ) : (
        input
      )}
      {description !== undefined ? (
        <Text slot="description" className="text-xs text-secondary">
          {description}
        </Text>
      ) : null}
      <FieldError className="text-xs font-medium text-red">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
