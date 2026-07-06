'use client';

import { openEntryWorkflowEvent } from './entryWorkflowEvents';

type Workflow = 'movement' | 'inventory';

type EntryWorkflowButtonsProps = Readonly<{
  correctionDisabled?: boolean;
}>;

export function EntryWorkflowButtons({ correctionDisabled = true }: EntryWorkflowButtonsProps) {
  return (
    <div className="entryWorkflowButtons" aria-label="Entry actions">
      <button type="button" className="toolbarButton" disabled={correctionDisabled} onClick={() => openWorkflow('correction')}>
        赤伝票で訂正
      </button>
      <button type="button" className="toolbarButton" onClick={() => openWorkflow('inventory')}>
        現在高チェック
      </button>
      <button type="button" className="toolbarButton primaryToolbarButton" onClick={() => openWorkflow('movement')}>
        新規レコード
      </button>
    </div>
  );
}

function openWorkflow(workflow: Workflow | 'correction'): void {
  window.dispatchEvent(new CustomEvent(openEntryWorkflowEvent, { detail: workflow }));
}
