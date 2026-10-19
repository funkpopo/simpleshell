import styles from "../AIChatWindow.module.css";

// The module also owns state modifiers and classes used by command cards.
export const aiClassName = (names) =>
  names
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => styles[name] || name)
    .join(" ");
