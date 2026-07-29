import { REDUCED_MOTION_QUERY } from "@/lib/reducedMotion";
import { useMediaQuery } from "./useMediaQuery";

// Only JS-driven animation needs this; CSS is covered by the global duration
// reset in `app.css`.
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
