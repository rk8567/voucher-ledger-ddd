'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type BranchSelectorOption = Readonly<{
  value: string;
  label: string;
  href: string;
  disabled?: boolean;
}>;

export function BranchSelector({
  selectedValue,
  options,
}: Readonly<{
  selectedValue: string;
  options: readonly BranchSelectorOption[];
}>) {
  const router = useRouter();
  const [value, setValue] = useState(selectedValue);
  const effectiveValue = options.some((option) => option.value === value) ? value : options[0]?.value ?? '';

  useEffect(() => {
    setValue(selectedValue);
  }, [selectedValue]);

  return (
    <select
      className="branchSelector"
      aria-label="拠点"
      value={effectiveValue}
      onChange={(event) => {
        const nextValue = event.target.value;
        const option = options.find((candidate) => candidate.value === nextValue);
        if (!option || option.disabled) return;
        setValue(nextValue);
        router.push(option.href, { scroll: false });
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  );
}
