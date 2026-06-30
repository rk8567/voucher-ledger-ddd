'use client';

import { openEntryWorkflowEvent } from './entryWorkflowEvents';

type Workflow = 'movement' | 'inventory';

export function EntryWorkflowButtons() {
  return (
    <div className="entryWorkflowButtons" aria-label="Entry actions">
      <button type="button" className="toolbarButton primaryToolbarButton" onClick={() => openWorkflow('movement')}>
        新規レコード
      </button>
      <button type="button" className="toolbarButton" onClick={() => openWorkflow('inventory')}>
        現在高チェック
      </button>
    </div>
  );
}

function openWorkflow(workflow: Workflow): void {
  window.dispatchEvent(new CustomEvent(openEntryWorkflowEvent, { detail: workflow }));
}
