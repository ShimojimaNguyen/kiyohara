import { createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";

/* TanStack Start 1.168 nạp router qua virtual module `#tanstack-router-entry`
   và đòi đúng tên export này. Phần `declare module Register` do
   routeTree.gen.ts tự sinh — không khai lại ở đây để tránh hai khai báo đá nhau. */
export function getRouter() {
  /* MỘT QueryClient MỖI ROUTER, không phải một cái toàn cục.
     getRouter() chạy lại cho từng request SSR; một client dùng chung giữa các
     request sẽ cho người này thấy cache của người kia. */
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Quét chạy hàng tuần — refetch mỗi lần focus tab là vô ích.
        staleTime: 5 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });

  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
