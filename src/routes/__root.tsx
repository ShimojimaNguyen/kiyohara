import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell.tsx";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "KIYOHARA" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="vi">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppShell>
          <Outlet />
        </AppShell>
        <Scripts />
      </body>
    </html>
  );
}
