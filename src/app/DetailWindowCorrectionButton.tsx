'use client';

import { useRouter } from 'next/navigation';

import { openEntryWorkflowEvent } from './entryWorkflowEvents';

type DetailWindowCorrectionButtonProps = Readonly<{
  closeHref: string;
  disabled: boolean;
}>;

export function DetailWindowCorrectionButton({ closeHref, disabled }: DetailWindowCorrectionButtonProps) {
  const router = useRouter();

  return (
    <div className="detailActions">
      <button
        type="button"
        className="secondaryButton"
        disabled={disabled}
        onClick={() => {
          window.dispatchEvent(new CustomEvent(openEntryWorkflowEvent, { detail: 'correction' }));
          router.push(closeHref, { scroll: false });
        }}
      >
        赤伝票で訂正
      </button>
    </div>
  );
}
