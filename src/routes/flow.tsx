import { createFileRoute } from "@tanstack/react-router";
import { FlowTabs } from "../components/flow-tabs.tsx";
import { Card } from "../components/ui.tsx";

export const Route = createFileRoute("/flow")({ component: FlowPage });

function FlowPage() {
  return (
    <>
      <p className="text-[11px] uppercase tracking-widest text-fg-subtle">Weekly net flow</p>
      <h1 className="mt-1 font-display text-3xl">So sánh 4 tuần</h1>
      <div className="mt-4"><FlowTabs /></div>
      <Card className="mt-4 text-sm text-fg-muted">
        Chưa dựng. Dữ liệu tuần đã có trong <code>data/flow-latest.json</code>; trang này
        sẽ đọc cùng nguồn với <b>輸出入</b>. Để trống có chủ đích — thà rỗng còn hơn
        điền số mẫu trông như thật.
      </Card>
    </>
  );
}
