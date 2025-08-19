import { useState, useEffect } from "react";

/**
 * Hook to detect if the user prefers reduced motion
 * @returns {boolean} true if user prefers reduced motion
 */
export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Create media query
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Set initial value
    setPrefersReducedMotion(mediaQuery.matches);

    // Create event listener
    const handleChange = (event) => {
      setPrefersReducedMotion(event.matches);
    };

    // Add event listener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
    }

    // Cleanup
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        // Fallback for older browsers
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * Get conditional animation duration based on reduced motion preference
 * @param {number} duration - Original duration in ms
 * @returns {number} Adjusted duration (0.01 if reduced motion is preferred)
 */
export function useAnimationDuration(duration) {
  const prefersReducedMotion = usePrefersReducedMotion();
  return prefersReducedMotion ? 0.01 : duration;
}

/**
 * Get conditional transition style based on reduced motion preference
 * @param {string} transition - Original transition value
 * @returns {string} Adjusted transition (none if reduced motion is preferred)
 */
export function useTransition(transition) {
  const prefersReducedMotion = usePrefersReducedMotion();
  return prefersReducedMotion ? "none" : transition;
}
