// Hover-warming. Sidebar NavLink fires `prefetchTab(path)` on mouseenter so
// the cache is warm by the time the user clicks.
//
// Cache keys / fetchers come from queries.ts so they cannot drift from what
// the page hooks read.

import { queryClient } from "./queryClient";
import {
  insightsDatasetQuery,
  jobsListQuery,
  requestsAggQuery,
  requestsListQuery,
  sessionsAggQuery,
  sessionsListQuery,
  toolsAggQuery,
  toolsListQuery,
  usersAggQuery,
  usersListQuery,
} from "./queries";

export type TabPath =
  | "/insights"
  | "/sessions"
  | "/requests"
  | "/tools"
  | "/users"
  | "/jobs";

export function prefetchTab(path: TabPath): void {
  switch (path) {
    case "/insights":
      void queryClient.prefetchQuery(insightsDatasetQuery());
      return;
    case "/sessions":
      void queryClient.prefetchInfiniteQuery(sessionsListQuery({}));
      void queryClient.prefetchQuery(sessionsAggQuery({}));
      return;
    case "/requests":
      void queryClient.prefetchInfiniteQuery(requestsListQuery({}));
      void queryClient.prefetchQuery(requestsAggQuery({}));
      return;
    case "/tools":
      void queryClient.prefetchInfiniteQuery(toolsListQuery({}));
      void queryClient.prefetchQuery(toolsAggQuery());
      return;
    case "/users":
      void queryClient.prefetchInfiniteQuery(usersListQuery({}));
      void queryClient.prefetchQuery(usersAggQuery());
      return;
    case "/jobs":
      void queryClient.prefetchQuery(jobsListQuery());
      return;
  }
}
