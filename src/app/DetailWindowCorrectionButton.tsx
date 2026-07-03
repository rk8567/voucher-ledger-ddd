'use client';

import { openEntryWorkflowEvent } from './entryWorkflowEvents';

type DetailWindowCorrectionButtonProps = Readonly<{
  disabled: boolean;
}>;

export function DetailWindowCorrectionButton({ disabled }: DetailWindowCorrectionButtonProps) {
  return (
    <div className="detailWindowActions">
      <button
        type="button"
        className="toolbarButton secondaryButton"
        disabled={disabled}
        onClick={() => {
          window.dispatchEvent(new CustomEvent(openEntryWorkflowEvent, { detail: 'correction' }));
        }}
      >
        赤伝票で訂正
      </button>
    </div>
  );
}
