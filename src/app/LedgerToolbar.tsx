'use client';

type Workflow = 'movement' | 'inventory';

type LedgerToolbarProps = Readonly<{
  exportHref: string;
  showAllHref: string;
  unsortHref: string;
}>;

const openEntryWorkflowEvent = 'voucher-ledger:open-entry-workflow';

export function LedgerToolbar({
  exportHref,
  showAllHref,
  unsortHref,
}: LedgerToolbarProps) {
  function openWorkflow(workflow: Workflow) {
    window.dispatchEvent(new CustomEvent<Workflow>(openEntryWorkflowEvent, { detail: workflow }));
  }

  return (
    <section className="commandToolbar" aria-label="FileMaker commands">
      <div className="toolbarGroup" aria-label="File">
        <a className="toolbarButton" href={exportHref}>CSV出力</a>
      </div>
      <div className="toolbarGroup" aria-label="View">
        <a className="toolbarButton" href={showAllHref}>全件表示</a>
      </div>
      <div className="toolbarGroup" aria-label="Records">
        <button type="button" className="toolbarButton" onClick={() => openWorkflow('movement')}>新規レコード</button>
        <button type="button" className="toolbarButton" onClick={() => openWorkflow('inventory')}>現在高チェック</button>
      </div>
      <div className="toolbarGroup" aria-label="Sort">
        <a className="toolbarButton" href={unsortHref}>標準ソート</a>
      </div>
    </section>
  );
}

export { openEntryWorkflowEvent };
