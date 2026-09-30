import React, { useEffect, useRef, useState } from 'react';
import { formatInt } from '../lib/format.js';
import { parseMoney } from '../lib/contracts.js';

/**
 * Amount field for large Ariary figures. Shows grouped digits
 * ("180 000 000") when idle so zeros can't be miscounted, and the raw
 * number while editing. The internal draft is the single source of truth
 * for what's displayed, kept in sync with `value` when the field isn't
 * focused — so external resets show through and programmatic fills replace
 * cleanly instead of appending.
 *
 * value: number | ''      onChange(number | '' | NaN)
 */
export default function MoneyInput({ value, onChange, id, invalid, ariaLabel, placeholder = '0', ...props }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef(null);

  const raw = value === '' || value == null || Number.isNaN(value) ? '' : String(value);
  const formatted = value === '' || value == null || Number.isNaN(value) ? '' : formatInt(value);

  // When not editing, mirror the external value into the draft.
  useEffect(() => {
    if (!focused) setDraft(formatted);
  }, [formatted, focused]);

  return (
    <input
      ref={ref}
      id={id}
      className="input tabular"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={draft}
      onFocus={() => {
        setFocused(true);
        setDraft(raw);
        // Select everything so the next keystroke replaces the amount.
        requestAnimationFrame(() => ref.current?.select());
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseMoney(e.target.value));
      }}
      {...props}
    />
  );
}
