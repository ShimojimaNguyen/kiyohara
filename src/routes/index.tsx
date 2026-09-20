import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "../components/ui.tsx";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <>
      <p className="text-[11px] uppercase tracking-widest text-fg-subtle">Japanese equities · value screen</p>
      <h1 className="mt-1 font-display text-3xl">KIYOHARA</h1>
      <Card className="mt-4">
        <Link to="/trade" className="font-display text-xl text-accent">Tiền vào qua xuất nhập →</Link>
        <p className="mt-2 text-sm text-fg-muted">
          USDJPY và dòng ròng tuần của 492 mã TOPIX Core30/Large70/Mid400, tách 輸出 / 輸入 / 商社.
        </p>
      </Card>
    </>
  );
}
