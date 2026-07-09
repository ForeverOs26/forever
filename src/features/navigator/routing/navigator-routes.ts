export const navigatorRoutePaths = {
  root: "/navigator",
  session: "/navigator/session/$sessionId",
  decisionProfile: "/navigator/session/$sessionId/decision-profile",
  foreverStory: "/navigator/session/$sessionId/forever-story",
  decisionDesk: "/navigator/session/$sessionId/decision-desk",
  recommendations: "/navigator/session/$sessionId/recommendations",
} as const;

export type NavigatorRouteKey = keyof typeof navigatorRoutePaths;
