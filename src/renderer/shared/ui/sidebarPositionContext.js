import { createContext, useContext } from "react";

export const SidebarPositionContext = createContext("right");

export function useSidebarPosition() {
  return useContext(SidebarPositionContext);
}
