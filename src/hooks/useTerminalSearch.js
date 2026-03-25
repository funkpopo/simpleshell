import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectTerminalSearchMatches,
  findSelectedTerminalSearchMatchIndex,
} from "../modules/terminal/searchResults.js";

const EMPTY_SEARCH_RESULTS = {
  count: 0,
  current: 0,
};

const SEARCH_DECORATIONS = Object.freeze({
  matchOverviewRuler: "#7CB8FF",
  activeMatchColorOverviewRuler: "#FFB020",
});

export const useTerminalSearch = ({
  searchAddonRef,
  termRef,
  isActive,
  searchAddonVersion = 0,
}) => {
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState(EMPTY_SEARCH_RESULTS);
  const [noMatchFound, setNoMatchFound] = useState(false);
  const searchTermRef = useRef(searchTerm);

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  const clearSearchState = useCallback(
    ({ clearSelection = false } = {}) => {
      if (clearSelection) {
        try {
          searchAddonRef.current?.clearDecorations?.();
        } catch {
          // ignore search cleanup errors
        }

        try {
          termRef.current?.clearSelection?.();
        } catch {
          // ignore terminal selection cleanup errors
        }
      }

      setSearchResults(EMPTY_SEARCH_RESULTS);
      setNoMatchFound(false);
    },
    [searchAddonRef, termRef],
  );

  const refreshSearchState = useCallback(
    (term = searchTermRef.current) => {
      const terminal = termRef.current;
      if (!term || !terminal) {
        setSearchResults(EMPTY_SEARCH_RESULTS);
        setNoMatchFound(false);
        return {
          matches: [],
          currentIndex: -1,
        };
      }

      const matches = collectTerminalSearchMatches(terminal, term);
      const currentIndex = findSelectedTerminalSearchMatchIndex(
        terminal,
        matches,
      );

      setSearchResults((prev) => ({
        count: matches.length,
        current:
          currentIndex >= 0
            ? currentIndex + 1
            : matches.length > 0
              ? Math.min(Math.max(prev.current || 1, 1), matches.length)
              : 0,
      }));
      setNoMatchFound(matches.length === 0);

      return {
        matches,
        currentIndex,
      };
    },
    [termRef],
  );

  const runSearch = useCallback(
    (direction = "next", options = {}) => {
      const searchAddon = searchAddonRef.current;
      const term = searchTermRef.current;

      if (!term) {
        clearSearchState({ clearSelection: true });
        return false;
      }

      if (!searchAddon) {
        refreshSearchState(term);
        return false;
      }

      try {
        const searchOptions = {
          decorations: SEARCH_DECORATIONS,
          incremental: direction === "next" && options.incremental === true,
        };
        const found =
          direction === "previous"
            ? searchAddon.findPrevious(term, searchOptions)
            : searchAddon.findNext(term, searchOptions);

        refreshSearchState(term);
        return found;
      } catch {
        setSearchResults(EMPTY_SEARCH_RESULTS);
        setNoMatchFound(true);
        return false;
      }
    },
    [clearSearchState, refreshSearchState, searchAddonRef],
  );

  const handleSearch = useCallback(() => runSearch("next"), [runSearch]);

  const handleSearchPrevious = useCallback(
    () => runSearch("previous"),
    [runSearch],
  );

  const openSearchBar = useCallback(() => {
    setShowSearchBar(true);
  }, []);

  const closeSearchBar = useCallback(() => {
    setShowSearchBar(false);
  }, []);

  const toggleSearchBar = useCallback(() => {
    setShowSearchBar((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!searchTerm) {
      clearSearchState({ clearSelection: true });
      return;
    }

    runSearch("next", { incremental: true });
  }, [clearSearchState, runSearch, searchAddonVersion, searchTerm]);

  useEffect(() => {
    if (!isActive && showSearchBar) {
      setShowSearchBar(false);
    }
  }, [isActive, showSearchBar]);

  useEffect(() => {
    const searchAddon = searchAddonRef.current;
    if (!searchAddon?.onAfterSearch) {
      return undefined;
    }

    const disposable = searchAddon.onAfterSearch(() => {
      refreshSearchState(searchTermRef.current);
    });

    return () => {
      if (typeof disposable?.dispose === "function") {
        disposable.dispose();
      }
    };
  }, [refreshSearchState, searchAddonRef, searchAddonVersion]);

  return {
    showSearchBar,
    searchTerm,
    searchResults,
    noMatchFound,
    setSearchTerm,
    handleSearch,
    handleSearchPrevious,
    openSearchBar,
    closeSearchBar,
    toggleSearchBar,
  };
};
