// Form alanları: her alan görünür etiket, isteğe bağlı ipucu ve hata metniyle gelir
// (aria-describedby / aria-invalid otomatik bağlanır).
import { useId, type ComponentProps, type ReactNode } from "react";
import { cx } from "./basic";

export interface FieldProps {
  label: ReactNode;
  /** Kontrolün id'si (label for) */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Etiket gizli (yalnızca ekran okuyucu) */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
  hintId?: string;
  errorId?: string;
}

/** Etiket + kontrol + ipucu + hata sarmalayıcı. Hazır Input/Textarea/Select bunu kullanır. */
export function Field({ label, htmlFor, hint, error, required, hideLabel, children, className, hintId, errorId }: FieldProps) {
  return (
    <div className={cx("field", error ? "field-invalid" : null, className)}>
      <label className={cx("field-label", hideLabel && "sr-only")} htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field-required" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (zorunlu)</span> : null}
      </label>
      {children}
      {hint ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function useFieldIds(id: string | undefined, hint: unknown, error: unknown) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? fid + "-hint" : undefined;
  const errorId = error ? fid + "-err" : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { fid, hintId, errorId, describedBy };
}

interface CommonFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  fieldClassName?: string;
}

export type InputProps = ComponentProps<"input"> & CommonFieldProps;

export function Input({ label, hint, error, hideLabel, fieldClassName, id, className, required, ...rest }: InputProps) {
  const { fid, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  return (
    <Field label={label} htmlFor={fid} hint={hint} error={error} required={required} hideLabel={hideLabel} className={fieldClassName} hintId={hintId} errorId={errorId}>
      <input id={fid} className={cx("input", className)} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
    </Field>
  );
}

export type TextareaProps = ComponentProps<"textarea"> & CommonFieldProps & { showCount?: boolean };

export function Textarea({ label, hint, error, hideLabel, fieldClassName, id, className, required, showCount, value, maxLength, ...rest }: TextareaProps) {
  const { fid, hintId, errorId, describedBy } = useFieldIds(id, hint || showCount, error);
  const len = typeof value === "string" ? value.length : 0;
  return (
    <Field
      label={label}
      htmlFor={fid}
      hint={
        showCount ? (
          <span className="field-hint-row">
            <span>{hint}</span>
            <span className="field-count" aria-live="polite">
              {len}
              {maxLength ? ` / ${maxLength}` : ""}
            </span>
          </span>
        ) : (
          hint
        )
      }
      error={error}
      required={required}
      hideLabel={hideLabel}
      className={fieldClassName}
      hintId={hintId}
      errorId={errorId}
    >
      <textarea
        id={fid}
        className={cx("input", "textarea", className)}
        required={required}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = Omit<ComponentProps<"select">, "children"> &
  CommonFieldProps & {
    options: SelectOption[];
    /** Boş seçenek metni (ör. "Seçin…") */
    placeholder?: string;
  };

export function Select({ label, hint, error, hideLabel, fieldClassName, id, className, required, options, placeholder, ...rest }: SelectProps) {
  const { fid, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  return (
    <Field label={label} htmlFor={fid} hint={hint} error={error} required={required} hideLabel={hideLabel} className={fieldClassName} hintId={hintId} errorId={errorId}>
      <select id={fid} className={cx("input", "select", className)} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export type CheckboxProps = Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
};

/** Onay kutusu: etiket kutunun sağında, ipucu altında. */
export function Checkbox({ label, hint, error, fieldClassName, id, className, ...rest }: CheckboxProps) {
  const { fid, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  return (
    <div className={cx("check", error ? "field-invalid" : null, fieldClassName)}>
      <input id={fid} type="checkbox" className={cx("check-input", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      <div className="check-text">
        <label htmlFor={fid} className="check-label">
          {label}
        </label>
        {hint ? (
          <div className="field-hint" id={hintId}>
            {hint}
          </div>
        ) : null}
        {error ? (
          <div className="field-error" id={errorId} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
  label: ReactNode;
  name?: string;
  value: V | null;
  onChange: (v: V) => void;
  options: RadioOption<V>[];
  hint?: ReactNode;
  error?: ReactNode;
  /** Yan yana (geniş ekranda) ya da kart görünümlü seçenekler */
  layout?: "stack" | "inline" | "cards";
  disabled?: boolean;
  required?: boolean;
}

/** Erişilebilir radyo grubu (<fieldset> + <legend>). */
export function RadioGroup<V extends string>({ label, name, value, onChange, options, hint, error, layout = "stack", disabled, required }: RadioGroupProps<V>) {
  const auto = useId();
  const groupName = name ?? auto;
  const hintId = hint ? auto + "-hint" : undefined;
  const errorId = error ? auto + "-err" : undefined;
  return (
    <fieldset className={cx("radio-group", `radio-${layout}`, error ? "field-invalid" : null)} aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined} disabled={disabled}>
      <legend className="field-label">
        {label}
        {required ? <span className="sr-only"> (zorunlu)</span> : null}
      </legend>
      {hint ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      <div className="radio-options">
        {options.map((o) => {
          const oid = `${auto}-${o.value}`;
          return (
            <div className={cx("radio", value === o.value && "radio-checked")} key={o.value}>
              <input
                type="radio"
                id={oid}
                name={groupName}
                value={o.value}
                checked={value === o.value}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                aria-describedby={o.hint ? oid + "-h" : undefined}
                required={required}
              />
              <div className="check-text">
                <label htmlFor={oid} className="check-label">
                  {o.label}
                </label>
                {o.hint ? (
                  <div className="field-hint" id={oid + "-h"}>
                    {o.hint}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </fieldset>
  );
}
